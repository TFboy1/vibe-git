import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentJob, AlignmentRun, CloudflareTunnelStatus, CollaborationNode, InterfaceContract, StageTask, TaskBrief } from "@vibe-git/protocol";
import { buildApp } from "../src/app.js";
import type { CloudflareManager } from "../src/integrations/cloudflare/manager.js";
import type { V20Service } from "../src/v20/service.js";

type App = Awaited<ReturnType<typeof buildApp>>;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
class FakeCloudflare implements CloudflareManager {
  async status(): Promise<CloudflareTunnelStatus> { return { phase: "ready", installed: false, running: false, version: null, url: null, logs: [], lastError: null, updatedAt: new Date().toISOString() }; }
  async install() { return this.status(); } async start() { return this.status(); } async stop() { return this.status(); } async close() {}
}
async function post(app: App, token: string, url: string, payload: unknown = {}) {
  return app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}` }, payload: payload as never });
}
const headSha = "a".repeat(40);
const summary = "HEAD aaa · apps/host/src 与 apps/web/src 受限结构摘要";
const heartbeat = { workspaceReady: true, auditCodex: "available", workCodex: "available", workTransport: "auto", rateLimits: [],
  git: { branch: "main", headSha, dirty: false, fingerprint: "f".repeat(64), observedAt: new Date().toISOString() }, currentTaskId: null,
  repositoryContext: { headSha, dirty: false, summary, sha256: createHash("sha256").update(summary).digest("hex"), createdAt: new Date().toISOString() } };
async function setup() {
  const root = await mkdtemp(resolve(tmpdir(), "vibe-git-v21-")); roots.push(root);
  const dir = resolve(root, "runtime");
  const app = await buildApp({ dbPath: resolve(root, "room.db"), dataDir: dir, staticDir: false, backupDatabase: false, cloudflareManager: new FakeCloudflare() });
  const captain = JSON.parse(await readFile(resolve(dir, "captain.json"), "utf8")) as { nodeId: string; nodeToken: string };
  const invite = JSON.parse(await readFile(resolve(dir, "invite.json"), "utf8")) as { inviteToken: string };
  const joined = await app.inject({ method: "POST", url: "/api/v1/join", payload: { invite: invite.inviteToken } });
  const member = joined.json() as { node: CollaborationNode; nodeToken: string };
  const service = (app as unknown as { v20Service: V20Service }).v20Service;
  await post(app, captain.nodeToken, "/api/v1/nodes/heartbeat", heartbeat);
  await post(app, member.nodeToken, "/api/v1/nodes/heartbeat", heartbeat);
  return { app, captain, member, service, invite };
}
const brief = (ownedPath: string): TaskBrief => ({ deliverables: [`${ownedPath} 可运行交付物`], ownedPaths: [ownedPath], excludedPaths: ["其他成员拥有的模块"],
  requirementRefs: ["统一需求#验收"], interfaceNotes: ["输入输出及错误码遵守冻结接口"], mockStrategy: "使用本地 .vibe-git/mocks 替身，不提交仓库",
  integrationSteps: ["同步提供方提交 SHA，运行真实契约测试"], verificationCommands: ["npm test"], handoff: "提交完整 SHA 与测试结果" });
async function finishJob(app: App, service: V20Service, tokens: Map<string, string>, queued: AgentJob, result: unknown) {
  const token = tokens.get(queued.targetNodeId)!;
  const claimed = (await post(app, token, "/api/v1/nodes/jobs/next")).json() as AgentJob;
  expect(claimed.id).toBe(queued.id);
  const response = await post(app, token, `/api/v1/jobs/${claimed.id}/status`, { leaseToken: claimed.leaseToken, phase: "completed", result });
  expect(response.statusCode, response.body).toBe(200);
  return service.repo.getJob(queued.id)!;
}
async function richAlignment(ctx: Pick<Awaited<ReturnType<typeof setup>>, "app" | "captain" | "member" | "service">) {
  const { app, captain, member, service } = ctx;
  const tokens = new Map([[captain.nodeId, captain.nodeToken], [member.node.id, member.nodeToken]]);
  await post(app, member.nodeToken, "/api/v1/plans", { filename: "feature.md", content: "# 需求\n提供核心接口与 UI，要求可测试" });
  const alignment = (await post(app, captain.nodeToken, "/api/v1/alignments")).json() as AlignmentRun;
  const job = service.repo.getJob(alignment.agentJobId!)!;
  await finishJob(app, service, tokens, job, { alignmentMarkdown: "# 统一需求\n\n## 验收\n核心接口和 UI 可测试", issues: [],
    contracts: [{ key: "core-api", providerTaskKey: "core", consumerTaskKeys: ["ui"], kind: "module", name: "Core API",
      signature: "load(input: string): Promise<Result>", behavior: ["非空输入返回结果"], examples: ["load('a') => {ok:true}"], errors: ["load('') => InvalidInput"],
      testCommand: "node --test contract.test.mjs", handoff: "apps/host/src/core.ts + 提交 SHA" }],
    tasks: [
      { key: "core", title: "核心接口", goal: "实现核心模块", boundary: "仅服务模块", acceptance: ["接口测试通过"], dependencies: [], dependencyEdges: [],
        assigneeNodeId: captain.nodeId, sourcePlanNodeIds: [member.node.id], assignmentRationale: "队长认领接口", effort: "M" },
      { key: "ui", title: "UI 消费方", goal: "实现消费界面", boundary: "仅 Web 模块", acceptance: ["UI 测试通过"], dependencies: ["core"],
        dependencyEdges: [{ upstreamKey: "core", mode: "CONTRACT", contractKey: "core-api", reason: "输入输出已冻结，可用 Mock 并行" }],
        assigneeNodeId: member.node.id, sourcePlanNodeIds: [member.node.id], assignmentRationale: "提案认领", effort: "M" }
    ] });
  const detailJobs = service.repo.listJobs().filter((item) => item.entityId === alignment.id && item.kind === "DESCRIBE_WORKSTREAM");
  expect(detailJobs).toHaveLength(2);
  for (const detail of detailJobs) {
    const owner = detail.payload.ownerNodeId;
    await finishJob(app, service, tokens, detail, { mission: owner === captain.nodeId ? "接口工作主线" : "界面工作主线", boundary: "仅修改独占文件",
      tasks: [{ id: owner === captain.nodeId ? "DRAFT-1" : "DRAFT-2", brief: brief(owner === captain.nodeId ? "apps/host/src/core.ts" : "apps/web/src/core-view.tsx") }] });
  }
  expect(service.repo.getAlignment(alignment.id)?.status).toBe("READY");
  return { alignment: service.repo.getAlignment(alignment.id)!, tokens, contracts: service.repo.listContracts(alignment.id) };
}

describe("契约先行的阶段与并行切片", () => {
  it("缺席成员需显式跳过，并冻结本轮参与者与需求版本", async () => {
    const { app, captain, member, invite } = await setup();
    // 第二名成员通过房间当前邀请加入，尚未提交提案。
    const joined = await app.inject({ method: "POST", url: "/api/v1/join", payload: { invite: invite.inviteToken } });
    const absent = joined.json() as { node: CollaborationNode };
    await post(app, member.nodeToken, "/api/v1/plans", { filename: "member.md", content: "# 成员方案" });
    const readiness = await app.inject({ method: "GET", url: "/api/v1/alignments/readiness", headers: { authorization: `Bearer ${captain.nodeToken}` } });
    expect(readiness.json().missing.map((item: { nodeId: string }) => item.nodeId)).toEqual([absent.node.id]);
    expect((await post(app, captain.nodeToken, "/api/v1/alignments")).statusCode).toBe(409);
    expect((await post(app, captain.nodeToken, "/api/v1/alignments", { skipMissingNodeIds: [absent.node.id], expectedRequirementRevision: 9 })).statusCode).toBe(409);
    const started = await post(app, captain.nodeToken, "/api/v1/alignments", { skipMissingNodeIds: [absent.node.id], expectedRequirementRevision: 0 });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json().skippedNodeIds).toEqual([absent.node.id]);
    await app.close();
  });

  it("草稿修订、已读版本和契约确认失效受角色及并发限制", async () => {
    const { app, captain, member, service } = await setup();
    const { alignment, tokens, contracts } = await richAlignment({ app, captain, member, service });
    const titlePath = `/api/v1/alignments/${alignment.id}/tasks/DRAFT-1`;
    const rename = (token: string, revision: number) => app.inject({ method: "PATCH", url: titlePath,
      headers: { authorization: `Bearer ${token}` }, payload: { title: "新版核心接口", expectedRevision: revision } });
    expect((await rename(member.nodeToken, alignment.draftRevision!)).statusCode).toBe(403);
    expect((await rename(captain.nodeToken, alignment.draftRevision! - 1)).statusCode).toBe(409);
    expect((await rename(captain.nodeToken, alignment.draftRevision!)).statusCode).toBe(200);
    const current = service.repo.getAlignment(alignment.id)!;
    expect(current.tasks[0]?.title).toBe("新版核心接口");
    expect(service.repo.listAlignmentDraftVersions(alignment.id).at(-1)?.revision).toBe(current.draftRevision);
    expect((await post(app, member.nodeToken, `/api/v1/alignments/${alignment.id}/read`, { expectedRevision: alignment.draftRevision })).statusCode).toBe(409);
    expect((await post(app, member.nodeToken, `/api/v1/alignments/${alignment.id}/read`, { expectedRevision: current.draftRevision })).statusCode).toBe(200);
    const contract = contracts[0]!;
    for (const token of [captain.nodeToken, member.nodeToken]) await post(app, token, `/api/v1/contracts/${contract.id}/ack`, { expectedRevision: contract.revision, sha256: contract.sha256 });
    const edit = (token: string, hash = contract.sha256) => app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}`,
      headers: { authorization: `Bearer ${token}` }, payload: { expectedRevision: contract.revision, sha256: hash,
        name: contract.name, signature: "load(input: string): Promise<NewResult>", behavior: contract.behavior,
        examples: contract.examples, errors: contract.errors, testCommand: contract.testCommand, handoff: contract.handoff } });
    expect((await edit(member.nodeToken)).statusCode).toBe(403);
    expect((await edit(captain.nodeToken, "0".repeat(64))).statusCode).toBe(409);
    expect((await edit(captain.nodeToken)).statusCode).toBe(200);
    const revised = service.repo.getContract(contract.id)!;
    expect(revised.revision).toBe(2); expect(revised.acknowledgedNodeIds).toEqual([]);
    expect(service.repo.getAlignment(alignment.id)?.status).toBe("QUEUED");
    expect((await post(app, member.nodeToken, `/api/v1/contracts/${contract.id}/ack`, { expectedRevision: 1, sha256: contract.sha256 })).statusCode).toBe(409);
    const jobs = service.repo.getAlignment(alignment.id)!.detailJobIds!.map(id => service.repo.getJob(id)!);
    for (const job of jobs) {
      const owner = job.payload.ownerNodeId;
      await finishJob(app, service, tokens, job, { mission: "重新细化", boundary: "独占范围", tasks: [{ id: owner === captain.nodeId ? "DRAFT-1" : "DRAFT-2",
        brief: brief(owner === captain.nodeId ? "apps/host/src/core.ts" : "apps/web/src/core-view.tsx") }] });
    }
    expect(service.repo.getAlignment(alignment.id)?.status).toBe("READY");
    const finalRevision = service.repo.getAlignment(alignment.id)!.draftRevision!;
    expect(service.repo.listAlignmentReads().some(item => item.nodeId === member.node.id && item.revision === finalRevision)).toBe(false);
    await app.close();
  });

  it("变更保存提交时 Git 快照，全队可读正文，过期开工被拒绝", async () => {
    const { app, captain, member, service, invite } = await setup();
    const { alignment, contracts } = await richAlignment({ app, captain, member, service });
    for (const token of [captain.nodeToken, member.nodeToken]) await post(app, token, `/api/v1/contracts/${contracts[0]!.id}/ack`, { expectedRevision: 1, sha256: contracts[0]!.sha256 });
    const stage = (await post(app, captain.nodeToken, `/api/v1/alignments/${alignment.id}/publish`)).json() as { id: string };
    const change = (await post(app, member.nodeToken, "/api/v1/pull-requests", { filename: "change.md", content: "# 调整输出字段" })).json() as { documentId: string; submittedGit: { branch: string; headSha: string } };
    expect(change.submittedGit).toMatchObject({ branch: "main", headSha });
    const visible = await app.inject({ method: "GET", url: `/api/v1/documents/${change.documentId}`, headers: { authorization: `Bearer ${captain.nodeToken}` } });
    expect(visible.json().content).toContain("调整输出字段");
    const late = (await app.inject({ method: "POST", url: "/api/v1/join", payload: { invite: invite.inviteToken } })).json() as { nodeToken: string };
    expect((await app.inject({ method: "GET", url: `/api/v1/documents/${change.documentId}`, headers: { authorization: `Bearer ${late.nodeToken}` } })).json().content).toContain("调整输出字段");
    expect((await app.inject({ method: "GET", url: "/api/v1/bootstrap", headers: { authorization: `Bearer ${member.nodeToken}` } })).json().requirementVersions).toHaveLength(1);
    const task = service.repo.listTasks(stage.id).find(item => item.assigneeNodeId === member.node.id)!;
    expect((await post(app, member.nodeToken, `/api/v1/tasks/${task.id}/start`, { expectedTaskRevision: task.revision - 1, expectedRequirementRevision: 1 })).statusCode).toBe(409);
    expect((await post(app, member.nodeToken, `/api/v1/tasks/${task.id}/start`, { expectedTaskRevision: task.revision, expectedRequirementRevision: 1 })).statusCode).toBe(200);
    const running = service.repo.getTask(task.id)!;
    expect((await post(app, captain.nodeToken, `/api/v1/nodes/${member.node.id}/revoke`, { expectedActiveTaskRevisions: { [task.id]: task.revision } })).statusCode).toBe(409);
    expect((await post(app, captain.nodeToken, `/api/v1/nodes/${member.node.id}/revoke`, { expectedActiveTaskRevisions: { [task.id]: running.revision } })).statusCode).toBe(200);
    expect(service.repo.getTask(task.id)?.status).toBe("PAUSED");
    await app.close();
  });
  it("详细主线、双方确认、Mock 门禁与真实集成完成门禁", async () => {
    const ctx = await setup(); const { app, captain, member, service } = ctx;
    const { alignment, tokens, contracts } = await richAlignment(ctx);
    const contract = contracts[0]!;
    expect((await post(app, captain.nodeToken, `/api/v1/alignments/${alignment.id}/publish`)).statusCode).toBe(409);
    expect((await post(app, member.nodeToken, `/api/v1/contracts/${contract.id}/ack`, { expectedRevision: 1, sha256: "0".repeat(64) })).statusCode).toBe(409);
    for (const token of [captain.nodeToken, member.nodeToken]) expect((await post(app, token, `/api/v1/contracts/${contract.id}/ack`, { expectedRevision: 1, sha256: contract.sha256 })).statusCode).toBe(200);
    const stage = (await post(app, captain.nodeToken, `/api/v1/alignments/${alignment.id}/publish`)).json() as { id: string };
    const tasks = service.repo.listTasks(stage.id);
    const consumer = tasks.find((item) => item.assigneeNodeId === member.node.id)!;
    const provider = tasks.find((item) => item.assigneeNodeId === captain.nodeId)!;
    expect(consumer.dependencyEdges?.[0]?.mode).toBe("CONTRACT");
    const detail = await app.inject({ method: "GET", url: `/api/v1/tasks/${consumer.id}/detail`, headers: { authorization: `Bearer ${member.nodeToken}` } });
    expect(detail.json().markdown).toContain(contract.signature);
    expect(detail.json().markdown).toContain("真实集成步骤");
    expect((await post(app, member.nodeToken, `/api/v1/tasks/${consumer.id}/start`)).statusCode).toBe(200);
    let mock = service.repo.getJob(service.repo.getTask(consumer.id)!.activeJobId!)!;
    expect(mock.kind).toBe("PREPARE_MOCK");
    await finishJob(app, service, tokens, mock, { verified: false, contractHashes: { [contract.id]: contract.sha256 } });
    expect(service.repo.getTask(consumer.id)?.status).toBe("FAILED");
    await post(app, member.nodeToken, `/api/v1/tasks/${consumer.id}/start`);
    mock = service.repo.getJob(service.repo.getTask(consumer.id)!.activeJobId!)!;
    await finishJob(app, service, tokens, mock, { verified: true, contractHashes: { [contract.id]: contract.sha256 }, summary: "1 test passed" });
    expect(service.repo.getTask(consumer.id)?.status).toBe("STARTING");
    const run = service.repo.getJob(service.repo.getTask(consumer.id)!.activeJobId!)!;
    expect(run.kind).toBe("RUN_TASK");
    await finishJob(app, service, tokens, run, {});
    expect(service.repo.getTask(consumer.id)?.status).toBe("WAITING_INTEGRATION");
    expect((await post(app, member.nodeToken, `/api/v1/tasks/${consumer.id}/done`)).statusCode).toBe(409);
    expect((await post(app, member.nodeToken, `/api/v1/tasks/${consumer.id}/integrate`)).statusCode).toBe(409);
    service.repo.putTask({ ...provider, status: "DONE", doneAt: new Date().toISOString(), lastGit: heartbeat.git, revision: provider.revision + 1 });
    expect((await post(app, member.nodeToken, `/api/v1/tasks/${consumer.id}/integrate`)).statusCode).toBe(200);
    const integration = service.repo.getJob(service.repo.getTask(consumer.id)!.activeJobId!)!;
    await finishJob(app, service, tokens, integration, { verified: true, contractHashes: { [contract.id]: contract.sha256 }, headSha, summary: "1 real test passed" });
    expect(service.repo.getTask(consumer.id)?.status).toBe("WAITING_CONFIRMATION");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
    await post(app, member.nodeToken, "/api/v1/nodes/heartbeat", { ...heartbeat, currentTaskId: consumer.id });
    expect((await post(app, member.nodeToken, `/api/v1/tasks/${consumer.id}/done`)).statusCode).toBe(200);
    await app.close();
  });

  it("未开工阶段可按已发布需求原子重编排，旧切片归档；开工后拒绝", async () => {
    const ctx = await setup(); const { app, captain, member, service } = ctx;
    const { alignment, contracts, tokens } = await richAlignment(ctx);
    for (const token of [captain.nodeToken, member.nodeToken]) await post(app, token, `/api/v1/contracts/${contracts[0]!.id}/ack`, { expectedRevision: 1, sha256: contracts[0]!.sha256 });
    const stage = (await post(app, captain.nodeToken, `/api/v1/alignments/${alignment.id}/publish`)).json() as { id: string };
    const old = service.repo.listTasks(stage.id);
    const request = await post(app, captain.nodeToken, `/api/v1/stages/${stage.id}/replan`);
    expect(request.statusCode, request.body).toBe(200);
    const replan = request.json() as AlignmentRun;
    const job = service.repo.getJob(replan.agentJobId!)!;
    await finishJob(app, service, tokens, job, { alignmentMarkdown: service.repo.getStage(stage.id)!.requirementMarkdown, issues: [], contracts: [], tasks: [
      { key: "new-core", title: "重编排接口", goal: "完整实现接口", boundary: "apps/host/src", acceptance: ["接口测试通过"], dependencies: [], dependencyEdges: [],
        assigneeNodeId: captain.nodeId, sourcePlanNodeIds: [], assignmentRationale: "接口独占", effort: "M" },
      { key: "new-ui", title: "重编排界面", goal: "实现界面", boundary: "apps/web/src", acceptance: ["界面测试通过"], dependencies: ["new-core"],
        dependencyEdges: [{ upstreamKey: "new-core", mode: "HARD", contractKey: null, reason: "共享入口无法隔离" }],
        assigneeNodeId: member.node.id, sourcePlanNodeIds: [], assignmentRationale: "界面独占", effort: "M" }
    ] });
    for (const detail of service.repo.listJobs().filter((item) => item.entityId === replan.id && item.kind === "DESCRIBE_WORKSTREAM")) {
      const owner = detail.payload.ownerNodeId;
      await finishJob(app, service, tokens, detail, { mission: "新的完整主线", boundary: "只改独占模块", tasks: [{ id: owner === captain.nodeId ? "DRAFT-1" : "DRAFT-2",
        brief: brief(owner === captain.nodeId ? "apps/host/src/new-core.ts" : "apps/web/src/new-ui.tsx") }] });
    }
    expect(service.repo.listTasks(stage.id)).toHaveLength(old.length);
    expect((await post(app, captain.nodeToken, `/api/v1/alignments/${replan.id}/activate-replan`)).statusCode).toBe(200);
    expect(service.repo.listTasks(stage.id)).toHaveLength(2);
    expect(service.repo.listTasks(stage.id).every((item) => !old.some((previous) => previous.id === item.id))).toBe(true);
    expect(service.repo.getTask(old[0]!.id)?.archived).toBe(true);
    expect(service.repo.getStage(stage.id)?.requirementRevision).toBe(1);
    expect((await post(app, member.nodeToken, `/api/v1/tasks/${old[0]!.id}/start`)).statusCode).toBe(409);
    const newProvider = service.repo.listTasks(stage.id).find((item) => item.assigneeNodeId === captain.nodeId)!;
    await post(app, captain.nodeToken, `/api/v1/tasks/${newProvider.id}/start`);
    expect((await post(app, captain.nodeToken, `/api/v1/stages/${stage.id}/replan`)).statusCode).toBe(409);
    await app.close();
  });
});
