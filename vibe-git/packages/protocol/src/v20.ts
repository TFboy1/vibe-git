import type { CloudflareTunnelStatus } from "./types.js";

export type NodeRole = "captain" | "member";
export type CapabilityStateV20 = "available" | "unverified" | "unsupported" | "offline";
export type WorkTransport = "auto" | "app-server" | "cli";

export interface RateLimitWindow {
  label: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: number | null;
}

export interface GitSnapshot {
  branch: string;
  headSha: string;
  dirty: boolean;
  observedAt: string;
  fingerprint?: string;
}

export interface RepositoryContext {
  headSha: string;
  dirty: boolean;
  summary: string;
  sha256: string;
  createdAt: string;
}

export interface CollaborationNode {
  id: string;
  label: string;
  role: NodeRole;
  revoked: boolean;
  connected: boolean;
  workspaceReady: boolean;
  codex?: CapabilityStateV20;
  /** Legacy node input, read until the next unified heartbeat. */
  auditCodex?: CapabilityStateV20;
  workCodex?: CapabilityStateV20;
  workTransport: WorkTransport;
  activeJobCount: number;
  rateLimits: RateLimitWindow[];
  git: GitSnapshot | null;
  repositoryContext?: RepositoryContext | null;
  currentTaskId: string | null;
  lastSeenAt: string | null;
  lastAuditJobAt: string | null;
  createdAt: string;
}

export type MarkdownKind = "plan" | "task_detail" | "change";
export interface MarkdownDocument {
  restoredFromDocumentId?: string;
  id: string;
  kind: MarkdownKind;
  ownerNodeId: string;
  entityId: string | null;
  filename: string;
  revision: number;
  sha256: string;
  bytes: number;
  content: string;
  createdAt: string;
  impactedModuleIds?: string[];
  impactReviewed?: boolean;
}

export interface ProjectWorkPackage {
  id: string;
  name: string;
  status: "planned" | "in_progress" | "blocked" | "done";
  plannedStart: string | null;
  plannedEnd: string | null;
  taskIds: string[];
}

export interface ProjectModule {
  id: string;
  name: string;
  status: "planned" | "in_progress" | "blocked" | "done";
  plannedStart: string | null;
  plannedEnd: string | null;
  packages: ProjectWorkPackage[];
}

export interface PlanImpactPreview {
  assessmentId: string;
  suggestedModuleIds: string[];
  confirmedModuleIds: string[];
  relatedPlans: Array<{ documentId: string; ownerNodeId: string; filename: string; moduleIds: string[] }>;
  moduleRevision: number;
  unverified: boolean;
}

export interface AlignmentTaskDraft {
  id: string;
  title: string;
  goal: string;
  boundary: string;
  acceptance: string[];
  dependencies: string[];
  assigneeNodeId: string;
  sourcePlanNodeIds: string[];
  assignmentRationale?: string;
  effort?: "S" | "M" | "L";
  workstreamId?: string;
  brief?: TaskBrief;
  dependencyEdges?: DependencyEdge[];
}

export interface DependencyEdge {
  upstreamTaskId: string;
  mode: "HARD" | "CONTRACT";
  reason: string;
  contractId: string | null;
  contractRevision: number | null;
}

export interface TaskBrief {
  deliverables: string[];
  ownedPaths: string[];
  excludedPaths: string[];
  requirementRefs: string[];
  interfaceNotes: string[];
  mockStrategy: string;
  integrationSteps: string[];
  verificationCommands: string[];
  handoff: string;
}

export interface Workstream {
  id: string;
  alignmentId: string;
  stageId: string | null;
  ownerNodeId: string;
  mission: string;
  boundary: string;
  taskIds: string[];
  revision: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
}

export interface InterfaceContract {
  id: string;
  alignmentId: string;
  stageId: string | null;
  providerTaskId: string;
  consumerTaskIds: string[];
  kind: "module" | "http" | "event" | "file";
  name: string;
  signature: string;
  behavior: string[];
  examples: string[];
  errors: string[];
  testCommand: string;
  handoff: string;
  revision: number;
  sha256: string;
  acknowledgedNodeIds: string[];
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
}

export interface AlignmentIssue {
  id: string;
  title: string;
  evidence: Array<{ nodeId: string; excerpt: string }>;
  options: Array<{ id: string; label: string; impact: string }>;
  recommendedOptionId: string;
  selectedOptionId: string | null;
}

export type AlignmentStatus = "QUEUED" | "RUNNING" | "NEEDS_DECISION" | "READY" | "PUBLISHED" | "FAILED";
export interface PlanImpactFinding {
  documentId: string;
  moduleIds: string[];
  rationale: string;
}

export interface AlignmentRun {
  planImpacts?: PlanImpactFinding[];
  moduleRevisionSnapshot?: number;
  id: string;
  source: "plans" | "change_review" | "stage_replan";
  status: AlignmentStatus;
  planSnapshot: Array<{ nodeId: string; documentId: string; revision: number; sha256: string }>;
  requirementBaseRevision: number;
  alignmentMarkdown: string | null;
  tasksMarkdown: string | null;
  tasks: AlignmentTaskDraft[];
  executorNodeId: string | null;
  agentJobId: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  publishedStageId: string | null;
  phase?: "ANALYZE" | "FINALIZE";
  issues?: AlignmentIssue[];
  decisionRevision?: number;
  repositoryContext?: RepositoryContext | null;
  planBrief?: string | null;
  summaryJobIds?: string[];
  summaryParts?: Record<string, string>;
  summaryRound?: number;
  detailJobIds?: string[];
  detailedNodeIds?: string[];
  replanStageId?: string | null;
}

export type StageStatus = "ACTIVE" | "REVIEWING" | "AWAITING_APPLY" | "COMPLETED";
export interface DevelopmentStage {
  id: string;
  sequence: number;
  requirementRevision: number;
  requirementMarkdown: string;
  sourceAlignmentId: string;
  status: StageStatus;
  reviewId: string | null;
  createdAt: string;
  completedAt: string | null;
  baselineSha?: string | null;
  nextStageDraftTasks?: ReplacementTask[];
  replanRevision?: number;
}

export interface ImpactIndex {
  nodeId: string;
  headSha: string;
  fingerprint: string;
  taskIds: string[];
  changedPaths: string[];
  candidatePaths: string[];
  omittedPaths: number;
  diffSummary: string;
  createdAt: string;
}

export interface ImpactProbe {
  nodeId: string;
  headSha: string;
  fingerprint: string;
  affectedTaskIds: string[];
  unaffectedTaskIds: string[];
  uncertainTaskIds: string[];
  findings: Array<{ taskId: string; reason: string; paths: string[] }>;
  createdAt: string;
}

export type StageTaskStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "REFINING"
  | "READY"
  | "STARTING"
  | "PREPARING_MOCK"
  | "IN_PROGRESS"
  | "WAITING_INTEGRATION"
  | "WAITING_CONFIRMATION"
  | "PAUSED"
  | "BLOCKED"
  | "DONE"
  | "FAILED";

export interface StageTask {
  id: string;
  stageId: string;
  assigneeNodeId: string;
  title: string;
  goal: string;
  boundary: string;
  acceptance: string[];
  dependencies: string[];
  sourcePlanNodeIds: string[];
  status: StageTaskStatus;
  revision: number;
  detailDocumentId: string | null;
  activeJobId: string | null;
  runtimeId: string | null;
  lastGit: GitSnapshot | null;
  publishedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  doneAt: string | null;
  updatedAt: string;
  workstreamId?: string;
  brief?: TaskBrief;
  dependencyEdges?: DependencyEdge[];
  mockEvidence?: { contractHashes: Record<string, string>; verifiedAt: string; summary: string } | null;
  integrationEvidence?: { contractHashes: Record<string, string>; headSha: string; verifiedAt: string; summary: string } | null;
  blockedReason?: string | null;
  archived?: boolean;
}

export type PullRequestStatus = "QUEUED" | "IN_REVIEW" | "APPLIED" | "REJECTED";
export interface VibePullRequest {
  id: string;
  submitterNodeId: string;
  documentId: string;
  stageId: string;
  baseRequirementRevision: number;
  status: PullRequestStatus;
  reviewId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface ImpactDecision {
  changeId: string;
  verdict: "accept" | "reject";
  rationale: string;
}

export interface ReplacementTask {
  sourceTaskId: string | null;
  title: string;
  goal: string;
  boundary: string;
  acceptance: string[];
  assigneeNodeId: string;
  dependencies?: string[];
}

export interface ContractUpdate {
  contractId: string;
  changeIds: string[];
  name: string;
  signature: string;
  behavior: string[];
  examples: string[];
  errors: string[];
  testCommand: string;
  handoff: string;
}

export type ImpactReviewStatus = "QUEUED" | "RUNNING" | "NEEDS_EVIDENCE" | "AWAITING_CAPTAIN" | "APPLIED" | "REJECTED" | "FAILED" | "CANCELLED";
export interface ImpactReviewBatch {
  id: string;
  stageId: string;
  forced: boolean;
  status: ImpactReviewStatus;
  changeIds: string[];
  summaryMarkdown: string | null;
  requirementPatchMarkdown: string | null;
  decisions: ImpactDecision[];
  affectedTaskIds: string[];
  affectedNodeIds: string[];
  replacementTasks: ReplacementTask[];
  contractUpdates?: ContractUpdate[];
  pausedTaskStates: Record<string, StageTaskStatus>;
  executorNodeId: string | null;
  agentJobId: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  decidedAt: string | null;
  requirementRevisionSnapshot?: number;
  taskRevisionSnapshot?: Record<string, number>;
  taskFormalSnapshot?: Record<string, string>;
  indexes?: Record<string, ImpactIndex>;
  probes?: Record<string, ImpactProbe>;
  probeParts?: Record<string, Record<string, { status: "affected" | "unaffected" | "uncertain"; reason: string; paths: string[] }>>;
  pendingNodeIds?: string[];
  changeBrief?: string | null;
  summaryJobIds?: string[];
  summaryParts?: Record<string, string>;
  summaryRound?: number;
  summaryPurpose?: "CHANGE" | "AGGREGATE";
  aggregateBrief?: string | null;
  clearedNodeIds?: string[];
}

export type AgentJobKind = "ALIGN_PLANS" | "ALIGN_FINALIZE" | "DESCRIBE_WORKSTREAM" | "SUMMARIZE_PLAN" | "SUMMARIZE_CHANGE" | "IMPACT_INDEX" | "IMPACT_PROBE" | "REVIEW_CHANGES" | "PREPARE_MOCK" | "INTEGRATE_TASK" | "RUN_TASK" | "INTERRUPT_TASK" | "SYNC_NODE";
export type AgentJobStatus = "QUEUED" | "LEASED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export interface AgentJob {
  id: string;
  kind: AgentJobKind;
  targetNodeId: string;
  entityId: string;
  status: AgentJobStatus;
  payload: Record<string, unknown>;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  attempt: number;
  maxAttempts: number;
  runtimeId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  recipientNodeId: string;
  type: "TASK" | "CHANGE" | "REVIEW" | "SYSTEM";
  title: string;
  body: string;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditPoolStatus {
  online: number;
  available: number;
  busy: number;
}

export interface V20BootstrapPayload {
  room: {
    id: string;
    requirementRevision: number;
    currentRequirementMarkdown: string;
    seq: number;
  };
  viewer: CollaborationNode;
  nodes: CollaborationNode[];
  plans: MarkdownDocument[];
  modules: ProjectModule[];
  moduleRevision: number;
  alignments: AlignmentRun[];
  stages: DevelopmentStage[];
  tasks: StageTask[];
  workstreams: Workstream[];
  contracts: InterfaceContract[];
  pullRequests: VibePullRequest[];
  reviews: ImpactReviewBatch[];
  notifications: Notification[];
  auditPool: AuditPoolStatus;
  tunnel: CloudflareTunnelStatus | null;
}

export interface NodeHeartbeatInput {
  workspaceReady: boolean;
  codex?: CapabilityStateV20;
  /** Legacy node input, read until the next unified heartbeat. */
  auditCodex?: CapabilityStateV20;
  workCodex?: CapabilityStateV20;
  workTransport: WorkTransport;
  rateLimits: RateLimitWindow[];
  git: GitSnapshot | null;
  repositoryContext?: RepositoryContext | null;
  currentTaskId: string | null;
}

export interface JobResultInput {
  leaseToken: string;
  phase: "started" | "completed" | "failed" | "interrupted";
  runtimeId?: string | null;
  result?: unknown;
  error?: string;
}

export interface JoinResponse {
  roomId: string;
  node: CollaborationNode;
  nodeToken: string;
  hostUrl: string;
}

export interface BrowserTicketResponse { url: string; expiresAt: string }
