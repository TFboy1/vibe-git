import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { BootstrapPayload, MemberId } from "@vibe-git/protocol";
import { buildApp } from "../src/app.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const root = realpathSync(tmpdir());
const directories: string[] = [];
type App = typeof apps[number];
async function create(dbPath = ":memory:") { const app = await buildApp({ dbPath }); apps.push(app); return app; }
const get = async (app: App) => (await app.inject({ method: "GET", url: "/api/bootstrap" })).json<BootstrapPayload>();
const post = (app: App, actor: MemberId, url: string, payload: object) => app.inject({ method: "POST", url, headers: { "x-member-id": actor }, payload });
const project = { requestId: "project", name: "真实项目测试", memberNames: { A: "队长测试", B: "成员乙", C: "成员丙" } };
const proposal = (member: string) => ({ requestId: "proposal-" + member, title: "我的提案", content: "测试用户明确提交的需求", memberConfirmed: true, intent: { targetUser: "团队成员", scenario: "协作", problem: "需求未对齐", successConditions: ["全员确认同一稿"], valueBasis: [], hardConstraints: [], preferences: [], assumptions: [] } });
afterEach(async () => {
  while (apps.length) await apps.pop()?.close();
  for (const value of directories.splice(0)) {
    const target = resolve(value);
    if (dirname(target) !== root || !basename(target).startsWith("vibe-empty-test-")) throw new Error("Unsafe cleanup");
    rmSync(target, { recursive: true, force: true });
  }
});

describe("默认空白工作区", () => {
  it("默认不加载任何演示业务数据或虚构成员姓名", async () => {
    const data = await get(await create());
    expect(data.room).toMatchObject({ initialized: false, demo: false, requirementRevision: 0, seq: 0 });
    for (const [key, value] of Object.entries(data)) {
      if (key !== "members" && Array.isArray(value)) expect(value, key).toHaveLength(0);
    }
    expect(data.members.map(item => item.id)).toEqual(["A", "B", "C"]);
    expect(JSON.stringify(data)).not.toMatch(/林澈|周屿|许墨|REQ-AUTH|TASK-B|replay-pm/);
  });

  it("只有队长可初始化，输入校验、幂等和禁止覆盖均生效", async () => {
    const app = await create();
    expect((await post(app, "B", "/api/project", project)).statusCode).toBe(403);
    expect((await post(app, "A", "/api/project", { ...project, memberNames: { A: "A", B: " ", C: "C" } })).statusCode).toBe(400);
    const first = await post(app, "A", "/api/project", project);
    expect(first.statusCode).toBe(200);
    const repeated = await post(app, "A", "/api/project", project);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toEqual(first.json());
    expect((await post(app, "A", "/api/project", { ...project, requestId: "overwrite", name: "试图覆盖" })).statusCode).toBe(409);
    const data = await get(app);
    expect(data.room).toMatchObject({ initialized: true, demo: false, name: project.name, requirementRevision: 0, seq: 1 });
    expect(data.members.map(item => item.name)).toEqual(Object.values(project.memberNames));
    expect(data.requirements).toHaveLength(0);
    expect(data.tasks).toHaveLength(0);
  });

  it("未创建项目不能提交提案，初始化后提案重试不会重复保存", async () => {
    const app = await create();
    const payload = proposal("A");
    expect((await post(app, "A", "/api/proposals", payload)).statusCode).toBe(409);
    await post(app, "A", "/api/project", project);
    const first = await post(app, "A", "/api/proposals", payload);
    expect(first.statusCode).toBe(200);
    const repeated = await post(app, "A", "/api/proposals", payload);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toEqual(first.json());
    expect((await get(app)).proposals).toHaveLength(1);
  });

  it("空白项目三份真实输入与全员确认后才能产生第一版需求", async () => {
    const app = await create();
    await post(app, "A", "/api/project", project);
    const ids: string[] = [];
    for (const actor of ["A", "B", "C"] as const) {
      const response = await post(app, actor, "/api/proposals", proposal(actor));
      expect(response.statusCode).toBe(200); ids.push(response.json().id);
    }
    expect((await get(app)).requirements).toHaveLength(0);
    const candidate = await post(app, "A", "/api/consensus", { requestId: "candidate", title: "首版总需求", summary: "三人明确选择的范围", proposalIds: ids, expectedRequirementRevision: 0, candidateRequirements: [{ requirementId: "REQ-ROOT", content: "用户确认的总需求", acceptance: ["可以检查的结果"] }] });
    expect(candidate.statusCode).toBe(200);
    const id = candidate.json().id as string;
    expect((await post(app, "A", "/api/consensus/" + id + "/publish", { requestId: "too-early", expectedConsensusRevision: 1, expectedRequirementRevision: 0 })).statusCode).toBe(409);
    let revision = 1;
    for (const actor of ["A", "B", "C"] as const) {
      const vote = await post(app, actor, "/api/consensus/" + id + "/confirmations", { requestId: "confirm-" + actor, expectedConsensusRevision: revision, candidateHash: candidate.json().candidateHash, decision: "CONFIRMED" });
      expect(vote.statusCode).toBe(200); revision = vote.json().revision;
    }
    const published = await post(app, "A", "/api/consensus/" + id + "/publish", { requestId: "publish", expectedConsensusRevision: revision, expectedRequirementRevision: 0 });
    expect(published.statusCode).toBe(200);
    const data = await get(app);
    expect(data.room.requirementRevision).toBe(1);
    expect(data.requirements).toHaveLength(1);
    expect(data.requirements[0]).toMatchObject({ id: "REQ-ROOT", content: "用户确认的总需求", acceptance: ["可以检查的结果"] });
    expect(data.tasks).toHaveLength(0);
    expect(data.workUnits).toHaveLength(0);
    expect(data.ideaReviews).toHaveLength(0);
  });

  it("真实项目重启后保留数据，不重新灌入 fixtures", async () => {
    const dir = mkdtempSync(join(root, "vibe-empty-test-")); directories.push(dir);
    const dbPath = join(dir, "workspace.db");
    const first = await create(dbPath);
    await post(first, "A", "/api/project", project);
    await post(first, "A", "/api/proposals", proposal("A"));
    const before = await get(first);
    await apps.pop()!.close();
    const after = await get(await create(dbPath));
    expect({ ...after, connectStatus: { ...after.connectStatus, checkedAt: before.connectStatus.checkedAt } }).toEqual(before);
    expect(after.room.demo).toBe(false);
    expect(after.requirements).toHaveLength(0);
  });
});
