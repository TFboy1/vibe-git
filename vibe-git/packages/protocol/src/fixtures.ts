import type {
  ConsensusRevision, DelegationPolicy, FreezePolicy, FunctionalConflict, IdeaReview,
  Member, MemberProposal, Milestone, Module, RequirementItem, RequirementRevision,
  TaskPackage, WorkUnit
} from "./types.js";

export const membersFixture: Member[] = [
  { id: "A", name: "林澈 · 队长", role: "captain", color: "#ff6b35" },
  { id: "B", name: "周屿 · Relay", role: "member", color: "#00d4aa" },
  { id: "C", name: "许墨 · Web", role: "member", color: "#4da3ff" }
];

export const requirementsFixture: RequirementItem[] = [
  {
    id: "REQ-ROOT", parentId: null, title: "AI 协作需求与任务管理",
    content: "让三名开发者围绕同一份版本化需求协作，并在代码合并前识别功能冲突。",
    acceptance: ["需求、任务与决定可追溯", "Git 仍是代码版本唯一权威"], priority: "P0", revision: 1, updatedAt: "2026-09-22T00:00:00.000Z"
  },
  {
    id: "REQ-AUTH", parentId: "REQ-ROOT", title: "注册与登录规则",
    content: "注册用户必须完成邮箱验证后才能登录。",
    acceptance: ["未验证账号不能建立登录会话", "验证状态由 Host 记录"], priority: "P0", revision: 1, updatedAt: "2026-09-22T00:00:00.000Z"
  },
  {
    id: "REQ-SYNC", parentId: "REQ-ROOT", title: "实时协作状态",
    content: "所有成员看到同一份任务状态与需求变更事件。",
    acceptance: ["写入后广播 room_seq", "重连可补收事件"], priority: "P0", revision: 1, updatedAt: "2026-09-22T00:00:00.000Z"
  },
  {
    id: "REQ-GIT", parentId: "REQ-ROOT", title: "Git 证据关联",
    content: "任务仅关联真实分支和提交 SHA，不复制 Git 对象。",
    acceptance: ["显示真实分支与 SHA", "不把 commit 等同于 DONE"], priority: "P0", revision: 1, updatedAt: "2026-09-22T00:00:00.000Z"
  }
];

export const revisionsFixture: RequirementRevision[] = [
  { revision: 1, previousRevision: null, summary: "黑客松 P0 基线", approvedBy: ["A", "B", "C"], createdAt: "2026-09-22T00:00:00.000Z", changeId: null }
];

export const tasksFixture: TaskPackage[] = [
  {
    id: "TASK-A", title: "Host 与版本化业务状态", ownerId: "A", requirementIds: ["REQ-ROOT", "REQ-SYNC"],
    goal: "建立 Host、SQLite、需求版本和开工租约。", acceptance: ["过期 revision 被拒绝", "事件序号严格递增"],
    boundary: "不实现 Git 合并；不代成员批准本机权限。", resources: ["db:business", "api:/requirements", "api:/tasks"], dependencies: [],
    status: "IN_PROGRESS", revision: 1, contractRevision: 1, requirementRevision: 1, needsReplan: false, accepted: true, updatedAt: "2026-09-22T00:00:00.000Z"
  },
  {
    id: "TASK-B", title: "Relay 与注册流程", ownerId: "B", requirementIds: ["REQ-AUTH", "REQ-GIT"],
    goal: "上报本机 Git 信号，并实现注册后会话启动逻辑。", acceptance: ["注册后立即建立登录会话", "上报真实 Git SHA"],
    boundary: "负责 Relay 和注册完成后的客户端流程。", resources: ["interface:auth-session", "git:member-b"], dependencies: ["TASK-A"],
    status: "PLANNING", revision: 1, contractRevision: 1, requirementRevision: 1, needsReplan: false, accepted: true, updatedAt: "2026-09-22T00:00:00.000Z"
  },
  {
    id: "TASK-C", title: "需求树与登录界面", ownerId: "C", requirementIds: ["REQ-AUTH", "REQ-SYNC"],
    goal: "实现需求演进视图与登录入口。", acceptance: ["只有邮箱验证通过才显示可登录状态", "任务变化实时可见"],
    boundary: "负责浏览器交互，不写 Host 鉴权规则。", resources: ["interface:auth-session", "ui:console"], dependencies: ["TASK-A"],
    status: "PLANNING", revision: 1, contractRevision: 1, requirementRevision: 1, needsReplan: false, accepted: true, updatedAt: "2026-09-22T00:00:00.000Z"
  }
];

export const modulesFixture: Module[] = [
  {
    id: "MOD-COLLAB", title: "需求协作闭环", goal: "形成可追溯需求共识并驱动多人执行。",
    requirementIds: ["REQ-ROOT", "REQ-SYNC"], claimantIds: ["A", "C"], integrationOwnerId: "A",
    taskPackageId: "TASK-A", acceptanceIds: ["AC-CONSENSUS", "AC-REALTIME"], status: "ACTIVE",
    integrationAcceptanceId: null, revision: 1, updatedAt: "2026-09-22T00:00:00.000Z"
  },
  {
    id: "MOD-AUTH", title: "注册与登录体验", goal: "统一注册后的会话和验证行为。",
    requirementIds: ["REQ-AUTH", "REQ-GIT"], claimantIds: ["B", "C"], integrationOwnerId: "C",
    taskPackageId: "TASK-B", acceptanceIds: ["AC-AUTH-SESSION", "AC-GIT-EVIDENCE"], status: "PLANNING",
    integrationAcceptanceId: null, revision: 1, updatedAt: "2026-09-22T00:00:00.000Z"
  }
];

export const workUnitsFixture: WorkUnit[] = [
  {
    id: "WU-A-HOST", taskId: "TASK-A", moduleId: "MOD-COLLAB", ownerId: "A", title: "Host 共识与版本规则",
    deliverySlice: "实现 Host 事务、共识发布与局部失效。", boundary: "不接管成员本机权限。",
    acceptanceIds: ["AC-CONSENSUS"], requirementBindings: [{ requirementId: "REQ-ROOT", revision: 1 }, { requirementId: "REQ-SYNC", revision: 1 }],
    resources: ["db:business", "api:consensus"], dependencies: [], status: "IN_PROGRESS", executionStatus: "RUNNING",
    revision: 1, contractRevision: 1, accepted: true, needsReview: false, impactState: "VALID", planReviewId: null,
    reviewerId: "A", branch: null, baseSha: null, headSha: null, updatedAt: "2026-09-22T00:00:00.000Z"
  },
  {
    id: "WU-B-AUTH", taskId: "TASK-B", moduleId: "MOD-AUTH", ownerId: "B", title: "注册会话与 Relay 切片",
    deliverySlice: "实现注册后会话行为和本机 Git 信号。", boundary: "不改浏览器需求视图。",
    acceptanceIds: ["AC-AUTH-SESSION", "AC-GIT-EVIDENCE"], requirementBindings: [{ requirementId: "REQ-AUTH", revision: 1 }, { requirementId: "REQ-GIT", revision: 1 }],
    resources: ["interface:auth-session", "git:member-b"], dependencies: ["WU-A-HOST"], status: "PLANNING", executionStatus: "NOT_STARTED",
    revision: 1, contractRevision: 1, accepted: true, needsReview: false, impactState: "VALID", planReviewId: null,
    reviewerId: "C", branch: null, baseSha: null, headSha: null, updatedAt: "2026-09-22T00:00:00.000Z"
  },
  {
    id: "WU-C-AUTH", taskId: "TASK-C", moduleId: "MOD-AUTH", ownerId: "C", title: "登录界面与需求视图切片",
    deliverySlice: "实现邮箱验证后的登录界面和需求演进展示。", boundary: "不写 Host 鉴权实现。",
    acceptanceIds: ["AC-AUTH-SESSION"], requirementBindings: [{ requirementId: "REQ-AUTH", revision: 1 }, { requirementId: "REQ-SYNC", revision: 1 }],
    resources: ["interface:auth-session", "ui:console"], dependencies: ["WU-A-HOST"], status: "PLANNING", executionStatus: "NOT_STARTED",
    revision: 1, contractRevision: 1, accepted: true, needsReview: false, impactState: "VALID", planReviewId: null,
    reviewerId: "A", branch: null, baseSha: null, headSha: null, updatedAt: "2026-09-22T00:00:00.000Z"
  }
];

export const proposalsFixture: MemberProposal[] = [
  {
    id: "PROP-A", memberId: "A", title: "完整协作闭环", content: "优先完成需求共识、实时状态和真实执行闭环。", contentHash: "fixture-prop-a",
    intent: { targetUser: "三人开发队", scenario: "48 小时黑客松", problem: "需求理解不一致导致返工", successConditions: ["端到端演示可追溯"], valueBasis: ["演示完整性"], hardConstraints: ["Git 继续管理代码"], preferences: ["实时反馈"], assumptions: ["目标客户端支持受管理执行"] },
    memberConfirmed: true, status: "SUBMITTED", revision: 1, createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z"
  },
  {
    id: "PROP-B", memberId: "B", title: "稳定优先", content: "保留共享状态和断线刷新，延期复杂实时共同编辑。", contentHash: "fixture-prop-b",
    intent: { targetUser: "三人开发队", scenario: "跨机协作", problem: "外部链路不稳定", successConditions: ["断线后可恢复状态"], valueBasis: ["稳定性"], hardConstraints: ["不伪造远程成功"], preferences: ["缩小实时能力"], assumptions: ["SSE 可通过隧道"] },
    memberConfirmed: true, status: "SUBMITTED", revision: 1, createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z"
  },
  {
    id: "PROP-C", memberId: "C", title: "可见性优先", content: "优先展示需求演进、模块状态和证据，离线编辑延后。", contentHash: "fixture-prop-c",
    intent: { targetUser: "三人开发队", scenario: "现场演示", problem: "团队不知道决定如何影响任务", successConditions: ["影响关系可见"], valueBasis: ["用户可理解性"], hardConstraints: ["不读取私人对话"], preferences: ["清晰视觉反馈"], assumptions: ["浏览器可持续连接"] },
    memberConfirmed: true, status: "SUBMITTED", revision: 1, createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z"
  }
];

export const consensusFixture: ConsensusRevision[] = [
  {
    id: "CONS-001", revision: 1, baseRequirementRevision: 1, proposalIds: ["PROP-A", "PROP-B", "PROP-C"],
    title: "黑客松 P0 团队共识候选", summary: "保留共享需求/任务状态与断线刷新，延期复杂共同编辑和长期离线。",
    candidateRequirements: [{ requirementId: "REQ-SYNC", content: "所有成员看到同一份任务状态与需求变更事件；断线后按 room_seq 恢复。", acceptance: ["写入后广播 room_seq", "重连可补收事件"] }],
    candidateHash: "fixture-consensus-v1", status: "AWAITING_CONFIRMATION", confirmations: [], decisionRecordIds: [],
    publishedRequirementRevision: null, createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z"
  }
];

export const delegationPoliciesFixture: DelegationPolicy[] = [
  {
    id: "POLICY-P0", requirementIds: ["REQ-SYNC"], allowedActions: ["DEFER", "REDUCE_DEPTH", "USE_APPROVED_ALTERNATIVE"],
    protectedConstraints: ["Git 继续管理代码", "不读取私人对话", "全员确认正式版本"], milestoneId: "MS-G0",
    maxIterations: 2, usedIterations: 0, expiresAt: "2026-09-24T00:00:00.000Z", confirmedBy: ["A", "B", "C"],
    status: "ACTIVE", revision: 1, createdAt: "2026-09-22T00:00:00.000Z"
  }
];

export const milestonesFixture: Milestone[] = [
  { id: "MS-G0", title: "目标基线确认", stage: "G0", completionConditions: ["三人确认目标和最低闭环"], completionEvidenceIds: [], freezePolicyId: "FREEZE-G0", status: "ACTIVE", revision: 1, completedBy: null, completedAt: null }
];

export const freezePoliciesFixture: FreezePolicy[] = [
  { id: "FREEZE-G0", milestoneId: "MS-G0", frozenRequirementIds: ["REQ-ROOT"], frozenModuleIds: [], protectedConstraints: ["Git 继续管理代码"], allowedImpactWithoutException: ["L0"], status: "ACTIVE", revision: 1, confirmedBy: ["A", "B", "C"], createdAt: "2026-09-22T00:00:00.000Z" }
];

export const ideaReviewsFixture: IdeaReview[] = [
  {
    id: "IDEA-REVIEW-001", memberId: "B", ideaContent: "注册后立即建立受限会话，邮箱验证后解锁完整权限。",
    ideaHash: "fixture-idea-auth", verdict: "PASS_FOR_SUBMISSION", rationale: "与当前注册目标相关，范围和验收可明确。",
    blockingIssues: [], submissionSummary: "引入受限会话，完整登录仍需邮箱验证。", affectedRequirementIds: ["REQ-AUTH"],
    affectedModuleIds: ["MOD-AUTH"], suggestedImpact: "L2", agentRun: { runId: "replay-pm-001", promptVersion: "pm-review.v1", inputHash: "fixture-idea-auth", outputHash: "fixture-pm-output", mode: "replay", capability: "unverified", createdAt: "2026-09-22T00:00:00.000Z" },
    memberAuthorizedHash: "fixture-idea-auth", revision: 1, createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z"
  }
];

export const conflictsFixture: FunctionalConflict[] = [
  {
    id: "CONFLICT-001", requirementId: "REQ-AUTH", taskIds: ["TASK-B", "TASK-C"], changeId: null,
    classification: "contradiction", statement: "注册后的会话行为互相矛盾：TASK-B 要求立即登录，TASK-C 以邮箱验证后才允许登录为验收前提。",
    evidence: ["TASK-B：注册后立即建立登录会话", "TASK-C：只有邮箱验证通过才显示可登录状态"],
    status: "OPEN", resolution: null, createdAt: "2026-09-22T00:00:00.000Z"
  }
];
