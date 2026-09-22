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
}

export interface CollaborationNode {
  id: string;
  label: string;
  role: NodeRole;
  revoked: boolean;
  connected: boolean;
  workspaceReady: boolean;
  auditCodex: CapabilityStateV20;
  workCodex: CapabilityStateV20;
  workTransport: WorkTransport;
  activeJobCount: number;
  rateLimits: RateLimitWindow[];
  git: GitSnapshot | null;
  currentTaskId: string | null;
  lastSeenAt: string | null;
  lastAuditJobAt: string | null;
  createdAt: string;
}

export type MarkdownKind = "plan" | "task_detail" | "change";
export interface MarkdownDocument {
  id: string;
  kind: MarkdownKind;
  ownerNodeId: string;
  entityId: string | null;
  filename: "plan.md" | "task.md" | "change.md";
  revision: number;
  sha256: string;
  bytes: number;
  content: string;
  createdAt: string;
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
}

export type AlignmentStatus = "QUEUED" | "RUNNING" | "READY" | "PUBLISHED" | "FAILED";
export interface AlignmentRun {
  id: string;
  source: "plans" | "change_review";
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
}

export type StageTaskStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "REFINING"
  | "READY"
  | "STARTING"
  | "IN_PROGRESS"
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
}

export type ImpactReviewStatus = "QUEUED" | "RUNNING" | "AWAITING_CAPTAIN" | "APPLIED" | "REJECTED" | "FAILED";
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
  pausedTaskStates: Record<string, StageTaskStatus>;
  executorNodeId: string | null;
  agentJobId: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  decidedAt: string | null;
}

export type AgentJobKind = "ALIGN_PLANS" | "REVIEW_CHANGES" | "RUN_TASK" | "INTERRUPT_TASK" | "SYNC_NODE";
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
  alignments: AlignmentRun[];
  stages: DevelopmentStage[];
  tasks: StageTask[];
  pullRequests: VibePullRequest[];
  reviews: ImpactReviewBatch[];
  notifications: Notification[];
  auditPool: AuditPoolStatus;
  tunnel: CloudflareTunnelStatus | null;
}

export interface NodeHeartbeatInput {
  workspaceReady: boolean;
  auditCodex: CapabilityStateV20;
  workCodex: CapabilityStateV20;
  workTransport: WorkTransport;
  rateLimits: RateLimitWindow[];
  git: GitSnapshot | null;
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
