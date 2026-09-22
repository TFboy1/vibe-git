import { randomUUID } from "node:crypto";
import {
  EVENT_TYPES,
  type AcceptanceRecord, type AgentRunReference, type EvidenceBundle, type EvidenceItem,
  type ExecutionCommand, type ExecutionDecision, type FreezeException, type IdeaReview, type ImpactLevel, type IssueReport
} from "@vibe-git/protocol";
import { DomainServiceBase, contentHash, type MutationBase } from "./base-service.js";
import { badRequest, forbidden, invalidState, notFound, revisionConflict } from "./errors.js";

interface IdeaReviewInput extends MutationBase {
  ideaContent: string; verdict: IdeaReview["verdict"]; rationale: string; blockingIssues: string[];
  submissionSummary?: string; affectedRequirementIds: string[]; affectedModuleIds: string[];
  suggestedImpact: ImpactLevel; agentRun: AgentRunReference; memberAuthorized: boolean;
}
interface GovernedChangeInput extends MutationBase {
  ideaReviewId: string; requirementId: string; expectedRequirementRevision: number;
  proposedContent: string; reason: string; impactLevel: ImpactLevel;
}
interface EvidenceInput extends MutationBase {
  expectedWorkUnitRevision: number; contractRevision: number; requirementRevision: number;
  codeSha: string; environment: string; items: EvidenceItem[];
}

export class GovernanceService extends DomainServiceBase {
  recordIdeaReview(actorRaw: string | undefined, input: IdeaReviewInput) {
    const actor = this.member(actorRaw);
    if (!input.ideaContent.trim() || !input.rationale.trim() || !input.agentRun.runId) throw badRequest("IdeaReview 缺少内容、理由或 AgentRunReference");
    const ideaHash = contentHash(input.ideaContent.trim());
    if (input.verdict === "PASS_FOR_SUBMISSION" && !input.submissionSummary?.trim()) throw badRequest("PASS 必须提供 submissionSummary");
    return this.idem(actor, input.requestId, `idea-review:${actor}:${ideaHash}`, input, () => {
      const now = new Date().toISOString();
      const review: IdeaReview = {
        id: `IDEA-${randomUUID().slice(0, 8)}`, memberId: actor, ideaContent: input.ideaContent.trim(), ideaHash,
        verdict: input.verdict, rationale: input.rationale, blockingIssues: input.blockingIssues,
        submissionSummary: input.submissionSummary?.trim() || null, affectedRequirementIds: input.affectedRequirementIds,
        affectedModuleIds: input.affectedModuleIds, suggestedImpact: input.suggestedImpact, agentRun: input.agentRun,
        memberAuthorizedHash: input.memberAuthorized ? ideaHash : null, revision: 1, createdAt: now, updatedAt: now
      };
      this.repo.putIdeaReview(review);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.IDEA_REVIEW_RECORDED, actorId: actor, source: this.source(input.source), entityType: "idea_review", entityId: review.id, payload: review });
      return { response: review, events: [event] };
    });
  }

  createGovernedChange(actorRaw: string | undefined, input: GovernedChangeInput) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `governed-change:${input.ideaReviewId}`, input, () => {
      const review = this.repo.getIdeaReview(input.ideaReviewId); if (!review) throw notFound("IdeaReview 不存在");
      if (review.memberId !== actor) throw forbidden("只能提交本人已审查并授权的创意");
      if (review.verdict !== "PASS_FOR_SUBMISSION") throw invalidState("普通创意未通过 PM 审查");
      if (review.agentRun.mode !== "real" || review.agentRun.capability !== "available") throw invalidState("只有已真实验证的个人 Agent PM 审查可放行普通创意；mock/replay 不能作为上报依据");
      if (!review.memberAuthorizedHash || review.memberAuthorizedHash !== review.ideaHash) throw invalidState("本人提交授权缺失或已失效");
      if (review.ideaHash !== contentHash(input.proposedContent.trim())) throw revisionConflict("拟提交内容与 PM 审查/授权摘要不一致");
      if (!review.affectedRequirementIds.includes(input.requirementId)) throw invalidState("目标需求不在 PM 审查影响范围内");
      const currentRevision = this.repo.requirementRevision();
      if (input.expectedRequirementRevision !== currentRevision) throw revisionConflict("需求版本已变化", { currentRevision });
      const requirement = this.repo.getRequirement(input.requirementId); if (!requirement) throw notFound("目标需求不存在");
      const frozen = this.repo.listFreezePolicies().find((policy) => policy.status === "ACTIVE" && (policy.frozenRequirementIds.includes(input.requirementId) || review.affectedModuleIds.some((id) => policy.frozenModuleIds.includes(id))));
      const freezeBlocked = Boolean(frozen && !frozen!.allowedImpactWithoutException.includes(input.impactLevel));
      const linkedTasks = this.repo.listTasks().filter((task) => task.requirementIds.includes(input.requirementId));
      const linkedUnits = this.repo.listWorkUnits().filter((unit) => unit.requirementBindings.some((binding) => binding.requirementId === input.requirementId));
      const now = new Date().toISOString();
      const change = {
        id: `CHG-${randomUUID().slice(0, 8)}`, submitterId: actor, source: this.source(input.source), requirementId: input.requirementId,
        baseRequirementRevision: currentRevision, oldContent: requirement.content, proposedContent: input.proposedContent.trim(),
        contentHash: review.ideaHash, reason: input.reason, affectedTaskIds: linkedTasks.map((task) => task.id),
        affectedModuleIds: review.affectedModuleIds, affectedWorkUnitIds: linkedUnits.map((unit) => unit.id), ideaReviewId: review.id,
        impact: ["L2", "L3"].includes(input.impactLevel) ? "high" as const : "low" as const, impactLevel: input.impactLevel,
        freezeState: freezeBlocked ? "FROZEN" as const : "CLEAR" as const,
        status: freezeBlocked ? "FROZEN" as const : "OPEN" as const, approvals: [], createdAt: now, decidedAt: null
      };
      this.repo.putChange(change);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.CHANGE_CREATED, actorId: actor, source: this.source(input.source), entityType: "change", entityId: change.id, payload: change });
      return { response: change, events: [event] };
    });
  }

  reportIssue(actorRaw: string | undefined, input: MutationBase & { type: IssueReport["type"]; title: string; description: string; evidence: string[]; requirementIds: string[]; workUnitIds: string[] }) {
    const actor = this.member(actorRaw);
    if (!input.title.trim() || !input.description.trim()) throw badRequest("Issue 标题和描述不能为空");
    return this.idem(actor, input.requestId, `issue:${actor}:${contentHash([input.title, input.description])}`, input, () => {
      const issue: IssueReport = {
        id: `ISSUE-${randomUUID().slice(0, 8)}`, reporterId: actor, type: input.type, title: input.title,
        description: input.description, evidence: input.evidence, requirementIds: input.requirementIds,
        workUnitIds: input.workUnitIds, status: "OPEN", revision: 1, createdAt: new Date().toISOString()
      };
      this.repo.putIssue(issue);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.ISSUE_REPORTED, actorId: actor, source: this.source(input.source), entityType: "issue", entityId: issue.id, payload: issue });
      return { response: issue, events: [event] };
    });
  }

  createFreezeException(actorRaw: string | undefined, input: MutationBase & { changeId: string; policyId: string; reason: string; minimumAlternative: string; validationPlan: string; rollbackPlan: string }) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `freeze-exception:${input.changeId}`, input, () => {
      const change = this.repo.getChange(input.changeId); if (!change) throw notFound("变更申请不存在");
      const policy = this.repo.getFreezePolicy(input.policyId); if (!policy || policy.status !== "ACTIVE") throw notFound("活动 FreezePolicy 不存在");
      if (change.status !== "FROZEN" || change.freezeState !== "FROZEN") throw invalidState("只有被冻结的变更可以申请例外");
      const exception: FreezeException = {
        id: `FREEZE-EX-${randomUUID().slice(0, 8)}`, changeId: change.id, policyId: policy.id,
        reason: input.reason, minimumAlternative: input.minimumAlternative, validationPlan: input.validationPlan,
        rollbackPlan: input.rollbackPlan, approvals: [], status: "OPEN", revision: 1, createdAt: new Date().toISOString()
      };
      this.repo.putFreezeException(exception);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.FREEZE_EXCEPTION_CREATED, actorId: actor, source: this.source(input.source), entityType: "freeze_exception", entityId: exception.id, payload: exception });
      return { response: exception, events: [event] };
    });
  }

  decideFreezeException(actorRaw: string | undefined, exceptionId: string, input: MutationBase & { expectedRevision: number; decision: "APPROVE" | "REJECT" }) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `freeze-exception:decision:${exceptionId}:${actor}`, input, () => {
      const exception = this.repo.getFreezeException(exceptionId); if (!exception) throw notFound("FreezeException 不存在");
      if (exception.revision !== input.expectedRevision) throw revisionConflict("FreezeException 版本已变化", { currentRevision: exception.revision });
      if (exception.status !== "OPEN") throw invalidState("FreezeException 已结束");
      const approvals = input.decision === "APPROVE" ? [...new Set([...exception.approvals, actor])] : exception.approvals;
      const rejected = input.decision === "REJECT";
      const approved = approvals.length === 3;
      const updated: FreezeException = { ...exception, approvals, status: rejected ? "REJECTED" : approved ? "APPROVED" : "OPEN", revision: exception.revision + 1 };
      this.repo.putFreezeException(updated);
      if (approved) {
        const change = this.repo.getChange(exception.changeId);
        if (change) this.repo.putChange({ ...change, freezeState: "EXCEPTION_APPROVED", status: "OPEN" });
      }
      const event = this.repo.appendEvent({ type: EVENT_TYPES.FREEZE_EXCEPTION_DECIDED, actorId: actor, source: this.source(input.source), entityType: "freeze_exception", entityId: exception.id, payload: updated });
      return { response: updated, events: [event] };
    });
  }

  completeModule(actorRaw: string | undefined, moduleId: string, input: MutationBase & { expectedModuleRevision: number; integrationAcceptanceId: string; evidenceBundleIds: string[]; codeShas: string[] }) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `module:complete:${moduleId}`, input, () => {
      const module = this.repo.getModule(moduleId); if (!module) throw notFound("模块不存在");
      if (module.revision !== input.expectedModuleRevision) throw revisionConflict("模块版本已变化", { currentRevision: module.revision });
      if (actor !== module.integrationOwnerId && actor !== "A") throw forbidden("只有模块集成联系人或队长可完成模块验收");
      const units = this.repo.listWorkUnits().filter((unit) => unit.moduleId === module.id);
      if (!units.length || units.some((unit) => unit.status !== "DONE")) throw invalidState("所有必需 WorkUnit 完成后才能做模块集成验收");
      if (!input.integrationAcceptanceId.trim() || input.evidenceBundleIds.length === 0 || input.codeShas.length !== units.length) throw badRequest("模块验收必须绑定集成验收项、证据和每个 WorkUnit 的 SHA");
      const acceptedEvidence = this.repo.listEvidenceBundles().filter((evidence) => input.evidenceBundleIds.includes(evidence.id) && evidence.status === "ACCEPTED");
      if (acceptedEvidence.length !== input.evidenceBundleIds.length) throw invalidState("模块验收引用了未通过的证据");
      const updated = { ...module, status: "DONE" as const, integrationAcceptanceId: input.integrationAcceptanceId, revision: module.revision + 1, updatedAt: new Date().toISOString() };
      this.repo.putModule(updated);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.MODULE_ACCEPTED, actorId: actor, source: this.source(input.source), entityType: "module", entityId: module.id, payload: { module: updated, evidenceBundleIds: input.evidenceBundleIds, codeShas: input.codeShas } });
      return { response: updated, events: [event] };
    });
  }

  createExecutionDecision(actorRaw: string | undefined, workUnitId: string, input: MutationBase & { action: ExecutionDecision["action"]; reason: string; expectedWorkUnitRevision: number }) {
    const actor = this.captain(actorRaw);
    return this.idem(actor, input.requestId, `execution-decision:${workUnitId}`, input, () => {
      const unit = this.repo.getWorkUnit(workUnitId); if (!unit) throw notFound("WorkUnit 不存在");
      if (unit.revision !== input.expectedWorkUnitRevision) throw revisionConflict("WorkUnit 版本已变化", { currentRevision: unit.revision });
      const decision: ExecutionDecision = {
        id: `EXEC-${randomUUID().slice(0, 8)}`, workUnitId, actorId: actor, action: input.action, reason: input.reason,
        requirementRevision: this.repo.requirementRevision(), expectedWorkUnitRevision: unit.revision,
        status: input.action === "PAUSE" ? "REQUESTED" : "ACKNOWLEDGED", relayResult: input.action === "PAUSE" ? null : "无需中断回执",
        createdAt: new Date().toISOString(), acknowledgedAt: input.action === "PAUSE" ? null : new Date().toISOString()
      };
      this.repo.putExecutionDecision(decision);
      const updated = input.action === "PAUSE"
        ? { ...unit, status: "BLOCKED" as const, needsReview: true, executionStatus: "INTERRUPT_REQUESTED" as const, revision: unit.revision + 1, updatedAt: new Date().toISOString() }
        : unit;
      if (input.action === "PAUSE") this.repo.putWorkUnit(updated);
      const events = [this.repo.appendEvent({ type: EVENT_TYPES.EXECUTION_DECISION_CREATED, actorId: actor, source: this.source(input.source), entityType: "execution_decision", entityId: decision.id, payload: { decision, workUnit: updated } })];
      if (input.action === "PAUSE") {
        const active = this.repo.listExecutionCommands().find((command) => command.workUnitId === unit.id && command.kind === "START_WORK_UNIT" && ["CLAIMED", "STARTED"].includes(command.status));
        const device = this.repo.getDevice(unit.ownerId);
        if (active && device?.relay === "available") {
          const now = new Date().toISOString();
          const command: ExecutionCommand = {
            id: `COMMAND-${randomUUID().slice(0, 8)}`, kind: "INTERRUPT_WORK_UNIT", memberId: unit.ownerId,
            deviceId: active.deviceId, taskId: unit.taskId, workUnitId: unit.id, leaseId: active.leaseId,
            decisionId: decision.id, transportRequested: active.transportUsed ?? active.transportRequested,
            transportUsed: null, prompt: null, promptHash: null, requirementRevision: this.repo.requirementRevision(),
            entityRevision: updated.revision, status: "QUEUED", runtimeId: active.runtimeId, detail: input.reason,
            outputSummary: null, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), createdAt: now,
            claimedAt: null, startedAt: null, completedAt: null
          };
          this.repo.putExecutionCommand(command);
          events.push(this.repo.appendEvent({ type: EVENT_TYPES.EXECUTION_COMMAND_QUEUED, actorId: actor, source: "system", entityType: "execution_command", entityId: command.id, payload: command }));
        }
      }
      return { response: { decision, workUnit: updated }, events };
    });
  }

  acknowledgeExecution(actorRaw: string | undefined, decisionId: string, input: MutationBase & { result: "INTERRUPTED" | "FAILED" | "UNKNOWN"; detail: string }) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `execution-ack:${decisionId}`, input, () => {
      const decision = this.repo.getExecutionDecision(decisionId); if (!decision) throw notFound("ExecutionDecision 不存在");
      const unit = this.repo.getWorkUnit(decision.workUnitId); if (!unit) throw notFound("WorkUnit 不存在");
      if (actor !== unit.ownerId) throw forbidden("只有目标 WorkUnit 的成员 Relay 可以确认中断结果");
      if (decision.status !== "REQUESTED") throw invalidState("该调度请求不等待回执");
      const updatedDecision: ExecutionDecision = {
        ...decision, status: input.result === "INTERRUPTED" ? "ACKNOWLEDGED" : input.result,
        relayResult: input.detail, acknowledgedAt: new Date().toISOString()
      };
      const updatedUnit = { ...unit, executionStatus: input.result, revision: unit.revision + 1, updatedAt: new Date().toISOString() };
      this.repo.putExecutionDecision(updatedDecision); this.repo.putWorkUnit(updatedUnit);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.EXECUTION_DECISION_ACKNOWLEDGED, actorId: actor, source: this.source(input.source), entityType: "execution_decision", entityId: decision.id, payload: { decision: updatedDecision, workUnit: updatedUnit } });
      return { response: { decision: updatedDecision, workUnit: updatedUnit }, events: [event] };
    });
  }

  submitEvidence(actorRaw: string | undefined, workUnitId: string, input: EvidenceInput) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `evidence:${workUnitId}`, input, () => {
      const unit = this.repo.getWorkUnit(workUnitId); if (!unit) throw notFound("WorkUnit 不存在");
      if (actor !== unit.ownerId) throw forbidden("只有 WorkUnit 执行人可以提交证据");
      if (unit.revision !== input.expectedWorkUnitRevision) throw revisionConflict("WorkUnit 版本已变化", { currentRevision: unit.revision });
      if (unit.contractRevision !== input.contractRevision || input.requirementRevision !== this.repo.requirementRevision()) throw revisionConflict("证据绑定的契约或需求版本已过期");
      if (!/^[0-9a-f]{40}$/i.test(input.codeSha)) throw badRequest("证据必须绑定完整 40 位 Git SHA");
      const covered = new Set(input.items.filter((item) => item.passed && item.commandOrSteps.trim() && item.actualResult.trim()).map((item) => item.acceptanceId));
      const missing = unit.acceptanceIds.filter((id) => !covered.has(id));
      if (missing.length) throw invalidState("证据未覆盖全部必需验收项", { missingAcceptanceIds: missing });
      const git = this.repo.listGitReferences().find((reference) => reference.workUnitId === unit.id && reference.taskId === unit.taskId && reference.memberId === actor);
      if (!git?.headSha || git.headSha.toLowerCase() !== input.codeSha.toLowerCase()) throw invalidState("证据 SHA 与 Relay 最近上报的真实 Git HEAD 不一致");
      const bundle: EvidenceBundle = {
        id: `EVID-${randomUUID().slice(0, 8)}`, workUnitId, submitterId: actor, contractRevision: input.contractRevision,
        requirementRevision: input.requirementRevision, codeSha: input.codeSha, environment: input.environment,
        items: input.items, status: "SUBMITTED", revision: 1, createdAt: new Date().toISOString()
      };
      const updated = { ...unit, status: "WAITING_REVIEW" as const, headSha: input.codeSha, revision: unit.revision + 1, updatedAt: new Date().toISOString() };
      this.repo.putEvidenceBundle(bundle); this.repo.putWorkUnit(updated);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.EVIDENCE_SUBMITTED, actorId: actor, source: this.source(input.source), entityType: "evidence", entityId: bundle.id, payload: { evidence: bundle, workUnit: updated } });
      return { response: { evidence: bundle, workUnit: updated }, events: [event] };
    });
  }

  reviewEvidence(actorRaw: string | undefined, evidenceId: string, input: MutationBase & { expectedEvidenceRevision: number; decision: AcceptanceRecord["decision"]; reason: string }) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `evidence-review:${evidenceId}`, input, () => {
      const evidence = this.repo.getEvidenceBundle(evidenceId); if (!evidence) throw notFound("EvidenceBundle 不存在");
      if (evidence.revision !== input.expectedEvidenceRevision) throw revisionConflict("证据版本已变化", { currentRevision: evidence.revision });
      const unit = this.repo.getWorkUnit(evidence.workUnitId); if (!unit) throw notFound("WorkUnit 不存在");
      if (actor !== unit.reviewerId && actor !== "A") throw forbidden("只有指定验收人或队长可复核证据");
      if (unit.status !== "WAITING_REVIEW" || evidence.status !== "SUBMITTED") throw invalidState("当前证据不等待复核");
      const record: AcceptanceRecord = {
        id: `ACCEPT-${randomUUID().slice(0, 8)}`, workUnitId: unit.id, evidenceBundleId: evidence.id,
        reviewerId: actor, decision: input.decision, reason: input.reason, codeSha: evidence.codeSha, createdAt: new Date().toISOString()
      };
      const accepted = input.decision === "ACCEPT";
      const updatedEvidence = { ...evidence, status: accepted ? "ACCEPTED" as const : "REJECTED" as const, revision: evidence.revision + 1 };
      const updatedUnit = { ...unit, status: accepted ? "DONE" as const : "IN_PROGRESS" as const, executionStatus: accepted ? "FINISHED" as const : unit.executionStatus, revision: unit.revision + 1, updatedAt: new Date().toISOString() };
      this.repo.putAcceptanceRecord(record); this.repo.putEvidenceBundle(updatedEvidence); this.repo.putWorkUnit(updatedUnit);
      if (accepted) {
        const module = this.repo.getModule(unit.moduleId);
        if (module) {
          const allDone = this.repo.listWorkUnits().filter((item) => item.moduleId === module.id).every((item) => item.id === unit.id ? true : item.status === "DONE");
          if (allDone) this.repo.putModule({ ...module, status: "WAITING_INTEGRATION", revision: module.revision + 1, updatedAt: new Date().toISOString() });
        }
      }
      const event = this.repo.appendEvent({ type: EVENT_TYPES.EVIDENCE_REVIEWED, actorId: actor, source: this.source(input.source), entityType: "acceptance", entityId: record.id, payload: { acceptance: record, evidence: updatedEvidence, workUnit: updatedUnit } });
      return { response: { acceptance: record, evidence: updatedEvidence, workUnit: updatedUnit }, events: [event] };
    });
  }
}
