import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentJob, AlignmentRun, CloudflareTunnelStatus, CollaborationNode, StageTask, V20BootstrapPayload } from "@vibe-git/protocol";
import { buildApp } from "../src/app.js";
import type { CloudflareManager } from "../src/integrations/cloudflare/manager.js";

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

const git = { branch: "main", headSha: "a".repeat(40), dirty: false, observedAt: new Date().toISOString() };
const heartbeat = { workspaceReady: true, auditCodex: "available", workCodex: "available", workTransport: "auto", rateLimits: [{ label: "codex:5h", usedPercent: 20, remainingPercent: 80, resetsAt: null }], git, currentTaskId: null };

async function post(app: Awaited<ReturnType<typeof buildApp>>, url: string, token: string, payload: unknown = {}) {
  const response = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}` }, payload: payload as never });
  return response;
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

  it("校验 Markdown、保留版本和哈希，并隔离任务权限", async () => {
    const { app, captain, member } = await setup();
    expect((await post(app, "/api/v1/plans", member.nodeToken, { filename: "other.md", content: "x" })).statusCode).toBe(400);
    expect((await post(app, "/api/v1/plans", member.nodeToken, { filename: "plan.md", content: "" })).statusCode).toBe(400);
    const first = await post(app, "/api/v1/plans", member.nodeToken, { filename: "plan.md", content: "# A" });
    const same = await post(app, "/api/v1/plans", member.nodeToken, { filename: "plan.md", content: "# A" });
    const second = await post(app, "/api/v1/plans", member.nodeToken, { filename: "plan.md", content: "# B" });
    expect(first.json().revision).toBe(1); expect(same.json().id).toBe(first.json().id); expect(second.json().revision).toBe(2);
    expect(first.json().sha256).toMatch(/^[0-9a-f]{64}$/);
    const ready = await completeAlignment(app, captain.nodeToken, member.nodeToken, member.node.id);
    expect(ready.status).toBe("READY");
    const publish = await post(app, `/api/v1/alignments/${ready.id}/publish`, captain.nodeToken);
    expect(publish.statusCode).toBe(200);
    const task = (await bootstrap(app, captain.nodeToken)).tasks[0]!;
    expect((await post(app, `/api/v1/tasks/${task.id}/detail`, captain.nodeToken, { filename: "task.md", content: "越权" })).statusCode).toBe(403);
    expect((await post(app, `/api/v1/tasks/${task.id}/detail`, member.nodeToken, { filename: "task.md", content: "# 执行细节\n只补步骤" })).statusCode).toBe(200);
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
    const change = await post(app, "/api/v1/pull-requests", member.nodeToken, { filename: "change.md", content: "# 变更\n调整验收" });
    const duplicate = await post(app, "/api/v1/pull-requests", member.nodeToken, { filename: "change.md", content: "# 变更\n调整验收" });
    expect(duplicate.json().id).toBe(change.json().id);
    expect((await post(app, "/api/v1/reviews", member.nodeToken, { force: true })).statusCode).toBe(403);
    const reviewResponse = await post(app, "/api/v1/reviews", captain.nodeToken, { force: true });
    expect(reviewResponse.statusCode, reviewResponse.body).toBe(200);
    const review = reviewResponse.json() as { id: string; executorNodeId: string };
    const executorToken = review.executorNodeId === member.node.id ? member.nodeToken : captain.nodeToken;
    const job = (await post(app, "/api/v1/nodes/jobs/next", executorToken)).json() as AgentJob;
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
});
