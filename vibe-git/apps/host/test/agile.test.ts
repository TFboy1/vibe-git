import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { allocationConflicts, notificationResource, workspaceChanges } from "@vibe-git/protocol";
import type { AgileFlow, AgileTaskDraft, CollaborationNode, StageTask } from "@vibe-git/protocol";
import { buildApp } from "../src/app.js";
import type { V20Service } from "../src/v20/service.js";
import { ensureV20Runtime } from "../src/v20/runtime-secrets.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [], roots: string[] = [];
it("过期租约由作业模块恢复，非法错误码不改变租约，迟到开工被拒绝", async () => {
  const { a, s, captain, plans } = await setup(); plans(); a.startInitial(captain, { expectedRequirementRevision: 0 });
  const claimed = s.claimJob(captain)!;
  expect(() => s.reportJob(captain, claimed.id, { leaseToken: claimed.leaseToken!, phase: "failed", errorCode: "unknown" as never })).toThrow("错误码");
  expect(s.repo.getJob(claimed.id)!.status).toBe("LEASED");
  s.repo.putJob({ ...claimed, leaseExpiresAt: "2000-01-01T00:00:00.000Z" });
  s.claimJob(captain);
  expect(s.repo.getJob(claimed.id)).toMatchObject({ status: "FAILED", leaseToken: null, leaseExpiresAt: null });
  expect(() => s.reportJob(captain, claimed.id, { leaseToken: claimed.leaseToken!, phase: "started" })).toThrow("租约");
});
it("作业结果处理回滚后不广播成功，失败收敛到单一终态并隔离迟到结果", async () => {
  const { a, s, captain, plans } = await setup(); plans();
  const flow = a.startInitial(captain, { expectedRequirementRevision: 0 }), claimed = s.claimJob(captain)!;
  const events: Array<{ type: string; payload: unknown }> = [], unsubscribe = s.hub.subscribe(event => events.push(event));
  const original = a.complete.bind(a);
  a.complete = () => {
    s.repo.setMeta("rolled-back-result", "bad");
    (s as unknown as { event(type: string, actor: string, kind: string, id: string, payload: unknown): unknown }).event("agile.updated", captain.id, "agile", flow.id, { rolledBack: true });
    throw new Error("结果校验失败");
  };
  try {
    const result = s.reportJob(captain, claimed.id, { leaseToken: claimed.leaseToken!, phase: "completed", result: {} });
    await Promise.resolve();
    expect(result.status).toBe("FAILED"); expect(result.leaseToken).toBeNull();
    expect(s.repo.getMeta("rolled-back-result")).toBeUndefined();
    expect(events.filter(event => event.type === "job.failed")).toHaveLength(1);
    expect(events.some(event => event.type === "job.completed" || (event.payload as { rolledBack?: boolean })?.rolledBack)).toBe(false);
    expect(() => s.reportJob(captain, claimed.id, { leaseToken: claimed.leaseToken!, phase: "completed", result: {} })).toThrow();
  } finally { a.complete = original; unsubscribe(); }
});
it("相同需求变更重试复用原记录；介入偏好不能绕过队长权限或发布版本", async () => {
  const { a, s, captain, member, publishInitial } = await setup();
  publishInitial();
  const input = { title: "增加导出", content: "支持导出 CSV", filename: "change.md", expectedRequirementRevision: 1 };
  const first = a.submitPR(member, input);
  expect(a.submitPR(member, input).id).toBe(first.id);
  expect(s.repo.listPullRequests()).toHaveLength(1);
  expect(() => a.startReview(member, { expectedRequirementRevision: 1 })).toThrow("仅限队长");
  const review = a.startReview(captain, { expectedRequirementRevision: 1 });
  expect(a.submitPR(member, input).id).toBe(first.id);
  expect(() => a.publish(captain, review.id, { expectedRevision: review.revision - 1 })).toThrow("版本");
});
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir(), "vibe-agile-"))) throw new Error("Invalid test cleanup target");
    await rm(root, { recursive: true, force: true });
  }
});
async function setup() {
  const root = await mkdtemp(resolve(tmpdir(), "vibe-agile-")); roots.push(root);
  const tunnel = { status: async () => null, close: async () => {} };
  const app = await buildApp({ dbPath: resolve(root, "room.db"), dataDir: root, staticDir: false, backupDatabase: false,
    cloudflareManager: tunnel as never }); apps.push(app);
  const s = (app as unknown as { v20Service: V20Service }).v20Service, a = s.agile;
  const runtime = await ensureV20Runtime(s.repo, root);
  const captain = s.repo.getNode(runtime.captain.nodeId)!;
  const joined = s.join(runtime.inviteToken, "http://localhost"), member = joined.node;
  const summary = "HEAD " + "a".repeat(40) + "\nfeatures/room\nfeatures/client\nfeatures/messages\n入口与模型由各功能独占";
  const beat = { workspaceReady: true, codex: "available" as const, workTransport: "auto" as const, rateLimits: [], currentTaskId: null,
    git: { branch: "main", headSha: "a".repeat(40), dirty: false, observedAt: new Date().toISOString() },
    repositoryContext: { headSha: "a".repeat(40), dirty: false, summary, sha256: createHash("sha256").update(summary).digest("hex"), createdAt: new Date().toISOString() } };
  s.heartbeat(captain, beat); s.heartbeat(member, { ...beat, codex: "offline" });
  const latest = (flow: AgileFlow) => s.repo.getAgileFlow(flow.id)!;
  const finish = (flow: AgileFlow, result: unknown) => {
    const current = latest(flow), job = s.repo.getJob(current.agentJobId!)!;
    const node = s.repo.getNode(job.targetNodeId)!;
    const claimed = s.claimJob(node)!; expect(claimed.id).toBe(job.id);
    if (job.kind === "AGILE_ALLOCATE" && result && typeof result === "object" && Array.isArray((result as { tasks?: unknown }).tasks)) {
      const allocation = result as { tasks: AgileTaskDraft[] };
      result = { contracts: [], ...result, tasks: allocation.tasks.map(t => ({ ...t, dependencyEdges: t.dependencyEdges ?? t.dependencies.map(upstreamKey => ({ upstreamKey, mode: "HARD", contractKey: null, reason: "等待实际交付" })) })) };
    }
    const returned = s.reportJob(node, claimed.id, { leaseToken: claimed.leaseToken!, phase: "completed", result });
    return { flow: latest(flow), job: returned };
  };
  const plans = () => {
    a.savePlan(captain, { expectedRevision: 0, filename: "captain.md", content: "# 房间\n支持多人计划协作" });
    a.savePlan(member, { expectedRevision: 0, filename: "member.md", content: "# 客户端\n编辑 Markdown 并提交 PR" });
  };
  const task = (key: string, owner: CollaborationNode, sourceTaskId: string | null = null): AgileTaskDraft => ({
    key, sourceTaskId, title: key, goal: "实现 " + key, boundary: "仅处理 " + key, acceptance: ["后端验证通过"],
    assigneeNodeId: owner.id, dependencies: [], ownedPaths: ["features/" + key], excludedPaths: [], requirementRefs: [],
    interfaceNotes: [], integrationSteps: ["合并功能分支后执行验证"], verificationCommands: ["npm test"], mockStrategy: "", handoff: "提供分支提交及验证证据"
  });
  const draftAllocation = () => {
    plans(); let flow = a.startInitial(captain, { expectedRequirementRevision: 0 });
    flow = finish(flow, { summary: "计划一致", affectedTaskIds: [], decisions: [], issues: [] }).flow;
    flow = finish(flow, { summary: "首轮需求", markdown: "# 需求 R1\n\n## 房间\n支持多人计划\n\n## 客户端\n支持 Markdown" }).flow;
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    return flow;
  };
  const publishInitial = () => {
    let flow = draftAllocation();
    flow = finish(flow, { summary: "三项任务", tasks: [task("room", captain), task("client", member), task("messages", captain)], removedTaskIds: [] }).flow;
    flow = a.publish(captain, flow.id, { expectedRevision: flow.revision });
    const tasks = s.repo.listTasks(flow.stageId!);
    return { flow, room: tasks.find(t => t.title === "room")!, client: tasks.find(t => t.title === "client")!, messages: tasks.find(t => t.title === "messages")! };
  };
  const publishLegacy = () => {
    s.repo.setMeta("flow_mode", "legacy");
    const c = s.coordination;
    const intent = c.saveIntent(captain, { title: "历史需求", content: "## 房间\n多人协作\n## 客户端\n编辑计划" });
    const draft = c.importPlan(captain, intent.id, { expectedRevision: intent.revision, plan: { tasks: [
      { key: "room", title: "房间", goal: "实现多人房间", boundary: "只改房间", acceptance: ["房间可以加入"], assigneeNodeId: captain.id, dependencies: [] },
      { key: "client", title: "客户端", goal: "编辑个人计划", boundary: "只改客户端", acceptance: ["计划可以保存"], assigneeNodeId: member.id, dependencies: [] }
    ], contracts: [], issues: [] } });
    const stage = s.publishAlignment(captain, draft.id), tasks = s.repo.listTasks(stage.id).map(t => ({ ...t,
      brief: { deliverables: t.acceptance, ownedPaths: ["features/" + t.title], excludedPaths: [], requirementRefs: [], interfaceNotes: [],
        mockStrategy: "", integrationSteps: ["合并功能分支后执行验证"], verificationCommands: ["npm test"], handoff: "提供分支提交及验证证据" } }));
    for (const t of tasks) s.repo.putTask(t);
    return { stage, room: tasks.find(task => task.title === "房间")!, client: tasks.find(task => task.title === "客户端")! };
  };
  const report = (owner: CollaborationNode, t: StageTask, action: "started" | "progress" | "blocked" | "completed", reportId = "report-" + Math.random()) =>
    a.report(owner, t.id, { reportId, taskRevision: t.packageRevision, requirementRevision: t.requirementRevision, action,
      summary: action + " 说明", ...(action === "completed" ? { evidence: ["vitest：全部通过"] } : {}) });
  return { root, app, s, a, captain, member, beat, finish, latest, plans, task, draftAllocation, publishInitial, publishLegacy, report, runtime, joined };
}
function conflict(flow: AgileFlow, id = "conflict-1") {
  return { id, title: "交付范围冲突", reason: "两份计划对首轮范围有不同要求",
    evidence: [{ sourceId: flow.planSnapshot[0]!.id, excerpt: "支持多人计划" }],
    options: [{ id: "a", label: "先做最小范围", impact: "尽早开工" }, { id: "b", label: "按完整范围", impact: "任务较多" }, { id: "c", label: "分两轮", impact: "本轮先做核心" }] };
}

describe("超敏捷协作", () => {
  it.each([1, 2, 5])("按实际 %i 人团队提供分工上下文，不把任务数绑定人数", async count => {
    const h = await setup(), { s, a, captain, member, task, finish } = h;
    if (count === 1) s.repo.putNode({ ...s.repo.getNode(member.id)!, revoked: true });
    for (let i = 2; i < count; i++) s.join(h.runtime.inviteToken, "http://localhost");
    let flow = h.draftAllocation();
    const prompt = String(s.repo.getJob(flow.agentJobId!)!.payload.prompt);
    const data = JSON.parse(prompt.split("<untrusted_collaboration_data>\n")[1]!.split("\n</untrusted_collaboration_data>")[0]!);
    expect(data.team).toHaveLength(count);
    expect(prompt).toContain("人数、任务数和并行数分别决定");
    expect(data.repositoryContext.headSha).toBe(h.beat.git.headSha);
    if (count > 1) expect(data.team.some((n: { id: string }) => n.id === member.id)).toBe(true);
    flow = finish(flow, { summary: "两个完整功能；多余成员不虚构任务", tasks: [task("create", captain), task("query", count > 1 ? member : captain)], removedTaskIds: [] }).flow;
    expect(flow.status).toBe("READY"); expect(flow.tasks).toHaveLength(2);
    a.publish(captain, flow.id, { expectedRevision: flow.revision });
    expect(s.repo.listTasks()).toHaveLength(2);
  });

  it("同一路径不能通过硬依赖豁免，自动重排两次后保留全部候选并阻止发布", async () => {
    const h = await setup(), { a, s, captain, member, task, finish } = h;
    let flow = h.draftAllocation();
    const first = { ...task("priority", captain), ownedPaths: ["backend/app/main.py"] };
    const second = { ...task("date", member), ownedPaths: ["backend/app/main.py"], dependencies: [first.key] };
    for (let i = 0; i < 3; i++) {
      const result = finish(flow, { summary: "候选 " + i, tasks: [first, second], removedTaskIds: [] });
      flow = result.flow;
      expect(flow.allocationAttempts).toHaveLength(i + 1);
      expect(flow.allocationConflicts![0]!.path).toBe("backend/app/main.py");
      expect(flow.allocationConflicts![0]!.tasks.map(t => t.key)).toEqual([first.key, second.key]);
      expect(flow.status).toBe(i < 2 ? "PLANNING" : "FAILED");
      if (i < 2) {
        const prompt = String(s.repo.getJob(flow.agentJobId!)!.payload.prompt);
        expect(prompt).toContain("backend/app/main.py"); expect(prompt).toContain("allocationFeedback");
      }
    }
    expect(flow.allocationRepairCount).toBe(2);
    expect(flow.error).toContain("自动调整两次");
    expect(() => a.publish(captain, flow.id, { expectedRevision: flow.revision })).toThrow("请根据最新需求");
    expect(s.repo.requirementRevision()).toBe(0); expect(s.repo.listTasks()).toHaveLength(0);
    // The failed candidate remains editable and can be repaired without losing the requirement.
    flow = a.saveAllocation(captain, flow.id, { expectedRevision: flow.revision, draftRevision: flow.draftRevision,
      tasks: [first, { ...second, ownedPaths: ["backend/app/dates.py"] }], removedTaskIds: [] });
    expect(flow.status).toBe("READY"); expect(flow.allocationConflicts).toEqual([]);
  });

  it("冲突反馈后修正为独立文件，保存和发布入口也返回具体冲突", async () => {
    const h = await setup(), { a, s, captain, member, task, finish } = h;
    let flow = h.draftAllocation();
    const tasks = [{ ...task("api", captain), ownedPaths: ["src/**"] }, { ...task("client", member), ownedPaths: ["src/App.vue"] }];
    flow = finish(flow, { summary: "有重叠", tasks, removedTaskIds: [] }).flow;
    flow = finish(flow, { summary: "拆为独立模块，共享入口唯一负责", tasks: [tasks[0], { ...tasks[1], ownedPaths: ["frontend/client.vue"] }], removedTaskIds: [] }).flow;
    expect(flow.status).toBe("READY"); expect(flow.allocationAttempts).toHaveLength(2);
    for (const path of ["allocation", "publish"]) {
      if (path === "publish") s.repo.putAgileFlow({ ...flow, tasks });
      const response = await h.app.inject({ method: "POST", url: "/api/v1/agile/flows/" + flow.id + "/" + path,
        headers: { authorization: "Bearer " + h.runtime.captain.nodeToken },
        payload: { expectedRevision: flow.revision, draftRevision: flow.draftRevision, tasks, removedTaskIds: [] } });
      expect(response.statusCode).toBe(400);
      expect(response.json().details.conflicts[0]).toMatchObject({ path: "src/app.vue", tasks: [{ key: "api" }, { key: "client" }] });
    }
    expect(s.repo.requirementRevision()).toBe(0);
  });

  it("契约随任务发布，消费方可在提供方未完成时开工，真实硬依赖仍等待", async () => {
    const h = await setup(), { a, s, captain, member, task, finish, report } = h;
    let flow = h.draftAllocation();
    const api = task("api", captain), ui = { ...task("ui", member), dependencies: [api.key],
      dependencyEdges: [{ upstreamKey: api.key, mode: "CONTRACT" as const, contractKey: "todo-api", reason: "按已确定的 API 并行" }],
      interfaceNotes: ["GET /api/todos 返回 Todo[]"], mockStrategy: "按样例提供本地 API fixture，最终换成真实实现" };
    const contract = { key: "todo-api", providerTaskKey: api.key, consumerTaskKeys: [ui.key, "integration"], kind: "http", name: "Todo 列表", signature: "GET /api/todos -> Todo[]",
      behavior: ["返回全部待办"], examples: ["[]"], errors: ["500 查询失败"], testCommand: "npm test", handoff: "提供 API 提交与真实集成证据" };
    flow = finish(flow, { summary: "通过接口并行", tasks: [api, ui, { ...task("integration", captain), dependencies: [api.key, ui.key],
      dependencyEdges: [{ upstreamKey: api.key, mode: "HARD", contractKey: "todo-api", reason: "最终集成需要真实 API 交付，同时保留接口约定引用" },
        { upstreamKey: ui.key, mode: "HARD", contractKey: null, reason: "等待 UI 交付" }] }], contracts: [contract], removedTaskIds: [] }).flow;
    expect(flow.status).toBe("READY");
    flow = a.publish(captain, flow.id, { expectedRevision: flow.revision });
    const tasks = s.repo.listTasks(), consumer = tasks.find(t => t.title === "ui")!, integration = tasks.find(t => t.title === "integration")!;
    expect(s.repo.listContracts()[0]!.status).toBe("PUBLISHED");
    expect(report(member, consumer, "started").status).toBe("IN_PROGRESS");
    expect(() => report(captain, integration, "started")).toThrow("依赖任务尚未完成");
    const pack = a.package(member, consumer.id);
    expect(pack.nextStep).not.toContain("等待"); expect(pack.baselineSha).toBe(h.beat.git.headSha);
    expect(pack.markdown).toContain(ui.mockStrategy); expect(pack.brief!.verificationCommands).toEqual(["npm test"]);
    expect(pack.markdown).toContain("500 查询失败"); expect(pack.markdown).toContain("提供 API 提交与真实集成证据");
    const c = s.repo.listContracts()[0]!; s.repo.putContract({ ...c, revision: c.revision + 1 });
    expect(() => report(member, consumer, "progress")).toThrow("接口不可用");
  });

  it("成员加入后重排使用最新团队，成员退出后的旧归属会进入自动修正", async () => {
    const h = await setup(), { a, s, captain, member, task, finish } = h;
    let flow = h.draftAllocation();
    const joined = s.join(h.runtime.inviteToken, "http://localhost").node;
    s.repo.putNode({ ...s.repo.getNode(member.id)!, revoked: true });
    flow = finish(flow, { summary: "旧归属", tasks: [task("feature", member)], removedTaskIds: [] }).flow;
    expect(flow.status).toBe("PLANNING");
    expect(flow.allocationTeam!.map(n => n.id)).toContain(joined.id);
    expect(flow.allocationTeam!.map(n => n.id)).not.toContain(member.id);
    flow = finish(flow, { summary: "交给当前成员", tasks: [task("feature", joined)], removedTaskIds: [] }).flow;
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    expect(flow.allocationTeam).toHaveLength(2);
  });

  it("仓库基线变化后旧分工被隔离，重新生成必须等待有效仓库摘要", async () => {
    const h = await setup(), { s, a, captain, task, finish } = h;
    const flow = h.draftAllocation();
    s.repo.putNode({ ...s.repo.getNode(captain.id)!, git: { ...h.beat.git, headSha: "b".repeat(40) } });
    const failed = finish(flow, { summary: "旧基线", tasks: [task("feature", captain)], removedTaskIds: [] });
    expect(failed.job.status).toBe("FAILED"); expect(failed.flow.error).toContain("仓库基线已变化");
    expect(() => a.retry(captain, flow.id, { expectedRevision: failed.flow.revision })).toThrow("仓库摘要尚未就绪");
    expect(s.repo.listTasks()).toHaveLength(0);
  });

  it.each([
    ["src/**", "SRC\\App.vue", [], 1], ["./src/./App.vue", "src/App.vue", [], 1],
    ["src/**", "src/App.vue", ["src/App.vue"], 0], ["src", "src-old/app.vue", [], 0]
  ] as const)("写入路径规范化和排除范围：%s / %s", async (left, right, excluded, expected) => {
    const task = (key: string, path: string, excludedPaths: string[]) => ({ key, title: key, assigneeNodeId: key, ownedPaths: [path], excludedPaths });
    expect(allocationConflicts([task("a", left, [...excluded]), task("b", right, [])])).toHaveLength(expected);
  });

  it("空负责范围会要求模型修正，不能静默绕过发布检查", async () => {
    const h = await setup(); let flow = h.draftAllocation();
    flow = h.finish(flow, { summary: "空路径", tasks: [{ ...h.task("feature", h.captain), ownedPaths: [] }], removedTaskIds: [] }).flow;
    expect(flow.status).toBe("PLANNING"); expect(flow.allocationConflicts![0]!.reason).toContain("非空");
  });

  it("检查保留任务的写入范围，修正新增影响后才暂停对应任务并保留进度", async () => {
    const h = await setup(), { a, s, captain, member, task, finish, report } = h;
    const initial = h.publishInitial(); report(member, initial.client, "started");
    const beforeProgress = s.repo.getTask(initial.client.id)!.reportEvidence;
    const pr = a.submitPR(captain, { title: "房间历史", content: "增加历史查询", expectedRequirementRevision: 1 });
    let flow = a.startReview(captain, { expectedRequirementRevision: 1 });
    flow = finish(flow, { summary: "仅房间受影响", affectedTaskIds: [initial.room.id], issues: [], decisions: [{ changeId: pr.id, verdict: "accept", rationale: "补充历史" }] }).flow;
    flow = a.requirement(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "完整需求", markdown: "# R2\n房间历史与客户端功能" }).flow;
    const summary = "HEAD " + "b".repeat(40) + "\nfeatures/room\nfeatures/client\nfeatures/messages";
    s.heartbeat(s.repo.getNode(captain.id)!, { ...h.beat, git: { ...h.beat.git, headSha: "b".repeat(40) },
      repositoryContext: { ...h.beat.repositoryContext, headSha: "b".repeat(40), summary, sha256: createHash("sha256").update(summary).digest("hex") } });
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    const room = { ...task("room-v2", captain, initial.room.id), ownedPaths: initial.client.brief!.ownedPaths };
    flow = finish(flow, { summary: "遗漏保留任务", tasks: [room], removedTaskIds: [] }).flow;
    expect(flow.status).toBe("PLANNING");
    expect(flow.allocationConflicts![0]!.tasks.map(t => t.key)).toContain(initial.client.id);
    expect(s.repo.getTask(initial.client.id)!.status).toBe("IN_PROGRESS");
    flow = finish(flow, { summary: "明确调整新增影响", tasks: [room, { ...task("client-v2", member, initial.client.id), ownedPaths: ["features/new-client"] }], removedTaskIds: [] }).flow;
    expect(flow.status).toBe("READY"); expect(s.repo.getTask(initial.client.id)!.status).toBe("PAUSED");
    a.publish(captain, flow.id, { expectedRevision: flow.revision });
    expect(s.repo.getTask(initial.client.id)!.status).toBe("IN_PROGRESS");
    expect(s.repo.getTask(initial.client.id)!.reportEvidence).toEqual(beforeProgress);
    expect(s.repo.getTask(initial.messages.id)!.brief).toEqual(initial.messages.brief);
    expect(a.package(captain, initial.room.id).baselineSha).toBe("b".repeat(40));
    expect(a.package(captain, initial.messages.id).baselineSha).toBe("a".repeat(40));
  });

  it("自动修正期间编辑需求会取消旧作业，迟到分工不能覆盖新正文", async () => {
    const h = await setup(); let flow = h.draftAllocation();
    const bad = [h.task("first", h.captain), { ...h.task("second", h.member), ownedPaths: ["features/first"] }];
    flow = h.finish(flow, { summary: "冲突", tasks: bad, removedTaskIds: [] }).flow;
    const job = h.s.claimJob(h.captain)!;
    const edited = h.a.saveDraft(h.captain, flow.id, { expectedRevision: flow.revision, markdown: "# 已编辑需求\n新的完整目标" });
    expect(edited.status).toBe("DRAFT"); expect(edited.tasks).toEqual([]); expect(edited.allocationConflicts).toEqual([]);
    expect(() => h.s.reportJob(h.captain, job.id, { leaseToken: job.leaseToken!, phase: "completed", result: { summary: "迟到结果" } })).toThrow();
    expect(h.s.repo.getAgileFlow(flow.id)!.draftMarkdown).toContain("已编辑需求");
  });

  it("已发布任务改派也不能重新引入跨成员写入冲突，失败保持所有任务不变", async () => {
    const h = await setup(), initial = h.publishInitial();
    const messages = { ...initial.messages, brief: { ...initial.messages.brief!, ownedPaths: initial.room.brief!.ownedPaths } };
    h.s.repo.putTask(messages);
    const response = await h.app.inject({ method: "POST", url: "/api/v1/tasks/assign", headers: { authorization: "Bearer " + h.runtime.captain.nodeToken },
      payload: { taskIds: [messages.id], assigneeNodeId: h.member.id, expectedTaskRevisions: { [messages.id]: messages.revision } } });
    expect(response.statusCode).toBe(400); expect(response.json().details.conflicts[0].path).toBe("features/room");
    expect(h.s.repo.getTask(messages.id)!.assigneeNodeId).toBe(h.captain.id); expect(h.s.repo.getTask(messages.id)!.revision).toBe(messages.revision);
  });
  it.each(["agile", "legacy"] as const)("%s 房间直接改派，保留进度证据和需求版本，旧负责人不能再汇报", async mode => {
    const { s, a, app, captain, member, runtime, joined, publishInitial, publishLegacy, report } = await setup();
    const original = mode === "agile" ? publishInitial().client : publishLegacy().client;
    const before = { ...original, status: "IN_PROGRESS" as const, progressSummary: "接口已实现，等待接续", reportEvidence: [{ reportId: "previous", taskRevision: original.packageRevision ?? original.revision, requirementRevision: original.requirementRevision ?? 1, action: "progress", summary: "已有进度", evidence: ["已有测试结果"], createdAt: new Date().toISOString() }] };
    s.repo.putTask(before);
    const response = await app.inject({ method: "POST", url: "/api/v1/tasks/assign", headers: { authorization: "Bearer " + runtime.captain.nodeToken },
      payload: { taskIds: [before.id], assigneeNodeId: captain.id, expectedTaskRevisions: { [before.id]: before.revision } } });
    expect(response.statusCode).toBe(200);
    const updated = s.repo.getTask(before.id)!;
    expect(updated).toMatchObject({ assigneeNodeId: captain.id, status: "PUBLISHED", goal: before.goal, dependencies: before.dependencies,
      progressSummary: before.progressSummary, reportEvidence: before.reportEvidence,
      revision: before.revision + 1, packageRevision: (before.packageRevision ?? before.revision) + 1 });
    expect(updated.requirementRevision).toBe(before.requirementRevision); expect(s.repo.requirementRevision()).toBe(1); expect(s.repo.listPullRequests()).toHaveLength(0);
    expect(s.repo.listNotifications(member.id).some(note => note.title.includes("停止原任务"))).toBe(true);
    const denied = await app.inject({ method: "POST", url: "/api/v1/tasks/assign", headers: { authorization: "Bearer " + joined.nodeToken },
      payload: { taskIds: [updated.id], assigneeNodeId: member.id, expectedTaskRevisions: { [updated.id]: updated.revision } } });
    expect(denied.statusCode).toBe(403);
    if (mode === "agile") {
      expect(() => report(member, before, "completed")).toThrow("自己的任务");
      expect(() => report(captain, before, "progress")).toThrow("版本");
      expect(a.package(captain, updated.id).taskRevision).toBe(updated.packageRevision);
    }
  });

  it("批量改派原子校验版本、完成状态、归档与审核冻结", async () => {
    const { s, a, captain, member, publishInitial } = await setup();
    const { room, client } = publishInitial();
    const assign = (ids: string[], revisions: Record<string, number>) => s.assignTasks(captain, { taskIds: ids, assigneeNodeId: member.id, expectedTaskRevisions: revisions });
    expect(() => assign([room.id, client.id], { [room.id]: room.revision, [client.id]: -1 })).toThrow("任务已变化");
    expect(s.repo.getTask(room.id)?.assigneeNodeId).toBe(captain.id);
    s.repo.putTask({ ...client, status: "DONE" });
    expect(() => assign([room.id, client.id], { [room.id]: room.revision, [client.id]: client.revision })).toThrow("已完成");
    expect(s.repo.getTask(room.id)?.revision).toBe(room.revision);
    s.repo.putTask({ ...client, archived: true });
    expect(() => assign([client.id], { [client.id]: client.revision })).toThrow("归档");
    s.repo.putTask(client);
    a.submitPR(member, { title: "增加通知", content: "增加房间通知", expectedRequirementRevision: 1 });
    const review = a.startReview(captain, { expectedRequirementRevision: 1 });
    expect(() => assign([room.id], { [room.id]: s.repo.getTask(room.id)!.revision })).toThrow("审核");
    a.close(captain, review.id, { expectedRevision: review.revision });
    const current = s.repo.getTask(room.id)!;
    expect(assign([current.id], { [current.id]: current.revision })[0]!.assigneeNodeId).toBe(member.id);
  });

  it("进度事件校验租约并去重，不修改需求流程版本，历史可分页读取和重启恢复", async () => {
    const { s, a, captain, member, root, app, runtime, plans } = await setup();
    plans(); const flow = a.startInitial(captain, { expectedRequirementRevision: 0 }), job = s.claimJob(captain)!;
    const activity = { id: "event-1", kind: "tool" as const, message: "查看需求", detail: "Authorization: Bearer secret-value", model: "test-model" };
    const input = { phase: "progress" as const, leaseToken: job.leaseToken!, activity };
    expect(() => s.reportJob(member, job.id, input)).toThrow("不属于");
    expect(() => s.reportJob(captain, job.id, { ...input, leaseToken: "wrong" })).toThrow("租约");
    s.reportJob(captain, job.id, input); s.reportJob(captain, job.id, input);
    expect(s.repo.getAgileFlow(flow.id)?.revision).toBe(flow.revision);
    expect(s.repo.getJob(job.id)?.status).toBe("LEASED");
    const first = s.repo.flowActivity(flow.id, Number.MAX_SAFE_INTEGER);
    expect(first.events.filter(event => event.type === "job.progress")).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain("secret-value");
    for (let i = 2; i < 108; i++) s.reportJob(captain, job.id, { ...input, activity: { ...activity, id: "event-" + i } });
    const latest = await app.inject({ method: "GET", url: `/api/v1/agile/flows/${flow.id}/activity`, headers: { authorization: "Bearer " + runtime.captain.nodeToken } });
    expect(latest.statusCode).toBe(200); expect(latest.json().hasMore).toBe(true);
    const older = s.repo.flowActivity(flow.id, latest.json().events[0].seq);
    expect(older.events.some(event => event.seq === first.events[0]!.seq)).toBe(true);
    s.reportJob(captain, job.id, { leaseToken: job.leaseToken!, phase: "failed", error: "测试失败" });
    expect(() => s.reportJob(captain, job.id, input)).toThrow(/已经结束|租约/);
    await app.close();
    const reopened = await buildApp({ dbPath: resolve(root, "room.db"), dataDir: root, backupDatabase: false, cloudflareManager: { status: async () => null, close: async () => {} } as never }); apps.push(reopened);
    const persisted = (reopened as unknown as { v20Service: V20Service }).v20Service;
    expect(persisted.repo.flowActivity(flow.id, Number.MAX_SAFE_INTEGER).events.some(event => event.type === "job.progress")).toBe(true);
  });

  it("切换准备阻止新作业，运行或排队中的作业阻止切换", async () => {
    const { s, a, captain, plans } = await setup();
    s.prepareProjectSwitch(captain); expect(s.claimJob(captain)).toBeNull(); s.switching = false;
    plans(); a.startInitial(captain, { expectedRequirementRevision: 0 });
    expect(() => s.prepareProjectSwitch(captain)).toThrow("未结束");
  });

  it("移除成员使旧邀请和凭据失效，保留历史名字并允许直接接续", async () => {
    const { s, app, captain, member, publishInitial, runtime, joined } = await setup();
    const { client } = publishInitial();
    const removed = await app.inject({ method: "POST", url: `/api/v1/nodes/${member.id}/revoke`, headers: { authorization: "Bearer " + runtime.captain.nodeToken }, payload: { expectedActiveTaskRevisions: { [client.id]: client.revision } } });
    expect(removed.statusCode).toBe(200); expect(s.repo.getTask(client.id)?.status).toBe("PAUSED");
    expect(() => s.authenticateBearer("Bearer " + joined.nodeToken)).toThrow("撤销");
    expect(() => s.join(runtime.inviteToken, "http://localhost")).toThrow();
    expect((await s.bootstrap(captain)).nodes.find(node => node.id === member.id)).toMatchObject({ label: member.label, revoked: true, connected: false });
    const paused = s.repo.getTask(client.id)!;
    expect(s.assignTasks(captain, { taskIds: [paused.id], assigneeNodeId: captain.id, expectedTaskRevisions: { [paused.id]: paused.revision } })[0]).toMatchObject({ status: "PUBLISHED", blockedReason: null });
    const denied = await app.inject({ method: "POST", url: `/api/v1/nodes/${captain.id}/revoke`, headers: { authorization: "Bearer " + runtime.captain.nodeToken }, payload: {} });
    expect(denied.statusCode).toBe(403);
  });

  it.each(["agile", "legacy"] as const)("%s 房间整合新一轮计划，冻结来源并统一发布新版需求", async mode => {
    const { a, s, captain, member, publishInitial, publishLegacy, app, runtime, joined, finish, task } = await setup();
    const initial = mode === "agile" ? publishInitial() : publishLegacy();
    const originalVersion = s.repo.listRequirementVersions()[0]!;
    const originalClient = { ...initial.client, status: "IN_PROGRESS" as const, progressSummary: "客户端编辑已完成" };
    s.repo.putTask(originalClient);
    const captainPlan = mode === "agile"
      ? a.savePlan(captain, { expectedRevision: 1, content: "# 房间计划\n支持多人计划和房间历史", filename: "captain.md" })
      : s.submitPlan(captain, "captain.md", "# 房间计划\n支持多人计划和房间历史");
    const memberPlan = mode === "agile"
      ? a.savePlan(member, { expectedRevision: 1, content: "# 客户端计划\n保留当前客户端功能", filename: "member.md" })
      : s.submitPlan(member, "member.md", "# 客户端计划\n保留当前客户端功能");
    const pending = mode === "agile"
      ? a.submitPR(captain, { expectedRequirementRevision: 1, title: "下一批处理导出", content: "客户端增加导出" })
      : s.coordination.submitChange(captain, { expectedRequirementRevision: 1, title: "下一批处理导出", content: "客户端增加导出" });
    const payload = { expectedRequirementRevision: 1 };
    const denied = await app.inject({ method: "POST", url: "/api/v1/agile/plan-integrations",
      headers: { authorization: "Bearer " + joined.nodeToken }, payload });
    expect(denied.statusCode).toBe(403);
    const stale = await app.inject({ method: "POST", url: "/api/v1/agile/plan-integrations",
      headers: { authorization: "Bearer " + runtime.captain.nodeToken }, payload: { expectedRequirementRevision: 0 } });
    expect(stale.statusCode).toBe(409); expect(s.repo.listPullRequests()).toHaveLength(mode === "agile" ? 1 : 0);
    const response = await app.inject({ method: "POST", url: "/api/v1/agile/plan-integrations",
      headers: { authorization: "Bearer " + runtime.captain.nodeToken }, payload });
    expect(response.statusCode).toBe(200); let flow = response.json<AgileFlow>();
    expect(flow.kind).toBe("review"); expect(flow.baseRequirementRevision).toBe(1);
    expect(flow.planSnapshot).toEqual([captainPlan, memberPlan]); expect(flow.changeSnapshot).toHaveLength(2);
    expect(flow.changeSnapshot.map(change => change.submitterNodeId).sort()).toEqual([captain.id, member.id].sort());
    expect(flow.changeSnapshot.some(change => change.id === pending.id)).toBe(false);
    expect(s.repo.requirementMarkdown()).toBe(originalVersion.markdown);
    const newer = s.updatePlan(member, memberPlan.id, memberPlan.revision, "member.md", "# 之后的计划\n新增搜索");
    expect(newer.revision).toBe(memberPlan.revision + 1);
    expect(s.repo.getAgileFlow(flow.id)!.planSnapshot).toEqual([captainPlan, memberPlan]);
    expect(flow.changeSnapshot.find(change => change.submitterNodeId === member.id)!.document.content).toBe(memberPlan.content);
    flow = finish(flow, { summary: "房间增加历史，客户端保留", issues: [conflict(flow)], affectedTaskIds: [initial.room.id],
      decisions: flow.changeSnapshot.map(change => ({ changeId: change.id, verdict: "accept", rationale: "纳入本轮需求" })) }).flow;
    expect(s.repo.getTask(initial.room.id)!.status).toBe("PAUSED"); expect(s.repo.getTask(initial.client.id)).toEqual(originalClient);
    flow = a.answer(captain, flow.id, { expectedRevision: flow.revision, issueId: flow.issues[0]!.id, answer: { kind: "option", optionId: "a" } });
    flow = finish(flow, { summary: "范围已确认", followUp: null }).flow;
    flow = a.requirement(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "R2 需求草稿", markdown: "# 完整需求 R2\n\n## 房间\n多人协作与房间历史\n\n## 客户端\n保留编辑功能" }).flow;
    expect(s.repo.requirementRevision()).toBe(1);
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "只修订房间任务", tasks: [task("room-history", captain, initial.room.id)], removedTaskIds: [] }).flow;
    flow = a.publish(captain, flow.id, { expectedRevision: flow.revision });
    expect(flow.publishedRequirementRevision).toBe(2); expect(s.repo.listRequirementVersions()[0]).toEqual(originalVersion);
    expect(s.repo.getTask(initial.client.id)).toMatchObject({ status: "IN_PROGRESS", progressSummary: originalClient.progressSummary });
    expect(s.repo.getMeta("flow_mode")).toBe(mode);
    expect(flow.changeSnapshot.every(change => s.repo.getPullRequest(change.id)!.status === "APPLIED")).toBe(true);
    expect(mode === "agile" ? s.repo.getPullRequest(pending.id)!.status : s.repo.getCoordinationChange(pending.id)!.status).toBe(mode === "agile" ? "QUEUED" : "PENDING");
  });
  it("新一轮整合只收集已提交且未撤回的意见，取消后复用同一版本的待审记录", async () => {
    const { a, s, captain, member, publishInitial } = await setup(); publishInitial();
    s.repo.setMeta("v20_plan_withdrawn_" + member.id, "true");
    expect(() => a.startPlanIntegration(captain, { expectedRequirementRevision: 1, skipMissingNodeIds: [captain.id, member.id] })).toThrow("至少提交一份");
    expect(() => a.startPlanIntegration(captain, { expectedRequirementRevision: 1, skipMissingNodeIds: ["不存在的节点"] })).toThrow("不存在");
    let flow = a.startPlanIntegration(captain, { expectedRequirementRevision: 1 });
    expect(flow.participantNodeIds).toEqual([captain.id]); expect(flow.planSnapshot).toHaveLength(1);
    const ids = flow.changeSnapshot.map(change => change.id);
    expect(() => a.startPlanIntegration(captain, { expectedRequirementRevision: 1 })).toThrow("已有进行中");
    a.close(captain, flow.id, { expectedRevision: flow.revision });
    expect(s.repo.getStage(flow.stageId!)!.status).toBe("ACTIVE"); expect(s.repo.requirementRevision()).toBe(1);
    flow = a.startPlanIntegration(captain, { expectedRequirementRevision: 1, skipMissingNodeIds: [member.id] });
    expect(flow.changeSnapshot.map(change => change.id)).toEqual(ids); expect(s.repo.listPullRequests()).toHaveLength(1);
  });
  it("无可用算力时整合事务回滚，不留下变更、快照或审核状态", async () => {
    const { a, s, captain, publishInitial, beat } = await setup(); const initial = publishInitial();
    const stage = s.repo.getStage(initial.flow.stageId!)!, jobs = s.repo.listJobs(), documents = s.repo.listDocuments("change");
    s.heartbeat(captain, { ...beat, codex: "offline" });
    expect(() => a.startPlanIntegration(captain, { expectedRequirementRevision: 1 })).toThrow();
    expect(s.repo.listDocuments("change")).toEqual(documents); expect(s.repo.listPullRequests()).toHaveLength(0);
    expect(s.repo.getStage(stage.id)).toEqual(stage); expect(s.repo.listJobs()).toEqual(jobs);
    expect(a.snapshot().activeFlow).toBeNull(); expect(s.repo.requirementRevision()).toBe(1);
  });
  it("已有 R3 和已完成阶段仍可启动计划整合，取消时恢复完成记录", async () => {
    const { a, s, captain, publishInitial } = await setup(); const initial = publishInitial();
    const stage = { ...s.repo.getStage(initial.flow.stageId!)!, status: "COMPLETED" as const, requirementRevision: 3, completedAt: new Date().toISOString() };
    s.repo.putStage(stage); s.repo.setRequirementRevision(3); s.repo.setRequirementMarkdown("# 正式需求 R3");
    expect(a.snapshot().planIntegrationEnabled).toBe(true);
    const flow = a.startPlanIntegration(captain, { expectedRequirementRevision: 3 });
    expect(flow.baseRequirementRevision).toBe(3); expect(flow.baseRequirementMarkdown).toBe("# 正式需求 R3");
    expect(flow.changeSnapshot.every(change => change.baseRequirementRevision === 3)).toBe(true);
    a.close(captain, flow.id, { expectedRevision: flow.revision });
    expect(s.repo.getStage(stage.id)).toEqual(stage); expect(s.repo.requirementRevision()).toBe(3);
  });
  it("首轮整合入口仍使用原首轮状态机", async () => {
    const { a, captain, plans } = await setup(); plans();
    const flow = a.startPlanIntegration(captain, { expectedRequirementRevision: 0 });
    expect(flow.kind).toBe("initial"); expect(flow.changeSnapshot).toHaveLength(0); expect(flow.planSnapshot).toHaveLength(2);
  });
  it("成员命名、至少一份输入、冻结来源，并在后端限制队长操作", async () => {
    const { a, s, captain, member, plans, app, runtime, joined } = await setup();
    expect(a.rename(member, { label: " 小林 " }).label).toBe("小林");
    expect(a.rename(captain, { label: "小林" }).label).toBe("小林");
    expect(() => a.startInitial(member, { expectedRequirementRevision: 0 })).toThrow("队长");
    expect(() => a.startInitial(captain, { expectedRequirementRevision: 0 })).toThrow("至少提交一份");
    plans(); const flow = a.startInitial(captain, { expectedRequirementRevision: 0 });
    const saved = a.savePlan(member, { expectedRevision: 1, content: "# 新计划", filename: "member.md" });
    expect(flow.planSnapshot.find(p => p.ownerNodeId === member.id)!.revision).toBe(1);
    expect(saved.revision).toBe(2);
    const denied = await app.inject({ method: "POST", url: "/api/v1/agile/flows/" + flow.id + "/cancel",
      headers: { authorization: "Bearer " + joined.nodeToken }, payload: { expectedRevision: flow.revision } });
    expect(denied.statusCode).toBe(403);
    const renamed = await app.inject({ method: "PUT", url: "/api/v1/agile/profile",
      headers: { authorization: "Bearer " + runtime.captain.nodeToken }, payload: { label: "队长" } });
    expect(renamed.json().label).toBe("队长"); expect(s.repo.listNodes()).toHaveLength(2);
  });
  it.each(["initial", "integration"] as const)("%s 入口从一句目标补齐需求，给未提交计划的成员派任务并附证据完成", async entry => {
    const { a, s, captain, member, app, runtime, finish, task, report } = await setup();
    const goal = a.savePlan(captain, { expectedRevision: 0, content: "做一个团队待办板", filename: "goal.md" });
    const response = await app.inject({ method: "POST", url: entry === "initial" ? "/api/v1/agile/initial" : "/api/v1/agile/plan-integrations",
      headers: { authorization: "Bearer " + runtime.captain.nodeToken }, payload: { expectedRequirementRevision: 0 } });
    expect(response.statusCode).toBe(200);
    let flow = response.json<AgileFlow>();
    expect(flow.planSnapshot).toEqual([goal]); expect(flow.participantNodeIds).toEqual([captain.id]);
    const issue = { ...conflict(flow), title: "首轮需要哪些能力？", reason: "目标尚未明确验收范围",
      evidence: [{ sourceId: goal.id, excerpt: goal.content }] };
    flow = finish(flow, { summary: "需要补齐范围", issues: [issue], affectedTaskIds: [], decisions: [] }).flow;
    flow = a.answer(captain, flow.id, { expectedRevision: flow.revision, issueId: issue.id, answer: { kind: "option", optionId: "a" } });
    flow = finish(flow, { summary: "关键需求已明确", followUp: null }).flow;
    flow = finish(flow, { summary: "待办板需求", markdown: "# 团队待办板\n\n## 验收\n可以新增和完成待办" }).flow;
    expect(s.repo.requirementRevision()).toBe(0);
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "成员负责页面", tasks: [task("todo-board", member)], removedTaskIds: [] }).flow;
    expect(s.repo.requirementRevision()).toBe(0); expect(s.repo.listTasks()).toHaveLength(0);
    a.publish(captain, flow.id, { expectedRevision: flow.revision });
    const assigned = s.repo.listTasks()[0]!;
    expect(assigned.assigneeNodeId).toBe(member.id); expect(s.repo.latestDocument(member.id, "plan", null)).toBeUndefined();
    expect(a.inbox(member).tasks[0]!.package.taskId).toBe(assigned.id);
    expect(report(member, assigned, "completed").status).toBe("DONE");
    expect(s.repo.getTask(assigned.id)!.reportEvidence).toHaveLength(1);
  });
  it("首轮拒绝空来源、撤回来源与过期版本，不纳入后来提交的意见", async () => {
    const { a, s, captain, member } = await setup();
    const goal = a.savePlan(captain, { expectedRevision: 0, content: "简述目标", filename: "goal.md" });
    s.repo.setMeta("v20_plan_withdrawn_" + captain.id, "true");
    expect(() => a.startInitial(captain, { expectedRequirementRevision: 0 })).toThrow("至少提交一份");
    s.repo.setMeta("v20_plan_withdrawn_" + captain.id, "");
    expect(() => a.startInitial(captain, { expectedRequirementRevision: 0, skipMissingNodeIds: [captain.id] })).toThrow("至少提交一份");
    expect(() => a.startInitial(captain, { expectedRequirementRevision: 1 })).toThrow();
    expect(s.repo.listJobs()).toHaveLength(0); expect(a.snapshot().activeFlow).toBeNull();
    const flow = a.startInitial(captain, { expectedRequirementRevision: 0 });
    a.savePlan(member, { expectedRevision: 0, content: "后来补充的意见", filename: "idea.md" });
    expect(s.repo.getAgileFlow(flow.id)!.planSnapshot).toEqual([goal]);
    expect(() => a.startInitial(captain, { expectedRequirementRevision: 0 })).toThrow("已有进行中");
  });
  it("每题恰好三个方案；自定义回答触发必要追问，并保留答案与草稿历史", async () => {
    const { a, captain, plans, finish, task } = await setup(); plans();
    let flow = a.startInitial(captain, { expectedRequirementRevision: 0 });
    flow = finish(flow, { summary: "需要确认范围", issues: [conflict(flow)], affectedTaskIds: [], decisions: [] }).flow;
    expect(flow.status).toBe("DECIDING");
    flow = a.answer(captain, flow.id, { expectedRevision: flow.revision, issueId: flow.issues[0]!.id, answer: { kind: "custom", text: "先做多人协作，导出延后" } });
    flow = finish(flow, { summary: "补充交付时间", followUp: conflict(flow, "follow-up") }).flow;
    expect(flow.issues[0]!.answer).toMatchObject({ kind: "custom" });
    flow = a.answer(captain, flow.id, { expectedRevision: flow.revision, issueId: "follow-up", answer: { kind: "option", optionId: "c" } });
    flow = finish(flow, { summary: "裁决完成", followUp: null }).flow;
    flow = finish(flow, { summary: "生成最终草稿", markdown: "# 需求\n\n## 协作\n仅多人计划" }).flow;
    flow = a.saveDraft(captain, flow.id, { expectedRevision: flow.revision, markdown: "# 需求\n\n## 协作\n增加验收" });
    expect(flow.draftHistory).toHaveLength(2);
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "分工", tasks: [task("build", captain)], removedTaskIds: [] }).flow;
    expect(flow.status).toBe("READY");
    const published = a.publish(captain, flow.id, { expectedRevision: flow.revision });
    expect(published.status).toBe("PUBLISHED");
  });
  it("非法四方案使作业失败，重试后可继续；发布幂等且无成员确认作业", async () => {
    const { a, s, captain, plans, finish, task } = await setup(); plans();
    let flow = a.startInitial(captain, { expectedRequirementRevision: 0 });
    const issue = conflict(flow); issue.options.push({ id: "d", label: "第四项", impact: "无效" });
    let result = finish(flow, { summary: "无效", issues: [issue], affectedTaskIds: [], decisions: [] });
    expect(result.job.status).toBe("FAILED"); expect(result.flow.status).toBe("FAILED");
    flow = a.retry(captain, flow.id, { expectedRevision: result.flow.revision });
    flow = finish(flow, { summary: "一致", issues: [], affectedTaskIds: [], decisions: [] }).flow;
    flow = finish(flow, { summary: "需求", markdown: "# 完整需求" }).flow;
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "任务", tasks: [task("work", captain)], removedTaskIds: [] }).flow;
    const one = a.publish(captain, flow.id, { expectedRevision: flow.revision });
    const two = a.publish(captain, flow.id, { expectedRevision: flow.revision });
    expect(two).toEqual(one); expect(s.repo.listRequirementVersions()).toHaveLength(1);
    expect(s.repo.listTasks()).toHaveLength(1); expect(s.repo.listTasks()[0]!.status).toBe("PUBLISHED");
    expect(s.repo.listJobs().some(job => job.kind === "RUN_TASK")).toBe(false);
  });
  it("编辑需求使分工失效，并取消正在执行的旧分工作业，迟到结果不能覆盖", async () => {
    const { a, s, captain, publishInitial, finish } = await setup();
    const initial = publishInitial();
    const pr = a.submitPR(captain, { title: "修改房间", content: "增加历史", expectedRequirementRevision: 1 });
    let flow = a.startReview(captain, { expectedRequirementRevision: 1, changeIds: [pr.id] });
    flow = finish(flow, { summary: "补充历史", issues: [], affectedTaskIds: [], decisions: [{ changeId: pr.id, verdict: "accept", rationale: "采纳历史" }] }).flow;
    flow = a.requirement(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "完整新版", markdown: "# R2 草稿" }).flow;
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    const leased = s.claimJob(captain)!;
    const revised = a.saveDraft(captain, flow.id, { expectedRevision: flow.revision, markdown: "# 新 R2 草稿" });
    expect(revised.allocationDraftRevision).toBeNull(); expect(revised.status).toBe("DRAFT");
    expect(() => s.reportJob(captain, leased.id, { leaseToken: leased.leaseToken!, phase: "completed", result: {} })).toThrow();
    expect(s.repo.getAgileFlow(flow.id)!.draftMarkdown).toBe("# 新 R2 草稿");
    expect(s.repo.requirementRevision()).toBe(initial.flow.publishedRequirementRevision);
  });
  it("批量审核冻结 PR，只有受影响任务暂停；取消恢复状态且新增 PR 留在下一批", async () => {
    const { a, s, captain, member, publishInitial, report, finish } = await setup();
    const initial = publishInitial(), started = report(captain, initial.room, "started");
    const other = report(member, initial.client, "progress");
    const pr1 = a.submitPR(member, { title: "增加暂停", content: "房间支持暂停", expectedRequirementRevision: 1 });
    const pr2 = a.submitPR(captain, { title: "禁用暂停", content: "房间不可暂停", expectedRequirementRevision: 1 });
    let flow = a.startReview(captain, { expectedRequirementRevision: 1 });
    const later = a.submitPR(member, { title: "导出", content: "以后导出", expectedRequirementRevision: 1 });
    s.repo.putNode({ ...s.repo.getNode(member.id)!, lastSeenAt: null, connected: false });
    flow = finish(flow, { summary: "暂停冲突", issues: [conflict(flow)], affectedTaskIds: [initial.room.id],
      decisions: [{ changeId: pr1.id, verdict: "accept", rationale: "支持暂停" }, { changeId: pr2.id, verdict: "reject", rationale: "与暂停目标矛盾" }] }).flow;
    expect(flow.changeSnapshot).toHaveLength(2);
    expect(s.repo.getTask(initial.room.id)!.status).toBe("PAUSED");
    expect(s.repo.getTask(initial.client.id)).toEqual(other);
    expect(() => report(captain, started, "completed")).toThrow("暂停");
    report(member, other, "progress");
    const closed = a.close(captain, flow.id, { expectedRevision: flow.revision });
    expect(closed.status).toBe("CANCELLED"); expect(s.repo.getTask(started.id)!.status).toBe("IN_PROGRESS");
    expect(s.repo.getPullRequest(later.id)!.status).toBe("QUEUED");
    expect(s.repo.getPullRequest(pr1.id)!.status).toBe("QUEUED"); expect(s.repo.requirementRevision()).toBe(1);
  });
  it("R2 原子派发，未受影响任务保留进度，已完成任务创建关联返工，旧包结果拒绝", async () => {
    const { a, s, captain, member, publishInitial, report, finish, task } = await setup();
    const initial = publishInitial();
    const completed = report(captain, initial.room, "completed");
    const progressing = report(member, initial.client, "progress");
    const active = report(captain, initial.messages, "started");
    const pr = a.submitPR(member, { title: "修订消息与房间", content: "增加历史消息", expectedRequirementRevision: 1 });
    let flow = a.startReview(captain, { expectedRequirementRevision: 1 });
    flow = finish(flow, { summary: "两项受到影响", issues: [], affectedTaskIds: [completed.id, active.id],
      decisions: [{ changeId: pr.id, verdict: "accept", rationale: "补充历史" }] }).flow;
    // Progress during review does not invalidate the formal task snapshot.
    report(member, progressing, "progress", "during-review");
    flow = a.requirement(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "R2：历史消息", markdown: "# 完整需求 R2\n\n## 房间\n多人协作和历史消息\n\n## 客户端\nMarkdown" }).flow;
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "修订两个任务", removedTaskIds: [],
      tasks: [task("room-v2", captain, completed.id), task("messages-v2", captain, active.id)] }).flow;
    flow = a.publish(captain, flow.id, { expectedRevision: flow.revision });
    expect(flow.publishedRequirementRevision).toBe(2);
    const unchanged = s.repo.getTask(progressing.id)!;
    expect(unchanged.status).toBe("IN_PROGRESS"); expect(unchanged.progressSummary).toBe(progressing.progressSummary);
    expect(unchanged.assigneeNodeId).toBe(member.id); expect(unchanged.packageRevision).toBe(2);
    const original = s.repo.getTask(completed.id)!;
    expect(original.doneAt).toBe(completed.doneAt); expect(original.reportEvidence).toEqual(completed.reportEvidence);
    expect(s.repo.listTasks().find(t => t.reworkOfTaskId === completed.id)).toMatchObject({ title: "room-v2", status: "PUBLISHED" });
    expect(s.repo.getTask(active.id)).toMatchObject({ title: "messages-v2", status: "IN_PROGRESS", pauseRequested: false });
    expect(() => report(member, progressing, "completed")).toThrow("版本已变化");
    const pack = a.package(member, unchanged.id);
    expect(pack.requirementRevision).toBe(2); expect(pack.markdown).toContain("R2");
    expect(a.inbox(member).notifications.some(n => n.title.startsWith("R2"))).toBe(true);
    expect(s.repo.getPullRequest(pr.id)!.status).toBe("APPLIED");
    expect(s.repo.listRequirementVersions().map(v => v.revision)).toEqual([1, 2]);
  });
  it("全部退回不生成空版本，恢复暂停任务，撤销任务保留归档历史", async () => {
    const { a, s, captain, member, publishInitial, report, finish } = await setup();
    const initial = publishInitial(), started = report(member, initial.client, "started");
    const pr = a.submitPR(member, { title: "撤销客户端", content: "不做客户端", expectedRequirementRevision: 1 });
    let flow = a.startReview(captain, { expectedRequirementRevision: 1 });
    flow = finish(flow, { summary: "不采纳", issues: [], affectedTaskIds: [started.id],
      decisions: [{ changeId: pr.id, verdict: "reject", rationale: "保留客户端" }] }).flow;
    flow = a.requirement(captain, flow.id, { expectedRevision: flow.revision });
    expect(flow.status).toBe("REJECTED"); expect(s.repo.getTask(started.id)!.status).toBe("IN_PROGRESS");
    expect(s.repo.requirementRevision()).toBe(1);
    const second = a.submitPR(member, { title: "撤销客户端", content: "不做客户端", expectedRequirementRevision: 1 });
    flow = a.startReview(captain, { expectedRequirementRevision: 1 });
    flow = finish(flow, { summary: "采纳撤销", issues: [], affectedTaskIds: [started.id],
      decisions: [{ changeId: second.id, verdict: "accept", rationale: "范围收缩" }] }).flow;
    flow = a.requirement(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "撤销客户端", markdown: "# R2\n仅房间和消息" }).flow;
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "保留两项", tasks: [], removedTaskIds: [started.id] }).flow;
    a.publish(captain, flow.id, { expectedRevision: flow.revision });
    expect(s.repo.getTask(started.id)!.archived).toBe(true);
    expect(a.snapshot().archivedTasks.some(t => t.id === started.id)).toBe(true);
    expect(a.inbox(member).tasks).toHaveLength(0);
  });
  it("汇报需真实包版本和完成证据，按汇报标识幂等；成员不能读取其他人的包", async () => {
    const { a, s, captain, member, app, joined, publishInitial, report } = await setup();
    const initial = publishInitial();
    expect(() => a.package(member, initial.room.id)).toThrow("自己的");
    const denied = await app.inject({ url: "/api/v1/tasks/" + initial.room.id + "/package", headers: { authorization: "Bearer " + joined.nodeToken } });
    expect(denied.statusCode).toBe(403);
    expect(() => a.report(member, initial.client.id, { reportId: "missing", action: "completed", summary: "通过", taskRevision: 1, requirementRevision: 1 })).toThrow("证据");
    const one = report(member, initial.client, "completed", "completed-one");
    const two = report(member, initial.client, "completed", "completed-one");
    expect(one).toEqual(two); expect(one.reportEvidence).toHaveLength(1);
    expect(() => s.doneTask(member, initial.client.id)).toThrow("task report");
    expect(() => s.coordination.finishExternal(member, initial.client.id, one.revision)).toThrow("task report");
    expect(a.inbox(member).tasks[0]!.package.taskRevision).toBe(1);
  });
  it("API 算力只在队长配置所在节点执行，Codex 不可用也能审核，配置不含 Key", async () => {
    const { a, s, captain, member, plans, beat } = await setup(); plans();
    expect(() => a.setCompute(member, { provider: "api" })).toThrow("队长");
    a.setCompute(captain, { provider: "api" });
    expect(() => a.startInitial(captain, { expectedRequirementRevision: 0 })).toThrow("API 未就绪");
    s.heartbeat(captain, { ...beat, codex: "offline", apiReady: true });
    const flow = a.startInitial(captain, { expectedRequirementRevision: 0 });
    const job = s.repo.getJob(flow.agentJobId!)!;
    expect(job.targetNodeId).toBe(captain.id); expect(job.payload.provider).toBe("api");
    expect(JSON.stringify(a.snapshot().compute)).not.toContain("Key");
    expect(s.claimJob(captain)!.id).toBe(job.id);
  });
  it("历史房间不自动迁移到新状态机", async () => {
    const { a, s, captain } = await setup();
    expect(a.snapshot().enabled).toBe(true);
    s.repo.setMeta("flow_mode", "legacy");
    expect(a.snapshot().enabled).toBe(false);
    expect(() => a.startInitial(captain, { expectedRequirementRevision: 0 })).toThrow("历史房间");
    expect(a.snapshot().batchReviewEnabled).toBe(true);
  });
  it("队长只选两个 PR 联合分析，未选中和审核期间新增的 PR 不进入本批", async () => {
    const { a, s, captain, member, publishInitial, finish, task } = await setup();
    const initial = publishInitial();
    const first = a.submitPR(member, { title: "增加房间历史", content: "房间记录历史", expectedRequirementRevision: 1 });
    const second = a.submitPR(captain, { title: "限定历史范围", content: "只保留最近一轮历史", expectedRequirementRevision: 1 });
    const unselected = a.submitPR(member, { title: "导出", content: "导出个人计划", expectedRequirementRevision: 1 });
    let flow = a.startReview(captain, { expectedRequirementRevision: 1, changeIds: [first.id, second.id] });
    const later = a.submitPR(member, { title: "搜索", content: "搜索历史", expectedRequirementRevision: 1 });
    expect(flow.changeSnapshot.map(pr => pr.id)).toEqual([first.id, second.id]);
    const jobs = s.repo.listJobs().filter(job => job.entityId === flow.id && job.kind === "AGILE_ANALYZE");
    expect(jobs).toHaveLength(1); expect(jobs[0]!.payload.prompt).toContain(first.id); expect(jobs[0]!.payload.prompt).toContain(second.id);
    expect(jobs[0]!.payload.prompt).not.toContain(unselected.id); expect(jobs[0]!.payload.prompt).not.toContain(later.id);
    const issue = { ...conflict(flow), evidence: [{ sourceId: first.id, excerpt: "房间记录历史" }, { sourceId: second.id, excerpt: "最近一轮历史" }] };
    flow = finish(flow, { summary: "历史保留范围有冲突", issues: [issue], affectedTaskIds: [initial.room.id], decisions: [
      { changeId: first.id, verdict: "accept", rationale: "增加历史" }, { changeId: second.id, verdict: "accept", rationale: "限制到最近一轮" }
    ] }).flow;
    flow = a.answer(captain, flow.id, { expectedRevision: flow.revision, issueId: issue.id, answer: { kind: "custom", text: "增加历史，仅保留最近一轮" } });
    flow = finish(flow, { summary: "合并两个 PR 的范围", followUp: null }).flow;
    flow = a.requirement(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "增加最近一轮历史", markdown: "# 完整需求 R2\n\n## 房间\n多人协作，仅保留最近一轮历史\n\n## 客户端\n编辑个人计划" }).flow;
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "统一修订房间", tasks: [{ ...task("room-v2", captain, initial.room.id), goal: "记录并查看最近一轮房间历史", acceptance: ["历史可以读取", "更早记录不在本轮范围"] }], removedTaskIds: [] }).flow;
    a.publish(captain, flow.id, { expectedRevision: flow.revision });
    expect(s.repo.getPullRequest(first.id)!.status).toBe("APPLIED"); expect(s.repo.getPullRequest(second.id)!.status).toBe("APPLIED");
    expect(s.repo.getPullRequest(unselected.id)!.status).toBe("QUEUED"); expect(s.repo.getPullRequest(later.id)!.status).toBe("QUEUED");
    expect(s.repo.listRequirementVersions().map(version => version.revision)).toEqual([1, 2]);
    expect(s.repo.getTask(initial.room.id)!.goal).toBe("记录并查看最近一轮房间历史");
  });
  it("历史变更与旧 PR 可组成一个批次，保留原房间和历史并统一派发新版包", async () => {
    const { a, s, captain, member, publishLegacy, finish, task, app, runtime, joined } = await setup();
    const initial = publishLegacy(), originalVersion = s.repo.listRequirementVersions()[0]!;
    const beforeClient = { ...initial.client, status: "IN_PROGRESS" as const, progressSummary: "编辑器已完成" }; s.repo.putTask(beforeClient);
    const first = s.coordination.submitChange(member, { title: "增加历史", content: "房间显示历史", taskIds: [initial.room.id], expectedRequirementRevision: 1 });
    const unselected = s.coordination.submitChange(captain, { title: "增加导出", content: "客户端导出", expectedRequirementRevision: 1 });
    const pr = s.submitPullRequest(captain, "history.md", "# 历史范围\n仅保留最近一轮");
    const denied = await app.inject({ method: "POST", url: "/api/v1/agile/reviews", headers: { authorization: "Bearer " + joined.nodeToken },
      payload: { expectedRequirementRevision: 1, changeIds: [first.id, pr.id] } });
    expect(denied.statusCode).toBe(403);
    const response = await app.inject({ method: "POST", url: "/api/v1/agile/reviews", headers: { authorization: "Bearer " + runtime.captain.nodeToken },
      payload: { expectedRequirementRevision: 1, changeIds: [first.id, pr.id] } });
    expect(response.statusCode).toBe(200); let flow = response.json<AgileFlow>();
    expect(flow.changeSnapshot.map(pr => pr.source).sort()).toEqual(["legacy_change", "legacy_pr"]);
    expect(flow.taskSnapshot).toHaveLength(2); expect(flow.changeSnapshot.find(pr => pr.id === first.id)!.taskIds).toEqual([initial.room.id]);
    expect(() => s.coordination.rejectChange(captain, first.id, s.coordination.change(first.id).revision)).toThrow("已处理");
    expect(() => s.startReview(captain, true)).toThrow("已有审核");
    const later = s.coordination.submitChange(member, { title: "新增搜索", content: "搜索历史", expectedRequirementRevision: 1 });
    flow = finish(flow, { summary: "联合采用最近一轮历史", issues: [], affectedTaskIds: [initial.room.id], decisions: [
      { changeId: first.id, verdict: "accept", rationale: "增加历史" }, { changeId: pr.id, verdict: "accept", rationale: "限制保留范围" }
    ] }).flow;
    expect(s.repo.getTask(initial.room.id)!.status).toBe("PAUSED"); expect(s.repo.getTask(initial.client.id)).toEqual(beforeClient);
    const bootstrap = await s.bootstrap(captain);
    expect(bootstrap.agile).toMatchObject({ enabled: false, batchReviewEnabled: true });
    expect(workspaceChanges(bootstrap).find(change => change.id === first.id)!.status).toBe("IN_REVIEW");
    const note = s.repo.listNotifications(captain.id).find(note => note.entityId === first.id)!;
    expect(notificationResource(note, bootstrap)!.status).toBe("审核中");
    flow = a.requirement(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "历史范围已合并", markdown: "# 完整需求 R2\n\n## 房间\n多人协作与最近一轮历史\n\n## 客户端\n编辑个人计划" }).flow;
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "房间统一修订", tasks: [{ ...task("history-room", captain, initial.room.id), goal: "实现多人房间及最近一轮历史", acceptance: ["房间可以加入", "历史仅保留最近一轮"] }], removedTaskIds: [] }).flow;
    const published = a.publish(captain, flow.id, { expectedRevision: flow.revision });
    expect(a.publish(captain, flow.id, { expectedRevision: flow.revision })).toEqual(published);
    expect(s.repo.listRequirementVersions()[0]).toEqual(originalVersion); expect(s.repo.requirementRevision()).toBe(2);
    expect(s.repo.getMeta("flow_mode")).toBe("legacy"); expect(s.repo.getStage(initial.stage.id)!.sourceAlignmentId).toBe(initial.stage.sourceAlignmentId);
    expect(s.repo.getStage(initial.stage.id)).toMatchObject({ status: "ACTIVE", reviewId: null });
    expect(s.coordination.change(first.id)).toMatchObject({ status: "APPLIED", reviewId: flow.id });
    const comparison = s.coordination.change(first.id).taskChanges![0]!;
    expect(comparison.before.goal).toBe(initial.room.goal); expect(comparison.after.goal).toBe("实现多人房间及最近一轮历史");
    expect(s.repo.getPullRequest(pr.id)!.status).toBe("APPLIED"); expect(s.coordination.change(unselected.id).status).toBe("PENDING"); expect(s.coordination.change(later.id).status).toBe("PENDING");
    const currentClient = s.repo.getTask(initial.client.id)!;
    expect(currentClient).toMatchObject({ assigneeNodeId: member.id, status: "IN_PROGRESS", progressSummary: "编辑器已完成", goal: beforeClient.goal, pendingChangeId: null });
    expect(a.inbox(member).tasks[0]!.package.requirementRevision).toBe(2); expect(a.inbox(member).notifications.some(note => note.title.startsWith("R2"))).toBe(true);
    expect(() => a.report(member, currentClient.id, { reportId: "old", action: "completed", taskRevision: initial.client.revision, requirementRevision: 1, summary: "旧结果", evidence: ["旧验证"] })).toThrow("版本已变化");
  });
  it("历史批次取消或全部退回时恢复原状态，只处理选中的来源，不产生空需求版本", async () => {
    const { a, s, captain, member, publishLegacy, finish } = await setup();
    const initial = publishLegacy();
    s.repo.putTask({ ...initial.room, status: "BLOCKED", blockedReason: "等待接口" });
    const change = s.coordination.submitChange(member, { title: "历史", content: "新增历史", expectedRequirementRevision: 1 });
    const untouched = s.coordination.submitChange(member, { title: "搜索", content: "以后搜索", expectedRequirementRevision: 1 });
    const pr = s.submitPullRequest(captain, "limit.md", "# 限制\n保留一轮");
    const originalTasks = s.repo.listTasks(initial.stage.id), originalDocuments = s.repo.listDocuments();
    const review = () => a.startReview(captain, { expectedRequirementRevision: 1, changeIds: [change.id, pr.id] });
    let flow = review();
    flow = finish(flow, { summary: "先暂停", issues: [], affectedTaskIds: [initial.room.id], decisions: [
      { changeId: change.id, verdict: "accept", rationale: "新增历史" }, { changeId: pr.id, verdict: "reject", rationale: "范围不适合" }
    ] }).flow;
    a.close(captain, flow.id, { expectedRevision: flow.revision });
    expect(s.repo.getTask(initial.room.id)).toMatchObject({ status: "BLOCKED", blockedReason: "等待接口", pauseRequested: false });
    expect(s.coordination.change(change.id)).toMatchObject({ status: "PENDING", reviewId: null }); expect(s.repo.getPullRequest(pr.id)).toMatchObject({ status: "QUEUED", reviewId: null });
    expect(s.repo.getStage(initial.stage.id)).toEqual(initial.stage);
    flow = review();
    flow = finish(flow, { summary: "本批全部退回", issues: [], affectedTaskIds: [initial.room.id], decisions: [
      { changeId: change.id, verdict: "reject", rationale: "保留原范围" }, { changeId: pr.id, verdict: "reject", rationale: "暂不增加历史" }
    ] }).flow;
    expect(a.requirement(captain, flow.id, { expectedRevision: flow.revision }).status).toBe("REJECTED");
    expect(s.coordination.change(change.id).status).toBe("REJECTED"); expect(s.repo.getPullRequest(pr.id)!.status).toBe("REJECTED");
    expect(s.coordination.change(untouched.id)).toEqual(untouched); expect(s.repo.listRequirementVersions()).toHaveLength(1);
    expect(s.repo.listDocuments()).toEqual(originalDocuments);
    expect(s.repo.listTasks(initial.stage.id).map(task => ({ goal: task.goal, boundary: task.boundary, acceptance: task.acceptance })))
      .toEqual(originalTasks.map(task => ({ goal: task.goal, boundary: task.boundary, acceptance: task.acceptance })));
  });
  it("批次拒绝空选择、重复、过期状态和跨阶段记录，失败不会半锁定数据", async () => {
    const { a, s, captain, member, publishLegacy } = await setup(); const initial = publishLegacy();
    const change = s.coordination.submitChange(member, { title: "历史", content: "历史", expectedRequirementRevision: 1 });
    const pr = s.submitPullRequest(member, "history.md", "# 历史\n保留一轮");
    const invalidSelections = [[], [change.id, change.id], ["missing"], [change.id, "missing"]];
    for (const changeIds of invalidSelections) expect(() => a.startReview(captain, { expectedRequirementRevision: 1, changeIds })).toThrow("请选择");
    expect(() => a.startReview(captain, { expectedRequirementRevision: 0, changeIds: [change.id] })).toThrow("版本");
    s.repo.putPullRequest({ ...pr, stageId: "another-stage" });
    expect(() => a.startReview(captain, { expectedRequirementRevision: 1, changeIds: [change.id, pr.id] })).toThrow("同一需求阶段");
    s.repo.putPullRequest({ ...pr, status: "APPLIED" });
    expect(() => a.startReview(captain, { expectedRequirementRevision: 1, changeIds: [pr.id] })).toThrow("请选择");
    s.repo.putNode({ ...s.repo.getNode(captain.id)!, codex: "offline" });
    expect(() => a.startReview(captain, { expectedRequirementRevision: 1, changeIds: [change.id] })).toThrow();
    expect(s.coordination.change(change.id)).toEqual(change); expect(s.repo.getStage(initial.stage.id)).toEqual(initial.stage); expect(s.repo.listAgileFlows()).toHaveLength(0);
  });
  it("批量分工不能复制原任务冒充修订，失败保留需求草稿且可重试得到真实变化", async () => {
    const { a, s, captain, member, publishLegacy, finish, task } = await setup(); const initial = publishLegacy();
    const change = s.coordination.submitChange(member, { title: "历史", content: "房间增加历史", expectedRequirementRevision: 1 });
    let flow = a.startReview(captain, { expectedRequirementRevision: 1, changeIds: [change.id] });
    flow = finish(flow, { summary: "房间受影响", issues: [], affectedTaskIds: [initial.room.id], decisions: [{ changeId: change.id, verdict: "accept", rationale: "新增历史" }] }).flow;
    flow = a.requirement(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "新增历史", markdown: "# 完整 R2\n房间包含历史" }).flow;
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    const copy: AgileTaskDraft = { ...task("new-key", captain, initial.room.id), title: initial.room.title, goal: initial.room.goal,
      boundary: initial.room.boundary, acceptance: initial.room.acceptance, ownedPaths: initial.room.brief!.ownedPaths, requirementRefs: ["房间包含历史"] };
    for (let attempt = 0; attempt < 3; attempt++) flow = finish(flow, { summary: "错误地照搬任务", tasks: [copy], removedTaskIds: [] }).flow;
    expect(flow.status).toBe("FAILED"); expect(flow.error).toContain("没有具体变化"); expect(flow.draftMarkdown).toBe("# 完整 R2\n房间包含历史");
    expect(s.repo.getTask(initial.room.id)!.goal).toBe(initial.room.goal); expect(s.repo.requirementRevision()).toBe(1);
    flow = a.retry(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "真实修订", tasks: [{ ...copy, goal: "实现多人房间和最近一轮历史" }], removedTaskIds: [] }).flow;
    expect(flow.status).toBe("READY"); expect(flow.tasks[0]!.goal).not.toBe(initial.room.goal);
  });
  it("历史房间的批量审核可使用队长本机 API，冻结后的来源改变会隔离过期 AI 结果", async () => {
    const { a, s, captain, member, publishLegacy, beat, finish } = await setup(); publishLegacy();
    const change = s.coordination.submitChange(member, { title: "历史", content: "房间历史", expectedRequirementRevision: 1 });
    a.setCompute(captain, { provider: "api" }); s.heartbeat(captain, { ...beat, codex: "offline", apiReady: true });
    const flow = a.startReview(captain, { expectedRequirementRevision: 1, changeIds: [change.id] });
    expect(s.repo.getJob(flow.agentJobId!)!).toMatchObject({ targetNodeId: captain.id, payload: { provider: "api" } });
    const frozen = s.coordination.change(change.id); s.repo.putCoordinationChange({ ...frozen, content: "来源意外改变" });
    const result = finish(flow, { summary: "旧结果", issues: [], affectedTaskIds: [], decisions: [{ changeId: change.id, verdict: "accept", rationale: "旧提案" }] });
    expect(result.job.status).toBe("FAILED"); expect(result.flow.error).toContain("变更已变化"); expect(result.flow.changeSnapshot[0]!.document.content).toContain("房间历史");
    expect(s.repo.requirementRevision()).toBe(1);
  });
  it("旧 Codex 作业迟到的开工、结束或失败汇报不能解除批量审核暂停", async () => {
    const { a, s, captain, member, publishLegacy, finish } = await setup(); const initial = publishLegacy();
    const run = s.startTask(s.repo.getNode(captain.id)!, initial.room.id), leased = s.claimJob(captain)!;
    expect(leased.id).toBe(run.id);
    const change = s.coordination.submitChange(member, { title: "历史", content: "房间增加历史", expectedRequirementRevision: 1 });
    let flow = a.startReview(captain, { expectedRequirementRevision: 1, changeIds: [change.id] });
    flow = finish(flow, { summary: "房间暂停", issues: [], affectedTaskIds: [initial.room.id], decisions: [{ changeId: change.id, verdict: "accept", rationale: "新增历史" }] }).flow;
    s.reportJob(captain, run.id, { leaseToken: leased.leaseToken!, phase: "started", runtimeId: "old-runtime" });
    expect(s.repo.getTask(initial.room.id)).toMatchObject({ status: "PAUSED", pauseRequested: true });
    s.reportJob(captain, run.id, { leaseToken: leased.leaseToken!, phase: "completed", result: { summary: "旧执行结束" } });
    expect(s.repo.getTask(initial.room.id)).toMatchObject({ status: "PAUSED", pauseRequested: true, finishedAt: null, activeJobId: null });
    expect(s.repo.getAgileFlow(flow.id)!.status).toBe("DECIDING");
    // A failed old worker must preserve the same pause fact as a completed old worker.
    const otherJob = { ...run, id: "JOB-old-failed", status: "LEASED" as const, leaseToken: "test-old-lease", leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() };
    s.repo.putJob(otherJob); s.repo.putTask({ ...s.repo.getTask(initial.room.id)!, activeJobId: otherJob.id });
    s.reportJob(captain, otherJob.id, { leaseToken: "test-old-lease", phase: "failed", error: "旧执行异常" });
    expect(s.repo.getTask(initial.room.id)).toMatchObject({ status: "PAUSED", pauseRequested: true, blockedReason: "需求变更审核中，等待队长统一派发" });
  });
  it("编辑新版正文扩大影响时，分工预览前暂停新增受影响任务", async () => {
    const { a, s, captain, member, publishInitial, finish, task, report } = await setup();
    const initial = publishInitial(); report(member, initial.client, "started");
    const pr = a.submitPR(captain, { title: "修改房间", content: "增加历史", expectedRequirementRevision: 1 });
    let flow = a.startReview(captain, { expectedRequirementRevision: 1 });
    flow = finish(flow, { summary: "先影响房间", issues: [], affectedTaskIds: [initial.room.id], decisions: [{ changeId: pr.id, verdict: "accept", rationale: "增加历史" }] }).flow;
    flow = a.requirement(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "房间历史", markdown: "# R2\n房间历史" }).flow;
    flow = a.saveDraft(captain, flow.id, { expectedRevision: flow.revision, markdown: "# R2\n房间历史与客户端历史导出" });
    flow = a.allocate(captain, flow.id, { expectedRevision: flow.revision });
    flow = finish(flow, { summary: "客户端也需要修订", removedTaskIds: [], tasks: [task("room-new", captain, initial.room.id), task("client-new", member, initial.client.id)] }).flow;
    expect(flow.affectedTaskIds).toContain(initial.client.id);
    expect(s.repo.getTask(initial.client.id)!.status).toBe("PAUSED");
    a.close(captain, flow.id, { expectedRevision: flow.revision });
    expect(s.repo.getTask(initial.client.id)!.status).toBe("IN_PROGRESS");
  });
  it("依赖任务完成前不能开工，包给出等待信息；开工和进度由 AI 直接汇报", async () => {
    const { a, s, captain, member, publishInitial, report } = await setup();
    const initial = publishInitial();
    s.repo.putTask({ ...initial.client, dependencies: [initial.room.id] });
    expect(a.package(member, initial.client.id).nextStep).toContain("等待前置");
    expect(() => report(member, initial.client, "started")).toThrow("依赖任务");
    expect(report(member, initial.client, "blocked").status).toBe("BLOCKED");
    report(captain, initial.room, "completed");
    expect(report(member, initial.client, "started").status).toBe("IN_PROGRESS");
  });
  it("重启后恢复冻结快照、回答、需求草稿和编辑历史", async () => {
    const { root, app, a, captain, plans, finish } = await setup(); plans();
    let flow = a.startInitial(captain, { expectedRequirementRevision: 0 });
    flow = finish(flow, { summary: "一致", issues: [], affectedTaskIds: [], decisions: [] }).flow;
    flow = finish(flow, { summary: "需求", markdown: "# 可恢复需求" }).flow;
    flow = a.saveDraft(captain, flow.id, { expectedRevision: flow.revision, markdown: "# 可恢复需求\n\n## 验收\n重启后仍然存在" });
    apps.splice(apps.indexOf(app), 1); await app.close();
    const reopened = await buildApp({ dbPath: resolve(root, "room.db"), dataDir: root, staticDir: false, backupDatabase: false, cloudflareManager: { close: async () => {} } as never }); apps.push(reopened);
    const service = (reopened as unknown as { v20Service: V20Service }).v20Service;
    expect(service.agile.snapshot().activeFlow).toEqual(flow);
    expect(service.repo.getAgileFlow(flow.id)!.draftHistory).toHaveLength(2);
  });
});
