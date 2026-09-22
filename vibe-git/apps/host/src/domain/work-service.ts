import { randomUUID } from "node:crypto";
import {
  EVENT_TYPES, TASK_TRANSITIONS,
  type AgentRunReference, type ExecutionCommand, type ExecutionLease, type ExecutionTransport, type PlanReview, type TaskStatus, type WorkUnit
} from "@vibe-git/protocol";
import { DomainServiceBase, contentHash, type MutationBase } from "./base-service.js";
import { badRequest, forbidden, invalidState, notFound, revisionConflict, unavailable } from "./errors.js";
import { buildWorkUnitPrompt } from "./execution-prompt.js";

interface ClaimInput extends MutationBase { expectedModuleRevision: number; title: string; deliverySlice: string; boundary: string; acceptanceIds: string[]; resources: string[]; dependencies: string[] }
interface PlanReviewInput extends MutationBase { expectedWorkUnitRevision: number; planHash: string; result: PlanReview["result"]; findings: PlanReview["findings"]; agentRun: AgentRunReference }
interface StatusInput extends MutationBase { expectedWorkUnitRevision: number; status: TaskStatus; note: string }

export class WorkService extends DomainServiceBase {
  claimModule(actorRaw: string | undefined, moduleId: string, input: ClaimInput) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `module:claim:${moduleId}:${actor}`, input, () => {
      const module = this.repo.getModule(moduleId); if (!module) throw notFound("模块不存在");
      if (module.revision !== input.expectedModuleRevision) throw revisionConflict("模块版本已变化", { currentRevision: module.revision });
      const existing = this.repo.listWorkUnits().find((unit) => unit.moduleId === moduleId && unit.ownerId === actor && unit.status !== "DONE");
      if (existing) return { response: existing, events: [] };
      if (!input.deliverySlice.trim() || !input.boundary.trim() || input.acceptanceIds.length === 0) throw badRequest("认领必须包含交付切片、边界和验收项");
      if (input.acceptanceIds.some((id) => !module.acceptanceIds.includes(id))) throw invalidState("WorkUnit 验收项必须属于模块契约");
      const task = this.repo.getTask(module.taskPackageId); if (!task) throw notFound("模块 TaskPackage 不存在");
      const now = new Date().toISOString();
      const unit: WorkUnit = {
        id: `WU-${actor}-${randomUUID().slice(0, 8)}`, taskId: task.id, moduleId, ownerId: actor, title: input.title,
        deliverySlice: input.deliverySlice, boundary: input.boundary, acceptanceIds: input.acceptanceIds,
        requirementBindings: task.requirementIds.map((requirementId) => ({ requirementId, revision: this.repo.getRequirement(requirementId)?.revision ?? 0 })),
        resources: input.resources, dependencies: input.dependencies, status: "PLANNING", executionStatus: "NOT_STARTED",
        revision: 1, contractRevision: task.contractRevision, accepted: true, needsReview: false, impactState: "VALID", planReviewId: null,
        reviewerId: module.integrationOwnerId, branch: null, baseSha: null, headSha: null, updatedAt: now
      };
      this.repo.putWorkUnit(unit);
      this.repo.putModule({ ...module, claimantIds: [...new Set([...module.claimantIds, actor])], revision: module.revision + 1, updatedAt: now });
      const event = this.repo.appendEvent({ type: EVENT_TYPES.MODULE_CLAIMED, actorId: actor, source: this.source(input.source), entityType: "work_unit", entityId: unit.id, payload: unit });
      return { response: unit, events: [event] };
    });
  }

  recordPlanReview(actorRaw: string | undefined, workUnitId: string, input: PlanReviewInput) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `plan-review:${workUnitId}`, input, () => {
      const unit = this.repo.getWorkUnit(workUnitId); if (!unit) throw notFound("WorkUnit 不存在");
      if (unit.revision !== input.expectedWorkUnitRevision) throw revisionConflict("WorkUnit 版本已变化", { currentRevision: unit.revision });
      if (actor !== unit.ownerId && actor !== unit.reviewerId && actor !== "A") throw forbidden("只有执行人、指定审查人或队长可提交 Plan 审查记录");
      if (!input.planHash || !input.agentRun.runId) throw badRequest("Plan 审查必须绑定 Plan 摘要和 AgentRunReference");
      if (input.result === "PASS" && input.findings.some((finding) => finding.type !== "MISSING_INFORMATION")) throw badRequest("PASS 不能同时包含越界或冲突阻断");
      const review: PlanReview = {
        id: `PLANREV-${randomUUID().slice(0, 8)}`, workUnitId, planHash: input.planHash,
        contractRevision: unit.contractRevision, result: input.result, findings: input.findings,
        agentRun: input.agentRun, createdAt: new Date().toISOString()
      };
      const updated: WorkUnit = { ...unit, planReviewId: review.id, needsReview: input.result !== "PASS", status: "PLANNING", revision: unit.revision + 1, updatedAt: new Date().toISOString() };
      this.repo.putPlanReview(review); this.repo.putWorkUnit(updated);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.PLAN_REVIEW_RECORDED, actorId: actor, source: this.source(input.source), entityType: "plan_review", entityId: review.id, payload: { review, workUnit: updated } });
      return { response: { review, workUnit: updated }, events: [event] };
    });
  }

  ready(actorRaw: string | undefined, workUnitId: string, input: MutationBase & { expectedWorkUnitRevision: number }) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `work-unit:ready:${workUnitId}`, input, () => {
      const unit = this.repo.getWorkUnit(workUnitId); if (!unit) throw notFound("WorkUnit 不存在");
      if (actor !== unit.ownerId) throw forbidden("只有 WorkUnit 执行人可以确认 Ready");
      if (unit.revision !== input.expectedWorkUnitRevision) throw revisionConflict("WorkUnit 版本已变化", { currentRevision: unit.revision });
      if (!unit.accepted || unit.needsReview || unit.impactState !== "VALID") throw invalidState("WorkUnit 未接受、待重审或影响状态无效");
      const review = unit.planReviewId ? this.repo.getPlanReview(unit.planReviewId) : undefined;
      if (!review || review.result !== "PASS" || review.contractRevision !== unit.contractRevision) throw invalidState("当前契约没有有效的 PASS PlanReview");
      if (review.agentRun.mode !== "real" || review.agentRun.capability !== "available") throw invalidState("只有已真实验证的 PlanReview 可放行 Ready；mock/replay 不能作为开工依据");
      const updated: WorkUnit = { ...unit, status: "READY", executionStatus: "NOT_STARTED", revision: unit.revision + 1, updatedAt: new Date().toISOString() };
      this.repo.putWorkUnit(updated);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.WORK_UNIT_READY, actorId: actor, source: this.source(input.source), entityType: "work_unit", entityId: unit.id, payload: updated });
      return { response: updated, events: [event] };
    });
  }

  updateStatus(actorRaw: string | undefined, workUnitId: string, input: StatusInput) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `work-unit:status:${workUnitId}`, input, () => {
      const unit = this.repo.getWorkUnit(workUnitId); if (!unit) throw notFound("WorkUnit 不存在");
      if (actor !== unit.ownerId && actor !== "A") throw forbidden("只有执行人或队长可更新 WorkUnit");
      if (unit.revision !== input.expectedWorkUnitRevision) throw revisionConflict("WorkUnit 版本已变化", { currentRevision: unit.revision });
      if (input.status === "READY") throw invalidState("READY 只能通过当前契约的 Plan 审查与 Ready 接口产生");
      if (input.status === "DONE") throw invalidState("DONE 只能通过证据复核产生");
      if (unit.needsReview && !["PLANNING", "BLOCKED"].includes(input.status)) throw invalidState("待重审 WorkUnit 只能处于 PLANNING/BLOCKED");
      const allowed = TASK_TRANSITIONS[unit.status] as readonly TaskStatus[];
      if (unit.status !== input.status && !allowed.includes(input.status)) throw invalidState(`不允许从 ${unit.status} 变为 ${input.status}`);
      const updated: WorkUnit = { ...unit, status: input.status, revision: unit.revision + 1, updatedAt: new Date().toISOString() };
      this.repo.putWorkUnit(updated);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.WORK_UNIT_STATUS_CHANGED, actorId: actor, source: this.source(input.source), entityType: "work_unit", entityId: unit.id, payload: { workUnit: updated, note: input.note } });
      return { response: updated, events: [event] };
    });
  }

  start(actorRaw: string | undefined, workUnitId: string, input: MutationBase & { expectedWorkUnitRevision: number; deviceId: string; transport?: ExecutionTransport }) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `work-unit:start:${workUnitId}`, input, () => {
      const unit = this.repo.getWorkUnit(workUnitId); if (!unit) throw notFound("WorkUnit 不存在");
      if (actor !== unit.ownerId) throw forbidden("只有 WorkUnit 执行人可以启动");
      if (unit.revision !== input.expectedWorkUnitRevision) throw revisionConflict("WorkUnit 版本已变化", { currentRevision: unit.revision });
      if (unit.status !== "READY" || unit.needsReview || unit.impactState !== "VALID") throw invalidState("WorkUnit 必须通过当前契约审查并处于 READY");
      const review = unit.planReviewId ? this.repo.getPlanReview(unit.planReviewId) : undefined;
      if (!unit.accepted || !review || review.workUnitId !== unit.id || review.result !== "PASS" || review.contractRevision !== unit.contractRevision || review.agentRun.mode !== "real" || review.agentRun.capability !== "available") {
        throw invalidState("当前契约缺少有效的真实 PlanReview，不可签发开工租约");
      }
      if (["STARTING", "RUNNING", "INTERRUPT_REQUESTED"].includes(unit.executionStatus)) throw invalidState("该 WorkUnit 当前执行代次已在启动或运行");
      const device = this.repo.getDevice(actor);
      if (!device || device.deviceId !== input.deviceId || device.relay !== "available") throw unavailable("成员 Relay 未在线或设备不匹配");
      if (device.codex !== "available") throw unavailable("该设备尚未验证 Codex 客户端或 CLI 启动能力", { codex: device.codex });
      if (device.git !== "available") throw unavailable("该设备工作区尚未验证 Git，无法形成可验收的执行证据", { git: device.git });
      const task = this.repo.getTask(unit.taskId); if (!task) throw notFound("WorkUnit 对应的 TaskPackage 不存在");
      const requirements = unit.requirementBindings.flatMap((binding) => {
        const requirement = this.repo.getRequirement(binding.requirementId);
        return requirement ? [requirement] : [];
      });
      const prompt = buildWorkUnitPrompt(unit, task, this.repo.getModule(unit.moduleId), requirements);
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const lease: ExecutionLease = {
        id: `LEASE-${randomUUID().slice(0, 8)}`, taskId: unit.taskId, workUnitId: unit.id, memberId: actor,
        deviceId: input.deviceId, taskRevision: unit.revision, requirementRevision: this.repo.requirementRevision(),
        status: "ISSUED", idempotencyKey: input.requestId, expiresAt, createdAt: new Date().toISOString()
      };
      const command: ExecutionCommand = {
        id: `COMMAND-${randomUUID().slice(0, 8)}`, kind: "START_WORK_UNIT", memberId: actor, deviceId: input.deviceId,
        taskId: unit.taskId, workUnitId: unit.id, leaseId: lease.id, decisionId: null,
        transportRequested: input.transport ?? "auto", transportUsed: null, prompt, promptHash: contentHash(prompt),
        requirementRevision: lease.requirementRevision, entityRevision: unit.revision,
        status: "QUEUED", runtimeId: null, detail: null, outputSummary: null, expiresAt,
        createdAt: lease.createdAt, claimedAt: null, startedAt: null, completedAt: null
      };
      this.repo.putLease(lease);
      this.repo.putExecutionCommand(command);
      this.repo.putWorkUnit({ ...unit, executionStatus: "STARTING", revision: unit.revision + 1, updatedAt: new Date().toISOString() });
      const events = [
        this.repo.appendEvent({ type: EVENT_TYPES.LEASE_ISSUED, actorId: actor, source: this.source(input.source), entityType: "lease", entityId: lease.id, payload: lease }),
        this.repo.appendEvent({ type: EVENT_TYPES.EXECUTION_COMMAND_QUEUED, actorId: actor, source: "system", entityType: "execution_command", entityId: command.id, payload: command })
      ];
      return { response: lease, events };
    });
  }
}
