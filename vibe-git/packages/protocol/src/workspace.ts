import type { CoordinationChange } from "./coordination.js";
import type { Notification, V20BootstrapPayload, VibePullRequest } from "./v20.js";
import type { CoordinationSnapshot } from "./coordination.js";

export interface Page<T> { items: T[]; nextCursor: number | null }
export const WORKSPACE_RESOURCES = ["overview", "members", "tasks", "requirements", "changes", "notifications"] as const;
export type WorkspaceResource = typeof WORKSPACE_RESOURCES[number];
export type WorkspaceResourceData = Partial<Omit<V20BootstrapPayload, "coordination">> & { coordination?: Partial<CoordinationSnapshot> };
export interface WorkspaceResources { roomId: string; seq: number; data: WorkspaceResourceData }
export type ChangeHistoryItem = { source: "pr"; record: VibePullRequest } | { source: "change"; record: CoordinationChange };
export interface ChangeDetail {
  change: WorkspaceChange; pr?: VibePullRequest; legacy?: CoordinationChange;
  flow?: import("./agile.js").AgileFlow; review?: import("./v20.js").ImpactReviewBatch;
}

export function resourcesForEvent(type: string): WorkspaceResource[] | null {
  if (type === "job.progress") return [];
  if (type.startsWith("node.") || type.startsWith("invite.")) return type === "node.revoked" ? ["members", "tasks", "notifications"] : ["members"];
  if (type.startsWith("notification.")) return ["notifications"];
  if (type.startsWith("plan.")) return ["requirements"];
  if (type === "agile.compute") return ["members", "requirements"];
  if (type === "agile.pr_submitted" || type === "change.submitted") return ["changes", "notifications"];
  if (type.startsWith("task.") || type.startsWith("contract.")) return ["tasks", "members", "notifications"];
  if (type.startsWith("agile.") || type.startsWith("stage.") || type.startsWith("review.") || type.startsWith("coordination.") || type.startsWith("intent.") || type.startsWith("alignment.") || type.startsWith("job.")) return [...WORKSPACE_RESOURCES];
  if (type === "modules.updated") return ["overview"];
  return null;
}

export interface WorkspaceChange {
  id: string;
  stageId: string;
  reviewId: string | null;
  source: "agile_pr" | "legacy_pr" | "legacy_change";
  title: string;
  submitterNodeId: string;
  baseRequirementRevision: number;
  status: VibePullRequest["status"] | CoordinationChange["status"];
  createdAt: string;
  decidedAt: string | null;
  documentId: string | null;
  content: string | null;
}

export const CHANGE_STATUS_LABELS: Record<WorkspaceChange["status"], string> = {
  PENDING: "待审核", QUEUED: "待审核", IN_REVIEW: "审核中", APPLIED: "已采纳", REJECTED: "已退回"
};

/** Both retained workflows contribute to the same room activity. */
export function workspaceChanges(data: Pick<V20BootstrapPayload, "pullRequests" | "coordination">): WorkspaceChange[] {
  return [
    ...data.pullRequests.map(pr => ({
      id: pr.id, stageId: pr.stageId, reviewId: pr.reviewId, source: pr.flow === "agile" ? "agile_pr" as const : "legacy_pr" as const,
      title: pr.title ?? "需求变更 PR · " + pr.id.slice(-6).toUpperCase(), submitterNodeId: pr.submitterNodeId,
      baseRequirementRevision: pr.baseRequirementRevision, status: pr.status, createdAt: pr.createdAt,
      decidedAt: pr.decidedAt, documentId: pr.documentId, content: null
    })),
    ...(data.coordination?.changes ?? []).map(change => ({
      id: change.id, stageId: change.stageId, reviewId: change.reviewId ?? null, source: "legacy_change" as const, title: change.title, submitterNodeId: change.submitterNodeId,
      baseRequirementRevision: change.baseRequirementRevision, status: change.status, createdAt: change.createdAt,
      decidedAt: change.decidedAt, documentId: null, content: change.content
    }))
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export interface NotificationResource {
  kind: "change" | "task" | "plan" | "requirement";
  id: string;
  status: string;
}

/** Notification text is an event at creation time; resolve current state by identity. */
export function notificationResource(note: Notification, data: V20BootstrapPayload): NotificationResource | null {
  const change = workspaceChanges(data).find(item => item.id === note.entityId);
  if (change) return { kind: "change", id: change.id, status: CHANGE_STATUS_LABELS[change.status] };
  const task = [...data.tasks, ...(data.agile?.archivedTasks ?? [])].find(item => item.id === note.entityId);
  if (task) return { kind: "task", id: task.id, status: task.archived ? "已归档" : task.status };
  const flow = data.agile?.flows.find(item => item.id === note.entityId);
  if (flow?.kind === "review" && flow.changeSnapshot[0]) {
    const record = workspaceChanges(data).find(item => item.id === flow.changeSnapshot[0]!.id);
    return record ? { kind: "change", id: record.id, status: CHANGE_STATUS_LABELS[record.status] } : null;
  }
  const review = data.reviews.find(item => item.id === note.entityId);
  if (review) {
    const pr = data.pullRequests.find(item => item.reviewId === review.id);
    if (pr) return { kind: "change", id: pr.id, status: CHANGE_STATUS_LABELS[pr.status] };
  }
  const requirement = data.requirementVersions.find(item => item.sourceId === note.entityId);
  if (requirement) return { kind: "requirement", id: String(requirement.revision), status: "正式需求 R" + requirement.revision };
  const plan = data.plans.find(item => item.id === note.entityId || item.ownerNodeId === note.entityId);
  if (plan) return { kind: "plan", id: plan.ownerNodeId, status: "计划 v" + plan.revision };
  return null;
}
