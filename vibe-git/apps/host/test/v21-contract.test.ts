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
  return { app, captain, member, service };
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
async function richAlignment(ctx: Awaited<ReturnType<typeof setup>>) {
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
