import { advanceReviewTasks, reviewAction, initializeReviewTasks } from "./reviewActions";
import type {
  AlignmentRun, CollaborationNode, DevelopmentStage, InterfaceContract,
  MarkdownDocument, ProjectModule, StageTask, TaskBrief, V20BootstrapPayload,
  Workstream
} from "@vibe-git/protocol";

const date = "2026-09-23T10:00:00+08:00";
const sha = (digit: string) => digit.repeat(40);
const digest = (digit: string) => digit.repeat(64);
const ids = { captain: "node-captain", chen: "node-chen", xu: "node-xu" } as const;
export type ReviewRole = keyof typeof ids;

const node = (id: string, label: string, role: "captain" | "member", branch: string, head: string): CollaborationNode => ({
  id, label, role, revoked: false, connected: true, workspaceReady: true,
  codex: "available", workTransport: "app-server",
  activeJobCount: 0, rateLimits: [], git: { branch, headSha: sha(head), dirty: false, fingerprint: digest(head), observedAt: date },
  currentTaskId: null, lastSeenAt: date, lastAuditJobAt: date, createdAt: "2026-09-21T09:00:00+08:00"
});
const nodes = [
  node(ids.captain, "Ivan", "captain", "feature/agents-room", "a"),
  node(ids.chen, "小芋头", "member", "feature/agents-contracts", "b"),
  node(ids.xu, "汤神", "member", "feature/agents-workflow", "c")
];

const proposal = (id: string, owner: string, filename: string, revision: number, content: string, at: string, restoredFromDocumentId?: string): MarkdownDocument => ({
  id, kind: "plan", ownerNodeId: owner, entityId: null, filename, revision,
  sha256: digest(id.endsWith("2") ? "b" : "a"), bytes: new TextEncoder().encode(content).length,
  content, createdAt: at, ...(restoredFromDocumentId ? { restoredFromDocumentId } : {})
});

const planTexts = {
  captain: `# Agents 协作房间建设计划

## 要解决的问题

当前任务按编号串联，下游常常等到上游全部完成才能动手；提案版本、接口约定和真实集成记录也分散在不同地方。本阶段把这些信息放回房间里，让三名成员清楚看到自己能做什么、在等谁，以及哪一步需要人来确认。

## 页面与角色

| 页面 | 队长 | 成员 |
| --- | --- | --- |
| 房间总览 | 查看模块排期、成员状态和待处理事项；维护排期 | 查看团队进度与自己的待办 |
| 项目提案 | 查看全员版本，发起对齐、裁决冲突 | 提交、更新、撤回和恢复自己的版本 |
| 工作项 | 发布主线，检查契约与集成记录 | 下载任务说明、启动切片、确认集成与完成 |
| 变更审核 | 发起、应用或退回影响审核 | 提交变更并查看处理进度 |

所有身份使用同一套房间界面，权限在 Host 校验，页面只显示当前身份能使用的操作。提案提交时不要求成员猜测影响模块；队长端审核时对照冻结提案和模块目录给出结论与依据。

## 工作主线

每位负责人保留一条主线，主线内最多四个可验收切片。每个切片要写清交付物、可修改和禁改目录、关联需求、输入输出、异常、依赖原因、测试命令及完成条件。小芋头先处理接口模型，再交付房间查询和本地交接；汤神先完成房间页面，再接成员工作台；Ivan复核阶段边界，在真实接口和页面交付后验收房间权限。

## 接口与并行开发

- 硬依赖必须等上游任务完成；契约依赖在双方确认同一版本、队长冻结后可并行。
- 契约记录签名、行为、错误情况、测试命令、版本哈希和交接产物。任何一方没确认，就继续等待；无法隔离共享文件时改为硬依赖。
- 消费方在自己的本地目录准备接口替身与契约测试，测试通过才启动开发。接口替身不写进共享仓库，也不作为真实集成结果。
- 提供方交付提交 SHA 后，消费方同步真实代码、重跑契约测试，记录结果，再由本人确认完成。

## 变更处理

开发中的需求调整走房间内部变更。队长审核后，只暂停实际受影响的切片；被修改的契约提高版本，原确认和旧接口替身准备状态失效。没有被命中的任务继续执行。若整个阶段还未开工，可由队长从已发布需求重排主线，原任务保留归档。

## 本周安排

1. **9 月 22 日**：确认需求、模块目录和任务边界，发布阶段一。
2. **9 月 23–25 日**：接口模型与房间页面并行完成；核对权限和 Markdown 排版。
3. **9 月 26–28 日**：本地任务准备、成员工作台和变更审核联调。
4. **9 月 29–30 日**：同步真实代码，跑契约测试，处理回归并确认完成。

## 验收清单

- [ ] 三种身份打开同一房间，按钮权限与 Host 一致。
- [ ] 提案保留历史版本；恢复旧正文会生成新版本。
- [ ] 工作项有完整执行说明，契约未确认时不能并行开工。
- [ ] 本地接口替身测试失败不会启动开发；真实集成前不能标成完成。
- [ ] 变更只失效命中的切片与契约，旧任务和审核记录可追溯。`,
  chen: `# 接口契约与工作切片\n\n## 我负责的内容\n协议类型、契约冻结和工作切片接口。每个切片写明输入、输出、错误情况和测试命令。\n\n## 对接约定\n消费方确认同一哈希后才能并行开工。接口变化时提高修订号，原确认失效。\n\n## 需要队长确认\n跨模块的数据边界，以及契约降级为硬等待的时机。`,
  xu: `# 房间页面与本地工作流\n\n## 页面\n以人员拓扑与项目甘特为两种视角，成员提案、工作项和需求变更均在详情抽屉中打开。顶部保留工作区、算力网、邀请与活动通知入口。\n\n## 本地流程\n成员可以在本机查看自己的任务说明，准备接口替身、运行测试，并在真实依赖到达后记录集成结果。\n\n## 验收\n三种身份显示各自权限；提案正文按 Markdown 排版；未确认的工作不会标成完成。`
};
const documents: MarkdownDocument[] = [
  proposal("plan-lin-1", ids.captain, "agents-room.md", 1, planTexts.captain, "2026-09-21T10:15:00+08:00"),
  proposal("plan-chen-1", ids.chen, "contracts.md", 1, "# 接口契约\n\n先列出字段与责任人，再讨论实现。", "2026-09-21T11:10:00+08:00"),
  proposal("plan-chen-2", ids.chen, "contracts.md", 2, planTexts.chen, "2026-09-22T16:30:00+08:00"),
  proposal("plan-xu-1", ids.xu, "room-ui.md", 1, planTexts.xu, "2026-09-22T14:20:00+08:00"),
  { id: "change-1-doc", kind: "change", ownerNodeId: ids.chen, entityId: "change-1", filename: "contract-error-codes.md", revision: 1,
    sha256: digest("7"), bytes: 238, content: "# 契约错误码补充\n\n把修订号不一致与权限不足分开返回。\n\n## 原因\n成员端需要明确告诉负责人是重新确认契约，还是联系队长调整权限。\n\n## 验收\n- 409 返回当前修订号与请求修订号。\n- 403 不返回其他成员的任务详情。", createdAt: "2026-09-22T19:10:00+08:00" },
  { id: "change-2-doc", kind: "change", ownerNodeId: ids.xu, entityId: "change-2", filename: "proposal-history-filter.md", revision: 1,
    sha256: digest("8"), bytes: 230, content: "# 提案历史增加筛选\n\n提案版本多起来后，按成员和时间查看记录。\n\n## 影响范围\n房间提案页与版本查询接口。旧版本、撤回记录和冻结快照继续保留。\n\n## 验收\n- 队长可查全员版本；成员只能恢复自己的版本。\n- 恢复旧正文时生成新版本，不改写旧记录。", createdAt: "2026-09-23T09:40:00+08:00" }
];

const spec = (ownedPaths: string[], deliverables: string[], mockStrategy: string, integrationSteps: string[]): TaskBrief => ({
  deliverables, ownedPaths, excludedPaths: ["房间密钥与本地凭据"], requirementRefs: ["R1 / 协作房间", "R1 / 工作切片"],
  interfaceNotes: ["输入：冻结的任务与契约；输出：可验证的代码和交接记录"],
  mockStrategy, integrationSteps, verificationCommands: ["npm run typecheck", "npm test"],
  handoff: "交付代码提交、对应测试结果和真实依赖集成记录"
});
const task = (id: string, title: string, owner: string, status: StageTask["status"], goal: string, workstreamId: string, brief: TaskBrief, dependencies: StageTask["dependencyEdges"] = []): StageTask => ({
  id, stageId: "stage-agents-1", assigneeNodeId: owner, title, goal,
  boundary: brief.ownedPaths.join("、"), acceptance: ["通过对应测试", "同步真实依赖", "本人确认交付"],
  dependencies: dependencies.map((edge) => edge.upstreamTaskId), dependencyEdges: dependencies,
  brief, workstreamId, mockEvidence: null, integrationEvidence: null, archived: false, sourcePlanNodeIds: [owner], status, revision: 2,
  detailDocumentId: null, activeJobId: null, runtimeId: null, lastGit: nodes.find((item) => item.id === owner)?.git ?? null,
  publishedAt: "2026-09-22T18:00:00+08:00", startedAt: status === "PUBLISHED" ? null : "2026-09-23T09:10:00+08:00",
  finishedAt: ["WAITING_INTEGRATION", "WAITING_CONFIRMATION", "DONE"].includes(status) ? date : null,
  doneAt: status === "DONE" ? date : null, updatedAt: date
});
const tasks: StageTask[] = [
  task("task-lin-1", "阶段需求与分工复核", ids.captain, "DONE", "复核已发布阶段的需求、任务边界与负责人清单。", "stream-lin",
    spec(["apps/host/src/v20"], ["阶段需求 R1", "工作主线清单"], "不需要接口替身；校验发布数据。", ["核对任务责任人", "发布阶段"])),
  task("task-chen-1", "接口契约与状态模型", ids.chen, "IN_PROGRESS", "定义契约修订、双方确认和任务状态流转。", "stream-chen",
    spec(["packages/protocol/src", "apps/host/src/v20"], ["契约模型", "确认与发布接口"], "用最小消费方桩验证签名与错误分支。", ["提交提供方实现", "记录提交哈希"]),
    [{ upstreamTaskId: "task-lin-1", mode: "HARD", reason: "先取得上游验收交付物", contractId: null, contractRevision: null }]),
  task("task-xu-1", "房间页面与提案版本", ids.xu, "IN_PROGRESS", "让三个身份都能查看提案、版本与模块排期。", "stream-xu",
    spec(["apps/web/src"], ["房间页面", "提案版本入口"], "本机注入契约返回值，检查空值与权限状态。", ["拉取契约提供方提交", "联调提案与房间接口"]),
    [{ upstreamTaskId: "task-chen-1", mode: "CONTRACT", reason: "接口已经冻结，可并行开发", contractId: "contract-room-api", contractRevision: 1 }]),
  task("task-chen-2", "本地任务准备与交接", ids.chen, "PUBLISHED", "为并行切片生成本地接口替身并留下可复验记录。", "stream-chen",
    spec(["apps/cli/src"], ["本地工作目录", "契约测试结果"], "依照冻结签名生成桩文件与测试，不写入共享仓库。", ["对照真实实现运行测试", "提交集成记录"]),
    [{ upstreamTaskId: "task-chen-1", mode: "HARD", reason: "先取得上游验收交付物", contractId: null, contractRevision: null }]),
  task("task-xu-2", "成员工作台与集成视图", ids.xu, "PUBLISHED", "显示硬等待、契约并行和真实集成状态。", "stream-xu",
    spec(["apps/web/src"], ["工作项状态卡", "集成确认入口"], "用冻结契约响应检查所有状态。", ["取得提供方提交", "记录真实集成测试"]),
    [{ upstreamTaskId: "task-chen-2", mode: "CONTRACT", reason: "接口已经冻结，可并行开发", contractId: "contract-work-api", contractRevision: 1 }]),
  task("task-chen-3", "房间查询接口与版本历史", ids.chen, "PUBLISHED", "在契约模型完成后实现房间查询与提案历史接口。", "stream-chen",
    spec(["apps/host/src/v20"], ["房间查询接口", "提案历史查询"], "沿用已冻结的接口签名。", ["对接房间页面", "验证三种身份的读取权限"]),
    [{ upstreamTaskId: "task-chen-1", mode: "HARD", reason: "契约模型验收后接入查询服务", contractId: null, contractRevision: null }]),
  task("task-lin-2", "房间页面验收与权限核对", ids.captain, "PUBLISHED", "页面与真实查询接口完成后核对三种身份的入口和权限。", "stream-lin",
    spec(["apps/web/src", "apps/host/test"], ["房间页面验收记录", "权限回归结果"], "最终验收使用真实房间接口。", ["核对提案历史与画布数据", "复核成员不能代替他人操作"]),
    ["task-chen-3", "task-xu-1"].map(upstreamTaskId => ({ upstreamTaskId, mode: "HARD" as const, reason: "等待页面与查询接口真实交付", contractId: null, contractRevision: null })))
];
const workstreams: Workstream[] = [
  { id: "stream-lin", ownerNodeId: ids.captain, taskIds: ["task-lin-1", "task-lin-2"], mission: "复核阶段边界，再验收房间页面与权限。" },
  { id: "stream-chen", ownerNodeId: ids.chen, taskIds: ["task-chen-1", "task-chen-3", "task-chen-2"], mission: "先完成契约模型，再交付房间查询和本地任务准备。" },
  { id: "stream-xu", ownerNodeId: ids.xu, taskIds: ["task-xu-1", "task-xu-2"], mission: "先接房间与提案页，再完成成员工作台。" }
].map(item => ({...item, alignmentId: "alignment-agents-1", stageId: "stage-agents-1", boundary: "按本人的切片负责范围修改，接口按冻结契约交接。", revision: 1, status: "PUBLISHED"}));
const contract = (id: string, providerTaskId: string, consumerTaskId: string, hash: string): InterfaceContract => ({
  id, alignmentId: "alignment-agents-1", stageId: "stage-agents-1", providerTaskId, consumerTaskIds: [consumerTaskId], kind: "http",
  name: id === "contract-room-api" ? "房间状态接口" : "任务集成接口",
  signature: id === "contract-room-api" ? "GET /api/v1/bootstrap → RoomPayload" : "POST /api/v1/tasks/:id/integrate → Task",
  behavior: ["按查看者身份返回房间状态；核对修订与任务归属后保存。"],
  examples: ["当前版本与身份匹配时返回 200"], errors: ["409 修订不一致", "403 非任务负责人"],
  testCommand: "npm test -- contract", handoff: "实现提交 SHA 与 contract-test.log",
  revision: 1, sha256: hash, acknowledgedNodeIds: [ids.chen, ids.xu], status: "PUBLISHED"
});
const contracts = [contract("contract-room-api", "task-chen-1", "task-xu-1", digest("d")), contract("contract-work-api", "task-chen-2", "task-xu-2", digest("e"))];
// Keep the initial running tasks consistent with the same detail/contract gates as the UI.
for (const item of tasks.filter(item => item.startedAt)) {
  const content = `# ${item.title}\n\n${item.goal}\n\n## 验证\n${item.brief?.verificationCommands.join("\n")}`;
  item.detailDocumentId = `${item.id}-detail`;
  documents.push({ id: item.detailDocumentId, kind: "task_detail", ownerNodeId: item.assigneeNodeId, entityId: item.id,
    filename: `${item.id}.md`, revision: 1, content, sha256: digest("f"), bytes: new TextEncoder().encode(content).length,
    createdAt: "2026-09-23T09:00:00+08:00" });
  const dependencies = contracts.filter(contract => contract.consumerTaskIds.includes(item.id));
  if (dependencies.length) item.mockEvidence = { contractHashes: Object.fromEntries(dependencies.map(contract => [contract.id, contract.sha256])), verifiedAt: "2026-09-23T09:05:00+08:00", summary: "冻结接口签名与错误分支检查通过" };
}
for (const document of documents) document.bytes = new TextEncoder().encode(document.content).length;
const modules: ProjectModule[] = [
  { id: "agents-room", name: "协作房间", status: "in_progress", plannedStart: "2026-09-22", plannedEnd: "2026-09-27", packages: [
    { id: "room-stage", name: "需求与阶段", status: "done", plannedStart: "2026-09-22", plannedEnd: "2026-09-23", taskIds: ["task-lin-1"] },
    { id: "room-view", name: "房间页面", status: "in_progress", plannedStart: "2026-09-23", plannedEnd: "2026-09-27", taskIds: ["task-xu-1", "task-chen-3", "task-lin-2"] }
  ] },
  { id: "agents-contract", name: "接口与契约", status: "in_progress", plannedStart: "2026-09-23", plannedEnd: "2026-09-28", packages: [
    { id: "contract-model", name: "契约模型", status: "in_progress", plannedStart: "2026-09-23", plannedEnd: "2026-09-25", taskIds: ["task-chen-1"] },
    { id: "contract-handoff", name: "本地准备与交接", status: "planned", plannedStart: "2026-09-25", plannedEnd: "2026-09-28", taskIds: ["task-chen-2"] }
  ] },
  { id: "agents-work", name: "成员工作台", status: "planned", plannedStart: "2026-09-26", plannedEnd: "2026-09-30", packages: [
    { id: "work-view", name: "任务与集成视图", status: "planned", plannedStart: "2026-09-26", plannedEnd: "2026-09-30", taskIds: ["task-xu-2"] }
  ] }
];
const alignment: AlignmentRun = {
  id: "alignment-agents-1", source: "plans", status: "PUBLISHED",
  planSnapshot: [documents[0]!, documents[2]!, documents[3]!].map((item) => ({ nodeId: item.ownerNodeId, documentId: item.id, revision: item.revision, sha256: item.sha256 })),
  requirementBaseRevision: 0, alignmentMarkdown: "# 阶段需求 R1\n\n三人共用一套房间页面。队长负责发布与裁决，成员按主线完成切片。\n\n## 本轮交付\n- 提案与版本记录\n- 工作主线和接口契约\n- 任务准备与真实集成\n\n## 需关注\n房间 API 由小芋头提供，汤神在契约冻结后并行制作页面。", tasksMarkdown: "# 工作分配\n\n每人按主线顺序交付，接口依赖经双方确认后并行。",
  tasks: tasks.map((item) => ({ id: item.id, title: item.title, goal: item.goal, boundary: item.boundary, acceptance: item.acceptance,
    dependencies: item.dependencies, dependencyEdges: item.dependencyEdges ?? [], ...(item.brief ? {brief: item.brief} : {}), assigneeNodeId: item.assigneeNodeId, sourcePlanNodeIds: item.sourcePlanNodeIds })),
  executorNodeId: ids.captain, agentJobId: null, error: null, createdAt: "2026-09-22T16:50:00+08:00", completedAt: "2026-09-22T17:40:00+08:00",
  publishedStageId: "stage-agents-1", phase: "FINALIZE", issues: [], decisionRevision: 0,
  planImpacts: [
    { documentId: "plan-lin-1", moduleIds: ["agents-room", "agents-contract", "agents-work"], rationale: "包含全房间协作流程和各模块交付边界。" },
    { documentId: "plan-chen-2", moduleIds: ["agents-contract", "agents-work"], rationale: "定义契约数据与成员任务交接接口。" },
    { documentId: "plan-xu-1", moduleIds: ["agents-room", "agents-work"], rationale: "涉及房间页面及成员工作台。" }
  ], moduleRevisionSnapshot: 1
};
const stage: DevelopmentStage = {
  id: "stage-agents-1", sequence: 1, requirementRevision: 2,
  requirementMarkdown: `${alignment.alignmentMarkdown!.replace("阶段需求 R1", "阶段需求 R2")}\n\n## 已确认补充\n契约错误码按 403 与 409 区分。`, sourceAlignmentId: alignment.id, status: "ACTIVE", reviewId: null,
  createdAt: "2026-09-22T18:00:00+08:00", completedAt: null, baselineSha: sha("a")
};

const state = {
  documents, tasks, modules, alignment, stage, moduleRevision: 1, nodes, workstreams, contracts, alignments: [alignment], stages: [stage], seq: 1,
  notifications: nodes.map(n => ({ id: `notice-${n.id}`, recipientNodeId:n.id, type: "TASK" as const, title:"阶段一已发布", body:"工作主线和接口契约已就绪。请查看自己的任务。", entityId:stage.id, readAt:null, createdAt:date })) as V20BootstrapPayload["notifications"],
  pullRequests: [
    { id: "change-1", submitterNodeId: ids.chen, documentId: "change-1-doc", stageId: stage.id, baseRequirementRevision: 1,
      status: "APPLIED", reviewId: "review-1", createdAt: "2026-09-22T19:10:00+08:00", decidedAt: "2026-09-22T20:25:00+08:00" },
    { id: "change-2", submitterNodeId: ids.xu, documentId: "change-2-doc", stageId: stage.id, baseRequirementRevision: 2,
      status: "QUEUED", reviewId: null, createdAt: "2026-09-23T09:40:00+08:00", decidedAt: null }
  ] as V20BootstrapPayload["pullRequests"],
  reviews: [{ id: "review-1", stageId: stage.id, forced: true, status: "APPLIED", changeIds: ["change-1"],
    summaryMarkdown: "## 已处理：契约错误码\n\n**接受。** 只涉及契约模型和成员提示，不改房间排期。小芋头更新提供方实现后，汤神按新修订重新确认。",
    requirementPatchMarkdown: "错误码按 403 与 409 区分。", decisions: [{ changeId: "change-1", verdict: "accept", rationale: "有明确验收，影响可控制。" }],
    affectedTaskIds: ["task-chen-1", "task-xu-1"], affectedNodeIds: [ids.chen, ids.xu], replacementTasks: [], pausedTaskStates: {},
    executorNodeId: ids.captain, agentJobId: null, error: null, createdAt: "2026-09-22T19:12:00+08:00",
    completedAt: "2026-09-22T20:10:00+08:00", decidedAt: "2026-09-22T20:25:00+08:00" }] as V20BootstrapPayload["reviews"],
  withdrawnOwners: new Set<string>()
};
export type ReviewState = typeof state;
state.notifications.push({id:"notice-change-2",recipientNodeId:ids.captain,type:"CHANGE",title:"汤神提交了需求变更",body:"proposal-history-filter.md",entityId:"change-2",readAt:null,createdAt:date});
let activeRole: ReviewRole = "captain";
try {
  const stored = window.sessionStorage.getItem("vibe-git-review-role");
  if (stored && stored in ids) activeRole = stored as ReviewRole;
} catch { /* Local-file browsers may block session storage. */ }
export const getReviewRole = () => activeRole;
export function setReviewRole(role: ReviewRole) {
  activeRole = role;
  try { window.sessionStorage.setItem("vibe-git-review-role", role); } catch { /* The switch still works for this page. */ }
}
const currentPlans = () => nodes.map((member) => state.withdrawnOwners.has(member.id) ? null : state.documents.filter((item) => item.kind === "plan" && item.ownerNodeId === member.id).at(-1)).filter((item): item is MarkdownDocument => !!item);
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const failure = (message: string, status = 409) => response({ error: message }, status);

export function reviewPayload(): V20BootstrapPayload {
  const visibleNodes = nodes.filter(n => !n.revoked).map(n => {
    const running = state.tasks.filter(t => t.assigneeNodeId === n.id && !t.archived && t.activeJobId);
    return { ...n, activeJobCount: running.length, currentTaskId: running[0]?.id ?? null };
  });
  return {
    room: { id: "agents-room", requirementRevision: state.stage.requirementRevision, currentRequirementMarkdown: state.stage.requirementMarkdown, seq: state.seq },
    viewer: visibleNodes.find((item) => item.id === ids[activeRole])!, nodes: visibleNodes, plans: currentPlans(), modules: state.modules, moduleRevision: state.moduleRevision, workstreams, contracts,
    alignments: state.alignments, stages: state.stages, tasks: state.tasks, pullRequests: state.pullRequests, reviews: state.reviews,
    notifications: state.notifications.filter(n => n.recipientNodeId === ids[activeRole]), auditPool: { online: 3, available: 3, busy: 0 }, tunnel: { installed: true, running: tunnelRunning, url: "https://agents-room.invalid", phase: tunnelRunning ? "running" : "ready", version:"2026.9",logs:[],lastError:null,updatedAt:date }
  };
}


function taskMarkdown(task: StageTask): string {
 return [`# ${task.title}`, `## 正式目标\n${task.goal}`, `## 边界\n${task.boundary}`, `## 验收\n${task.acceptance.map(x=>`- ${x}`).join("\n")}`, `## 交付物\n${task.brief?.deliverables.map(x=>`- ${x}`).join("\n")}`, `## 接口与异常\n${task.brief?.interfaceNotes.join("\n")}`, `## 集成与验证\n${[...(task.brief?.integrationSteps??[]),...(task.brief?.verificationCommands??[])].join("\n")}`].join("\n\n");
}

let tunnelRunning = true;
let inviteRevision = 1;
const workspacePaths = new Map(nodes.map(n => [n.id, `D:/Projects/${n.label}/agents-room`]));
const sources = new Set<RoomEvents>();
function emitChange() {
  state.seq++;
  for (const source of sources) source.deliver(state.seq);
}
class RoomEvents extends EventTarget {
  readonly url: string;
  readonly withCredentials = true;
  readyState = 0;
  onopen: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  constructor(url: string | URL) {
    super(); this.url = String(url); sources.add(this);
    setTimeout(() => { if (this.readyState === 2) return; this.readyState = 1; this.onopen?.(new Event("open")); }, 0);
  }
  deliver(seq: number) { if (this.readyState !== 1) return; const e = new MessageEvent("message", {data:JSON.stringify({seq}), lastEventId:String(seq)}); this.onmessage?.(e); this.dispatchEvent(e); }
  close() { this.readyState = 2; sources.delete(this); }
}
export function installReviewApi() {
  window.EventSource = RoomEvents as unknown as typeof EventSource;
  initializeReviewTasks(state);
  setInterval(() => { if (advanceReviewTasks(state)) emitChange(); }, 500);
  const handle: typeof fetch = async (input, init) => {
    // Resolve application routes independently of Windows file URL drive letters.
    // This base is only a parser anchor; fixture requests never contact it.
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://vibe-git.invalid/");
    if (!url.pathname.startsWith("/api/")) return failure("此页面不访问外部服务", 404);
    const path = url.pathname;
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const viewer = nodes.find(n => n.id === ids[activeRole])!;
    const mutation = method !== "GET";
    if (viewer.revoked) return failure("当前成员已被撤销，请切换身份", 403);
    if (path.startsWith("/api/local/workspace")) {
      const current = workspacePaths.get(viewer.id)!;
      const alternate = current.endsWith("-next") ? current.slice(0,-5) : `${current}-next`;
      if (path.endsWith("/pick")) return response({path:alternate});
      if (path.endsWith("/select")) {
        if (state.tasks.some(t => t.assigneeNodeId === viewer.id && t.activeJobId)) return failure("本机仍有任务在执行，请完成后切换");
        if (![current,alternate].includes(String(body.path))) return failure("请选择有效的 Git 工作区",400);
        workspacePaths.set(viewer.id,String(body.path));
      }
      const selected = workspacePaths.get(viewer.id)!;
      return response({path:selected,name:selected.split("/").at(-1),branch:viewer.git?.branch,headSha:viewer.git?.headSha,dirty:viewer.git?.dirty,recent:[{path:current,name:current.split("/").at(-1)},{path:alternate,name:alternate.split("/").at(-1)}]});
    }
    if (path.startsWith("/api/local/codex")) return response({status:"available",rateLimits:[{label:"5 小时额度",remainingPercent:76},{label:"周额度",remainingPercent:62}]});
    if (path === "/api/v1/invite" || path === "/api/v1/invite/rotate") {
      if (activeRole !== "captain") return failure("只有队长可以邀请成员",403);
      if (mutation) inviteRevision++;
      const joinUrl = `https://agents-room.invalid/join/room-${inviteRevision}`;
      return response({joinUrl,command:`vibe-git connect ${joinUrl}`});
    }
    if (path.startsWith("/api/v1/local/cloudflare/")) {
      if (activeRole !== "captain") return failure("只有队长可以管理 Tunnel",403);
      if (path.endsWith("/stop")) tunnelRunning=false;
      if (path.endsWith("/start")) tunnelRunning=true;
      return response({installed:true,running:tunnelRunning});
    }
    const revoke = /^\/api\/v1\/nodes\/([^/]+)\/revoke$/.exec(path);
    if (revoke) { if (activeRole !== "captain") return failure("只有队长可以撤销成员",403); const n=nodes.find(n=>n.id===revoke[1]); if (!n || n.role === "captain") return failure("无法撤销该成员"); n.revoked=true; n.connected=false; return response(n); }
    const notice = /^\/api\/v1\/notifications\/([^/]+)\/read$/.exec(path);
    if (notice && mutation) { const n=state.notifications.find(n=>n.id===notice[1]); if (!n) return failure("通知不存在",404); if (n.recipientNodeId!==viewer.id) return failure("不能修改其他成员的通知",403); n.readAt ??= new Date().toISOString(); return response(n); }
    const action = reviewAction(state, viewer.id, activeRole === "captain", path, method, body);
    if (action) return action;
    if (path === "/api/v1/bootstrap") return response(reviewPayload());
    if (path === "/api/v1/plans/history") {
      const offset = Number(url.searchParams.get("offset") || 0); const limit = Number(url.searchParams.get("limit") || 50);
      const items = state.documents.filter((item) => item.kind === "plan").slice().reverse().map(({ content: _content, ...item }) => ({ ...item,
        current: currentPlans().some((plan) => plan.id === item.id), withdrawn: state.withdrawnOwners.has(item.ownerNodeId) && state.documents.filter((value) => value.ownerNodeId === item.ownerNodeId).at(-1)?.id === item.id }));
      return response({ total: items.length, items: items.slice(offset, offset + limit) });
    }
    if (path.startsWith("/api/v1/documents/")) {
      const found = state.documents.find((item) => item.id === decodeURIComponent(path.split("/").at(-1)!));
      if (found && found.kind !== "plan" && activeRole !== "captain" && found.ownerNodeId !== viewer.id) return failure("无权查看此文件",403);
      return found ? response(found) : failure("文件不存在", 404);
    }
    if (path === "/api/v1/plans" && method === "POST") {
      const mine = state.documents.filter((item) => item.kind === "plan" && item.ownerNodeId === ids[activeRole]);
      const current = currentPlans().find((item) => item.ownerNodeId === ids[activeRole]);
      if (current) return current.filename === body.filename && current.content === body.content ? response(current) : failure("已有提案，请带当前版本号更新");
      const created = proposal(`plan-${activeRole}-${Date.now()}`, ids[activeRole], String(body.filename), (mine.at(-1)?.revision ?? 0) + 1, String(body.content), new Date().toISOString());
      state.documents.push(created); state.withdrawnOwners.delete(ids[activeRole]); return response(created, 201);
    }
    const planRoute = /^\/api\/v1\/plans\/([^/]+)(?:\/(restore))?$/.exec(path);
    if (planRoute) {
      const old = state.documents.find((item) => item.id === planRoute[1]);
      if (!old) return failure("提案版本不存在", 404);
      if (old.ownerNodeId !== ids[activeRole]) return failure("只能改动自己的提案", 403);
      const latest = state.documents.filter((item) => item.kind === "plan" && item.ownerNodeId === old.ownerNodeId).at(-1);
      if (Number(body.expectedRevision) !== latest?.revision) return failure("提案已更新，请刷新后重试");
      if (method === "DELETE") { state.withdrawnOwners.add(old.ownerNodeId); return response({ withdrawn: true }); }
      const content = planRoute[2] === "restore" ? old.content : String(body.content);
      const filename = planRoute[2] === "restore" ? old.filename : String(body.filename);
      if (!planRoute[2] && latest.content === content && latest.filename === filename) return response(latest);
      const updated = proposal(`plan-${activeRole}-${Date.now()}`, ids[activeRole], filename, latest.revision + 1, content, new Date().toISOString(), planRoute[2] ? old.id : undefined);
      state.documents.push(updated); state.withdrawnOwners.delete(old.ownerNodeId); return response(updated);
    }
    if (path.startsWith("/api/v1/workstreams/") && method === "GET") {
      const stream = workstreams.find((item) => item.id === path.split("/")[4]);
      if (!stream) return failure("工作主线不存在", 404);
      if (activeRole !== "captain" && stream.ownerNodeId !== ids[activeRole]) return failure("不能查看其他成员的执行主线", 403);
      return new Response(`# ${stream.mission}\n\n${stream.boundary}\n\n${stream.taskIds.map(id => taskMarkdown(state.tasks.find(task => task.id === id)!)).join("\n\n---\n\n")}`, { headers: { "content-type": "text/markdown" } });
    }
    if (path.startsWith("/api/v1/tasks/") && path.endsWith("/detail") && method === "GET") {
      const found = state.tasks.find((item) => item.id === path.split("/")[4]);
      if (!found) return failure("工作项不存在", 404);
      if (activeRole !== "captain" && found.assigneeNodeId !== ids[activeRole]) return failure("不能查看其他成员的任务详情", 403);
      return response({ markdown: `# ${found.title}\n\n${found.goal}\n\n## 交付\n${found.brief?.deliverables.map((item) => `- ${item}`).join("\n")}` });
    }
    if (path === "/api/v1/modules" && method === "PUT") {
      if (activeRole !== "captain") return failure("只有队长可以调整排期", 403);
      if (Number(body.expectedRevision) !== state.moduleRevision) return failure("排期版本已变化，请重新载入");
      state.modules = body.items as ProjectModule[]; state.moduleRevision++; return response({ revision: state.moduleRevision, items: state.modules });
    }
    if (path === "/api/v1/pull-requests" && method === "POST") {
      if (state.stage.status !== "ACTIVE") return failure("当前阶段暂不能提交变更");
      const id = `change-${Date.now()}`;
      const content = String(body.content ?? "");
      const document: MarkdownDocument = { id: `${id}-doc`, kind: "change", ownerNodeId: ids[activeRole], entityId: id,
        filename: String(body.filename ?? "change.md"), revision: 1, sha256: digest("9"), bytes: new TextEncoder().encode(content).length,
        content, createdAt: new Date().toISOString() };
      state.documents.push(document);
      const created: V20BootstrapPayload["pullRequests"][number] = { id, submitterNodeId: ids[activeRole], documentId: document.id,
        stageId: state.stage.id, baseRequirementRevision: state.stage.requirementRevision, status: "QUEUED", reviewId: null,
        createdAt: document.createdAt, decidedAt: null };
      state.pullRequests.push(created);
      if (viewer.role !== "captain") state.notifications.push({id:`notice-${id}`,recipientNodeId:ids.captain,type:"CHANGE",title:`${viewer.label}提交了需求变更`,body:document.filename,entityId:id,readAt:null,createdAt:document.createdAt});
      return response(created, 201);
    }
    if (path === "/api/v1/reviews" && method === "POST") {
      if (activeRole !== "captain") return failure("只有队长可以发起影响审核", 403);
      if (state.stage.status !== "ACTIVE") return failure("已有审核正在进行");
      const queued = state.pullRequests.filter((item) => item.status === "QUEUED");
      if (!queued.length) return failure("当前没有待审变更");
      const id = `review-${Date.now()}`;
      const created: V20BootstrapPayload["reviews"][number] = { id, stageId: state.stage.id, forced: true,
        status: "AWAITING_CAPTAIN", changeIds: queued.map((item) => item.id),
        summaryMarkdown: "## 提案历史筛选\n\n**建议接受。** 版本记录按成员和提交时间筛选。汤神负责页面，小芋头核对版本查询权限；其余工作照常进行。队长确认后更新受影响的切片。",
        requirementPatchMarkdown: "提案历史支持成员与时间筛选，恢复仍生成新版本。",
        decisions: queued.map((item) => ({ changeId: item.id, verdict: "accept", rationale: "需求边界明确，保持历史记录不变。" })),
        affectedTaskIds: ["task-xu-1"], affectedNodeIds: [ids.xu], replacementTasks: [], pausedTaskStates: {},
        executorNodeId: ids.captain, agentJobId: null, error: null, createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), decidedAt: null };
      state.reviews.push(created);
      queued.forEach((item) => { item.status = "IN_REVIEW"; item.reviewId = id; });
      state.stage.status = "AWAITING_APPLY"; state.stage.reviewId = id;
      return response(created, 201);
    }
    const reviewRoute = /^\/api\/v1\/reviews\/([^/]+)\/(apply|reject|cancel)$/.exec(path);
    if (reviewRoute && method === "POST") {
      if (activeRole !== "captain") return failure("只有队长可以裁决审核", 403);
      const found = state.reviews.find((item) => item.id === reviewRoute[1]);
      if (!found || found.status !== "AWAITING_CAPTAIN") return failure("当前审核无法处理");
      const verdict = reviewRoute[2] === "apply" ? "APPLIED" : reviewRoute[2] === "reject" ? "REJECTED" : "CANCELLED";
      found.status = verdict; found.decidedAt = new Date().toISOString();
      state.pullRequests.filter((item) => found.changeIds.includes(item.id)).forEach((item) => {
        item.status = verdict === "APPLIED" ? "APPLIED" : verdict === "REJECTED" ? "REJECTED" : "QUEUED";
        item.decidedAt = verdict === "CANCELLED" ? null : found.decidedAt;
      });
      if (verdict === "APPLIED") {
        state.stage.requirementRevision += 1;
        state.stage.requirementMarkdown += `\n\n## 补充需求\n${found.requirementPatchMarkdown}`;
        const affected = state.tasks.find((item) => item.id === "task-xu-1");
        if (affected) { affected.status = "PUBLISHED"; affected.revision += 1; affected.startedAt = null; affected.activeJobId = null; affected.finishedAt=null; affected.doneAt=null; affected.updatedAt = found.decidedAt; }
      }
      state.stage.status = "ACTIVE"; state.stage.reviewId = null;
      return response(found);
    }
    return failure("当前操作暂无可用结果");
  };
  window.fetch = async (input, init) => {
    const result = await handle(input, init);
    if (result.ok && init?.method && init.method !== "GET") emitChange();
    return result;
  };
}
