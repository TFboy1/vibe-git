export const MEMBERS = ["A", "B", "C"] as const;
export type MemberId = (typeof MEMBERS)[number];
export type SubmissionSource = "manual" | "codex" | "system";
export type TaskStatus = "TODO" | "PLANNING" | "READY" | "IN_PROGRESS" | "BLOCKED" | "WAITING_REVIEW" | "DONE";
export type ExecutionStatus = "NOT_STARTED" | "STARTING" | "RUNNING" | "INTERRUPT_REQUESTED" | "INTERRUPTED" | "FINISHED" | "FAILED" | "UNKNOWN";
export type CapabilityState = "available" | "unverified" | "unsupported" | "offline";
export type ImpactLevel = "L0" | "L1" | "L2" | "L3";
export type MilestoneStage = "G0" | "G1" | "G2" | "G3";

export interface Member { id: MemberId; name: string; role: "captain" | "member"; color: string }

export interface ProjectProfile { id: string; name: string; members: Member[]; createdAt: string }
export interface InitializeProjectInput { requestId: string; name: string; memberNames: Record<MemberId, string> }

export interface AgentRunReference {
  runId: string;
  promptVersion: "pm-review.v1" | "coordinator-degrade.v1" | "plan-review.v1" | "conflict-review.v1";
  inputHash: string;
  outputHash: string;
  mode: "real" | "mock" | "replay";
  capability: CapabilityState;
  createdAt: string;
}

export interface ProjectIntent {
  targetUser: string;
  scenario: string;
  problem: string;
  successConditions: string[];
  valueBasis: string[];
  hardConstraints: string[];
  preferences: string[];
  assumptions: string[];
}

export interface MemberProposal {
  id: string;
  memberId: MemberId;
  title: string;
  content: string;
  contentHash: string;
  intent: ProjectIntent;
  memberConfirmed: boolean;
  status: "DRAFT" | "SUBMITTED" | "WITHDRAWN";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConsensusConfirmation {
  memberId: MemberId;
  candidateHash: string;
  decision: "CONFIRMED" | "OBJECTED";
  reason: string | null;
  minimumAcceptable: string | null;
  createdAt: string;
}

export interface CandidateRequirement {
  requirementId: string;
  content: string;
  acceptance: string[];
}

export interface ConsensusRevision {
  id: string;
  revision: number;
  baseRequirementRevision: number;
  proposalIds: string[];
  title: string;
  summary: string;
  candidateRequirements: CandidateRequirement[];
  candidateHash: string;
  status: "COLLECTING" | "REVISING" | "AWAITING_CONFIRMATION" | "PUBLISHED" | "SUPERSEDED" | "UNRESOLVED";
  confirmations: ConsensusConfirmation[];
  decisionRecordIds: string[];
  publishedRequirementRevision: number | null;
  createdAt: string;
  updatedAt: string;
}

export type DelegationAction = "DEFER" | "REDUCE_DEPTH" | "USE_APPROVED_ALTERNATIVE";
export interface DelegationPolicy {
  id: string;
  requirementIds: string[];
  allowedActions: DelegationAction[];
  protectedConstraints: string[];
  milestoneId: string | null;
  maxIterations: number;
  usedIterations: number;
  expiresAt: string;
  confirmedBy: MemberId[];
  status: "DRAFT" | "ACTIVE" | "EXPIRED" | "REVOKED";
  revision: number;
  createdAt: string;
}

export interface DecisionRecord {
  id: string;
  consensusId: string;
  policyId: string;
  requirementId: string;
  action: DelegationAction;
  before: string;
  after: string;
  rationale: string;
  sacrifices: string[];
  risks: string[];
  agentRun: AgentRunReference;
  createdAt: string;
}

export interface RequirementItem {
  id: string;
  parentId: string | null;
  title: string;
  content: string;
  acceptance: string[];
  acceptanceIds?: string[];
  priority: "P0" | "P1" | "P2";
  priorityRationale?: string;
  moduleId?: string;
  degradable?: boolean;
  protected?: boolean;
  revision: number;
  updatedAt: string;
}

export interface RequirementRevision {
  revision: number;
  previousRevision: number | null;
  summary: string;
  approvedBy: MemberId[];
  candidateHash?: string;
  consensusId?: string | null;
  createdAt: string;
  changeId: string | null;
}

export interface Module {
  id: string;
  title: string;
  goal: string;
  requirementIds: string[];
  claimantIds: MemberId[];
  integrationOwnerId: MemberId;
  taskPackageId: string;
  acceptanceIds: string[];
  status: "PLANNING" | "ACTIVE" | "WAITING_INTEGRATION" | "DONE" | "BLOCKED";
  integrationAcceptanceId: string | null;
  revision: number;
  updatedAt: string;
}

/** Compatibility object. New execution writes belong to WorkUnit. */
export interface TaskPackage {
  id: string;
  moduleId?: string;
  title: string;
  ownerId: MemberId;
  claimantIds?: MemberId[];
  integrationOwnerId?: MemberId;
  requirementIds: string[];
  goal: string;
  nonGoals?: string[];
  acceptance: string[];
  acceptanceIds?: string[];
  boundary: string;
  resources: string[];
  dependencies: string[];
  status: TaskStatus;
  revision: number;
  contractRevision: number;
  requirementRevision: number;
  needsReplan: boolean;
  accepted: boolean;
  updatedAt: string;
}

export interface RequirementBinding { requirementId: string; revision: number }
export interface WorkUnit {
  id: string;
  taskId: string;
  moduleId: string;
  ownerId: MemberId;
  title: string;
  deliverySlice: string;
  boundary: string;
  acceptanceIds: string[];
  requirementBindings: RequirementBinding[];
  resources: string[];
  dependencies: string[];
  status: TaskStatus;
  executionStatus: ExecutionStatus;
  revision: number;
  contractRevision: number;
  accepted: boolean;
  needsReview: boolean;
  impactState: "VALID" | "INVALIDATED" | "PENDING_IMPACT_REVIEW";
  planReviewId: string | null;
  reviewerId: MemberId;
  branch: string | null;
  baseSha: string | null;
  headSha: string | null;
  updatedAt: string;
}

export interface PlanReview {
  id: string;
  workUnitId: string;
  planHash: string;
  contractRevision: number;
  result: "PASS" | "NEEDS_REVISION" | "NEEDS_INFORMATION";
  findings: Array<{ type: "OUT_OF_SCOPE" | "CONFLICT" | "MISSING_INFORMATION"; sourceRef: string; statement: string; minimumFix: string }>;
  agentRun: AgentRunReference;
  createdAt: string;
}

export type IdeaReviewVerdict = "PASS_FOR_SUBMISSION" | "REVISE" | "DEFER" | "REJECT";
export interface IdeaReview {
  id: string;
  memberId: MemberId;
  ideaContent: string;
  ideaHash: string;
  verdict: IdeaReviewVerdict;
  rationale: string;
  blockingIssues: string[];
  submissionSummary: string | null;
  affectedRequirementIds: string[];
  affectedModuleIds: string[];
  suggestedImpact: ImpactLevel;
  agentRun: AgentRunReference;
  memberAuthorizedHash: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface IssueReport {
  id: string;
  reporterId: MemberId;
  type: "DEFECT" | "BLOCKER" | "AMBIGUITY" | "SECURITY";
  title: string;
  description: string;
  evidence: string[];
  requirementIds: string[];
  workUnitIds: string[];
  status: "OPEN" | "TRIAGED" | "RESOLVED" | "DISMISSED";
  revision: number;
  createdAt: string;
}

export interface RequirementChangeRequest {
  id: string;
  submitterId: MemberId;
  source: SubmissionSource;
  requirementId: string;
  baseRequirementRevision: number;
  oldContent: string;
  proposedContent: string;
  contentHash?: string;
  reason: string;
  affectedTaskIds: string[];
  affectedModuleIds?: string[];
  affectedWorkUnitIds?: string[];
  ideaReviewId?: string | null;
  impact: "low" | "high";
  impactLevel?: ImpactLevel;
  freezeState?: "CLEAR" | "FROZEN" | "EXCEPTION_APPROVED" | "PENDING_IMPACT_REVIEW";
  status: "OPEN" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "FROZEN";
  approvals: MemberId[];
  createdAt: string;
  decidedAt: string | null;
}

export interface FunctionalConflict {
  id: string;
  requirementId: string;
  taskIds: string[];
  workUnitIds?: string[];
  changeId: string | null;
  classification: "priority" | "value_standard" | "duplicate" | "contradiction" | "out_of_scope" | "compatible" | "insufficient";
  statement: string;
  evidence: string[];
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  resolution: string | null;
  reviewId?: string | null;
  severity?: "low" | "medium" | "high" | "critical";
  resolutionOptions?: ConflictResolutionOption[];
  createdAt: string;
}

export interface ConflictResolutionOption {
  id: string;
  title: string;
  description: string;
  tradeoffs: string[];
  requirementChanges: Array<{ requirementId: string; proposedContent: string }>;
  recommended: boolean;
}

export interface ConflictReviewFinding {
  id: string;
  classification: FunctionalConflict["classification"];
  severity: "low" | "medium" | "high" | "critical";
  statement: string;
  evidence: string[];
  affectedRequirementIds: string[];
  resolutionOptions: ConflictResolutionOption[];
}

export interface ConflictReview {
  id: string;
  targetType: "consensus" | "change" | "conflict";
  targetId: string;
  requestedBy: MemberId;
  snapshotHash: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  summary: string | null;
  findings: ConflictReviewFinding[];
  createdConflictIds: string[];
  agentRun: AgentRunReference | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CodexConnectStatus {
  state: CapabilityState;
  provider: "codex-cli" | "unavailable";
  mode: "read-only";
  detail: string;
  checkedAt: string;
}

export interface FreezePolicy {
  id: string;
  milestoneId: string;
  frozenRequirementIds: string[];
  frozenModuleIds: string[];
  protectedConstraints: string[];
  allowedImpactWithoutException: ImpactLevel[];
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED";
  revision: number;
  confirmedBy: MemberId[];
  createdAt: string;
}

export interface Milestone {
  id: string;
  title: string;
  stage: MilestoneStage;
  completionConditions: string[];
  completionEvidenceIds: string[];
  freezePolicyId: string;
  status: "PLANNED" | "ACTIVE" | "COMPLETED";
  revision: number;
  completedBy: MemberId | null;
  completedAt: string | null;
}

export interface FreezeException {
  id: string;
  changeId: string;
  policyId: string;
  reason: string;
  minimumAlternative: string;
  validationPlan: string;
  rollbackPlan: string;
  approvals: MemberId[];
  status: "OPEN" | "APPROVED" | "REJECTED";
  revision: number;
  createdAt: string;
}

export interface ExecutionDecision {
  id: string;
  workUnitId: string;
  actorId: MemberId;
  action: "PAUSE" | "ALLOW_FINISH" | "CONTINUE";
  reason: string;
  requirementRevision: number;
  expectedWorkUnitRevision: number;
  status: "REQUESTED" | "ACKNOWLEDGED" | "FAILED" | "UNKNOWN";
  relayResult: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface EvidenceItem {
  acceptanceId: string;
  verificationType: "TEST" | "COMMAND" | "MANUAL" | "SCREENSHOT" | "LOG";
  commandOrSteps: string;
  expectedResult: string;
  actualResult: string;
  passed: boolean;
  artifactRef: string | null;
}

export interface EvidenceBundle {
  id: string;
  workUnitId: string;
  submitterId: MemberId;
  contractRevision: number;
  requirementRevision: number;
  codeSha: string;
  environment: string;
  items: EvidenceItem[];
  status: "SUBMITTED" | "ACCEPTED" | "REJECTED";
  revision: number;
  createdAt: string;
}

export interface AcceptanceRecord {
  id: string;
  workUnitId: string;
  evidenceBundleId: string;
  reviewerId: MemberId;
  decision: "ACCEPT" | "REJECT";
  reason: string;
  codeSha: string;
  createdAt: string;
}

export interface GitReference {
  taskId: string;
  workUnitId?: string;
  memberId: MemberId;
  branch: string;
  baseSha: string | null;
  headSha: string | null;
  dirty: boolean;
  observedAt: string;
}

export interface DeviceSignal {
  memberId: MemberId;
  deviceId: string;
  relay: CapabilityState;
  codex: CapabilityState;
  git: CapabilityState;
  detail: string;
  executionTransports?: {
    appServer: CapabilityState;
    cli: CapabilityState;
    preferred: ExecutionTransport;
  };
  observedAt: string;
}

export type ExecutionTransport = "auto" | "app-server" | "cli";

export interface ExecutionCommand {
  id: string;
  kind: "START_WORK_UNIT" | "START_TASK" | "INTERRUPT_WORK_UNIT";
  memberId: MemberId;
  deviceId: string;
  taskId: string;
  workUnitId: string | null;
  leaseId: string | null;
  decisionId: string | null;
  transportRequested: ExecutionTransport;
  transportUsed: Exclude<ExecutionTransport, "auto"> | null;
  prompt: string | null;
  promptHash: string | null;
  requirementRevision: number;
  entityRevision: number;
  status: "QUEUED" | "CLAIMED" | "STARTED" | "COMPLETED" | "FAILED" | "INTERRUPTED" | "EXPIRED";
  runtimeId: string | null;
  detail: string | null;
  outputSummary: string | null;
  expiresAt: string;
  createdAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ExecutionLease {
  id: string;
  taskId: string;
  workUnitId?: string;
  memberId: MemberId;
  deviceId: string;
  taskRevision: number;
  requirementRevision: number;
  status: "ISSUED" | "STARTED" | "COMPLETED" | "FAILED" | "INTERRUPTED" | "EXPIRED" | "REVOKED";
  idempotencyKey: string;
  expiresAt: string;
  createdAt: string;
}

export interface RoomEvent<T = unknown> {
  seq: number;
  type: string;
  actorId: MemberId | "system";
  source: SubmissionSource;
  entityType: string;
  entityId: string;
  payload: T;
  createdAt: string;
}

export interface BootstrapPayload {
  room: { id: string; name: string; initialized: boolean; demo: boolean; requirementRevision: number; seq: number };
  members: Member[];
  requirements: RequirementItem[];
  revisions: RequirementRevision[];
  tasks: TaskPackage[];
  modules: Module[];
  workUnits: WorkUnit[];
  proposals: MemberProposal[];
  consensusRevisions: ConsensusRevision[];
  delegationPolicies: DelegationPolicy[];
  decisionRecords: DecisionRecord[];
  planReviews: PlanReview[];
  ideaReviews: IdeaReview[];
  issues: IssueReport[];
  milestones: Milestone[];
  freezePolicies: FreezePolicy[];
  executionDecisions: ExecutionDecision[];
  evidenceBundles: EvidenceBundle[];
  acceptanceRecords: AcceptanceRecord[];
  changes: RequirementChangeRequest[];
  conflicts: FunctionalConflict[];
  conflictReviews: ConflictReview[];
  connectStatus: CodexConnectStatus;
  gitReferences: GitReference[];
  devices: DeviceSignal[];
  leases: ExecutionLease[];
  executionCommands: ExecutionCommand[];
  recentEvents: RoomEvent[];
}

export type CloudflareTunnelPhase = "not_installed" | "installing" | "ready" | "starting" | "running" | "stopping" | "error";
export interface CloudflareTunnelStatus {
  phase: CloudflareTunnelPhase;
  installed: boolean;
  running: boolean;
  version: string | null;
  url: string | null;
  logs: string[];
  lastError: string | null;
  updatedAt: string;
}

export interface ApiErrorShape {
  error: string;
  code: "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "REVISION_CONFLICT" | "INVALID_STATE" | "IDEMPOTENCY_CONFLICT" | "CAPABILITY_UNAVAILABLE";
  details?: unknown;
}
