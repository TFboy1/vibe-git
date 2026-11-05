import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase, transaction, afterCommit } from "../src/db/database.js";
import type { V20Service } from "../src/v20/service.js";

let root: string | undefined, app: Awaited<ReturnType<typeof buildApp>> | undefined;
afterEach(async () => {
  await app?.close(); app = undefined;
  if (root) { if (!root.startsWith(resolve(tmpdir(), "vibe-migration-"))) throw new Error("Unsafe cleanup"); await rm(root, { recursive: true, force: true }); root = undefined; }
});
async function oldDatabase(changes: string) {
  root = await mkdtemp(resolve(tmpdir(), "vibe-migration-"));
  const path = resolve(root, "room.db"), db = new DatabaseSync(path);
  db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  db.prepare("INSERT INTO meta VALUES (?,?)").run("coordination_intents", '[{"id":"intent-1","revision":3,"content":"保留正文","publishedStageId":null}]');
  db.prepare("INSERT INTO meta VALUES (?,?)").run("coordination_changes", changes); db.close();
  return { dbPath: path, dataDir: resolve(root, "data"), staticDir: false as const, cloudflareManager: { status: async () => null, close: async () => {} } as never };
}
it("迁移前备份，保留 ID、版本和原始 JSON，重启不重复导入", async () => {
  const raw = '[{"id":"change-1","stageId":"stage-1","status":"PENDING","revision":7,"createdAt":"2026-01-01","content":"原始变更"}]';
  const options = await oldDatabase(raw); app = await buildApp(options);
  const repo = (app as unknown as { v20Service: V20Service }).v20Service.repo;
  expect(repo.getCoordinationIntent("intent-1")).toMatchObject({ revision: 3, content: "保留正文" });
  expect(repo.getCoordinationChange("change-1")).toMatchObject({ revision: 7, content: "原始变更" });
  expect(repo.getMeta("coordination_changes")).toBe(raw);
  const backups = await readdir(resolve(options.dataDir, "backups")); expect(backups).toHaveLength(1);
  const marker = await readFile(resolve(options.dataDir, ".v023-database-backed-up"), "utf8"); expect(marker).toContain(backups[0]);
  repo.putCoordinationChange({ ...repo.getCoordinationChange("change-1")!, revision: 8 });
  await app.close(); app = await buildApp(options);
  const reopened = (app as unknown as { v20Service: V20Service }).v20Service.repo;
  expect(reopened.listCoordinationChanges()).toHaveLength(1); expect(reopened.getCoordinationChange("change-1")!.revision).toBe(8);
  expect(await readdir(resolve(options.dataDir, "backups"))).toHaveLength(1);
});
it("损坏的数据使整批迁移回滚，保留原始内容且允许修复后重启", async () => {
  const options = await oldDatabase("not-json"); await expect(buildApp(options)).rejects.toThrow("迁移失败");
  const db = new DatabaseSync(options.dbPath);
  expect(db.prepare("SELECT count(*) AS n FROM coordination_intents").get()).toMatchObject({ n: 0 });
  expect(db.prepare("SELECT value FROM meta WHERE key='coordination_tables_migrated'").get()).toBeUndefined();
  expect(db.prepare("SELECT value FROM meta WHERE key='coordination_changes'").get()).toMatchObject({ value: "not-json" });
  db.prepare("UPDATE meta SET value='[]' WHERE key='coordination_changes'").run(); db.close();
  app = await buildApp(options);
  expect((app as unknown as { v20Service: V20Service }).v20Service.repo.listCoordinationIntents()).toHaveLength(1);
});
it("嵌套事务成功后才发布事件，内外层回滚都不留下事件通知", () => {
  const db = openDatabase(":memory:"), received: string[] = [];
  try {
    transaction(db, () => {
      afterCommit(db, () => received.push("outer"));
      expect(() => transaction(db, () => { afterCommit(db, () => received.push("rolled-back")); throw new Error("rollback"); })).toThrow();
      transaction(db, () => afterCommit(db, () => received.push("inner")));
      expect(received).toEqual([]);
    });
    expect(received).toEqual(["outer", "inner"]);
    expect(() => transaction(db, () => { transaction(db, () => afterCommit(db, () => received.push("bad"))); throw new Error("rollback"); })).toThrow();
    expect(received).toEqual(["outer", "inner"]);
  } finally { db.close(); }
});
