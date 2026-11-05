import type { CollaborationNode, V20BootstrapPayload, WorkspaceResource, WorkspaceResources, WorkspaceResourceData, NotificationResource, ChangeDetail } from "@vibe-git/protocol";
import { CHANGE_STATUS_LABELS, WORKSPACE_RESOURCES } from "@vibe-git/protocol";
import type { V20Repository } from "./repository.js";
import type { AgileService } from "./agile-service.js";
import type { CoordinationService } from "./coordination-service.js";
import { forbidden, notFound } from "../domain/errors.js";

export class WorkspaceReader {
  constructor(private readonly repo: V20Repository, private readonly agile: AgileService, private readonly coordination: CoordinationService,
    private readonly connection: (node: CollaborationNode) => CollaborationNode, private readonly modules: () => { revision: number; items: V20BootstrapPayload["modules"] }) {}

  snapshot(viewer: CollaborationNode, names: readonly WorkspaceResource[] = WORKSPACE_RESOURCES): WorkspaceResources {
    return this.repo.tx(() => {
      const data: WorkspaceResourceData = {}, wanted = new Set(names);
      if (wanted.has("overview")) {
        const modules = this.modules();
        data.room = { id: this.repo.room()!.id, requirementRevision: this.repo.requirementRevision(), currentRequirementMarkdown: this.repo.requirementMarkdown(), seq: this.repo.lastSeq() };
        data.modules = modules.items; data.moduleRevision = modules.revision;
      }
      if (wanted.has("members")) {
        data.nodes = this.repo.listNodes().map(node => this.connection(node)); data.viewer = this.connection(this.repo.getNode(viewer.id) ?? viewer);
        const online = data.nodes.filter(node => node.connected), available = online.filter(node => node.codex === "available");
        data.auditPool = { online: online.length, available: available.length, busy: available.filter(node => node.activeJobCount > 0).length };
      }
      if (wanted.has("tasks")) {
        data.tasks = this.repo.workspaceTasks(); data.stages = this.repo.workspaceStages();
        data.contracts = this.repo.workspaceContracts(data.tasks, data.stages); data.workstreams = this.repo.workspaceWorkstreams(data.stages);
        data.coordination = { readiness: Object.fromEntries(data.tasks.filter(task => !task.archived).map(task => [task.id, this.coordination.readiness(viewer, task, data.tasks)])) };
      }
      if (wanted.has("requirements")) {
        data.agile = this.agile.snapshot(true, true);
        data.plans = this.repo.latestPlans().filter(plan => !this.repo.getNode(plan.ownerNodeId)?.revoked && !this.repo.getMeta("v20_plan_withdrawn_" + plan.ownerNodeId));
        data.alignments = this.repo.workspaceAlignments();
        data.coordination = { ...data.coordination, intents: this.repo.workspaceIntents() };
      }
      if (wanted.has("changes")) { data.pullRequests = this.repo.workspacePullRequests(); data.coordination = { ...data.coordination, changes: this.repo.workspaceCoordinationChanges() }; }
      if (wanted.has("notifications")) data.notifications = this.repo.listNotifications(viewer.id);
      return { roomId: this.repo.room()!.id, seq: this.repo.lastSeq(), data };
    });
  }

  notification(viewer: CollaborationNode, id: string): NotificationResource | null {
    const note = this.repo.getNotification(id);
    if (!note) throw notFound("消息不存在");
    if (note.recipientNodeId !== viewer.id) throw forbidden("只能读取本人的消息");
    const entity = note.entityId;
    if (!entity) return null;
    const change = this.repo.getCoordinationChange(entity) ?? this.repo.getPullRequest(entity);
    if (change) return { kind: "change", id: entity, status: CHANGE_STATUS_LABELS[change.status] };
    const task = this.repo.getTask(entity);
    if (task) return { kind: "task", id: entity, status: task.archived ? "已归档" : task.status };
    const flow = this.repo.getAgileFlow(entity);
    if (flow?.kind === "review" && flow.changeSnapshot[0]) return { kind: "change", id: flow.changeSnapshot[0].id, status: flow.status };
    const review = this.repo.getReview(entity);
    if (review?.changeIds[0]) return { kind: "change", id: review.changeIds[0], status: review.status };
    const requirement = this.repo.requirementBySource(entity);
    if (requirement) return { kind: "requirement", id: String(requirement.revision), status: "正式需求 R" + requirement.revision };
    const plan = this.repo.getDocument(entity) ?? this.repo.latestDocument(entity, "plan", null);
    return plan?.kind === "plan" ? { kind: "plan", id: plan.ownerNodeId, status: "计划 v" + plan.revision } : null;
  }

  changeDetail(id: string): ChangeDetail {
    const pr = this.repo.getPullRequest(id), legacy = this.repo.getCoordinationChange(id);
    const reviewId = pr?.reviewId ?? legacy?.reviewId;
    const flow = reviewId ? this.repo.getAgileFlow(reviewId) : undefined, review = reviewId ? this.repo.getReview(reviewId) : undefined;
    const context = { ...(flow ? { flow } : {}), ...(review ? { review } : {}) };
    if (pr) return { ...context, pr, change: { id, stageId: pr.stageId, reviewId: pr.reviewId, source: pr.flow === "agile" ? "agile_pr" : "legacy_pr", title: pr.title ?? "需求变更", submitterNodeId: pr.submitterNodeId, baseRequirementRevision: pr.baseRequirementRevision, status: pr.status, createdAt: pr.createdAt, decidedAt: pr.decidedAt, documentId: pr.documentId, content: null } };
    if (!legacy) throw notFound("需求变更不存在");
    return { ...context, legacy, change: { ...legacy, reviewId: legacy.reviewId ?? null, source: "legacy_change", documentId: null } };
  }
}
