import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema.js";

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(SCHEMA);
    migrateCoordination(db);
    return db;
  } catch (error) { db.close(); throw error; }
}

function migrateCoordination(db: DatabaseSync): void {
  if (db.prepare("SELECT value FROM meta WHERE key = 'coordination_tables_migrated'").get()) return;
  transaction(db, () => {
    for (const kind of ["intents", "changes"] as const) {
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get("coordination_" + kind) as { value: string } | undefined;
      if (!row) continue;
      const valid = db.prepare("SELECT json_valid(?) AS valid").get(row.value) as { valid: number };
      if (!valid.valid || (db.prepare("SELECT json_type(?) AS type").get(row.value) as { type: string }).type !== "array") throw new Error("旧协作数据迁移失败：" + kind + " 不是有效数组，原数据已保留");
      const invalid = db.prepare("SELECT 1 FROM json_each(?) WHERE type != 'object' OR json_type(value, '$.id') IS NOT 'text' OR length(json_extract(value, '$.id')) = 0 LIMIT 1").get(row.value);
      if (invalid) throw new Error("旧协作数据迁移失败：" + kind + " 缺少记录 ID，原数据已保留");
      if (kind === "intents") db.prepare("INSERT INTO coordination_intents SELECT json_extract(value, '$.id'), value FROM json_each(?)").run(row.value);
      else db.prepare("INSERT INTO coordination_changes SELECT json_extract(value,'$.id'), json_extract(value,'$.stageId'), json_extract(value,'$.status'), json_extract(value,'$.createdAt'), value FROM json_each(?)").run(row.value);
    }
    db.exec(`INSERT OR IGNORE INTO v20_requirement_versions(revision,data)
      SELECT json_extract(data,'$.requirementRevision'), json_object('revision',json_extract(data,'$.requirementRevision'),
        'markdown',json_extract(data,'$.requirementMarkdown'),'source','alignment','sourceId',json_extract(data,'$.sourceAlignmentId'),'createdAt',json_extract(data,'$.publishedAt'))
      FROM v20_stages WHERE json_extract(data,'$.requirementRevision') > 0 AND json_type(data,'$.requirementMarkdown')='text';
      INSERT INTO meta(key,value) VALUES ('coordination_tables_migrated','1');
      INSERT INTO meta(key,value) VALUES ('schema_version','23') ON CONFLICT(key) DO UPDATE SET value='23'`);
  });
}

const commitCallbacks = new WeakMap<DatabaseSync, Array<() => void>>();
export function afterCommit(db: DatabaseSync, callback: () => void): void {
  const callbacks = commitCallbacks.get(db);
  if (callbacks) callbacks.push(callback); else callback();
}

let nextSavepoint = 0;
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  const parent = commitCallbacks.get(db), callbacks: Array<() => void> = [];
  const savepoint = "vibe_" + nextSavepoint++;
  db.exec(parent ? "SAVEPOINT " + savepoint : "BEGIN IMMEDIATE");
  commitCallbacks.set(db, callbacks);
  let result: T;
  try {
    result = work();
    db.exec(parent ? "RELEASE " + savepoint : "COMMIT");
  } catch (error) {
    db.exec(parent ? "ROLLBACK TO " + savepoint : "ROLLBACK");
    if (parent) db.exec("RELEASE " + savepoint);
    throw error;
  } finally {
    if (parent) commitCallbacks.set(db, parent); else commitCallbacks.delete(db);
  }
  if (parent) parent.push(...callbacks); else for (const callback of callbacks) callback();
  return result;
}
