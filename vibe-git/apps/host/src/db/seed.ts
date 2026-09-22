import type { DatabaseSync } from "node:sqlite";
import {
  conflictsFixture, consensusFixture, delegationPoliciesFixture, freezePoliciesFixture,
  ideaReviewsFixture, milestonesFixture, modulesFixture, proposalsFixture, requirementsFixture,
  revisionsFixture, tasksFixture, workUnitsFixture
} from "@vibe-git/protocol";

function insertJson(db: DatabaseSync, table: string, key: string, value: unknown, keyColumn = "id") {
  db.prepare(`INSERT OR IGNORE INTO ${table} (${keyColumn}, data) VALUES (?, ?)`).run(key, JSON.stringify(value));
}

export function seedDatabase(db: DatabaseSync, demo = false) {
  if (!demo) {
    // Empty is the production/local default; fixtures are explicit test-only input.
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('requirement_revision', '0')").run();
    return;
  }
  if (db.prepare("SELECT value FROM meta WHERE key = 'project_profile'").get()) {
    throw new Error("不能向已创建的真实项目灌入演示数据");
  }
  const row = db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get() as { value: string } | undefined;
  if (!row) {
    for (const item of requirementsFixture) insertJson(db, "requirements", item.id, item);
    for (const item of revisionsFixture) insertJson(db, "requirement_revisions", String(item.revision), item, "revision");
    for (const item of tasksFixture) insertJson(db, "tasks", item.id, item);
    for (const item of conflictsFixture) insertJson(db, "conflicts", item.id, item);
    db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1')").run();
    db.prepare("INSERT INTO meta (key, value) VALUES ('requirement_revision', '1')").run();
  }

  const v10 = db.prepare("SELECT value FROM meta WHERE key = 'seeded_v010'").get() as { value: string } | undefined;
  if (v10) return;
  for (const item of modulesFixture) insertJson(db, "modules", item.id, item);
  for (const item of workUnitsFixture) insertJson(db, "work_units", item.id, item);
  for (const item of proposalsFixture) insertJson(db, "proposals", item.id, item);
  for (const item of consensusFixture) insertJson(db, "consensus_revisions", item.id, item);
  for (const item of delegationPoliciesFixture) insertJson(db, "delegation_policies", item.id, item);
  for (const item of ideaReviewsFixture) insertJson(db, "idea_reviews", item.id, item);
  for (const item of milestonesFixture) insertJson(db, "milestones", item.id, item);
  for (const item of freezePoliciesFixture) insertJson(db, "freeze_policies", item.id, item);
  db.prepare("INSERT INTO meta (key, value) VALUES ('seeded_v010', '1')").run();
}
