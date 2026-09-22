import {
  EVENT_TYPES,
  type ExecutionCommand, type ExecutionTransport, type MemberId, type RoomEvent
} from "@vibe-git/protocol";
import { DomainServiceBase, type MutationBase } from "./base-service.js";
import { badRequest, forbidden, invalidState, notFound, unavailable } from "./errors.js";

interface NextCommandInput { deviceId: string; waitMs?: number }
interface CommandStatusInput extends MutationBase {
  deviceId: string;
  status: "STARTED" | "COMPLETED" | "FAILED" | "INTERRUPTED";
  transportUsed: Exclude<ExecutionTransport, "auto">;
  runtimeId?: string | null;
  detail?: string;
  outputSummary?: string | null;
}

export class ExecutionService extends DomainServiceBase {
  async nextCommand(actorRaw: string | undefined, input: NextCommandInput): Promise<ExecutionCommand | null> {
    const actor = this.member(actorRaw);
    if (!input?.deviceId?.trim()) throw badRequest("deviceId 为必填项");
    const device = this.repo.getDevice(actor);
    if (!device || device.deviceId !== input.deviceId || device.relay !== "available") throw unavailable("Relay 设备未注册或已离线");
    const waitMs = Math.max(0, Math.min(Number(input.waitMs ?? 25_000), 30_000));
    const immediate = this.claimNext(actor, input.deviceId);
    if (immediate || waitMs === 0) return immediate;
    return new Promise<ExecutionCommand | null>((resolve) => {
      let settled = false;
      const finish = (command: ExecutionCommand | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(command);
      };
      const unsubscribe = this.hub.subscribe((event) => {
        if (event.type !== EVENT_TYPES.EXECUTION_COMMAND_QUEUED) return;
        const payload = event.payload as ExecutionCommand;
        if (payload.memberId === actor && payload.deviceId === input.deviceId) finish(this.claimNext(actor, input.deviceId));
      });
      const timer = setTimeout(() => finish(null), waitMs);
      const raced = this.claimNext(actor, input.deviceId);
      if (raced) finish(raced);
    });
  }

  acknowledge(actorRaw: string | undefined, commandId: string, input: CommandStatusInput) {
    const actor = this.member(actorRaw);
    return this.idem(actor, input.requestId, `execution-command:${commandId}:${input.status}`, input, () => {
      const command = this.repo.getExecutionCommand(commandId); if (!command) throw notFound("执行命令不存在");
      if (command.memberId !== actor || command.deviceId !== input.deviceId) throw forbidden("Relay 只能回执本设备领取的命令");
      if (command.status === input.status) return { response: command, events: [] };
      const allowed = input.status === "STARTED"
        ? ["CLAIMED", "STARTED"]
        : ["CLAIMED", "STARTED"];
      if (!allowed.includes(command.status)) throw invalidState(`执行命令当前状态 ${command.status} 不接受 ${input.status} 回执`);
      const now = new Date().toISOString();
      const updated: ExecutionCommand = {
        ...command, status: input.status, transportUsed: input.transportUsed,
        runtimeId: input.runtimeId?.trim() || command.runtimeId,
        detail: input.detail?.trim() || null,
        outputSummary: input.outputSummary?.trim().slice(0, 8_000) || null,
        startedAt: input.status === "STARTED" ? (command.startedAt ?? now) : command.startedAt,
        completedAt: input.status === "STARTED" ? null : now
      };
      this.repo.putExecutionCommand(updated);
      this.updateLease(updated);
      this.updateEntity(updated);
      this.updateDecision(updated);
      const event = this.repo.appendEvent({
        type: EVENT_TYPES.EXECUTION_COMMAND_UPDATED, actorId: actor, source: "system",
        entityType: "execution_command", entityId: command.id, payload: updated
      });
      return { response: updated, events: [event] };
    });
  }

  private claimNext(actor: MemberId, deviceId: string): ExecutionCommand | null {
    const result = this.repo.tx(() => {
      const now = Date.now();
      const events: RoomEvent[] = [];
      const candidates = this.repo.listExecutionCommands()
        .filter((command) => command.memberId === actor && command.deviceId === deviceId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      for (const command of candidates) {
        if (["QUEUED", "CLAIMED"].includes(command.status) && Date.parse(command.expiresAt) <= now) {
          const expired = { ...command, status: "EXPIRED" as const, completedAt: new Date().toISOString(), detail: "领取前已过期" };
          this.repo.putExecutionCommand(expired);
          if (expired.leaseId) {
            const lease = this.repo.getLease(expired.leaseId);
            if (lease) this.repo.putLease({ ...lease, status: "EXPIRED" });
          }
          events.push(this.repo.appendEvent({ type: EVENT_TYPES.EXECUTION_COMMAND_UPDATED, actorId: "system", source: "system", entityType: "execution_command", entityId: expired.id, payload: expired }));
        }
      }
      const reclaimBefore = now - 45_000;
      const command = candidates.find((item) => Date.parse(item.expiresAt) > now && (item.status === "QUEUED" || (item.status === "CLAIMED" && item.claimedAt !== null && Date.parse(item.claimedAt) < reclaimBefore)));
      if (!command) return { command: null, events };
      const claimed = { ...command, status: "CLAIMED" as const, claimedAt: new Date().toISOString(), detail: command.status === "CLAIMED" ? "领取回执超时后重新领取" : command.detail };
      this.repo.putExecutionCommand(claimed);
      events.push(this.repo.appendEvent({ type: EVENT_TYPES.EXECUTION_COMMAND_CLAIMED, actorId: actor, source: "system", entityType: "execution_command", entityId: claimed.id, payload: claimed }));
      return { command: claimed, events };
    });
    result.events.forEach((event) => this.publish(event));
    return result.command;
  }

  private updateLease(command: ExecutionCommand) {
    if (!command.leaseId) return;
    const lease = this.repo.getLease(command.leaseId);
    if (!lease) return;
    const status = command.status === "STARTED" ? "STARTED"
      : command.status === "COMPLETED" ? "COMPLETED"
        : command.status === "INTERRUPTED" ? "INTERRUPTED"
          : command.status === "FAILED" ? "FAILED" : lease.status;
    this.repo.putLease({ ...lease, status });
  }

  private updateEntity(command: ExecutionCommand) {
    if (command.workUnitId) {
      const unit = this.repo.getWorkUnit(command.workUnitId); if (!unit) throw notFound("执行命令绑定的 WorkUnit 不存在");
      if (command.kind === "INTERRUPT_WORK_UNIT") {
        if (command.status === "INTERRUPTED" || command.status === "FAILED") this.repo.putWorkUnit({
          ...unit, status: "BLOCKED", needsReview: true,
          executionStatus: command.status === "INTERRUPTED" ? "INTERRUPTED" : "FAILED",
          revision: unit.revision + 1, updatedAt: new Date().toISOString()
        });
        return;
      }
      const executionStatus = command.status === "STARTED" ? "RUNNING"
        : command.status === "COMPLETED" ? "FINISHED"
          : command.status === "FAILED" ? "FAILED"
            : command.status === "INTERRUPTED" ? "INTERRUPTED" : unit.executionStatus;
      const status = command.status === "STARTED" ? "IN_PROGRESS"
        : ["FAILED", "INTERRUPTED"].includes(command.status) ? "BLOCKED" : unit.status;
      this.repo.putWorkUnit({ ...unit, status, executionStatus, revision: unit.revision + 1, updatedAt: new Date().toISOString() });
      return;
    }
    const task = this.repo.getTask(command.taskId); if (!task) throw notFound("执行命令绑定的任务不存在");
    const status = command.status === "STARTED" ? "IN_PROGRESS" : ["FAILED", "INTERRUPTED"].includes(command.status) ? "BLOCKED" : task.status;
    this.repo.putTask({ ...task, status, revision: task.revision + 1, updatedAt: new Date().toISOString() });
  }

  private updateDecision(command: ExecutionCommand) {
    if (!command.decisionId || !["INTERRUPTED", "FAILED"].includes(command.status)) return;
    const decision = this.repo.getExecutionDecision(command.decisionId);
    if (!decision) return;
    this.repo.putExecutionDecision({
      ...decision, status: command.status === "INTERRUPTED" ? "ACKNOWLEDGED" : "FAILED",
      relayResult: command.detail, acknowledgedAt: new Date().toISOString()
    });
  }
}
