import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AlignmentRun, CloudflareTunnelStatus, QuickPlanInput, StageTask } from "@vibe-git/protocol";
import { buildApp } from "../src/app.js";
import type { V20Service } from "../src/v20/service.js";

const roots: string[] = [], apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir(), "vibe-coordination-"))) throw new Error("Unexpected cleanup target"); await rm(root, { recursive: true, force: true }); }
});
class Tunnel {
  async status(): Promise<CloudflareTunnelStatus> { return { phase: "ready", installed: false, running: false, version: null, url: null, logs: [], lastError: null, updatedAt: new Date().toISOString() }; }
  async install() { return this.status(); } async start() { return this.status(); } async stop() { return this.status(); } async close() {}
}
async function setup() {
  const root = await mkdtemp(resolve(tmpdir(), "vibe-coordination-")); roots.push(root);
  const app = await buildApp({ dbPath: resolve(root, "room.db"), dataDir: root, staticDir: false, backupDatabase: false, cloudflareManager: new Tunnel() }); apps.push(app);
  const captainFile = JSON.parse(await readFile(resolve(root, "captain.json"), "utf8"));
  const service = (app as unknown as { v20Service: V20Service }).v20Service;
  const captain = service.repo.getNode(captainFile.nodeId)!;
  const invite = JSON.parse(await readFile(resolve(root, "invite.json"), "utf8"));
  const joined = service.join(invite.inviteToken, "http://localhost"); const member = joined.node;
  const beat = { workspaceReady: true, codex: "unverified" as const, workTransport: "auto" as const, rateLimits: [], currentTaskId: null,
    git: { branch: "main", headSha: "a".repeat(40), dirty: false, fingerprint: "f".repeat(64), observedAt: new Date().toISOString() } };
  service.heartbeat(captain, beat); service.heartbeat(member, beat);
  const c = service.coordination;
  const intent = c.saveIntent(captain, { title: "群面", content: "## 房间\n管理房间状态\n## 报告\n输出评价", acceptance: ["可以创建房间"] });
  const plan: QuickPlanInput = { tasks: [
    { key: "room", title: "房间", goal: "实现状态机", boundary: "只改 room", acceptance: ["状态测试通过"], assigneeNodeId: captain.id, dependencies: [], requirementRefs: ["## 房间"] },
    { key: "report", title: "报告", goal: "生成报告", boundary: "只改 report", acceptance: ["报告可读取"], assigneeNodeId: member.id, dependencies: [], requirementRefs: ["## 报告"] }
  ], contracts: [], issues: [] };
  const publish = () => { const draft = c.importPlan(captain, intent.id, { expectedRevision: intent.revision, plan }); const stage = service.publishAlignment(captain, draft.id); return plan.tasks.map(draft => service.repo.listTasks(stage.id).find(task => task.title === draft.title)!); };
  return { app, service, captain, member, c, intent, plan, publish, beat, captainToken: captainFile.nodeToken as string };
}

describe("共享需求与可选执行", () => {
  it("无需 Codex、全员提案或队长仓库摘要即可导入并发布；离线成员不阻塞独立任务", async () => {
    const { service, captain, member, c, publish } = await setup();
    service.repo.putNode({ ...service.repo.getNode(member.id)!, lastSeenAt: null });
    const tasks = publish(); expect(tasks).toHaveLength(2);
    expect(c.readiness(captain, tasks[0]!).canStartExternal).toBe(true);
    expect(c.readiness(captain, tasks[0]!).canStartCodex).toBe(false);
    const started = c.startExternal(captain, tasks[0]!.id, 1);
    expect(started.executionMode).toBe("external"); expect(service.repo.listJobs()).toHaveLength(0);
    expect(c.executionPackage(started.id).requirements).not.toContain("## 报告");
    expect(() => c.startExternal(member, started.id, started.revision)).toThrow("自己的任务");
  });
  it("导入拒绝循环、伪造负责人和不匹配的契约；过期草稿不能发布", async () => {
    const { c, captain, intent, plan } = await setup();
    const invalid = structuredClone(plan); invalid.tasks[0]!.dependencies = ["report"]; invalid.tasks[1]!.dependencies = ["room"];
    expect(() => c.importPlan(captain, intent.id, { expectedRevision: 1, plan: invalid })).toThrow("循环");
    invalid.tasks[0]!.assigneeNodeId = "unknown";
    expect(() => c.importPlan(captain, intent.id, { expectedRevision: 1, plan: invalid })).toThrow("负责人");
    const draft = c.importPlan(captain, intent.id, { expectedRevision: 1, plan });
    c.saveIntent(captain, { title: intent.title, content: "changed", expectedRevision: 1 }, intent.id);
    expect(() => c.publish(captain, draft.id)).toThrow("已变化");
  });
  it("外部执行提交证据后负责人确认完成；Git 或任务版本漂移拒绝旧结果", async () => {
    const { c, captain, publish, service, beat } = await setup();
    const [task] = publish(); const started = c.startExternal(captain, task!.id, 1);
    expect(() => c.reportExternal(captain, task!.id, { expectedRevision: 1, action: "ready", summary: "passed" })).toThrow("已变化");
    const report = c.reportExternal(captain, task!.id, { expectedRevision: started.revision, action: "ready", summary: "node test: 3 passed" });
    service.heartbeat(captain, { ...beat, git: { ...beat.git, fingerprint: "b".repeat(64) } });
    expect(() => c.finishExternal(captain, task!.id, report.revision)).toThrow("Git 快照");
    const fresh = c.reportExternal(captain, task!.id, { expectedRevision: report.revision, action: "ready", summary: "retested: passed" });
    expect(c.finishExternal(captain, task!.id, fresh.revision).status).toBe("DONE");
  });
  it("未确认契约不阻塞发布，只阻塞相关开工；双方确认后可以并行", async () => {
    const { c, captain, member, plan, publish, service } = await setup();
    plan.tasks[1]!.dependencies = ["room"];
    plan.tasks[1]!.dependencyEdges = [{ upstreamKey: "room", mode: "CONTRACT", contractKey: "api", reason: "稳定接口" }];
    plan.contracts = [{ key: "api", providerTaskKey: "room", consumerTaskKeys: ["report"], kind: "http", name: "Room API", signature: "GET /rooms", behavior: ["返回房间"], examples: [], errors: [], testCommand: "npm test", handoff: "Git SHA" }];
    const tasks = publish(), contract = service.repo.listContracts()[0]!;
    expect(c.readiness(member, tasks[1]!).canStartExternal).toBe(false);
    c.acknowledgeContract(captain, contract.id, 1); c.acknowledgeContract(member, contract.id, 1);
    expect(c.readiness(member, tasks[1]!).canStartExternal).toBe(true);
    const started = c.startExternal(member, tasks[1]!.id, 1);
    expect(() => c.reportExternal(member, started.id, { expectedRevision: started.revision, action: "ready", summary: "only mock" })).toThrow("上游");
  });
  it("变更只打断确认受影响的任务；外部执行不能伪装为已经暂停", async () => {
    const { c, captain, member, publish, service } = await setup();
    const tasks = publish(); const a = c.startExternal(captain, tasks[0]!.id, 1), b = c.startExternal(member, tasks[1]!.id, 1);
    const change = c.submitChange(member, { title: "暂停房间", content: "增加暂停", taskIds: [a.id], expectedRequirementRevision: 1 });
    const impact = c.impact(change.id);
    c.applyChange(captain, change.id, { expectedRevision: 1, expectedRequirementRevision: 1,
      decisions: impact.tasks.map(item => ({ taskId: item.taskId, expectedRevision: item.revision, affected: item.taskId === a.id,
        ...(item.taskId === a.id ? { update: { goal: "实现支持暂停的房间状态机", boundary: a.boundary, acceptance: [...a.acceptance, "主持人可以暂停房间"] } } : {}) })) });
    const revised = service.repo.getTask(a.id)!;
    expect(revised.status).toBe("IN_PROGRESS"); expect(revised.pauseRequested).toBe(true);
    expect(service.repo.getTask(b.id)).toEqual(b);
    expect(() => c.acknowledgeChange(captain, a.id, { expectedRevision: revised.revision })).toThrow("停止旧版本任务");
    expect(() => c.reportExternal(captain, a.id, { expectedRevision: a.revision, action: "ready", summary: "old" })).toThrow("已变化");
    const ack = c.acknowledgeChange(captain, a.id, { expectedRevision: revised.revision, stopped: true });
    expect(ack.status).toBe("PUBLISHED"); expect(c.executionPackage(a.id).changes).toHaveLength(1);
    const report = c.reportExternal(member, b.id, { expectedRevision: b.revision, action: "ready", summary: "passed" });
    expect(c.finishExternal(member, b.id, report.revision).status).toBe("DONE");
  });
  it("只标记受影响、原样提交或空验收不能应用，失败时保留需求和任务", async () => {
    const { c, captain, publish, service } = await setup();
    const [room, report] = publish();
    const change = c.submitChange(captain, { title: "暂停房间", content: "主持人可以暂停房间", taskIds: [room!.id], expectedRequirementRevision: 1 });
    const decisions = c.impact(change.id).tasks.map(item => ({ taskId: item.taskId, expectedRevision: item.revision, affected: item.taskId === room!.id }));
    const input = { expectedRevision: change.revision, expectedRequirementRevision: 1, decisions };
    expect(() => c.applyChange(captain, change.id, input)).toThrow("还没有具体修订");
    const update = { goal: room!.goal, boundary: room!.boundary, acceptance: room!.acceptance };
    expect(() => c.applyChange(captain, change.id, { ...input, decisions: decisions.map(item => item.affected ? { ...item, update } : item) })).toThrow("还没有具体修订");
    expect(() => c.applyChange(captain, change.id, { ...input, decisions: decisions.map(item => item.affected ? { ...item, update: { ...update, goal: "新增暂停能力", acceptance: [] } } : item) })).toThrow("修订验收");
    expect(c.change(change.id).status).toBe("PENDING"); expect(service.repo.requirementRevision()).toBe(1);
    expect(service.repo.getTask(room!.id)).toEqual(room); expect(service.repo.getTask(report!.id)).toEqual(report);
  });
  it("确认应用的是人工核对后的草稿，保存不可变对比，负责人确认和后续修订不丢失记录", async () => {
    const { c, captain, member, publish, service, beat, app, captainToken } = await setup();
    const [room, report] = publish();
    const change = c.submitChange(member, { title: "暂停房间", content: "主持人可以暂停和恢复房间", taskIds: [room!.id], expectedRequirementRevision: 1 });
    service.heartbeat(captain, { ...beat, codex: "available" });
    const queued = c.suggestImpact(captain, change.id, change.revision), job = service.claimJob(captain)!;
    expect(job.id).toBe(queued.suggestion!.jobId);
    expect(JSON.stringify(job.payload.outputSchema)).toContain('"update"');
    const draft = { goal: "实现支持暂停的状态机", boundary: room!.boundary, acceptance: ["状态测试通过", "主持人可暂停房间"] };
    service.reportJob(captain, job.id, { leaseToken: job.leaseToken!, phase: "completed", result: { findings: [
      { taskId: room!.id, impact: "affected", reason: "新增暂停状态", update: draft },
      { taskId: report!.id, impact: "unaffected", reason: "报告不受影响", update: null }
    ] } });
    expect(c.change(change.id).suggestion!.findings[0]!.update).toEqual(draft);
    expect(service.repo.getTask(room!.id)).toEqual(room);
    const reviewed = { goal: "实现支持暂停与恢复的状态机", boundary: "只改 room，保留原有房间流程", acceptance: ["状态测试通过", "主持人可暂停并恢复房间", "普通成员不能修改暂停状态"] };
    const impact = c.impact(change.id);
    const appliedResponse = await app.inject({ method: "POST", url: `/api/v1/changes/${change.id}/apply`, headers: { authorization: `Bearer ${captainToken}` }, payload: {
      expectedRevision: impact.changeRevision, expectedRequirementRevision: impact.requirementRevision,
      decisions: impact.tasks.map(item => ({ taskId: item.taskId, expectedRevision: item.revision, affected: item.taskId === room!.id,
        ...(item.taskId === room!.id ? { update: { ...reviewed, goal: `  ${reviewed.goal}  ` } } : {}) }))
    } });
    expect(appliedResponse.statusCode).toBe(200);
    const snapshot = appliedResponse.json().taskChanges[0];
    expect(snapshot).toEqual({ taskId: room!.id, title: room!.title, beforeRevision: room!.revision, afterRevision: room!.revision + 1,
      before: { goal: room!.goal, boundary: room!.boundary, acceptance: room!.acceptance }, after: reviewed });
    const revised = service.repo.getTask(room!.id)!;
    expect(revised).toMatchObject(reviewed); expect(revised.brief?.deliverables).toEqual(reviewed.acceptance);
    expect(c.executionPackage(room!.id)).toMatchObject(reviewed); expect(c.executionPackage(room!.id).markdown).toContain(reviewed.goal);
    expect(service.repo.getTask(report!.id)).toEqual(report);
    const ack = c.acknowledgeChange(captain, room!.id, { expectedRevision: revised.revision });
    expect(ack).toMatchObject({ ...reviewed, pendingChangeId: null, status: "PUBLISHED" });
    const next = c.submitChange(captain, { title: "暂停时长", content: "记录暂停时长", taskIds: [room!.id], expectedRequirementRevision: 2 });
    const nextImpact = c.impact(next.id);
    c.applyChange(captain, next.id, { expectedRevision: nextImpact.changeRevision, expectedRequirementRevision: 2,
      decisions: nextImpact.tasks.map(item => ({ taskId: item.taskId, expectedRevision: item.revision, affected: item.taskId === room!.id,
        ...(item.taskId === room!.id ? { update: { ...reviewed, acceptance: [...reviewed.acceptance, "记录每次暂停时长"] } } : {}) })) });
    expect(c.change(change.id).taskChanges![0]).toEqual(snapshot);
    expect(c.change(next.id).taskChanges![0]!.before).toEqual(reviewed);
  });
  it("只修订接口时允许相关任务正文保持原样，并拒绝未变化的接口", async () => {
    const { c, captain, plan, publish, service } = await setup();
    plan.contracts = [{ key: "api", providerTaskKey: "room", consumerTaskKeys: ["report"], kind: "http", name: "Room API", signature: "GET /rooms", behavior: ["返回房间"], examples: [], errors: [], testCommand: "npm test", handoff: "Git SHA" }];
    const tasks = publish(), contract = service.repo.listContracts()[0]!;
    const change = c.submitChange(captain, { title: "接口增加状态", content: "返回暂停状态", contractIds: [contract.id], expectedRequirementRevision: 1 });
    const impact = c.impact(change.id), input = { expectedRevision: 1, expectedRequirementRevision: 1,
      decisions: impact.tasks.map(item => ({ taskId: item.taskId, expectedRevision: item.revision, affected: true })) };
    const update = { contractId: contract.id, expectedRevision: contract.revision, signature: contract.signature, behavior: contract.behavior, testCommand: contract.testCommand };
    expect(() => c.applyChange(captain, change.id, { ...input, contractUpdates: [update] })).toThrow("尚未修改");
    const applied = c.applyChange(captain, change.id, { ...input, contractUpdates: [{ ...update, behavior: ["返回房间和暂停状态"] }] });
    expect(applied.taskChanges).toHaveLength(2);
    for (const snapshot of applied.taskChanges!) expect(snapshot.after).toEqual(snapshot.before);
    expect(service.repo.getContract(contract.id)).toMatchObject({ behavior: ["返回房间和暂停状态"], revision: 2, status: "DRAFT", acknowledgedNodeIds: [] });
    for (const task of tasks) expect(service.repo.getTask(task.id)).toMatchObject({ goal: task.goal, boundary: task.boundary, acceptance: task.acceptance, pendingChangeId: change.id });
  });
  it("影响不明确时要求人工确认；重复应用和旧需求上的审核被拒绝", async () => {
    const { c, captain, publish } = await setup(); publish();
    const change = c.submitChange(captain, { title: "调整规则", content: "新规则", expectedRequirementRevision: 1 });
    expect(c.impact(change.id).tasks.every(item => item.uncertain)).toBe(true);
    expect(() => c.applyChange(captain, change.id, { expectedRevision: 1, expectedRequirementRevision: 1, decisions: [] })).toThrow("逐项确认");
    const stale = c.submitChange(captain, { title: "旧建议", content: "规则", expectedRequirementRevision: 1 });
    const impact = c.impact(change.id);
    c.applyChange(captain, change.id, { expectedRevision: 1, expectedRequirementRevision: 1, decisions: impact.tasks.map(item => ({ taskId: item.taskId, expectedRevision: item.revision, affected: false })) });
    expect(() => c.applyChange(captain, change.id, { expectedRevision: 1 })).toThrow("已变化");
    expect(() => c.applyChange(captain, stale.id, { expectedRevision: 1, expectedRequirementRevision: 2 })).toThrow("旧需求");
  });
  it("HTTP 路由使用现有凭据边界，执行包只读，未认证不能写入", async () => {
    const { app, publish, captainToken } = await setup(); const [task] = publish();
    expect((await app.inject({ method: "POST", url: "/api/v1/intents", payload: { title: "x", content: "x" } })).statusCode).toBe(403);
    const result = await app.inject({ method: "GET", url: `/api/v1/tasks/${task!.id}/package`, headers: { authorization: `Bearer ${captainToken}` } });
    expect(result.statusCode).toBe(200); expect(result.json().markdown).toContain("## 验收");
  });
  it("Codex 快速规划共用导入校验；迟到生成不能覆盖已修订需求", async () => {
    const { c, captain, service, intent, plan, beat } = await setup(); service.heartbeat(captain, { ...beat, codex: "available" });
    const alignment = c.generate(captain, intent.id, 1), job = service.repo.getJob(alignment.agentJobId!)!;
    c.completePlan(job, plan); expect(service.repo.getAlignment(alignment.id)?.status).toBe("READY");
    c.saveIntent(captain, { title: "新需求", content: "revision", expectedRevision: 1 }, intent.id);
    expect(() => c.completePlan(job, plan)).toThrow("已变化");
  });
  it("算力池影响建议只生成待审候选，不自动暂停；过期任务快照不能套用", async () => {
    const { service, c, captain, member, beat, publish } = await setup();
    service.heartbeat(captain, { ...beat, codex: "available" });
    const [room, report] = publish();
    const change = c.submitChange(member, { title: "调整房间状态", content: "主持人可暂停", taskIds: [room!.id], expectedRequirementRevision: 1 });
    const queued = c.suggestImpact(captain, change.id, change.revision);
    const job = service.repo.getJob(queued.suggestion!.jobId)!;
    const claimed = service.claimJob(captain)!;
    expect(claimed.id).toBe(job.id);
    service.reportJob(captain, job.id, { leaseToken: claimed.leaseToken!, phase: "completed", result: { findings: [
      { taskId: room!.id, impact: "affected", reason: "变更直接改写房间状态规则", update: { goal: "实现支持暂停的房间状态机", boundary: room!.boundary, acceptance: [...room!.acceptance, "主持人可以暂停房间"] } },
      { taskId: report!.id, impact: "unaffected", reason: "报告生成不依赖暂停行为", update: null }
    ] } });
    expect(c.impact(change.id).tasks.find(item => item.taskId === room!.id)?.suggested).toBe(true);
    expect(service.repo.getTask(room!.id)?.status).toBe("PUBLISHED");
    expect(service.repo.listJobs().filter(item => item.kind === "INTERRUPT_TASK")).toHaveLength(0);
    const second = c.submitChange(member, { title: "再次变化", content: "另一个要求", expectedRequirementRevision: 1 });
    const pending = c.suggestImpact(captain, second.id, second.revision), staleJob = service.repo.getJob(pending.suggestion!.jobId)!;
    const claimedAgain = service.claimJob(captain)!; expect(claimedAgain.id).toBe(staleJob.id);
    const current = service.repo.getTask(room!.id)!; service.repo.putTask({ ...current, revision: current.revision + 1 });
    const outcome = service.reportJob(captain, staleJob.id, { leaseToken: claimedAgain.leaseToken!, phase: "completed", result: { findings: [
      { taskId: room!.id, impact: "affected", reason: "旧快照" }, { taskId: report!.id, impact: "uncertain", reason: "旧快照" }
    ] } });
    expect(outcome.status).toBe("FAILED"); expect(c.change(second.id).suggestion?.status).toBe("FAILED");
    expect(service.repo.getTask(room!.id)?.pendingChangeId).toBeUndefined();
  });
  it("AI 草稿无实际变化或任务范围改变时拒绝结果，不修改正式任务", async () => {
    for (const changedScope of [false, true]) {
      const { c, captain, publish, service, beat } = await setup();
      const [room, report] = publish();
      const change = c.submitChange(captain, { title: "暂停房间", content: "支持暂停", taskIds: [room!.id], expectedRequirementRevision: 1 });
      service.heartbeat(captain, { ...beat, codex: "available" });
      c.suggestImpact(captain, change.id, change.revision); const job = service.claimJob(captain)!;
      if (changedScope) service.repo.putTask({ ...report!, archived: true });
      const result = service.reportJob(captain, job.id, { leaseToken: job.leaseToken!, phase: "completed", result: { findings: [
        { taskId: room!.id, impact: "affected", reason: "支持暂停", update: { goal: room!.goal, boundary: room!.boundary, acceptance: room!.acceptance } },
        { taskId: report!.id, impact: "unaffected", reason: "报告不变", update: null }
      ] } });
      expect(result.status).toBe("FAILED"); expect(result.error).toContain(changedScope ? "任务范围已变化" : "具体变化");
      expect(c.change(change.id).suggestion!.status).toBe("FAILED"); expect(service.repo.getTask(room!.id)).toEqual(room);
    }
  });

  it("需求规划或影响建议失败时发布事件，页面能结束分析中状态", async () => {
    const planning = await setup();
    planning.service.heartbeat(planning.captain, { ...planning.beat, codex: "available" });
    const alignment = planning.c.generate(planning.captain, planning.intent.id, planning.intent.revision);
    const planJob = planning.service.claimJob(planning.captain)!;
    const planSeq = planning.service.repo.lastSeq();
    planning.service.reportJob(planning.captain, planJob.id, { leaseToken: planJob.leaseToken!, phase: "failed", error: "模型暂不可用" });
    expect(planning.service.repo.getAlignment(alignment.id)?.status).toBe("FAILED");
    expect(planning.service.repo.eventsSince(planSeq)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "job.failed", entityId: planJob.id })]));

    const impact = await setup();
    impact.publish();
    impact.service.heartbeat(impact.captain, { ...impact.beat, codex: "available" });
    const change = impact.c.submitChange(impact.member, { title: "测试变更", content: "仅验证建议流程", expectedRequirementRevision: 1 });
    impact.c.suggestImpact(impact.captain, change.id, change.revision);
    const impactJob = impact.service.claimJob(impact.captain)!;
    const impactSeq = impact.service.repo.lastSeq();
    impact.service.reportJob(impact.captain, impactJob.id, { leaseToken: impactJob.leaseToken!, phase: "failed", error: "模型暂不可用" });
    expect(impact.c.change(change.id).suggestion?.status).toBe("FAILED");
    expect(impact.service.repo.eventsSince(impactSeq)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "job.failed", entityId: impactJob.id })]));
  });

});
