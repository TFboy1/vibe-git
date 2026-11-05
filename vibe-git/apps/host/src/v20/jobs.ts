import type { AgileService } from "./agile-service.js";
import type { CoordinationService } from "./coordination-service.js";
import type { TaskJobResults } from "./task-job-results.js";
import { jobFailureCode, JOB_FAILURE_CODES } from "@vibe-git/protocol";
import { badRequest, forbidden, invalidState, notFound } from "../domain/errors.js";
import { safeActivityText } from "@vibe-git/protocol";
import { newSecret } from "./runtime-secrets.js";
import { randomUUID } from "node:crypto";
import type { AgentJob, CollaborationNode, JobResultInput, RoomEvent, JobFailureCode, ImpactReviewBatch, DevelopmentStage, Notification } from "@vibe-git/protocol";
import type { V20Repository } from "./repository.js";
const now = () => new Date().toISOString();
const id = (prefix: string) => prefix + "-" + randomUUID();
const isRecent = (value: string | null) => Boolean(value && Date.now() - Date.parse(value) <= 45_000);
export const MODEL_AUDIT_KINDS = new Set<AgentJob["kind"]>(["AGILE_ANALYZE", "AGILE_DIALOGUE", "AGILE_REQUIREMENT", "AGILE_ALLOCATE", "ASSESS_CHANGE", "PLAN_INTENT", "ALIGN_PLANS", "ALIGN_FINALIZE", "DESCRIBE_WORKSTREAM", "SUMMARIZE_PLAN", "SUMMARIZE_CHANGE", "IMPACT_PROBE", "REVIEW_CHANGES"]);

const JOB_LEASE_MS = 30 * 60_000;
interface JobHooks {
  switching(): boolean;
  inviteToken(): string;
  event(type: string, actor: string, entityType: string, entityId: string, payload: unknown): RoomEvent;
  agile: AgileService; coordination: CoordinationService; tasks: TaskJobResults;
  completeAlignment(job: AgentJob, result: unknown): void;
  completeWorkstreamDetail(job: AgentJob, result: unknown): void;
  completePlanSummary(job: AgentJob, result: unknown): void;
  completeSummary(job: AgentJob, result: unknown): void;
  completeImpactIndex(job: AgentJob, result: unknown): void;
  completeImpactProbe(job: AgentJob, result: unknown): void;
  completeReview(job: AgentJob, result: unknown): void;
  resetReviewEvidence(review: ImpactReviewBatch, stage: DevelopmentStage): void;
  cancelEvidenceJobs(reviewId: string, nodeId?: string): void;
  scheduleEvidence(reviewId: string): void;
  selectAuditNode(exclude: string[], required: boolean): CollaborationNode | null;
  notifyAll(type: Notification["type"], title: string, body: string, entityId: string | null): void;
}
export class JobLifecycle {
  constructor(private readonly repo: V20Repository, private readonly hooks: JobHooks) {}
  create(kind: AgentJob["kind"], targetNodeId: string, entityId: string, payload: Record<string, unknown>, maxAttempts: number): AgentJob {
    const createdAt = now();
    if (MODEL_AUDIT_KINDS.has(kind)) {
      const node = this.repo.getNode(targetNodeId);
      if (node) this.repo.putNode({ ...node, lastAuditJobAt: createdAt });
    }
    return { id: id("JOB"), kind, targetNodeId, entityId, status: "QUEUED", payload, leaseToken: null, leaseExpiresAt: null, attempt: 1, maxAttempts, runtimeId: null, error: null, createdAt, updatedAt: createdAt };
  }

  connection(node: CollaborationNode): CollaborationNode {
    const active = this.repo.activeJobCount(node.id);
    const { auditCodex, workCodex, ...publicNode } = node;
    return { ...publicNode, codex: node.codex ?? workCodex ?? auditCodex ?? "unverified", connected: !node.revoked && isRecent(node.lastSeenAt), activeJobCount: active };
  }

  claimJob(node: CollaborationNode): AgentJob | null {
    if (this.hooks.switching()) return null;
    this.recoverExpiredJobs();
    return this.repo.tx(() => {
      const jobs = this.repo.activeJobs();
      const busyAudit = jobs.some((job) => job.targetNodeId === node.id && MODEL_AUDIT_KINDS.has(job.kind) && ["LEASED", "RUNNING"].includes(job.status));
      const queued = jobs.find((job) => job.targetNodeId === node.id && job.status === "QUEUED" && (!busyAudit || !MODEL_AUDIT_KINDS.has(job.kind)));
      if (!queued) return null;
      const leased: AgentJob = {
        ...queued, payload: { ...queued.payload, activityEnabled: true }, status: "LEASED", leaseToken: newSecret(),
        leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS).toISOString(), updatedAt: now()
      };
      this.repo.putJob(leased);
      if (leased.kind === "ASSESS_CHANGE" || leased.kind === "PLAN_INTENT" || leased.kind === "ALIGN_PLANS" || leased.kind === "ALIGN_FINALIZE" || leased.kind === "DESCRIBE_WORKSTREAM") {
        const alignment = this.repo.getAlignment(leased.entityId);
        if (alignment) this.repo.putAlignment({ ...alignment, status: "RUNNING", executorNodeId: node.id });
      } else if (leased.kind === "REVIEW_CHANGES") {
        const review = this.repo.getReview(leased.entityId);
        if (review) this.repo.putReview({ ...review, status: "RUNNING", executorNodeId: node.id });
      }
      this.hooks.event("job.leased", node.id, "agent_job", leased.id, { kind: leased.kind, entityId: leased.entityId });
      return leased;
    });
  }

  reportJob(node: CollaborationNode, jobId: string, input: JobResultInput): AgentJob {
    if (!input || typeof input !== "object") throw badRequest("缺少作业汇报内容");
    const job = this.repo.getJob(jobId); if (!job) throw notFound("作业不存在");
    if (job.targetNodeId !== node.id) throw forbidden("该作业不属于当前节点");
    if (!job.leaseToken || input.leaseToken !== job.leaseToken) throw forbidden("作业租约无效");
    if (!["LEASED", "RUNNING"].includes(job.status)) throw invalidState("作业已经结束，迟到结果已忽略");
    if (job.leaseExpiresAt && job.leaseExpiresAt < now()) throw invalidState("作业租约已过期");
    if (input.phase === "progress") {
      const activity = input.activity;
      if (!activity || typeof activity.id !== "string" || !activity.id.trim() || activity.id.length > 100 ||
        !["status", "summary", "tool", "output"].includes(activity.kind) || typeof activity.message !== "string" || !activity.message.trim() ||
        (activity.detail !== undefined && typeof activity.detail !== "string") || (activity.model !== undefined && typeof activity.model !== "string")) throw badRequest("进度事件无效");
      if (!this.repo.activityExists(job.id, activity.id)) this.hooks.event("job.progress", node.id, "agent_job", job.id, {
        activityId: activity.id, activityKind: activity.kind,
        message: safeActivityText(activity.message, [job.leaseToken, this.hooks.inviteToken()]).slice(0, 500),
        detail: safeActivityText(activity.detail ?? "", [job.leaseToken, this.hooks.inviteToken()]),
        model: safeActivityText(activity.model ?? "", [job.leaseToken, this.hooks.inviteToken()]).slice(0, 150)
      });
      return job;
    }
    if (input.errorCode !== undefined && !JOB_FAILURE_CODES.includes(input.errorCode)) throw badRequest("作业错误码无效");
    if (input.phase === "started") return this.markJobStarted(job, input.runtimeId ?? null);
    if (input.phase === "failed" || input.phase === "interrupted") return this.failJob(job, input.error ?? (input.phase === "interrupted" ? "执行已中断" : "执行失败"), input.errorCode);
    if (input.phase !== "completed") throw badRequest("作业状态无效");
    try { return this.completeJob(job, input.result); }
    catch (error) { return this.failJob(job, error instanceof Error ? error.message : String(error), jobFailureCode(error)); }
  }

  private markJobStarted(job: AgentJob, runtimeId: string | null): AgentJob {
    const updated: AgentJob = { ...job, status: "RUNNING", runtimeId, updatedAt: now() };
    this.repo.tx(() => {
      this.repo.putJob(updated);
      if (job.kind === "RUN_TASK") {
        const task = this.repo.getTask(job.entityId);
        if (task?.activeJobId === job.id && task.flow !== "agile") this.repo.putTask({ ...task,
          status: task.pauseRequested || task.status === "PAUSED" ? "PAUSED" : "IN_PROGRESS", runtimeId,
          startedAt: task.startedAt ?? now(), revision: task.revision + 1, updatedAt: now() });
      }
      this.hooks.event("job.started", job.targetNodeId, "agent_job", job.id, { runtimeId });
    });
    return updated;
  }

  private recoverExpiredJobs(): void {
    const current = now();
    const expired = this.repo.activeJobs().filter((job) => ["LEASED", "RUNNING"].includes(job.status) && job.leaseExpiresAt && job.leaseExpiresAt < current);
    for (const job of expired) this.failJob(job, "作业租约过期，迟到结果已隔离", "LEASE_EXPIRED");
  }

  private completeJob(job: AgentJob, result: unknown): AgentJob {
    const completed: AgentJob = { ...job, status: "COMPLETED", leaseToken: null, leaseExpiresAt: null, updatedAt: now(), error: null };
    this.repo.tx(() => {
      this.repo.putJob(completed);
      if (job.kind.startsWith("AGILE_")) this.hooks.agile.complete(job, result);
      else if (job.kind === "ASSESS_CHANGE") this.hooks.coordination.completeImpact(job, result);
      else if (job.kind === "PLAN_INTENT") this.hooks.coordination.completePlan(job, result);
      else if (job.kind === "INTERRUPT_TASK" && job.payload.coordinationChangeId) this.hooks.coordination.interrupted(job, result);
      else if (job.kind === "ALIGN_PLANS" || job.kind === "ALIGN_FINALIZE") this.hooks.completeAlignment(job, result);
      else if (job.kind === "DESCRIBE_WORKSTREAM") this.hooks.completeWorkstreamDetail(job, result);
      else if (job.kind === "SUMMARIZE_PLAN") this.hooks.completePlanSummary(job, result);
      else if (job.kind === "SUMMARIZE_CHANGE") this.hooks.completeSummary(job, result);
      else if (job.kind === "IMPACT_INDEX") this.hooks.completeImpactIndex(job, result);
      else if (job.kind === "IMPACT_PROBE") this.hooks.completeImpactProbe(job, result);
      else if (job.kind === "REVIEW_CHANGES") this.hooks.completeReview(job, result);
      else this.hooks.tasks.complete(job, result);
      this.hooks.event("job.completed", job.targetNodeId, "agent_job", job.id, { kind: job.kind });
    });
    return completed;
  }

  private failJob(job: AgentJob, error: string, code?: JobFailureCode): AgentJob {
    return this.repo.tx(() => {
      const result = this.applyFailure(job, error, code);
      if (result.status === "FAILED") this.hooks.event("job.failed", job.targetNodeId, "agent_job", job.id, { error: result.error, ...(code ? { errorCode: code } : {}) });
      return result;
    });
  }
  private applyFailure(job: AgentJob, error: string, code?: JobFailureCode): AgentJob {
    const safeError = safeActivityText(error, [job.leaseToken ?? "", this.hooks.inviteToken()]);
    if (job.kind.startsWith("AGILE_")) {
      const failed: AgentJob = { ...job, status: "FAILED", error: safeError, leaseToken: null, leaseExpiresAt: null, updatedAt: now() };
      this.repo.tx(() => { this.repo.putJob(failed); this.hooks.agile.fail(job, safeError);  });
      return failed;
    }
    if (job.kind === "ASSESS_CHANGE") {
      const failed: AgentJob = { ...job, status: "FAILED", error: safeError, leaseToken: null, leaseExpiresAt: null, updatedAt: now() };
      this.repo.tx(() => { this.repo.putJob(failed); this.hooks.coordination.failImpact(job, safeError);  });
      return failed;
    }
    if (job.kind === "PLAN_INTENT") {
      const failed: AgentJob = { ...job, status: "FAILED", error: safeError, leaseToken: null, leaseExpiresAt: null, updatedAt: now() };
      this.repo.tx(() => { this.repo.putJob(failed); const alignment = this.repo.getAlignment(job.entityId); if (alignment?.agentJobId === job.id) this.repo.putAlignment({ ...alignment, status: "FAILED", error: safeError });  });
      return failed;
    }
    if (job.kind === "REVIEW_CHANGES" && (code === "REVISION_CONFLICT" || code === "WORKSPACE_CHANGED" || (!code && /版本|重新取证/.test(safeError)))) {
      const failed: AgentJob = { ...job, status: "FAILED", error: safeError, leaseToken: null, leaseExpiresAt: null, updatedAt: now() };
      this.repo.putJob(failed);
      const review = this.repo.getReview(job.entityId);
      const stage = review ? this.repo.getStage(review.stageId) : undefined;
      if (review && stage) this.hooks.resetReviewEvidence(review, stage);
      return failed;
    }
    if (job.kind === "IMPACT_PROBE" && (code === "WORKSPACE_CHANGED" || code === "REVISION_CONFLICT" || (!code && /工作树|代码版本/.test(safeError)))) {
      const failed: AgentJob = { ...job, status: "FAILED", error: safeError, leaseToken: null, leaseExpiresAt: null, updatedAt: now() };
      this.repo.putJob(failed);
      const review = this.repo.getReview(job.entityId);
      if (review?.status === "NEEDS_EVIDENCE") {
        this.hooks.cancelEvidenceJobs(review.id, job.targetNodeId);
        const indexes = { ...review.indexes }; const probes = { ...review.probes }; const probeParts = { ...review.probeParts };
        delete indexes[job.targetNodeId]; delete probes[job.targetNodeId]; delete probeParts[job.targetNodeId];
        this.repo.putReview({ ...review, indexes, probes, probeParts, error: "代码版本变化，正在重新取证" });
        this.hooks.scheduleEvidence(review.id);
      }
      return failed;
    }
    if (["ALIGN_PLANS", "ALIGN_FINALIZE", "DESCRIBE_WORKSTREAM", "REVIEW_CHANGES", "SUMMARIZE_PLAN", "SUMMARIZE_CHANGE", "IMPACT_INDEX", "IMPACT_PROBE"].includes(job.kind) && job.attempt < job.maxAttempts) {
      const alternate = ["IMPACT_INDEX", "IMPACT_PROBE"].includes(job.kind) ? this.repo.getNode(job.targetNodeId) : this.hooks.selectAuditNode([job.targetNodeId], false);
      if (alternate) {
        const retried: AgentJob = {
          ...job, targetNodeId: alternate.id, status: "QUEUED", leaseToken: null, leaseExpiresAt: null,
          runtimeId: null, attempt: job.attempt + 1, error: safeError, updatedAt: now()
        };
        this.repo.tx(() => {
          this.repo.putJob(retried);
          if (job.kind === "ALIGN_PLANS" || job.kind === "ALIGN_FINALIZE" || job.kind === "DESCRIBE_WORKSTREAM") {
            const alignment = this.repo.getAlignment(job.entityId); if (alignment) this.repo.putAlignment({ ...alignment, status: "QUEUED", executorNodeId: alternate.id, error: safeError });
          } else if (job.kind === "REVIEW_CHANGES") {
            const review = this.repo.getReview(job.entityId); if (review) this.repo.putReview({ ...review, status: "QUEUED", executorNodeId: alternate.id, error: safeError });
          }
          this.hooks.event("job.retried", job.targetNodeId, "agent_job", job.id, { nextNodeId: alternate.id, attempt: retried.attempt });
        });
        return retried;
      }
    }
    const failed: AgentJob = { ...job, status: "FAILED", error: safeError, leaseToken: null, leaseExpiresAt: null, updatedAt: now() };
    this.repo.tx(() => {
      this.repo.putJob(failed);
       if (job.kind === "ALIGN_PLANS" || job.kind === "ALIGN_FINALIZE" || job.kind === "DESCRIBE_WORKSTREAM") {
        const alignment = this.repo.getAlignment(job.entityId); if (alignment) this.repo.putAlignment({ ...alignment, status: "FAILED", error: safeError, completedAt: now() });
       } else if (job.kind === "REVIEW_CHANGES") {
        const review = this.repo.getReview(job.entityId);
        if (review) {
          this.repo.putReview({ ...review, status: "FAILED", error: safeError, completedAt: now() });
          const stage = this.repo.getStage(review.stageId);
          if (stage) this.repo.putStage({ ...stage, status: "ACTIVE", reviewId: null });
          for (const changeId of review.changeIds) {
            const change = this.repo.getPullRequest(changeId);
            if (change) this.repo.putPullRequest({ ...change, status: "QUEUED", reviewId: null });
          }
          this.hooks.notifyAll("SYSTEM", "需求审核失败", `${safeError}\n变更已回到待审核队列。`, review.id);
        }
       } else if (job.kind === "SUMMARIZE_PLAN") {
         const alignment = this.repo.getAlignment(job.entityId);
         if (alignment) {
           for (const sibling of this.repo.listJobs().filter((item) => item.entityId === alignment.id && item.kind === "SUMMARIZE_PLAN" && item.id !== job.id && ["QUEUED", "LEASED", "RUNNING"].includes(item.status))) {
             this.repo.putJob({ ...sibling, status: "CANCELLED", leaseToken: null, leaseExpiresAt: null, updatedAt: now() });
           }
           this.repo.putAlignment({ ...alignment, status: "FAILED", error: safeError, completedAt: now() });
         }
       } else if (["SUMMARIZE_CHANGE", "IMPACT_INDEX", "IMPACT_PROBE"].includes(job.kind)) {
         const review = this.repo.getReview(job.entityId);
         if (review) {
           this.repo.putReview({ ...review, status: "NEEDS_EVIDENCE", error: safeError, pendingNodeIds: [...new Set([...(review.pendingNodeIds ?? []), job.targetNodeId])] });
           this.hooks.notifyAll("REVIEW", "审核等待补充证据", `${job.kind} 失败：${safeError}`, review.id);
         }
      } else this.hooks.tasks.fail(job, safeError);

    });
    return failed;
  }

}
