import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentJob, AlignmentRun, CloudflareTunnelStatus, CollaborationNode, StageTask, V20BootstrapPayload } from "@vibe-git/protocol";
import { buildApp } from "../src/app.js";
import type { CloudflareManager } from "../src/integrations/cloudflare/manager.js";
import type { V20Service } from "../src/v20/service.js";

const tunnelStatus: CloudflareTunnelStatus = {
  phase: "running", installed: true, running: true, version: "test", url: "https://test.trycloudflare.com",
  logs: [], lastError: null, updatedAt: new Date().toISOString()
};
class FakeCloudflare implements CloudflareManager {
  async status() { return tunnelStatus; } async install() { return tunnelStatus; } async start() { return tunnelStatus; }
  async stop() { return { ...tunnelStatus, phase: "ready" as const, running: false, url: null }; } async close() {}
}

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(resolve(tmpdir(), "vibe-git-v20-test-")); roots.push(root);
  const dataDir = resolve(root, "v20");
  const app = await buildApp({ dbPath: resolve(root, "test.db"), dataDir, staticDir: false, backupDatabase: false, cloudflareManager: new FakeCloudflare(), logger: process.env.VIBE_TEST_LOG === "1" });
  const captain = JSON.parse(await readFile(resolve(dataDir, "captain.json"), "utf8")) as { nodeId: string; nodeToken: string };
  const invite = JSON.parse(await readFile(resolve(dataDir, "invite.json"), "utf8")) as { inviteToken: string };
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const join = await app.inject({ method: "POST", url: "/api/v1/join", payload: { invite: invite.inviteToken } });
  expect(join.statusCode).toBe(200);
  const member = join.json() as { node: CollaborationNode; nodeToken: string };
  return { app, root, captain, invite, member, auth };
}

const git = { branch: "main", headSha: "a".repeat(40), dirty: false, fingerprint: "f".repeat(64), observedAt: new Date().toISOString() };
const repositorySummary = "HEAD aaaaa · packages/、apps/ 只读摘要";
const repositoryContext = { headSha: git.headSha, dirty: false, summary: repositorySummary, sha256: createHash("sha256").update(repositorySummary).digest("hex"), createdAt: new Date().toISOString() };
const heartbeat = { workspaceReady: true, auditCodex: "available", workCodex: "available", workTransport: "auto", rateLimits: [{ label: "codex:5h", usedPercent: 20, remainingPercent: 80, resetsAt: null }], git, repositoryContext, currentTaskId: null };

async function post(app: Awaited<ReturnType<typeof buildApp>>, url: string, token: string, payload: unknown = {}) {
  const response = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}` }, payload: payload as never });
  return response;
}

async function put(app: Awaited<ReturnType<typeof buildApp>>, url: string, token: string, payload: unknown = {}) {
  return app.inject({ method: "PUT", url, headers: { authorization: `Bearer ${token}` }, payload: payload as never });
}

async function bootstrap(app: Awaited<ReturnType<typeof buildApp>>, token: string): Promise<V20BootstrapPayload> {
  const response = await app.inject({ method: "GET", url: "/api/v1/bootstrap", headers: { authorization: `Bearer ${token}` } });
  expect(response.statusCode).toBe(200); return response.json() as V20BootstrapPayload;
}

async function completeAlignment(app: Awaited<ReturnType<typeof buildApp>>, captainToken: string, memberToken: string, memberId: string): Promise<AlignmentRun> {
  expect((await post(app, "/api/v1/nodes/heartbeat", captainToken, heartbeat)).statusCode).toBe(200);
  expect((await post(app, "/api/v1/nodes/heartbeat", memberToken, heartbeat)).statusCode).toBe(200);
  expect((await post(app, "/api/v1/plans", memberToken, { filename: "plan.md", content: "# 成员计划\n实现可验证功能" })).statusCode).toBe(200);
  const queued = await post(app, "/api/v1/alignments", captainToken);
  expect(queued.statusCode).toBe(200);
  const alignment = queued.json() as AlignmentRun;
  const executorToken = alignment.executorNodeId === memberId ? memberToken : captainToken;
  const next = await post(app, "/api/v1/nodes/jobs/next", executorToken);
  const job = next.json() as AgentJob;
  expect(job.kind).toBe("ALIGN_PLANS");
  expect((await post(app, `/api/v1/jobs/${job.id}/status`, executorToken, { leaseToken: job.leaseToken, phase: "started", runtimeId: "fake-align" })).statusCode).toBe(200);
  const completed = await post(app, `/api/v1/jobs/${job.id}/status`, executorToken, {
    leaseToken: job.leaseToken, phase: "completed", result: {
      alignmentMarkdown: "# 统一需求\n\n## 验收\n- 可测试",
      tasks: [{ title: "实现功能", goal: "完成主流程", boundary: "只改源码", acceptance: ["测试通过"], dependencies: [], assigneeNodeId: memberId, sourcePlanNodeIds: [memberId] }]
    }
  });
  expect(completed.statusCode).toBe(200);
  return (await bootstrap(app, captainToken)).alignments.find((item) => item.id === alignment.id)!;
}

describe("Vibe-Git v0.20 Host", () => {
  it("动态加入、邀请轮换、会话票据和撤销不会泄漏凭据", async () => {
    const { app, captain, invite, member } = await setup();
    const before = await bootstrap(app, captain.nodeToken);
    expect(before.nodes).toHaveLength(2);
    expect(JSON.stringify(before)).not.toContain(member.nodeToken);
    expect(before.plans).toEqual([]);
    const rotate = await post(app, "/api/v1/invite/rotate", captain.nodeToken);
    expect(rotate.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/join", payload: { invite: invite.inviteToken } })).statusCode).toBe(403);
    const ticket = await post(app, "/api/v1/browser-ticket", member.nodeToken);
    const ticketUrl = new URL((ticket.json() as { url: string }).url);
    const exchange = await app.inject({ method: "GET", url: ticketUrl.pathname });
    expect(exchange.statusCode).toBe(302); expect(exchange.headers["set-cookie"]).toContain("HttpOnly");
    expect((await app.inject({ method: "GET", url: ticketUrl.pathname })).statusCode).toBe(403);
    expect((await post(app, `/api/v1/nodes/${member.node.id}/revoke`, captain.nodeToken)).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/bootstrap", headers: { authorization: `Bearer ${member.nodeToken}` } })).statusCode).toBe(403);
    await app.close();
  });

  it("所有节点都能查看团队最新提案，但只能由所有者修改", async () => {
    const { app, captain, invite, member } = await setup();
    const secondJoin = await app.inject({ method: "POST", url: "/api/v1/join", payload: { invite: invite.inviteToken } });
    const second = secondJoin.json() as { node: CollaborationNode; nodeToken: string };
    const captainPlan = (await post(app, "/api/v1/plans", captain.nodeToken, { filename: "captain.md", content: "# 队长提案" })).json();
    const memberPlan = (await post(app, "/api/v1/plans", member.nodeToken, { filename: "member-a.md", content: "# 成员 A 提案" })).json();
    await post(app, "/api/v1/plans", second.nodeToken, { filename: "member-b.md", content: "# 成员 B 提案" });

    for (const token of [captain.nodeToken, member.nodeToken, second.nodeToken]) {
      const visible = await bootstrap(app, token);
      expect(visible.plans).toHaveLength(3);
      expect(new Set(visible.plans.map((plan) => plan.ownerNodeId))).toEqual(new Set([captain.nodeId, member.node.id, second.node.id]));
    }

    expect((await put(app, `/api/v1/plans/${memberPlan.id}`, second.nodeToken, { expectedRevision: 1, filename: "越权.md", content: "# 越权" })).statusCode).toBe(403);
    expect((await put(app, `/api/v1/plans/${memberPlan.id}`, captain.nodeToken, { expectedRevision: 1, filename: "队长也不能代改.md", content: "# 越权" })).statusCode).toBe(403);
    expect((await put(app, `/api/v1/plans/${captainPlan.id}`, member.nodeToken, { expectedRevision: 1, filename: "越权.md", content: "# 越权" })).statusCode).toBe(403);

    const updated = await put(app, `/api/v1/plans/${memberPlan.id}`, member.nodeToken, { expectedRevision: 1, filename: "member-a-v2.md", content: "# 成员 A 提案\n第二版" });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().revision).toBe(2);
    expect(updated.json().filename).toBe("member-a-v2.md");
    expect((await put(app, `/api/v1/plans/${memberPlan.id}`, member.nodeToken, { expectedRevision: 1, filename: "stale.md", content: "# 过期修改" })).statusCode).toBe(409);

    for (const token of [captain.nodeToken, member.nodeToken, second.nodeToken]) {
      const visible = await bootstrap(app, token);
      expect(visible.plans).toHaveLength(3);
      expect(visible.plans.find((plan) => plan.ownerNodeId === member.node.id)?.content).toContain("第二版");
    }
    await app.close();
  });

  it("校验 Markdown、保留版本和哈希，并隔离任务权限", async () => {
    const { app, captain, member } = await setup();
    expect((await post(app, "/api/v1/plans", member.nodeToken, { filename: "other.txt", content: "x" })).statusCode).toBe(400);
    expect((await post(app, "/api/v1/plans", member.nodeToken, { filename: "empty.md", content: "" })).statusCode).toBe(400);
    const first = await post(app, "/api/v1/plans", member.nodeToken, { filename: "frontend-design.md", content: "# A" });
    const same = await post(app, "/api/v1/plans", member.nodeToken, { filename: "frontend-design.md", content: "# A" });
    const second = await post(app, "/api/v1/plans", member.nodeToken, { filename: "implementation-notes.MD", content: "# B" });
    expect(first.json().revision).toBe(1); expect(same.json().id).toBe(first.json().id); expect(second.json().revision).toBe(2);
    expect(first.json().filename).toBe("frontend-design.md"); expect(second.json().filename).toBe("implementation-notes.MD");
    expect(first.json().sha256).toMatch(/^[0-9a-f]{64}$/);
    const ready = await completeAlignment(app, captain.nodeToken, member.nodeToken, member.node.id);
    expect(ready.status).toBe("READY");
    const publish = await post(app, `/api/v1/alignments/${ready.id}/publish`, captain.nodeToken);
    expect(publish.statusCode).toBe(200);
    const task = (await bootstrap(app, captain.nodeToken)).tasks[0]!;
    expect((await post(app, `/api/v1/tasks/${task.id}/detail`, captain.nodeToken, { filename: "task.md", content: "越权" })).statusCode).toBe(403);
    const detail = await post(app, `/api/v1/tasks/${task.id}/detail`, member.nodeToken, { filename: "my-steps.md", content: "# 执行细节\n只补步骤" });
    expect(detail.statusCode).toBe(200); expect(detail.json().filename).toBe("my-steps.md");
    await app.close();
  });

  it("完成对齐、发布、显式开工、同步并由成员确认完成", async () => {
    const { app, captain, member } = await setup();
    const ready = await completeAlignment(app, captain.nodeToken, member.nodeToken, member.node.id);
    await post(app, `/api/v1/alignments/${ready.id}/publish`, captain.nodeToken);
    let task = (await bootstrap(app, member.nodeToken)).tasks[0]!;
    const start = await post(app, `/api/v1/tasks/${task.id}/start`, member.nodeToken);
    expect(start.statusCode).toBe(200);
    const job = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
    await post(app, `/api/v1/jobs/${job.id}/status`, member.nodeToken, { leaseToken: job.leaseToken, phase: "started", runtimeId: "thread:turn" });
    await post(app, `/api/v1/jobs/${job.id}/status`, member.nodeToken, { leaseToken: job.leaseToken, phase: "completed", result: {} });
    task = (await bootstrap(app, member.nodeToken)).tasks[0]!;
    expect(task.status).toBe("WAITING_CONFIRMATION");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
    await post(app, "/api/v1/nodes/heartbeat", member.nodeToken, { ...heartbeat, currentTaskId: task.id });
    expect((await post(app, `/api/v1/tasks/${task.id}/done`, member.nodeToken)).statusCode).toBe(200);
    const final = await bootstrap(app, captain.nodeToken);
    expect(final.tasks[0]?.status).toBe("DONE"); expect(final.stages[0]?.status).toBe("COMPLETED");
    await app.close();
  });

  it("批量变更只能由队长强制审核，且只暂停受影响任务并等待应用", async () => {
    const { app, captain, member } = await setup();
    const ready = await completeAlignment(app, captain.nodeToken, member.nodeToken, member.node.id);
    await post(app, `/api/v1/alignments/${ready.id}/publish`, captain.nodeToken);
    const task = (await bootstrap(app, captain.nodeToken)).tasks[0]!;
    const change = await post(app, "/api/v1/pull-requests", member.nodeToken, { filename: "验收调整.md", content: "# 变更\n调整验收" });
    const duplicate = await post(app, "/api/v1/pull-requests", member.nodeToken, { filename: "验收调整.md", content: "# 变更\n调整验收" });
    expect(duplicate.json().id).toBe(change.json().id);
    expect((await post(app, "/api/v1/reviews", member.nodeToken, { force: true })).statusCode).toBe(403);
    const reviewResponse = await post(app, "/api/v1/reviews", captain.nodeToken, { force: true });
    expect(reviewResponse.statusCode, reviewResponse.body).toBe(200);
    const review = reviewResponse.json() as { id: string };
    const indexJob = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
    expect(indexJob.kind).toBe("IMPACT_INDEX");
    expect((await post(app, `/api/v1/jobs/${indexJob.id}/status`, member.nodeToken, { leaseToken: indexJob.leaseToken, phase: "completed", result: {
      nodeId: member.node.id, headSha: git.headSha, fingerprint: git.fingerprint, taskIds: [task.id], changedPaths: ["src/task.ts"], candidatePaths: [], omittedPaths: 0, diffSummary: "1 file changed", createdAt: new Date().toISOString()
    } })).statusCode).toBe(200);
    const probeJob = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
    expect(probeJob.kind).toBe("IMPACT_PROBE");
    expect((await post(app, `/api/v1/jobs/${probeJob.id}/status`, member.nodeToken, { leaseToken: probeJob.leaseToken, phase: "completed", result: {
      nodeId: member.node.id, headSha: git.headSha, fingerprint: git.fingerprint, affectedTaskIds: [task.id], unaffectedTaskIds: [], uncertainTaskIds: [],
      findings: [{ taskId: task.id, reason: "验收受影响", paths: ["src/task.ts"] }], createdAt: new Date().toISOString()
    } })).statusCode).toBe(200);
    const runningReview = (await bootstrap(app, captain.nodeToken)).reviews.find((item) => item.id === review.id)!;
    const executorToken = runningReview.executorNodeId === member.node.id ? member.nodeToken : captain.nodeToken;
    const job = (await post(app, "/api/v1/nodes/jobs/next", executorToken)).json() as AgentJob;
    expect(job.kind).toBe("REVIEW_CHANGES");
    await post(app, `/api/v1/jobs/${job.id}/status`, executorToken, { leaseToken: job.leaseToken, phase: "started", runtimeId: "fake-review" });
    const result = await post(app, `/api/v1/jobs/${job.id}/status`, executorToken, { leaseToken: job.leaseToken, phase: "completed", result: {
      summaryMarkdown: "# 影响结论\n任务需要重发", requirementPatchMarkdown: "# 统一需求 R2", decisions: [{ changeId: change.json().id, verdict: "accept", rationale: "合理" }],
      affectedTaskIds: [task.id], replacementTasks: [{ sourceTaskId: task.id, title: task.title, goal: "更新后的目标", boundary: task.boundary, acceptance: ["新验收"], assigneeNodeId: member.node.id }]
    } });
    expect(result.statusCode).toBe(200);
    let state = await bootstrap(app, captain.nodeToken);
    expect(state.tasks.find((item) => item.id === task.id)?.status).toBe("PAUSED");
    expect(state.reviews[0]?.status).toBe("AWAITING_CAPTAIN");
    expect((await post(app, `/api/v1/reviews/${review.id}/apply`, captain.nodeToken)).statusCode).toBe(200);
    state = await bootstrap(app, captain.nodeToken);
    const updated = state.tasks.find((item) => item.id === task.id) as StageTask;
    expect(updated.status).toBe("PUBLISHED"); expect(updated.goal).toBe("更新后的目标"); expect(state.room.requirementRevision).toBe(2);
    expect(state.room.currentRequirementMarkdown).toContain("# 统一需求");
    expect(state.room.currentRequirementMarkdown).toContain("# 统一需求 R2");
    await app.close();
  }, 30_000);

  it("按负载与额度选择审核节点，并在失败后跨节点重试且隔离迟到结果", async () => {
    const { app, captain, member } = await setup();
    const lowQuota = { ...heartbeat, rateLimits: [{ label: "codex:5h", usedPercent: 90, remainingPercent: 10, resetsAt: null }] };
    const highQuota = { ...heartbeat, rateLimits: [{ label: "codex:5h", usedPercent: 5, remainingPercent: 95, resetsAt: null }] };
    await post(app, "/api/v1/nodes/heartbeat", captain.nodeToken, lowQuota);
    await post(app, "/api/v1/nodes/heartbeat", member.nodeToken, highQuota);
    await post(app, "/api/v1/plans", member.nodeToken, { filename: "plan.md", content: "# 调度测试" });
    const alignment = (await post(app, "/api/v1/alignments", captain.nodeToken)).json() as AlignmentRun;
    expect(alignment.executorNodeId).toBe(member.node.id);
    const first = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
    await post(app, `/api/v1/jobs/${first.id}/status`, member.nodeToken, { leaseToken: first.leaseToken, phase: "started", runtimeId: "first" });
    const retried = await post(app, `/api/v1/jobs/${first.id}/status`, member.nodeToken, { leaseToken: first.leaseToken, phase: "failed", error: "模拟节点失败" });
    expect(retried.statusCode).toBe(200); expect(retried.json().targetNodeId).toBe(captain.nodeId); expect(retried.json().attempt).toBe(2);
    expect((await post(app, `/api/v1/jobs/${first.id}/status`, member.nodeToken, { leaseToken: first.leaseToken, phase: "completed", result: {} })).statusCode).toBe(403);
    const second = (await post(app, "/api/v1/nodes/jobs/next", captain.nodeToken)).json() as AgentJob;
    expect(second.id).toBe(first.id); expect(second.leaseToken).not.toBe(first.leaseToken);
    await app.close();
  });

  it("提案实质冲突必须由队长裁决，定稿任务校验依赖后才能发布", async () => {
    const { app, captain, member } = await setup();
    await post(app, "/api/v1/nodes/heartbeat", captain.nodeToken, heartbeat);
    await post(app, "/api/v1/nodes/heartbeat", member.nodeToken, heartbeat);
    await post(app, "/api/v1/plans", captain.nodeToken, { filename: "队长.md", content: "# 方案\n使用 SQLite" });
    await post(app, "/api/v1/plans", member.nodeToken, { filename: "成员.md", content: "# 方案\n使用 PostgreSQL\n我负责数据库迁移" });
    const created = (await post(app, "/api/v1/alignments", captain.nodeToken)).json() as AlignmentRun;
    const token = created.executorNodeId === member.node.id ? member.nodeToken : captain.nodeToken;
    const job = (await post(app, "/api/v1/nodes/jobs/next", token)).json() as AgentJob;
    const analyzed = await post(app, `/api/v1/jobs/${job.id}/status`, token, { leaseToken: job.leaseToken, phase: "completed", result: {
      alignmentMarkdown: "# 待裁决需求", tasks: [], issues: [{ title: "数据库选型", evidence: [
        { nodeId: captain.nodeId, excerpt: "使用 SQLite" }, { nodeId: member.node.id, excerpt: "使用 PostgreSQL" }
      ], options: [{ id: "sqlite", label: "SQLite", impact: "沿用现有结构" }, { id: "pg", label: "PostgreSQL", impact: "需要迁移" }], recommendedOptionId: "sqlite" }]
    } });
    expect(analyzed.statusCode).toBe(200);
    let alignment = (await bootstrap(app, captain.nodeToken)).alignments.find((item) => item.id === created.id)!;
    expect(alignment.status).toBe("NEEDS_DECISION");
    expect((await post(app, `/api/v1/alignments/${created.id}/publish`, captain.nodeToken)).statusCode).toBe(409);
    const choice = { issueId: "ISSUE-1", optionId: "OPT-1", expectedRevision: 0 };
    expect((await post(app, `/api/v1/alignments/${created.id}/resolve`, member.nodeToken, choice)).statusCode).toBe(403);
    expect((await post(app, `/api/v1/alignments/${created.id}/resolve`, captain.nodeToken, choice)).statusCode).toBe(200);
    expect((await post(app, `/api/v1/alignments/${created.id}/resolve`, captain.nodeToken, choice)).statusCode).toBe(409);
    alignment = (await bootstrap(app, captain.nodeToken)).alignments.find((item) => item.id === created.id)!;
    expect(alignment.phase).toBe("FINALIZE");
    const finalToken = alignment.executorNodeId === member.node.id ? member.nodeToken : captain.nodeToken;
    const finalJob = (await post(app, "/api/v1/nodes/jobs/next", finalToken)).json() as AgentJob;
    expect(finalJob.kind).toBe("ALIGN_FINALIZE");
    const final = await post(app, `/api/v1/jobs/${finalJob.id}/status`, finalToken, { leaseToken: finalJob.leaseToken, phase: "completed", result: {
      alignmentMarkdown: "# 统一需求\n使用 SQLite", issues: [], tasks: [{ key: "T1", title: "落地数据库", goal: "实现持久化", boundary: "仅数据库", acceptance: ["数据库测试通过"], dependencies: [], assigneeNodeId: member.node.id, sourcePlanNodeIds: [member.node.id], assignmentRationale: "成员明确认领且具备方案", effort: "M" }]
    } });
    expect(final.statusCode).toBe(200);
    alignment = (await bootstrap(app, captain.nodeToken)).alignments.find((item) => item.id === created.id)!;
    expect(alignment.status).toBe("READY");
    expect(alignment.tasks[0]?.assignmentRationale).toContain("明确认领");
    expect((await post(app, `/api/v1/alignments/${created.id}/publish`, captain.nodeToken)).statusCode).toBe(200);
    expect((await bootstrap(app, captain.nodeToken)).stages[0]?.baselineSha).toBe(git.headSha);
    await app.close();
  });

  it("离线成员让审核待补证，重连后排队轻检，队长可取消且迟到结果无效", async () => {
    const { app, captain, member } = await setup();
    const ready = await completeAlignment(app, captain.nodeToken, member.nodeToken, member.node.id);
    await post(app, `/api/v1/alignments/${ready.id}/publish`, captain.nodeToken);
    const service = (app as unknown as { v20Service: V20Service }).v20Service;
    const offline = service.repo.getNode(member.node.id)!;
    service.repo.putNode({ ...offline, lastSeenAt: null, connected: false });
    await post(app, "/api/v1/pull-requests", member.nodeToken, { filename: "change.md", content: "# 变更\n调整验收" });
    const review = (await post(app, "/api/v1/reviews", captain.nodeToken, { force: true })).json() as { id: string };
    expect((await bootstrap(app, captain.nodeToken)).reviews.find((item) => item.id === review.id)?.status).toBe("NEEDS_EVIDENCE");
    expect((await post(app, `/api/v1/reviews/${review.id}/apply`, captain.nodeToken)).statusCode).toBe(409);
    expect(service.repo.listJobs().filter((job) => job.entityId === review.id && job.kind === "IMPACT_INDEX")).toHaveLength(0);
    await post(app, "/api/v1/nodes/heartbeat", member.nodeToken, heartbeat);
    const indexJob = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
    expect(indexJob.kind).toBe("IMPACT_INDEX");
    expect((await post(app, `/api/v1/reviews/${review.id}/cancel`, member.nodeToken)).statusCode).toBe(403);
    expect((await post(app, `/api/v1/reviews/${review.id}/cancel`, captain.nodeToken)).statusCode).toBe(200);
    expect((await post(app, `/api/v1/jobs/${indexJob.id}/status`, member.nodeToken, { leaseToken: indexJob.leaseToken, phase: "completed", result: {} })).statusCode).toBe(403);
    expect((await bootstrap(app, captain.nodeToken)).pullRequests[0]?.status).toBe("QUEUED");
    await app.close();
  });

  it("长变更分片摘要后才发起轻检，单个审核输入不越预算", async () => {
    const { app, captain, member } = await setup();
    const ready = await completeAlignment(app, captain.nodeToken, member.nodeToken, member.node.id);
    await post(app, `/api/v1/alignments/${ready.id}/publish`, captain.nodeToken);
    await post(app, "/api/v1/pull-requests", member.nodeToken, { filename: "large.md", content: `# 大变更\n${"更新可验证验收。".repeat(10_000)}` });
    const review = (await post(app, "/api/v1/reviews", captain.nodeToken, { force: true })).json() as { id: string };
    const service = (app as unknown as { v20Service: V20Service }).v20Service;
    const jobs = service.repo.listJobs().filter((job) => job.entityId === review.id && job.kind === "SUMMARIZE_CHANGE");
    expect(jobs.length).toBeGreaterThan(1);
    expect(jobs.every((job) => Buffer.byteLength(String(job.payload.prompt), "utf8") < 48 * 1024)).toBe(true);
    for (const queued of jobs) {
      const token = queued.targetNodeId === member.node.id ? member.nodeToken : captain.nodeToken;
      const claimed = (await post(app, "/api/v1/nodes/jobs/next", token)).json() as AgentJob;
      expect(claimed.id).toBe(queued.id);
      const result = await post(app, `/api/v1/jobs/${claimed.id}/status`, token, { leaseToken: claimed.leaseToken, phase: "completed", result: { summaryMarkdown: `change ${review.id}: 更新验收` } });
      expect(result.statusCode).toBe(200);
    }
    expect(service.repo.getReview(review.id)?.changeBrief).toContain("更新验收");
    expect(service.repo.listJobs().some((job) => job.entityId === review.id && job.kind === "IMPACT_INDEX")).toBe(true);
    await app.close();
  });

  it("大提案先分片摘要再对齐，冻结版本且每次输入不越预算", async () => {
    const { app, captain, member } = await setup();
    await post(app, "/api/v1/nodes/heartbeat", captain.nodeToken, heartbeat);
    await post(app, "/api/v1/nodes/heartbeat", member.nodeToken, heartbeat);
    const original = (await post(app, "/api/v1/plans", member.nodeToken, { filename: "large-plan.md", content: `# 大提案\n${"目标、边界、验收与明确认领。".repeat(5_000)}` })).json() as { id: string; revision: number };
    const created = (await post(app, "/api/v1/alignments", captain.nodeToken)).json() as AlignmentRun;
    expect(created.status).toBe("QUEUED"); expect(created.agentJobId).toBeNull();
    const service = (app as unknown as { v20Service: V20Service }).v20Service;
    const summaries = service.repo.listJobs().filter((job) => job.entityId === created.id && job.kind === "SUMMARIZE_PLAN");
    expect(summaries.length).toBeGreaterThan(1);
    expect(new Set(summaries.map((job) => job.targetNodeId)).size).toBe(2);
    expect(summaries.every((job) => Buffer.byteLength(String(job.payload.prompt), "utf8") <= 48 * 1024)).toBe(true);
    await put(app, `/api/v1/plans/${original.id}`, member.nodeToken, { expectedRevision: original.revision, filename: "v2.md", content: "# 新版提案" });
    for (const queued of summaries) {
      const token = queued.targetNodeId === member.node.id ? member.nodeToken : captain.nodeToken;
      const claimed = (await post(app, "/api/v1/nodes/jobs/next", token)).json() as AgentJob;
      expect(claimed.id).toBe(queued.id);
      const result = await post(app, `/api/v1/jobs/${claimed.id}/status`, token, { leaseToken: claimed.leaseToken, phase: "completed", result: { summaryMarkdown: `nodeId=${member.node.id}；原文：目标、边界、验收与明确认领。` } });
      expect(result.statusCode).toBe(200);
    }
    const alignment = service.repo.getAlignment(created.id)!;
    expect(alignment.planSnapshot[0]?.revision).toBe(original.revision);
    expect(alignment.planBrief).toContain(member.node.id);
    const analyze = service.repo.getJob(alignment.agentJobId!)!;
    expect(analyze.kind).toBe("ALIGN_PLANS");
    expect(Buffer.byteLength(String(analyze.payload.prompt), "utf8")).toBeLessThan(48 * 1024);
    expect(String(analyze.payload.prompt)).not.toContain("新版提案");
    await app.close();
  });

  it("同节点多任务分别深查，工作树漂移取消旧租约并重新轻检", async () => {
    const { app, captain, member } = await setup();
    const ready = await completeAlignment(app, captain.nodeToken, member.nodeToken, member.node.id);
    const stage = (await post(app, `/api/v1/alignments/${ready.id}/publish`, captain.nodeToken)).json() as { id: string };
    const service = (app as unknown as { v20Service: V20Service }).v20Service;
    const first = service.repo.listTasks(stage.id)[0]!;
    const second = { ...first, id: `${first.id}-SECOND`, title: "独立验收任务", revision: 1 };
    service.repo.putTask(second);
    await post(app, "/api/v1/pull-requests", member.nodeToken, { filename: "change.md", content: "# 变更\n更新验收" });
    const review = (await post(app, "/api/v1/reviews", captain.nodeToken, { force: true })).json() as { id: string };
    const index = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
    expect(index.kind).toBe("IMPACT_INDEX");
    expect((await post(app, `/api/v1/jobs/${index.id}/status`, member.nodeToken, { leaseToken: index.leaseToken, phase: "completed", result: {
      nodeId: member.node.id, headSha: git.headSha, fingerprint: git.fingerprint, taskIds: [first.id, second.id], changedPaths: ["src/a.ts"], candidatePaths: [], omittedPaths: 0, diffSummary: "1 file", createdAt: new Date().toISOString()
    } })).statusCode).toBe(200);
    const probeJobs = service.repo.listJobs().filter((job) => job.entityId === review.id && job.kind === "IMPACT_PROBE");
    expect(probeJobs).toHaveLength(2);
    expect(new Set(probeJobs.map((job) => job.payload.taskId))).toEqual(new Set([first.id, second.id]));
    const oldProbe = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
    expect(service.claimJob(service.repo.getNode(member.node.id)!)).toBeNull(); // 同节点模型审核串行，避免瞬间抢满额度
    const drifted = { ...git, fingerprint: "e".repeat(64) };
    await post(app, "/api/v1/nodes/heartbeat", member.nodeToken, { ...heartbeat, git: drifted });
    expect(service.repo.getJob(oldProbe.id)?.status).toBe("CANCELLED");
    expect((await post(app, `/api/v1/jobs/${oldProbe.id}/status`, member.nodeToken, { leaseToken: oldProbe.leaseToken, phase: "completed", result: {} })).statusCode).toBe(403);
    expect(service.repo.getReview(review.id)?.indexes?.[member.node.id]).toBeUndefined();
    const renewed = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
    expect(renewed.kind).toBe("IMPACT_INDEX");
    expect((await post(app, `/api/v1/jobs/${renewed.id}/status`, member.nodeToken, { leaseToken: renewed.leaseToken, phase: "completed", result: {
      nodeId: member.node.id, headSha: git.headSha, fingerprint: drifted.fingerprint, taskIds: [first.id, second.id], changedPaths: ["src/b.ts"], candidatePaths: [], omittedPaths: 0, diffSummary: "1 file", createdAt: new Date().toISOString()
    } })).statusCode).toBe(200);
    for (const taskId of [first.id, second.id]) {
      const probe = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
      expect(probe.kind).toBe("IMPACT_PROBE"); expect(probe.payload.taskId).toBe(taskId);
      expect((await post(app, `/api/v1/jobs/${probe.id}/status`, member.nodeToken, { leaseToken: probe.leaseToken, phase: "completed", result: {
        nodeId: member.node.id, headSha: git.headSha, fingerprint: drifted.fingerprint,
        affectedTaskIds: taskId === first.id ? [taskId] : [], unaffectedTaskIds: taskId === second.id ? [taskId] : [], uncertainTaskIds: [],
        findings: [{ taskId, reason: "已检查实现和验收路径", paths: ["src/b.ts:1"] }], createdAt: new Date().toISOString()
      } })).statusCode).toBe(200);
      if (taskId === first.id) expect(service.repo.getReview(review.id)?.agentJobId).toBeNull();
    }
    expect(service.repo.getReview(review.id)?.probes?.[member.node.id]?.affectedTaskIds).toEqual([first.id]);
    expect(service.repo.getReview(review.id)?.pendingNodeIds).toEqual([]);
    expect(service.repo.getReview(review.id)?.agentJobId).toBeTruthy();
    await app.close();
  });

  it("显式无交集的轻检结论也受代码版本约束，漂移后不得应用", async () => {
    const { app, captain, member } = await setup();
    const ready = await completeAlignment(app, captain.nodeToken, member.nodeToken, member.node.id);
    const stage = (await post(app, `/api/v1/alignments/${ready.id}/publish`, captain.nodeToken)).json() as { id: string };
    const service = (app as unknown as { v20Service: V20Service }).v20Service;
    const task = service.repo.listTasks(stage.id)[0]!;
    service.repo.putTask({ ...task, boundary: "仅 apps/web/src", revision: task.revision + 1 });
    await post(app, "/api/v1/pull-requests", member.nodeToken, { filename: "change.md", content: "# 变更\n仅 packages/protocol/src 的协议字段" });
    const review = (await post(app, "/api/v1/reviews", captain.nodeToken, { force: true })).json() as { id: string };
    const index = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
    expect((await post(app, `/api/v1/jobs/${index.id}/status`, member.nodeToken, { leaseToken: index.leaseToken, phase: "completed", result: {
      nodeId: member.node.id, headSha: git.headSha, fingerprint: git.fingerprint, taskIds: [task.id], changedPaths: [], candidatePaths: [], omittedPaths: 0, diffSummary: "", createdAt: new Date().toISOString()
    } })).statusCode).toBe(200);
    expect(service.repo.getReview(review.id)?.clearedNodeIds).toContain(member.node.id);
    const aggregate = service.repo.getReview(review.id)?.agentJobId;
    expect(aggregate).toBeTruthy();
    await post(app, "/api/v1/nodes/heartbeat", member.nodeToken, { ...heartbeat, git: { ...git, fingerprint: "e".repeat(64) } });
    expect(service.repo.getJob(aggregate!)?.status).toBe("CANCELLED");
    expect(service.repo.getReview(review.id)?.status).toBe("NEEDS_EVIDENCE");
    expect((await post(app, `/api/v1/reviews/${review.id}/apply`, captain.nodeToken)).statusCode).toBe(409);
    await app.close();
  });

  it("阶段结束后连续审核批次保留先前获批的下一阶段任务", async () => {
    const { app, captain, member } = await setup();
    const ready = await completeAlignment(app, captain.nodeToken, member.nodeToken, member.node.id);
    const stage = (await post(app, `/api/v1/alignments/${ready.id}/publish`, captain.nodeToken)).json() as { id: string };
    const service = (app as unknown as { v20Service: V20Service }).v20Service;
    const task = service.repo.listTasks(stage.id)[0]!;
    service.repo.putTask({ ...task, status: "DONE", doneAt: new Date().toISOString(), revision: task.revision + 1 });
    const firstChange = (await post(app, "/api/v1/pull-requests", member.nodeToken, { filename: "first.md", content: "# 第一批\n更新验收" })).json() as { id: string };
    const firstReview = (await post(app, "/api/v1/reviews", captain.nodeToken, { force: false })).json() as { id: string };
    await post(app, "/api/v1/pull-requests", member.nodeToken, { filename: "second.md", content: "# 第二批\n调整备注" });
    const finishEvidence = async (reviewId: string, changeId: string, verdict: "accept" | "reject") => {
      const index = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
      expect(index.kind).toBe("IMPACT_INDEX");
      await post(app, `/api/v1/jobs/${index.id}/status`, member.nodeToken, { leaseToken: index.leaseToken, phase: "completed", result: {
        nodeId: member.node.id, headSha: git.headSha, fingerprint: git.fingerprint, taskIds: [task.id], changedPaths: ["src/work.ts"], candidatePaths: [], omittedPaths: 0, diffSummary: "1 file", createdAt: new Date().toISOString()
      } });
      const probe = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
      expect(probe.kind).toBe("IMPACT_PROBE");
      await post(app, `/api/v1/jobs/${probe.id}/status`, member.nodeToken, { leaseToken: probe.leaseToken, phase: "completed", result: {
        nodeId: member.node.id, headSha: git.headSha, fingerprint: git.fingerprint,
        affectedTaskIds: verdict === "accept" ? [task.id] : [], unaffectedTaskIds: verdict === "reject" ? [task.id] : [], uncertainTaskIds: [],
        findings: [{ taskId: task.id, reason: "检查完成", paths: ["src/work.ts:1"] }], createdAt: new Date().toISOString()
      } });
      const review = service.repo.getReview(reviewId)!;
      const token = review.executorNodeId === member.node.id ? member.nodeToken : captain.nodeToken;
      const aggregate = (await post(app, "/api/v1/nodes/jobs/next", token)).json() as AgentJob;
      expect(aggregate.kind).toBe("REVIEW_CHANGES");
      const result = await post(app, `/api/v1/jobs/${aggregate.id}/status`, token, { leaseToken: aggregate.leaseToken, phase: "completed", result: {
        summaryMarkdown: "# 影响结论", requirementPatchMarkdown: verdict === "accept" ? "新增验收" : "",
        decisions: [{ changeId, verdict, rationale: "已核查" }], affectedTaskIds: verdict === "accept" ? [task.id] : [],
        replacementTasks: verdict === "accept" ? [{ sourceTaskId: task.id, title: "下一阶段实现", goal: "完成新增验收", boundary: "仅 src/work.ts", acceptance: ["新验收通过"], assigneeNodeId: member.node.id, dependencies: [] }] : []
      } });
      expect(result.statusCode).toBe(200);
    };
    await finishEvidence(firstReview.id, firstChange.id, "accept");
    expect((await post(app, `/api/v1/reviews/${firstReview.id}/apply`, captain.nodeToken)).statusCode).toBe(200);
    expect(service.repo.getStage(stage.id)?.nextStageDraftTasks).toHaveLength(1);
    const secondReview = service.repo.listReviews().find((item) => item.id !== firstReview.id)!;
    expect(secondReview.status).toBe("NEEDS_EVIDENCE");
    const secondChange = service.repo.listPullRequests().find((item) => item.id !== firstChange.id)!;
    await finishEvidence(secondReview.id, secondChange.id, "reject");
    expect((await post(app, `/api/v1/reviews/${secondReview.id}/reject`, captain.nodeToken)).statusCode).toBe(200);
    const draft = service.repo.listAlignments().find((item) => item.source === "change_review" && item.status === "READY");
    expect(draft?.tasks[0]?.title).toBe("下一阶段实现");
    expect(service.repo.getStage(stage.id)?.status).toBe("COMPLETED");
    await app.close();
  });

  it("长需求经摘要审核后应用增量修订，不丢失旧需求原文", async () => {
    const { app, captain, member } = await setup();
    const ready = await completeAlignment(app, captain.nodeToken, member.nodeToken, member.node.id);
    const stage = (await post(app, `/api/v1/alignments/${ready.id}/publish`, captain.nodeToken)).json() as { id: string };
    const service = (app as unknown as { v20Service: V20Service }).v20Service;
    const original = `# 长篇旧需求\n${"每项验收必须独立可测。".repeat(5_000)}\nUNIQUE_OLD_REQUIREMENT_END`;
    service.repo.putStage({ ...service.repo.getStage(stage.id)!, requirementMarkdown: original });
    service.repo.setRequirementMarkdown(original);
    const change = (await post(app, "/api/v1/pull-requests", member.nodeToken, { filename: "change.md", content: "# 变更\n补充日志字段" })).json() as { id: string };
    const review = (await post(app, "/api/v1/reviews", captain.nodeToken, { force: true })).json() as { id: string };
    const summaries = service.repo.listJobs().filter((job) => job.entityId === review.id && job.kind === "SUMMARIZE_CHANGE");
    expect(summaries.length).toBeGreaterThan(1);
    for (const queued of summaries) {
      const token = queued.targetNodeId === member.node.id ? member.nodeToken : captain.nodeToken;
      const claimed = (await post(app, "/api/v1/nodes/jobs/next", token)).json() as AgentJob;
      expect(claimed.id).toBe(queued.id);
      expect((await post(app, `/api/v1/jobs/${claimed.id}/status`, token, { leaseToken: claimed.leaseToken, phase: "completed", result: { summaryMarkdown: `需求旧条款保留；change id=${change.id} 补充日志字段` } })).statusCode).toBe(200);
    }
    const task = service.repo.listTasks(stage.id)[0]!;
    const index = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
    await post(app, `/api/v1/jobs/${index.id}/status`, member.nodeToken, { leaseToken: index.leaseToken, phase: "completed", result: {
      nodeId: member.node.id, headSha: git.headSha, fingerprint: git.fingerprint, taskIds: [task.id], changedPaths: [], candidatePaths: [], omittedPaths: 0, diffSummary: "", createdAt: new Date().toISOString()
    } });
    const probe = (await post(app, "/api/v1/nodes/jobs/next", member.nodeToken)).json() as AgentJob;
    expect(probe.kind).toBe("IMPACT_PROBE");
    await post(app, `/api/v1/jobs/${probe.id}/status`, member.nodeToken, { leaseToken: probe.leaseToken, phase: "completed", result: {
      nodeId: member.node.id, headSha: git.headSha, fingerprint: git.fingerprint, affectedTaskIds: [], unaffectedTaskIds: [task.id], uncertainTaskIds: [],
      findings: [{ taskId: task.id, reason: "日志字段不涉及该任务", paths: ["src/other.ts:1"] }], createdAt: new Date().toISOString()
    } });
    const running = service.repo.getReview(review.id)!;
    const executorToken = running.executorNodeId === member.node.id ? member.nodeToken : captain.nodeToken;
    const aggregate = (await post(app, "/api/v1/nodes/jobs/next", executorToken)).json() as AgentJob;
    expect(aggregate.kind).toBe("REVIEW_CHANGES");
    await post(app, `/api/v1/jobs/${aggregate.id}/status`, executorToken, { leaseToken: aggregate.leaseToken, phase: "completed", result: {
      summaryMarkdown: "# 无现有任务受影响", requirementPatchMarkdown: "增加日志字段说明", decisions: [{ changeId: change.id, verdict: "accept", rationale: "合理" }],
      affectedTaskIds: [], replacementTasks: []
    } });
    expect((await post(app, `/api/v1/reviews/${review.id}/apply`, captain.nodeToken)).statusCode).toBe(200);
    const requirement = service.repo.requirementMarkdown();
    expect(requirement).toContain("UNIQUE_OLD_REQUIREMENT_END");
    expect(requirement).toContain("增加日志字段说明");
    await app.close();
  });
});
