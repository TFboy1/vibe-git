import type { AlignmentRun, GitSnapshot, InterfaceContract, StageTask } from "./v20.js";

export interface IntentDraft {
  id: string; title: string; content: string; acceptance: string[]; constraints: string;
  ownerNodeId: string; revision: number; baseRequirementRevision: number;
  createdAt: string; updatedAt: string; publishedStageId: string | null;
}
export interface QuickPlanInput {
  tasks: Array<{ key: string; title: string; goal: string; boundary: string; acceptance: string[];
    assigneeNodeId: string; dependencies: string[]; requirementRefs?: string[];
    ownedPaths?: string[]; excludedPaths?: string[];
    dependencyEdges?: Array<{ upstreamKey: string; mode: "HARD" | "CONTRACT"; contractKey: string | null; reason: string }> }>;
  contracts?: Array<{ key: string; providerTaskKey: string; consumerTaskKeys: string[];
    kind: InterfaceContract["kind"]; name: string; signature: string; behavior: string[];
    examples: string[]; errors: string[]; testCommand: string; handoff: string }>;
  issues?: string[];
}
export interface TaskReadiness {
  taskId: string; readyForOwner: boolean; canStartExternal: boolean; canStartCodex: boolean;
  reasons: string[]; codexReasons: string[]; taskRevision: number;
}
export interface TaskExecutionPackage {
  taskId: string; taskRevision: number; requirementRevision: number;
  title: string; goal: string; acceptance: string[]; boundary: string;
  requirements: string; requirementSource: "referenced" | "full_fallback";
  contracts: InterfaceContract[]; dependencies: Array<{ id: string; title: string; owner: string; status: string }>;
  ownedPaths: string[]; excludedPaths: string[]; progress: string;
  changes: string[]; nextStep: string; markdown: string;
  baselineSha?: string | null; brief?: import("./v20.js").TaskBrief;
  dependencyEdges?: StageTask["dependencyEdges"];
}

export function taskDependencyBlockers(task: Pick<StageTask, "dependencies" | "dependencyEdges">, tasks: StageTask[], contracts: InterfaceContract[]): string[] {
  return task.dependencies.flatMap(id => {
    const upstream = tasks.find(t => t.id === id);
    if (!upstream || upstream.archived) return ["依赖任务不存在或已归档：" + id];
    const edge = task.dependencyEdges?.find(e => e.upstreamTaskId === id);
    const waiting = edge?.mode !== "CONTRACT" && upstream.status !== "DONE" ? ["等待前置任务实际交付：" + upstream.title] : [];
    if (edge?.mode !== "CONTRACT" && !edge?.contractId) return waiting;
    const contract = contracts.find(c => c.id === edge.contractId);
    return contract?.status === "PUBLISHED" && contract.revision === edge.contractRevision ? waiting : [...waiting, "等待接口更新：" + (contract?.name ?? edge.contractId)];
  });
}
export interface TaskChangeContent {
  goal: string; boundary: string; acceptance: string[];
}
export interface TaskRevisionDraftInput {
  expectedRevision: number; expectedRequirementRevision: number;
  taskRevisions: Record<string, number>; taskIds: string[];
}
export interface TaskRevisionDraft {
  changeId: string; changeRevision: number; requirementRevision: number;
  taskRevisions: Record<string, number>;
  updates: Array<{ taskId: string; update: TaskChangeContent }>;
}
export function taskContentChanged(before: TaskChangeContent, after: TaskChangeContent): boolean {
  return before.goal.trim() !== after.goal.trim() || before.boundary.trim() !== after.boundary.trim() ||
    JSON.stringify(before.acceptance.map(item => item.trim())) !== JSON.stringify(after.acceptance.map(item => item.trim()));
}
export interface TaskChangeSnapshot {
  taskId: string; title: string; beforeRevision: number; afterRevision: number;
  before: TaskChangeContent; after: TaskChangeContent;
}
export interface CoordinationChange {
  suggestion?: { jobId: string; status: "QUEUED" | "READY" | "FAILED"; error: string | null; taskRevisions: Record<string, number>; findings: Array<{ taskId: string; impact: "affected" | "unaffected" | "uncertain"; reason: string; update?: TaskChangeContent | null }> };
  id: string; title: string; content: string; submitterNodeId: string; stageId: string;
  baseRequirementRevision: number; revision: number; status: "PENDING" | "IN_REVIEW" | "APPLIED" | "REJECTED";
  reviewId?: string | null;
  taskIds: string[]; contractIds: string[]; requirementRefs: string[];
  createdAt: string; decidedAt: string | null; affectedTaskIds: string[];
  taskChanges?: TaskChangeSnapshot[];
}
export interface ChangeImpact {
  changeId: string; changeRevision: number; requirementRevision: number;
  tasks: Array<{ taskId: string; title: string; revision: number; suggested: boolean; uncertain: boolean; reasons: string[] }>;
}
export interface CoordinationSnapshot {
  intents: IntentDraft[]; changes: CoordinationChange[]; readiness: Record<string, TaskReadiness>;
}
export interface ExternalTaskReport {
  expectedRevision: number; action: "progress" | "blocked" | "ready";
  summary: string; contractHashes?: Record<string, string>; headSha?: string;
}
export interface ApplyCoordinationChange {
  expectedRevision: number; expectedRequirementRevision: number;
  decisions: Array<{ taskId: string; expectedRevision: number; affected: boolean; update?: TaskChangeContent }>;
  contractUpdates?: Array<{ contractId: string; expectedRevision: number; signature: string; behavior: string[]; testCommand: string }>;
}
export type QuickAlignment = AlignmentRun & { quickIntentId: string; quickIntentRevision: number; quickPlan: QuickPlanInput };
export type ExternalEvidence = { summary: string; git: GitSnapshot; contractHashes: Record<string, string>; submittedAt: string };
