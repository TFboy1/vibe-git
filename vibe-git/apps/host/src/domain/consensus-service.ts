import { randomUUID } from "node:crypto";
import {
  EVENT_TYPES, MEMBERS,
  type AgentRunReference, type CandidateRequirement, type ConsensusRevision,
  type DelegationAction, type DecisionRecord, type ProjectIntent
} from "@vibe-git/protocol";
import { DomainServiceBase, contentHash, type MutationBase } from "./base-service.js";
import { badRequest, forbidden, invalidState, notFound, revisionConflict } from "./errors.js";

interface ProposalInput extends MutationBase {
  proposalId?: string;
  title: string;
  content: string;
  intent: ProjectIntent;
  memberConfirmed: boolean;
  expectedRevision?: number;
}
interface CreateConsensusInput extends MutationBase {
  proposalIds: string[];
  title: string;
  summary: string;
  candidateRequirements: CandidateRequirement[];
  expectedRequirementRevision: number;
}
interface ReviseInput extends MutationBase {
  expectedConsensusRevision: number;
  policyId: string;
  requirementId: string;
  action: DelegationAction;
  after: string;
  acceptance: string[];
  rationale: string;
  sacrifices: string[];
  risks: string[];
  agentRun: AgentRunReference;
}
interface ConfirmInput extends MutationBase {
  expectedConsensusRevision: number;
  candidateHash: string;
  decision: "CONFIRMED" | "OBJECTED";
  reason?: string;
  minimumAcceptable?: string;
}

export class ConsensusService extends DomainServiceBase {
  submitProposal(actorRaw: string | undefined, input: ProposalInput) {
    const actor = this.member(actorRaw);
    if (!this.repo.getProject() && !this.repo.hasDemoData()) throw invalidState("请先创建项目");
    if (input.memberConfirmed !== true) throw invalidState("个人提案必须先由本人确认准确表达其意图");
    if (!input.content.trim() || !input.title.trim()) throw badRequest("提案标题和内容不能为空");
    return this.idem(actor, input.requestId, `proposal:${input.proposalId ?? "new"}`, input, () => {
      const id = input.proposalId ?? `PROP-${actor}-${randomUUID().slice(0, 8)}`;
      const existing = this.repo.getProposal(id);
      if (existing && existing.memberId !== actor) throw forbidden("不能修改其他成员的提案");
      if (existing && input.expectedRevision !== existing.revision) throw revisionConflict("提案版本已变化", { currentRevision: existing.revision });
      const now = new Date().toISOString();
      const proposal = {
        id, memberId: actor, title: input.title.trim(), content: input.content.trim(), contentHash: contentHash(input.content.trim()),
        intent: input.intent, memberConfirmed: true as const, status: "SUBMITTED" as const,
        revision: (existing?.revision ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now
      };
      this.repo.putProposal(proposal);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.PROPOSAL_SUBMITTED, actorId: actor, source: this.source(input.source), entityType: "proposal", entityId: id, payload: proposal });
      return { response: proposal, events: [event] };
    });
  }

  createConsensus(actorRaw: string | undefined, input: CreateConsensusInput) {
    const actor = this.captain(actorRaw);
    if (!this.repo.getProject() && !this.repo.hasDemoData()) throw invalidState("请先创建项目");
    return this.idem(actor, input.requestId, "consensus:create", input, () => {
      if (input.expectedRequirementRevision !== this.repo.requirementRevision()) throw revisionConflict("需求基线已变化", { currentRevision: this.repo.requirementRevision() });
      if (!input.title?.trim() || !input.summary?.trim()) throw badRequest("候选标题和摘要不能为空");
      if (!Array.isArray(input.candidateRequirements) || !input.candidateRequirements.length || input.candidateRequirements.some(item => !item.requirementId?.trim() || !item.content?.trim() || !Array.isArray(item.acceptance) || !item.acceptance.length || item.acceptance.some(value => typeof value !== "string" || !value.trim()))) throw badRequest("候选必须包含需求正文和可检查的验收条件");
      if (new Set(input.candidateRequirements.map(item => item.requirementId)).size !== input.candidateRequirements.length) throw badRequest("候选需求 ID 不能重复");
      if (input.expectedRequirementRevision === 0 && (input.candidateRequirements.length !== 1 || input.candidateRequirements[0]?.requirementId !== "REQ-ROOT")) throw badRequest("空白项目首版候选须定义 REQ-ROOT 总需求");
      const proposals = input.proposalIds.map((id) => this.repo.getProposal(id));
      if (proposals.some((item) => !item || item.status !== "SUBMITTED" || !item.memberConfirmed)) throw invalidState("共识候选只能引用本人已确认并提交的提案");
      const submittedMembers = new Set(proposals.map((item) => item!.memberId));
      if (MEMBERS.some((member) => !submittedMembers.has(member))) throw invalidState("P0 共识候选需要 A/B/C 三位成员各一份已提交提案");
      const now = new Date().toISOString();
      const candidateHash = contentHash(input.candidateRequirements);
      const consensus: ConsensusRevision = {
        id: `CONS-${randomUUID().slice(0, 8)}`, revision: 1, baseRequirementRevision: input.expectedRequirementRevision,
        proposalIds: input.proposalIds, title: input.title, summary: input.summary,
        candidateRequirements: input.candidateRequirements, candidateHash, status: "AWAITING_CONFIRMATION",
        confirmations: [], decisionRecordIds: [], publishedRequirementRevision: null, createdAt: now, updatedAt: now
      };
      this.repo.putConsensusRevision(consensus);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.CONSENSUS_CREATED, actorId: actor, source: this.source(input.source), entityType: "consensus", entityId: consensus.id, payload: consensus });
      return { response: consensus, events: [event] };
    });
  }

  reviseConsensus(actorRaw: string | undefined, consensusId: string, input: ReviseInput) {
    const actor = this.captain(actorRaw);
    return this.idem(actor, input.requestId, `consensus:revise:${consensusId}`, input, () => {
      const consensus = this.repo.getConsensusRevision(consensusId); if (!consensus) throw notFound("共识候选不存在");
      if (consensus.revision !== input.expectedConsensusRevision) throw revisionConflict("共识候选版本已变化", { currentRevision: consensus.revision });
      if (["PUBLISHED", "SUPERSEDED"].includes(consensus.status)) throw invalidState("已发布或已替代的候选不能修订");
      const policy = this.repo.getDelegationPolicy(input.policyId); if (!policy) throw notFound("DelegationPolicy 不存在");
      if (policy.status !== "ACTIVE" || Date.parse(policy.expiresAt) <= Date.now()) throw invalidState("DelegationPolicy 已失效");
      if (policy.confirmedBy.length !== MEMBERS.length) throw invalidState("DelegationPolicy 未获全员确认");
      if (!policy.requirementIds.includes(input.requirementId) || !policy.allowedActions.includes(input.action)) throw forbidden("Coordinator 修订超出授权需求或动作范围");
      if (policy.usedIterations >= policy.maxIterations) throw invalidState("已达到本轮自主修订次数上限");
      if (policy.protectedConstraints.some((constraint) => input.after.includes(`[删除:${constraint}]`))) throw forbidden("候选修订触碰保护项");
      if (!input.agentRun.runId || input.agentRun.inputHash === "" || input.agentRun.outputHash === "") throw badRequest("Coordinator 修订必须带 AgentRunReference");
      if (input.agentRun.mode !== "real" || input.agentRun.capability !== "available") throw invalidState("只有已真实验证的 Coordinator 运行可修改团队候选；mock/replay 只能用于测试或展示");
      const beforeItem = consensus.candidateRequirements.find((item) => item.requirementId === input.requirementId);
      if (!beforeItem) throw notFound("候选中不存在目标需求");
      const updatedCandidates = consensus.candidateRequirements.map((item) => item.requirementId === input.requirementId ? { ...item, content: input.after, acceptance: input.acceptance } : item);
      const candidateHash = contentHash(updatedCandidates);
      const decision: DecisionRecord = {
        id: `DEC-${randomUUID().slice(0, 8)}`, consensusId, policyId: policy.id, requirementId: input.requirementId,
        action: input.action, before: beforeItem.content, after: input.after, rationale: input.rationale,
        sacrifices: input.sacrifices, risks: input.risks, agentRun: input.agentRun, createdAt: new Date().toISOString()
      };
      const updated: ConsensusRevision = {
        ...consensus, revision: consensus.revision + 1, candidateRequirements: updatedCandidates, candidateHash,
        confirmations: [], decisionRecordIds: [...consensus.decisionRecordIds, decision.id], status: "AWAITING_CONFIRMATION", updatedAt: new Date().toISOString()
      };
      this.repo.putDecisionRecord(decision);
      this.repo.putDelegationPolicy({ ...policy, usedIterations: policy.usedIterations + 1, revision: policy.revision + 1 });
      this.repo.putConsensusRevision(updated);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.CONSENSUS_REVISED, actorId: actor, source: this.source(input.source), entityType: "consensus", entityId: consensusId, payload: { consensus: updated, decision } });
      return { response: updated, events: [event] };
    });
  }

  confirm(actorRaw: string | undefined, consensusId: string, input: ConfirmInput) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `consensus:confirm:${consensusId}:${actor}`, input, () => {
      const consensus = this.repo.getConsensusRevision(consensusId); if (!consensus) throw notFound("共识候选不存在");
      if (consensus.revision !== input.expectedConsensusRevision) throw revisionConflict("共识候选版本已变化", { currentRevision: consensus.revision });
      if (input.candidateHash !== consensus.candidateHash) throw revisionConflict("确认的不是当前候选内容", { candidateHash: consensus.candidateHash });
      if (consensus.status !== "AWAITING_CONFIRMATION") throw invalidState("当前候选不处于确认阶段");
      const confirmation = {
        memberId: actor, candidateHash: input.candidateHash, decision: input.decision,
        reason: input.reason?.trim() || null, minimumAcceptable: input.minimumAcceptable?.trim() || null, createdAt: new Date().toISOString()
      };
      if (input.decision === "OBJECTED" && !confirmation.reason) throw badRequest("提出异议必须说明原因");
      const confirmations = [...consensus.confirmations.filter((item) => item.memberId !== actor), confirmation];
      const updated: ConsensusRevision = { ...consensus, confirmations, status: input.decision === "OBJECTED" ? "REVISING" : consensus.status, revision: consensus.revision + 1, updatedAt: new Date().toISOString() };
      this.repo.putConsensusRevision(updated);
      const event = this.repo.appendEvent({ type: input.decision === "CONFIRMED" ? EVENT_TYPES.CONSENSUS_CONFIRMED : EVENT_TYPES.CONSENSUS_OBJECTED, actorId: actor, source: this.source(input.source), entityType: "consensus", entityId: consensusId, payload: confirmation });
      return { response: updated, events: [event] };
    });
  }

  publishConsensus(actorRaw: string | undefined, consensusId: string, input: MutationBase & { expectedConsensusRevision: number; expectedRequirementRevision: number }) {
    const actor = this.captain(actorRaw);
    return this.idem(actor, input.requestId, `consensus:publish:${consensusId}`, input, () => {
      const consensus = this.repo.getConsensusRevision(consensusId); if (!consensus) throw notFound("共识候选不存在");
      if (consensus.revision !== input.expectedConsensusRevision) throw revisionConflict("共识候选版本已变化", { currentRevision: consensus.revision });
      const currentRequirementRevision = this.repo.requirementRevision();
      if (input.expectedRequirementRevision !== currentRequirementRevision || consensus.baseRequirementRevision !== currentRequirementRevision) throw revisionConflict("需求基线已变化", { currentRevision: currentRequirementRevision });
      const confirmed = new Set(consensus.confirmations.filter((item) => item.decision === "CONFIRMED" && item.candidateHash === consensus.candidateHash).map((item) => item.memberId));
      if (MEMBERS.some((member) => !confirmed.has(member))) throw invalidState("A/B/C 必须显性确认同一候选摘要后才能发布");
      if (consensus.confirmations.some((item) => item.decision === "OBJECTED")) throw invalidState("候选仍有未解决异议");
      const newRevision = currentRequirementRevision + 1;
      const now = new Date().toISOString();
      const changedRequirementIds: string[] = [];
      for (const candidate of consensus.candidateRequirements) {
        const requirement = this.repo.getRequirement(candidate.requirementId);
        if (!requirement) {
          if (currentRequirementRevision !== 0 || candidate.requirementId !== "REQ-ROOT") throw notFound(`需求 ${candidate.requirementId} 不存在`);
          this.repo.putRequirement({ id: candidate.requirementId, parentId: null, title: consensus.title, content: candidate.content, acceptance: candidate.acceptance, priority: "P0", revision: 1, updatedAt: now });
          changedRequirementIds.push(candidate.requirementId);
          continue;
        }
        if (requirement.content === candidate.content && JSON.stringify(requirement.acceptance) === JSON.stringify(candidate.acceptance)) continue;
        this.repo.putRequirement({ ...requirement, content: candidate.content, acceptance: candidate.acceptance, revision: requirement.revision + 1, updatedAt: now });
        changedRequirementIds.push(requirement.id);
      }
      const invalidatedWorkUnitIds: string[] = [];
      for (const unit of this.repo.listWorkUnits()) {
        if (!unit.requirementBindings.some((binding) => changedRequirementIds.includes(binding.requirementId))) continue;
        this.repo.putWorkUnit({ ...unit, status: "BLOCKED", needsReview: true, impactState: "INVALIDATED", revision: unit.revision + 1, updatedAt: now });
        invalidatedWorkUnitIds.push(unit.id);
      }
      this.repo.setRequirementRevision(newRevision);
      this.repo.putRevision({ revision: newRevision, previousRevision: currentRequirementRevision, summary: consensus.summary, approvedBy: [...MEMBERS], candidateHash: consensus.candidateHash, consensusId, createdAt: now, changeId: null });
      const published: ConsensusRevision = { ...consensus, status: "PUBLISHED", publishedRequirementRevision: newRevision, revision: consensus.revision + 1, updatedAt: now };
      this.repo.putConsensusRevision(published);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.CONSENSUS_PUBLISHED, actorId: actor, source: this.source(input.source), entityType: "consensus", entityId: consensusId, payload: { consensus: published, changedRequirementIds, invalidatedWorkUnitIds } });
      return { response: { consensus: published, requirementRevision: newRevision, changedRequirementIds, invalidatedWorkUnitIds }, events: [event] };
    });
  }
}
