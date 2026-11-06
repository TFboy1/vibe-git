import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { V20Service } from "../src/v20/service.js";
import { resourcesForEvent } from "@vibe-git/protocol";
import type { AgentJob, AgileFlow, CoordinationChange, DevelopmentStage, ImpactReviewBatch, InterfaceContract, StageTask, V20BootstrapPayload, VibePullRequest, WorkspaceResources } from "@vibe-git/protocol";
import { ensureV20Runtime } from "../src/v20/runtime-secrets.js";

let root: string | undefined, app: Awaited<ReturnType<typeof buildApp>> | undefined;
afterEach(async () => {
  await app?.close(); app = undefined;
  if (root) {
    if (!root.startsWith(resolve(tmpdir(), "vibe-workspace-"))) throw new Error("非法清理目录");
    await rm(root, { recursive: true, force: true }); root = undefined;
  }
});
async function setup() {
  root = await mkdtemp(resolve(tmpdir(), "vibe-workspace-"));
  app = await buildApp({ dbPath: resolve(root, "room.db"), dataDir: root, staticDir: false, backupDatabase: false,
    cloudflareManager: { status: async () => null, close: async () => {} } as never });
  const service = (app as unknown as { v20Service: V20Service }).v20Service;
  const runtime = await ensureV20Runtime(service.repo, root);
  return { service, headers: { authorization: "Bearer " + runtime.captain.nodeToken } };
}
it("轻量快照不传历史正文，旧 bootstrap 保持完整；游标分页稳定且详情按需读取", async () => {
  const { service, headers } = await setup();
  for (let revision = 1; revision <= 205; revision++) service.repo.putRequirementVersion({ revision, markdown: "正文".repeat(500), source: "alignment", sourceId: "fixture", createdAt: new Date().toISOString() });
  const old = (await app!.inject({ url: "/api/v1/bootstrap", headers })).json<V20BootstrapPayload>();
  const lean = (await app!.inject({ url: "/api/v1/workspace", headers })).json<V20BootstrapPayload>();
  expect(old.requirementVersions).toHaveLength(205); expect(lean.requirementVersions).toEqual([]);
  const first = (await app!.inject({ url: "/api/v1/history/requirements", headers })).json();
  expect(first.items).toHaveLength(100); expect(first.items[0].revision).toBe(205); expect(first.items[0].markdown).toBeUndefined();
  service.repo.putRequirementVersion({ revision: 206, markdown: "后来新增", source: "alignment", sourceId: "fixture", createdAt: "now" });
  const second = (await app!.inject({ url: "/api/v1/history/requirements?before=" + first.nextCursor, headers })).json();
  expect(second.items[0].revision).toBe(105); expect(second.items).toHaveLength(100);
  const last = (await app!.inject({ url: "/api/v1/history/requirements?before=" + second.nextCursor, headers })).json();
  expect(last.items).toHaveLength(5); expect(last.nextCursor).toBeNull();
  const detail = (await app!.inject({ url: "/api/v1/history/requirements/205", headers })).json();
  expect(detail.markdown).toBe("正文".repeat(500));
  expect((await app!.inject({ url: "/api/v1/workspace" })).statusCode).toBe(403);
  expect((await app!.inject({ url: "/api/v1/history/requirements?before=NaN", headers })).statusCode).toBe(400);
  expect((await app!.inject({ url: "/api/v1/history/__proto__", headers })).statusCode).toBe(404);
});
it("当前流程保留、历史草稿不随快照重复传输，详情和历史列表可恢复", async () => {
  const { service, headers } = await setup();
  const flow = { id: "fixture-flow", status: "DRAFT", kind: "initial", draftHistory: [{ revision: 1, markdown: "保留的历史" }], createdAt: "now" } as AgileFlow;
  service.repo.putAgileFlow(flow);
  const lean = (await app!.inject({ url: "/api/v1/workspace", headers })).json<V20BootstrapPayload>();
  expect(lean.agile!.activeFlow!.id).toBe(flow.id); expect(lean.agile!.activeFlow!.draftHistory).toEqual([]);
  expect((await app!.inject({ url: "/api/v1/agile/flows/" + flow.id, headers })).json().draftHistory).toHaveLength(1);
  service.repo.putAgileFlow({ ...flow, status: "PUBLISHED" });
  const history = (await app!.inject({ url: "/api/v1/history/flows", headers })).json();
  expect(history.items[0].id).toBe(flow.id); expect(history.items[0].draftHistory).toBeUndefined();
});
it("当前任务仍包含旧阶段的实际依赖，排除无关的已完成和归档记录", async () => {
  const { service } = await setup();
  service.repo.putStage({ id: "old", sequence: 1, status: "COMPLETED" } as DevelopmentStage);
  service.repo.putStage({ id: "current", sequence: 2, status: "ACTIVE" } as DevelopmentStage);
  for (const task of [
    { id: "dependency", stageId: "old", status: "DONE", dependencies: [] },
    { id: "unrelated", stageId: "old", status: "DONE", dependencies: [] },
    { id: "archived", stageId: "old", status: "PAUSED", dependencies: [], archived: true },
    { id: "working", stageId: "current", status: "PUBLISHED", dependencies: ["dependency"] }
  ]) service.repo.putTask({ ...task, assigneeNodeId: "fixture" } as unknown as StageTask);
  expect(service.repo.workspaceTasks().map(task => task.id).sort()).toEqual(["dependency", "working"]);
});
it("新数据库不再创建废弃表，已有数据库的历史数据不会被删除", async () => {
  const { service } = await setup();
  expect(service.repo.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('requirements','tasks','proposals','execution_commands','idempotency')").all()).toEqual([]);
  service.repo.db.exec("CREATE TABLE requirements (id TEXT PRIMARY KEY, data TEXT NOT NULL); INSERT INTO requirements VALUES ('old', 'historical-data')");
  await app!.close(); app = undefined;
  app = await buildApp({ dbPath: resolve(root!, "room.db"), dataDir: root!, staticDir: false, backupDatabase: false,
    cloudflareManager: { status: async () => null, close: async () => {} } as never });
  const reopened = (app as unknown as { v20Service: V20Service }).v20Service;
  expect(reopened.repo.db.prepare("SELECT data FROM requirements WHERE id = 'old'").get()).toMatchObject({ data: "historical-data" });
});
it("成员资源不读取任务或需求，未知资源拒绝；事件仅刷新相应资源", async () => {
  const { service, headers } = await setup();
  const tasks = vi.spyOn(service.repo, "workspaceTasks"), plans = vi.spyOn(service.repo, "latestPlans");
  const response = await app!.inject({ url: "/api/v1/workspace/resources?names=members", headers });
  expect(response.statusCode).toBe(200);
  expect(Object.keys(response.json<WorkspaceResources>().data).sort()).toEqual(["auditPool", "nodes", "viewer"]);
  expect(tasks).not.toHaveBeenCalled(); expect(plans).not.toHaveBeenCalled();
  expect((await app!.inject({ url: "/api/v1/workspace/resources?names=unknown", headers })).statusCode).toBe(400);
  expect(resourcesForEvent("node.heartbeat")).toEqual(["members"]); expect(resourcesForEvent("job.progress")).toEqual([]);
  expect(resourcesForEvent("future.event")).toBeNull();
});
it("资源快照排除历史阶段、工作流和变更，跨阶段依赖的契约仍完整", async () => {
  const { service, headers } = await setup(), repo = service.repo;
  repo.putStage({ id: "old", sequence: 1, status: "COMPLETED" } as DevelopmentStage);
  repo.putStage({ id: "current", sequence: 2, status: "ACTIVE" } as DevelopmentStage);
  repo.putTask({ id: "upstream", stageId: "old", assigneeNodeId: "fixture", title: "上游", status: "DONE", dependencies: [] } as unknown as StageTask);
  repo.putTask({ id: "working", stageId: "current", assigneeNodeId: "fixture", title: "当前", status: "PUBLISHED", revision: 1, dependencies: ["upstream"], dependencyEdges: [{ upstreamTaskId: "upstream", mode: "CONTRACT", contractId: "needed", contractRevision: 1 }] } as unknown as StageTask);
  for (const id of ["needed", "irrelevant"]) repo.putContract({ id, alignmentId: "old", stageId: "old", status: "PUBLISHED", providerTaskId: id === "needed" ? "upstream" : "other", consumerTaskIds: [], revision: 1 } as unknown as InterfaceContract);
  repo.putWorkstream({ id: "historical", alignmentId: "old", stageId: "old" } as never);
  repo.putPullRequest({ id: "closed", stageId: "old", status: "APPLIED", createdAt: "now" } as VibePullRequest);
  for (const method of ["listStages", "listContracts", "listWorkstreams", "listPullRequests", "listCoordinationChanges"] as const) vi.spyOn(repo, method).mockImplementation(() => { throw new Error("unbounded read: " + method); });
  const response = await app!.inject({ url: "/api/v1/workspace/resources?names=tasks,changes", headers });
  expect(response.statusCode).toBe(200);
  const data = response.json<WorkspaceResources>().data;
  expect(data.stages!.map(stage => stage.id)).toEqual(["current"]);
  expect(data.contracts!.map(contract => contract.id)).toEqual(["needed"]); expect(data.workstreams).toEqual([]); expect(data.pullRequests).toEqual([]);
});
it("混合变更历史游标不重复遗漏，历史消息和任务可按 ID 读取且检查身份", async () => {
  const { service, headers } = await setup(), repo = service.repo, captain = service.authenticateBearer(headers.authorization);
  for (let i = 0; i < 105; i++) {
    repo.putPullRequest({ id: "pr-" + i, stageId: "old", submitterNodeId: captain.id, documentId: "doc", status: "APPLIED", createdAt: "now", reviewId: null, baseRequirementRevision: 1, decidedAt: "now" } as VibePullRequest);
    repo.putCoordinationChange({ id: "change-" + i, stageId: "old", submitterNodeId: captain.id, status: "REJECTED", createdAt: "now", content: "历史正文", revision: 1 } as CoordinationChange);
  }
  const ids = new Set<string>(); let cursor: number | null = null;
  do {
    const page: { items: Array<{ record: { id: string } }>; nextCursor: number | null } = (await app!.inject({ url: "/api/v1/history/changes" + (cursor ? "?before=" + cursor : ""), headers })).json();
    for (const item of page.items) { expect(ids.has(item.record.id)).toBe(false); ids.add(item.record.id); }
    cursor = page.nextCursor;
  } while (cursor);
  expect(ids.size).toBe(210);
  repo.putNotification({ id: "note", recipientNodeId: captain.id, entityId: "pr-0", type: "CHANGE", title: "历史", body: "", readAt: null, createdAt: "now" });
  expect((await app!.inject({ url: "/api/v1/notifications/note/resource", headers })).json()).toMatchObject({ kind: "change", id: "pr-0" });
  expect((await app!.inject({ url: "/api/v1/workspace/changes/change-0", headers })).json().legacy.content).toBe("历史正文");
  const member = service.join((await ensureV20Runtime(repo, root!)).inviteToken, "http://localhost");
  const memberHeaders = { authorization: "Bearer " + member.nodeToken };
  expect((await app!.inject({ url: "/api/v1/notifications/note/resource", headers: memberHeaders })).statusCode).toBe(403);
  repo.putTask({ id: "archived", stageId: "old", assigneeNodeId: captain.id, archived: true } as StageTask);
  expect((await app!.inject({ url: "/api/v1/workspace/tasks/archived", headers })).statusCode).toBe(200);
  expect((await app!.inject({ url: "/api/v1/workspace/tasks/archived", headers: memberHeaders })).statusCode).toBe(403);
  expect((await app!.inject({ url: "/api/v1/history/archivedTasks", headers: memberHeaders })).json().items).toEqual([]);
});
it("新作业按错误码恢复证据，不根据中文报错误判；无错误码的旧客户端仍兼容", async () => {
  const { service, headers } = await setup(), repo = service.repo, captain = service.authenticateBearer(headers.authorization);
  const review = { id: "review-code", stageId: "absent-stage", status: "NEEDS_EVIDENCE", indexes: { [captain.id]: { marker: "keep" } }, probes: {}, probeParts: {}, pendingNodeIds: [], createdAt: "now" } as unknown as ImpactReviewBatch;
  repo.putReview(review);
  const job = { id: "coded-job", kind: "IMPACT_PROBE", targetNodeId: captain.id, entityId: review.id, status: "LEASED", leaseToken: "fixture-lease", leaseExpiresAt: new Date(Date.now()+60000).toISOString(), attempt: 1, maxAttempts: 1, payload: {}, runtimeId: null, error: null, createdAt: "now", updatedAt: "now" } as AgentJob;
  repo.putJob(job);
  service.reportJob(captain, job.id, { leaseToken: job.leaseToken!, phase: "failed", errorCode: "EXECUTION_FAILED", error: "工作树只是错误描述的一部分" });
  expect(repo.getReview(review.id)!.indexes).toEqual(review.indexes);
  expect(repo.eventsSince().find(event => event.type === "job.failed")!.payload).toMatchObject({ errorCode: "EXECUTION_FAILED" });
  repo.putJob({ ...job, id: "workspace-job" });
  service.reportJob(captain, "workspace-job", { leaseToken: job.leaseToken!, phase: "failed", errorCode: "WORKSPACE_CHANGED", error: "source moved" });
  expect(repo.getReview(review.id)!.indexes![captain.id]).toBeUndefined();
  repo.putReview(review); repo.putJob({ ...job, id: "legacy-job" });
  service.reportJob(captain, "legacy-job", { leaseToken: job.leaseToken!, phase: "failed", error: "工作树发生变化" });
  expect(repo.getReview(review.id)!.indexes![captain.id]).toBeUndefined();
});
