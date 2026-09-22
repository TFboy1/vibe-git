import { contentHash, requestHash } from "./base-service.js";
import { randomUUID } from "node:crypto";
import {
  EVENT_TYPES, MEMBERS, TASK_TRANSITIONS, membersFixture,
  type InitializeProjectInput, type Member, type ProjectProfile, type BootstrapPayload, type CodexConnectStatus, type DeviceSignal, type ExecutionCommand, type ExecutionLease, type ExecutionTransport, type FunctionalConflict,
  type GitReference, type MemberId, type RequirementChangeRequest, type RoomEvent,
  type SubmissionSource, type TaskPackage, type TaskStatus
} from "@vibe-git/protocol";
import { Repository } from "../db/repository.js";
import { EventHub } from "../events/hub.js";
import { badRequest, forbidden, invalidState, notFound, revisionConflict, unavailable } from "./errors.js";
import { buildTaskPrompt } from "./execution-prompt.js";

interface MutationBase { requestId: string; source?: SubmissionSource }
interface StatusInput extends MutationBase { expectedTaskRevision: number; status: TaskStatus; note: string; evidence?: string }
interface ChangeInput extends MutationBase { requirementId: string; expectedRequirementRevision: number; proposedContent: string; reason: string; affectedTaskIds?: string[]; impact?: "low" | "high" }
interface DecisionInput extends MutationBase { decision: "approve" | "reject"; expectedRequirementRevision: number; reason?: string }

export class VibeService {
  constructor(
    readonly repo: Repository,
    readonly hub: EventHub,
    private readonly connectStatus: () => CodexConnectStatus = () => ({
      state: "unsupported", provider: "unavailable", mode: "read-only", detail: "Codex Connect 未配置", checkedAt: new Date().toISOString()
    })
  ) {}

  bootstrap(): BootstrapPayload {
    const project = this.repo.getProject();
    const demo = this.repo.hasDemoData();
    const members: Member[] = project?.members ?? (demo ? membersFixture : MEMBERS.map((id, index) => ({
      id, name: id === "A" ? "队长（待设置）" : "成员（待设置）", role: id === "A" ? "captain" : "member", color: ["#ff6b35", "#00d4aa", "#4da3ff"][index]!
    })));
    return {
      room: { id: project?.id ?? "local-workspace", name: project?.name ?? (demo ? "Vibe-Git / Demo Room" : "尚未创建项目"), initialized: Boolean(project) || demo, demo, requirementRevision: this.repo.requirementRevision(), seq: this.repo.lastSeq() },
      members, requirements: this.repo.listRequirements(), revisions: this.repo.listRevisions(), tasks: this.repo.listTasks(),
      modules: this.repo.listModules(), workUnits: this.repo.listWorkUnits(), proposals: this.repo.listProposals(),
      consensusRevisions: this.repo.listConsensusRevisions(), delegationPolicies: this.repo.listDelegationPolicies(),
      decisionRecords: this.repo.listDecisionRecords(), planReviews: this.repo.listPlanReviews(), ideaReviews: this.repo.listIdeaReviews(),
      issues: this.repo.listIssues(), milestones: this.repo.listMilestones(), freezePolicies: this.repo.listFreezePolicies(),
      executionDecisions: this.repo.listExecutionDecisions(), evidenceBundles: this.repo.listEvidenceBundles(),
      acceptanceRecords: this.repo.listAcceptanceRecords(), changes: this.repo.listChanges(), conflicts: this.repo.listConflicts(),
      conflictReviews: this.repo.listConflictReviews(), connectStatus: this.connectStatus(),
      gitReferences: this.repo.listGitReferences(), devices: this.repo.listDevices(), leases: this.repo.listLeases(),
      executionCommands: this.repo.listExecutionCommands(),
      recentEvents: this.repo.eventsSince(Math.max(0, this.repo.lastSeq() - 49), 50)
    };
  }

  initializeProject(actorRaw: string | undefined, input: InitializeProjectInput) {
    const actor = this.member(actorRaw);
    if (actor !== "A") throw forbidden("只有队长可以创建项目");
    if (!input || typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 100) throw badRequest("项目名称须为 1～100 字");
    if (!input.memberNames || MEMBERS.some(id => typeof input.memberNames[id] !== "string" || !input.memberNames[id].trim() || input.memberNames[id].trim().length > 50)) throw badRequest("请填写 A/B/C 三位成员的真实称呼（1～50 字）");
    return this.idem(actor, input.requestId, "project:initialize", input, () => {
      if (this.repo.getProject() || this.repo.hasDemoData()) throw invalidState("工作区已经初始化，不能覆盖已有项目");
      const project: ProjectProfile = {
        id: randomUUID(), name: input.name.trim(), createdAt: new Date().toISOString(),
        members: MEMBERS.map((id, index) => ({ id, name: input.memberNames[id].trim(), role: id === "A" ? "captain" : "member", color: ["#ff6b35", "#00d4aa", "#4da3ff"][index]! }))
      };
      this.repo.putProject(project);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.PROJECT_INITIALIZED, actorId: actor, source: "manual", entityType: "project", entityId: project.id, payload: project });
      return { response: project, events: [event] };
    });
  }

  private member(actor: string | undefined): MemberId {
    if (!actor || !MEMBERS.includes(actor as MemberId)) throw forbidden("缺少有效成员身份 x-member-id");
    return actor as MemberId;
  }

  private canWriteTask(actor: MemberId, task: TaskPackage) { return actor === task.ownerId || actor === "A"; }
  private source(value?: SubmissionSource): SubmissionSource { return value ?? "manual"; }
  private publish(event: RoomEvent) { queueMicrotask(() => this.hub.publish(event)); }

  private idem<T>(actor: MemberId, requestId: string, operation: string, payload: unknown, work: () => { response: T; events: RoomEvent[] }): T {
    if (!requestId?.trim()) throw badRequest("requestId 为必填项");
    const scopedOperation = `v2:${actor}:${operation}:${requestHash(payload)}`;
    const cached = this.repo.getIdempotent<T>(requestId, scopedOperation);
    if (cached) return cached;
    const result = this.repo.tx(() => {
      const inside = this.repo.getIdempotent<T>(requestId, scopedOperation);
      if (inside) return { response: inside, events: [] as RoomEvent[] };
      const next = work();
      this.repo.saveIdempotent(requestId, scopedOperation, next.response);
      return next;
    });
    result.events.forEach((event) => this.publish(event));
    return result.response;
  }

  acceptTask(actorRaw: string | undefined, taskId: string, input: MutationBase & { expectedTaskRevision: number }) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `accept:${taskId}`, input, () => {
      const task = this.repo.getTask(taskId); if (!task) throw notFound("任务不存在");
      if (!this.canWriteTask(actor, task)) throw forbidden("只有任务责任人或队长可接受该任务");
      if (task.revision !== input.expectedTaskRevision) throw revisionConflict("任务版本已变化，请刷新", { currentRevision: task.revision });
      const updated: TaskPackage = { ...task, accepted: true, status: task.status === "TODO" ? "PLANNING" : task.status, revision: task.revision + 1, updatedAt: new Date().toISOString() };
      this.repo.putTask(updated);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.TASK_ACCEPTED, actorId: actor, source: this.source(input.source), entityType: "task", entityId: taskId, payload: updated });
      return { response: updated, events: [event] };
    });
  }

  updateTaskStatus(actorRaw: string | undefined, taskId: string, input: StatusInput) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `status:${taskId}`, input, () => {
      const task = this.repo.getTask(taskId); if (!task) throw notFound("任务不存在");
      if (!this.canWriteTask(actor, task)) throw forbidden("只有任务责任人或队长可更新任务");
      if (task.revision !== input.expectedTaskRevision) throw revisionConflict("任务版本已变化，请刷新", { currentRevision: task.revision });
      if (task.needsReplan && input.status !== "PLANNING" && input.status !== "BLOCKED") throw invalidState("需求版本变化后必须先重审任务计划");
      const allowed = TASK_TRANSITIONS[task.status] as readonly TaskStatus[];
      if (task.status !== input.status && !allowed.includes(input.status)) throw invalidState(`不允许从 ${task.status} 变为 ${input.status}`);
      if (input.status === "DONE" && !input.evidence?.trim()) throw badRequest("报告 DONE 必须附验证证据");
      const updated: TaskPackage = { ...task, status: input.status, revision: task.revision + 1, updatedAt: new Date().toISOString() };
      this.repo.putTask(updated);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.TASK_STATUS_CHANGED, actorId: actor, source: this.source(input.source), entityType: "task", entityId: taskId, payload: { task: updated, note: input.note, evidence: input.evidence ?? null } });
      return { response: updated, events: [event] };
    });
  }

  readyTask(actorRaw: string | undefined, taskId: string, input: MutationBase & { expectedTaskRevision: number; acknowledgeRequirementRevision: number }) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `ready:${taskId}`, input, () => {
      const task = this.repo.getTask(taskId); if (!task) throw notFound("任务不存在");
      if (!this.canWriteTask(actor, task)) throw forbidden("只有任务责任人或队长可完成重审");
      if (task.revision !== input.expectedTaskRevision) throw revisionConflict("任务版本已变化，请刷新", { currentRevision: task.revision });
      const currentRequirementRevision = this.repo.requirementRevision();
      if (input.acknowledgeRequirementRevision !== currentRequirementRevision) throw revisionConflict("确认的需求版本不是当前版本", { currentRevision: currentRequirementRevision });
      if (!task.accepted) throw invalidState("接受任务后才能 Ready");
      const updated: TaskPackage = { ...task, status: "READY", needsReplan: false, requirementRevision: currentRequirementRevision, contractRevision: task.contractRevision + (task.needsReplan ? 1 : 0), revision: task.revision + 1, updatedAt: new Date().toISOString() };
      this.repo.putTask(updated);
      const event = this.repo.appendEvent({ type: EVENT_TYPES.TASK_READY, actorId: actor, source: this.source(input.source), entityType: "task", entityId: taskId, payload: updated });
      return { response: updated, events: [event] };
    });
  }

  createChange(actorRaw: string | undefined, input: ChangeInput) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, "change:create", input, () => {
      const currentRevision = this.repo.requirementRevision();
      if (input.expectedRequirementRevision !== currentRevision) throw revisionConflict("需求版本已变化，请刷新", { currentRevision });
      const requirement = this.repo.getRequirement(input.requirementId); if (!requirement) throw notFound("需求条目不存在");
      if (!input.proposedContent.trim() || !input.reason.trim()) throw badRequest("新内容和原因不能为空");
      const linked = this.repo.listTasks().filter((task) => task.requirementIds.includes(requirement.id)).map((task) => task.id);
      const affectedTaskIds = [...new Set((input.affectedTaskIds?.length ? input.affectedTaskIds : linked).filter((id) => linked.includes(id)))];
      const change: RequirementChangeRequest = {
        id: `CHG-${randomUUID().slice(0, 8)}`, submitterId: actor, source: this.source(input.source), requirementId: requirement.id,
        baseRequirementRevision: currentRevision, oldContent: requirement.content, proposedContent: input.proposedContent.trim(), reason: input.reason.trim(),
        affectedTaskIds, impact: input.impact ?? (affectedTaskIds.length > 1 ? "high" : "low"), status: "OPEN", approvals: [],
        createdAt: new Date().toISOString(), decidedAt: null
      };
      this.repo.putChange(change);
      const events = [this.repo.appendEvent({ type: EVENT_TYPES.CHANGE_CREATED, actorId: actor, source: change.source, entityType: "change", entityId: change.id, payload: change })];
      if (change.impact === "high" && affectedTaskIds.length > 1) {
        const conflict: FunctionalConflict = {
          id: `CONFLICT-${randomUUID().slice(0, 8)}`, requirementId: requirement.id, taskIds: affectedTaskIds, changeId: change.id,
          classification: "insufficient", statement: "该变更同时影响多个任务契约，需要联合审查其用户行为与验收语义。",
          evidence: [requirement.content, change.proposedContent], status: "OPEN", resolution: null, createdAt: new Date().toISOString()
        };
        this.repo.putConflict(conflict);
        events.push(this.repo.appendEvent({ type: EVENT_TYPES.CONFLICT_CREATED, actorId: "system", source: "system", entityType: "conflict", entityId: conflict.id, payload: conflict }));
      }
      return { response: change, events };
    });
  }

  decideChange(actorRaw: string | undefined, changeId: string, input: DecisionInput) {
    const actor = this.member(actorRaw);
    return this.idem<{ change: RequirementChangeRequest; applied: boolean; requirementRevision: number; invalidatedTaskIds?: string[]; invalidatedWorkUnitIds?: string[] }>(actor, input.requestId, `change:decision:${changeId}:${actor}`, input, () => {
      const currentRevision = this.repo.requirementRevision();
      if (input.expectedRequirementRevision !== currentRevision) throw revisionConflict("需求版本已变化，请刷新", { currentRevision });
      const change = this.repo.getChange(changeId); if (!change) throw notFound("变更申请不存在");
      if (change.status !== "OPEN") throw invalidState("该变更申请已结束");
      const events: RoomEvent[] = [];
      if (input.decision === "reject") {
        const rejected: RequirementChangeRequest = { ...change, status: "REJECTED", decidedAt: new Date().toISOString() };
        this.repo.putChange(rejected);
        events.push(this.repo.appendEvent({ type: EVENT_TYPES.CHANGE_REJECTED, actorId: actor, source: this.source(input.source), entityType: "change", entityId: change.id, payload: { change: rejected, reason: input.reason ?? "" } }));
        return { response: { change: rejected, applied: false, requirementRevision: currentRevision }, events };
      }
      const approvals = [...new Set([...change.approvals, actor])];
      if (change.impact === "high" && approvals.length < MEMBERS.length) {
        const pending: RequirementChangeRequest = { ...change, approvals };
        this.repo.putChange(pending);
        events.push(this.repo.appendEvent({ type: EVENT_TYPES.CHANGE_APPROVED, actorId: actor, source: this.source(input.source), entityType: "change", entityId: change.id, payload: { change: pending, awaiting: MEMBERS.filter((id) => !approvals.includes(id)) } }));
        return { response: { change: pending, applied: false, requirementRevision: currentRevision }, events };
      }
      const requirement = this.repo.getRequirement(change.requirementId); if (!requirement) throw notFound("目标需求不存在");
      const newRevision = currentRevision + 1;
      const now = new Date().toISOString();
      const applied: RequirementChangeRequest = { ...change, approvals, status: "APPROVED", decidedAt: now };
      this.repo.putChange(applied);
      this.repo.putRequirement({ ...requirement, content: change.proposedContent, revision: requirement.revision + 1, updatedAt: now });
      this.repo.putRevision({ revision: newRevision, previousRevision: currentRevision, summary: change.reason, approvedBy: approvals, createdAt: now, changeId: change.id });
      this.repo.setRequirementRevision(newRevision);
      const invalidated: string[] = [];
      for (const taskId of change.affectedTaskIds) {
        const task = this.repo.getTask(taskId); if (!task || !task.requirementIds.includes(change.requirementId)) continue;
        this.repo.putTask({ ...task, status: "PLANNING", needsReplan: true, requirementRevision: newRevision, revision: task.revision + 1, updatedAt: now });
        invalidated.push(task.id);
      }
      const invalidatedWorkUnitIds: string[] = [];
      for (const unit of this.repo.listWorkUnits()) {
        const explicitlyAffected = change.affectedWorkUnitIds?.includes(unit.id) ?? false;
        const requirementAffected = unit.requirementBindings.some((binding) => binding.requirementId === change.requirementId);
        if (!explicitlyAffected && !requirementAffected) continue;
        this.repo.putWorkUnit({ ...unit, status: "BLOCKED", needsReview: true, impactState: "INVALIDATED", revision: unit.revision + 1, updatedAt: now });
        invalidatedWorkUnitIds.push(unit.id);
      }
      for (const conflict of this.repo.listConflicts().filter((item) => item.requirementId === change.requirementId && item.status === "OPEN")) {
        this.repo.putConflict({ ...conflict, status: "RESOLVED", resolution: change.proposedContent });
      }
      events.push(this.repo.appendEvent({ type: EVENT_TYPES.REQUIREMENT_REVISED, actorId: actor, source: this.source(input.source), entityType: "requirement_revision", entityId: String(newRevision), payload: { change: applied, invalidatedTaskIds: invalidated, invalidatedWorkUnitIds } }));
      return { response: { change: applied, applied: true, requirementRevision: newRevision, invalidatedTaskIds: invalidated, invalidatedWorkUnitIds }, events };
    });
  }

  startTask(actorRaw: string | undefined, taskId: string, input: MutationBase & { expectedTaskRevision: number; deviceId: string; transport?: ExecutionTransport }) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `start:${taskId}`, input, () => {
      const task = this.repo.getTask(taskId); if (!task) throw notFound("任务不存在");
      if (actor !== task.ownerId) throw forbidden("只有任务责任人能启动本机任务");
      if (task.revision !== input.expectedTaskRevision) throw revisionConflict("任务版本已变化，请刷新", { currentRevision: task.revision });
      if (task.status !== "READY" || task.needsReplan) throw invalidState("任务必须完成审查并处于 READY");
      const device = this.repo.getDevice(actor);
      if (!device || device.deviceId !== input.deviceId || device.relay !== "available") throw unavailable("成员 Relay 未在线或设备不匹配");
      if (device.codex !== "available") throw unavailable("该设备尚未验证可启动的 Codex 客户端或 CLI", { codex: device.codex });
      if (device.git !== "available") throw unavailable("该设备工作区尚未验证 Git", { git: device.git });
      const prompt = buildTaskPrompt(task, task.requirementIds.flatMap((id) => { const requirement = this.repo.getRequirement(id); return requirement ? [requirement] : []; }));
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const lease: ExecutionLease = {
        id: `LEASE-${randomUUID().slice(0, 8)}`, taskId, memberId: actor, deviceId: input.deviceId,
        taskRevision: task.revision, requirementRevision: this.repo.requirementRevision(), status: "ISSUED", idempotencyKey: input.requestId,
        expiresAt, createdAt: new Date().toISOString()
      };
      const command: ExecutionCommand = {
        id: `COMMAND-${randomUUID().slice(0, 8)}`, kind: "START_TASK", memberId: actor, deviceId: input.deviceId,
        taskId, workUnitId: null, leaseId: lease.id, decisionId: null,
        transportRequested: input.transport ?? "auto", transportUsed: null, prompt, promptHash: contentHash(prompt),
        requirementRevision: lease.requirementRevision, entityRevision: task.revision, status: "QUEUED",
        runtimeId: null, detail: null, outputSummary: null, expiresAt,
        createdAt: lease.createdAt, claimedAt: null, startedAt: null, completedAt: null
      };
      this.repo.putLease(lease);
      this.repo.putExecutionCommand(command);
      const events = [
        this.repo.appendEvent({ type: EVENT_TYPES.LEASE_ISSUED, actorId: actor, source: this.source(input.source), entityType: "lease", entityId: lease.id, payload: lease }),
        this.repo.appendEvent({ type: EVENT_TYPES.EXECUTION_COMMAND_QUEUED, actorId: actor, source: "system", entityType: "execution_command", entityId: command.id, payload: command })
      ];
      return { response: lease, events };
    });
  }

  heartbeat(actorRaw: string | undefined, input: MutationBase & { device: DeviceSignal; gitReference?: GitReference }) {
    const actor = this.member(actorRaw);
    if (actor !== input.device.memberId) throw forbidden("Relay 只能上报绑定成员的设备");
    return this.idem(actor, input.requestId, `heartbeat:${input.device.deviceId}`, input, () => {
      const device = { ...input.device, observedAt: new Date().toISOString() };
      this.repo.putDevice(device);
      if (input.gitReference) {
        if (input.gitReference.memberId !== actor) throw forbidden("Git 引用成员不匹配");
        const reference = input.gitReference;
        if (reference.workUnitId !== undefined) {
          const unit = this.repo.getWorkUnit(reference.workUnitId);
          if (!unit) throw notFound("Git 引用绑定的 WorkUnit 不存在");
          if (unit.ownerId !== actor) throw forbidden("Relay 只能上报本人 WorkUnit 的 Git 引用");
          if (unit.taskId !== reference.taskId) throw badRequest("Git 引用的 TaskPackage 与 WorkUnit 不匹配");
        } else {
          const task = this.repo.getTask(reference.taskId);
          if (!task) throw notFound("Git 引用绑定的任务不存在");
          if (task.ownerId !== actor) throw forbidden("旧版 Git 引用只能上报本人任务");
        }
        this.repo.putGitReference({ ...reference, observedAt: device.observedAt });
      }
      const event = this.repo.appendEvent({ type: EVENT_TYPES.RELAY_HEARTBEAT, actorId: actor, source: "system", entityType: "device", entityId: device.deviceId, payload: { device, gitReference: input.gitReference ?? null } });
      return { response: device, events: [event] };
    });
  }
}
