import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyHostData } from "../src/host-data.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("项目房间数据迁移", () => {
  it("只复制匹配 Captain 的旧数据，保留原数据库与凭据", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "vibe-git-host-data-")); roots.push(root);
    const source = resolve(root, "legacy");
    const target = resolve(root, "project", ".vibe-git", "host");
    await mkdir(resolve(source, "v20"), { recursive: true });
    await writeFile(resolve(source, "v20", "captain.json"), '{"nodeId":"captain-1"}\n', "utf8");
    const db = new DatabaseSync(resolve(source, "workspace.db"));
    db.exec("CREATE TABLE project (name TEXT); INSERT INTO project VALUES ('保留项目');");
    db.close();

    expect(await migrateLegacyHostData(target, "other", source)).toBe(false);
    expect(existsSync(target)).toBe(false);
    expect(await migrateLegacyHostData(target, "captain-1", source)).toBe(true);
    const copied = new DatabaseSync(resolve(target, "workspace.db"));
    try { expect(copied.prepare("SELECT name FROM project").get()).toEqual({ name: "保留项目" }); }
    finally { copied.close(); }
    expect(await readFile(resolve(target, "v20", "captain.json"), "utf8")).toContain("captain-1");
    expect(existsSync(resolve(source, "workspace.db"))).toBe(true);
    expect(await migrateLegacyHostData(target, "captain-1", source)).toBe(false);
  });
});
