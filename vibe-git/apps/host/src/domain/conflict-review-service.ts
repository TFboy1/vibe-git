import { randomUUID } from "node:crypto";
import {
  EVENT_TYPES,
  type ConflictReview, type ConflictReviewFinding, type FunctionalConflict, type RoomEvent
} from "@vibe-git/protocol";
import type { ConflictReviewer, ConflictReviewSnapshot } from "../integrations/codex/connect-reviewer.js";
import { DomainServiceBase, contentHash, type MutationBase } from "./base-service.js";
import { notFound, unavailable } from "./errors.js";

export class ConflictReviewService extends DomainServiceBase {
  private readonly running = new Map<string, Promise<unknown>>();

  constructor(repo: DomainServiceBase["repo"], hub: DomainServiceBase["hub"], readonly reviewer: ConflictReviewer) {
    super(repo, hub);
  }

  recoverPending() {
    for (const review of this.repo.listConflictReviews()) {
      if (review.status === "RUNNING") {
        this.repo.putConflictReview({ ...review, status: "QUEUED", startedAt: null, error: "Host 重启后重新排队" });
      }
      if (review.status === "QUEUED" || review.status === "RUNNING") this.schedule(review.id);
    }
  }

  requestConsensusReview(actorRaw: string | undefined, consensusId: string, input: MutationBase) {
    const actor = this.member(actorRaw);
    const consensus = this.repo.getConsensusRevision(consensusId);
    if (!consensus) throw notFound("共识候选不存在");
    return this.request(actor, "consensus", consensusId, input);
  }

  requestChangeReview(actorRaw: string | undefined, changeId: string, input: MutationBase) {
    const actor = this.member(actorRaw);
    if (!this.repo.getChange(changeId)) throw notFound("变更申请不存在");
    return this.request(actor, "change", changeId, input);
  }

  requestConflictReview(actorRaw: string | undefined, conflictId: string, input: MutationBase) {
    const actor = this.member(actorRaw);
    if (!this.repo.getConflict(conflictId)) throw notFound("冲突记录不存在");
    return this.request(actor, "conflict", conflictId, input);
  }

  private request(actor: "A" | "B" | "C", targetType: ConflictReview["targetType"], targetId: string, input: MutationBase) {
    const capability = this.reviewer.status();
    if (capability.state !== "available") throw unavailable(capability.detail, capability);
    const snapshot = this.snapshot(targetType, targetId);
    const snapshotHash = contentHash(snapshot);
    const review = this.idem(actor, input.requestId, `connect-review:${targetType}:${targetId}:${snapshotHash}`, input, () => {
      const now = new Date().toISOString();
      const created: ConflictReview = {
        id: `CONNECT-${randomUUID().slice(0, 8)}`, targetType, targetId, requestedBy: actor, snapshotHash,
        status: "QUEUED", summary: null, findings: [], createdConflictIds: [], agentRun: null, error: null,
        createdAt: now, startedAt: null, completedAt: null
      };
      this.repo.putConflictReview(created);
      const event = this.repo.appendEvent({
        type: EVENT_TYPES.CONFLICT_REVIEW_QUEUED, actorId: actor, source: this.source(input.source),
        entityType: "conflict_review", entityId: created.id, payload: created
      });
      return { response: created, events: [event] };
    });
    this.schedule(review.id);
    return review;
  }

  private snapshot(targetType: ConflictReview["targetType"], targetId: string): ConflictReviewSnapshot {
    const target = targetType === "consensus"
      ? this.repo.getConsensusRevision(targetId)
      : targetType === "change"
        ? this.repo.getChange(targetId)
        : this.repo.getConflict(targetId);
    if (!target) throw notFound("审核目标不存在");
    const proposalIds = targetType === "consensus" && "proposalIds" in target ? target.proposalIds : [];
    const change = targetType === "conflict" && "changeId" in target && target.changeId ? this.repo.getChange(target.changeId) : undefined;
    const relatedRequirementIds = new Set<string>();
    if (targetType === "consensus" && "candidateRequirements" in target) target.candidateRequirements.forEach((item) => relatedRequirementIds.add(item.requirementId));
    if (targetType === "change" && "requirementId" in target) relatedRequirementIds.add(target.requirementId);
    if (targetType === "conflict" && "requirementId" in target) relatedRequirementIds.add(target.requirementId);
    if (change) relatedRequirementIds.add(change.requirementId);
    const tasks = this.repo.listTasks().filter((task) => task.requirementIds.some((id) => relatedRequirementIds.has(id)));
    const taskIds = new Set(tasks.map((task) => task.id));
    return {
      targetType, targetId, project: this.repo.getProject() ?? null,
      target: change ? { conflict: target, change } : target,
      requirements: this.repo.listRequirements().filter((item) => relatedRequirementIds.size === 0 || relatedRequirementIds.has(item.id)),
      proposals: this.repo.listProposals().filter((proposal) => proposalIds.includes(proposal.id)),
      tasks,
      workUnits: this.repo.listWorkUnits().filter((unit) => taskIds.has(unit.taskId) || unit.requirementBindings.some((binding) => relatedRequirementIds.has(binding.requirementId)))
    };
  }

  private schedule(reviewId: string) {
    if (this.running.has(reviewId)) return;
    const review = this.repo.getConflictReview(reviewId);
    if (!review || review.status !== "QUEUED") return;
    const job = this.run(reviewId).finally(() => this.running.delete(reviewId));
    this.running.set(reviewId, job);
  }

  private async run(reviewId: string) {
    const queued = this.repo.getConflictReview(reviewId);
    if (!queued || queued.status !== "QUEUED") return;
    const startedAt = new Date().toISOString();
    const running = { ...queued, status: "RUNNING" as const, startedAt };
    const startedEvent = this.repo.tx(() => {
      this.repo.putConflictReview(running);
      return this.repo.appendEvent({
        type: EVENT_TYPES.CONFLICT_REVIEW_STARTED, actorId: "system", source: "codex",
        entityType: "conflict_review", entityId: reviewId, payload: running
      });
    });
    this.publish(startedEvent);
    try {
      const snapshot = this.snapshot(running.targetType, running.targetId);
      if (contentHash(snapshot) !== running.snapshotHash) throw new Error("审核目标在运行前已变化，请重新发起审核");
      const result = await this.reviewer.review(snapshot);
      const events: RoomEvent[] = [];
      const completed = this.repo.tx(() => {
        const createdConflictIds = this.materializeFindings(running, result.findings, events, snapshot);
        const value: ConflictReview = {
          ...running, status: "COMPLETED", summary: result.summary, findings: result.findings,
          createdConflictIds, agentRun: result.agentRun, completedAt: new Date().toISOString(), error: null
        };
        this.repo.putConflictReview(value);
        events.push(this.repo.appendEvent({
          type: EVENT_TYPES.CONFLICT_REVIEW_COMPLETED, actorId: "system", source: "codex",
          entityType: "conflict_review", entityId: reviewId, payload: value
        }));
        return value;
      });
      events.forEach((event) => this.publish(event));
      return completed;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const failed: ConflictReview = { ...running, status: "FAILED", error: detail.slice(0, 4_000), completedAt: new Date().toISOString() };
      const event = this.repo.tx(() => {
        this.repo.putConflictReview(failed);
        return this.repo.appendEvent({
          type: EVENT_TYPES.CONFLICT_REVIEW_FAILED, actorId: "system", source: "codex",
          entityType: "conflict_review", entityId: reviewId, payload: failed
        });
      });
      this.publish(event);
      return failed;
    }
  }

  private materializeFindings(review: ConflictReview, findings: ConflictReviewFinding[], events: RoomEvent[], snapshot: ConflictReviewSnapshot): string[] {
    const ids: string[] = [];
    const fallbackRequirementId = (() => {
      if (snapshot.targetType === "consensus" && snapshot.target && typeof snapshot.target === "object" && "candidateRequirements" in snapshot.target) {
        const candidates = (snapshot.target as { candidateRequirements: Array<{ requirementId: string }> }).candidateRequirements;
        return candidates[0]?.requirementId;
      }
      return undefined;
    })();
    let reusedTarget = false;
    for (const finding of findings) {
      if (finding.classification === "compatible") continue;
      const requirementId = finding.affectedRequirementIds[0] ?? fallbackRequirementId ?? "UNSCOPED";
      const currentTarget: FunctionalConflict | undefined = review.targetType === "conflict" && !reusedTarget ? this.repo.getConflict(review.targetId) : undefined;
      const conflict: FunctionalConflict = currentTarget
        ? {
            ...currentTarget, classification: finding.classification, statement: finding.statement,
            evidence: finding.evidence, reviewId: review.id, severity: finding.severity,
            resolutionOptions: finding.resolutionOptions
          }
        : {
            id: `CONFLICT-${randomUUID().slice(0, 8)}`, requirementId, taskIds: [], workUnitIds: [], changeId: review.targetType === "change" ? review.targetId : null,
            classification: finding.classification, statement: finding.statement, evidence: finding.evidence,
            status: "OPEN", resolution: null, reviewId: review.id, severity: finding.severity,
            resolutionOptions: finding.resolutionOptions, createdAt: new Date().toISOString()
          };
      reusedTarget = Boolean(currentTarget);
      this.repo.putConflict(conflict);
      ids.push(conflict.id);
      events.push(this.repo.appendEvent({
        type: EVENT_TYPES.CONFLICT_CREATED, actorId: "system", source: "codex",
        entityType: "conflict", entityId: conflict.id, payload: conflict
      }));
    }
    return ids;
  }

  async close() {
    await this.reviewer.close();
    await Promise.allSettled(this.running.values());
  }
}
