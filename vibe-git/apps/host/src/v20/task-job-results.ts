import type { AgentJob, DevelopmentStage, StageTask } from "@vibe-git/protocol";
import { invalidState, revisionConflict } from "../domain/errors.js";
import type { V20Repository } from "./repository.js";
const now = () => new Date().toISOString();
interface TaskJobHooks {
  create(kind: AgentJob["kind"], target: string, entity: string, payload: Record<string, unknown>, attempts: number): AgentJob;
  prompt(stage: DevelopmentStage, task: StageTask, detail: string): string;
}
export class TaskJobResults {
  constructor(private readonly repo: V20Repository, private readonly hooks: TaskJobHooks) {}
  complete(job: AgentJob, result: unknown): void {
      if (job.kind === "PREPARE_MOCK") {
        const task = this.repo.getTask(job.entityId);
        if (!task || task.activeJobId !== job.id || task.status !== "PREPARING_MOCK") throw invalidState("Mock 准备作业已过期");
        const evidence = result as { verified?: boolean; contractHashes?: Record<string, string>; summary?: string } | null;
        const hashes = job.payload.contractHashes as Record<string, string>;
        if (!evidence?.verified || JSON.stringify(evidence.contractHashes) !== JSON.stringify(hashes) ||
          Object.entries(hashes).some(([contractId, hash]) => this.repo.getContract(contractId)?.sha256 !== hash))
          throw revisionConflict("Mock 测试未通过或接口契约已变化");
        const stage = this.repo.getStage(task.stageId)!;
        const detail = task.detailDocumentId ? this.repo.getDocument(task.detailDocumentId) : undefined;
        const run = this.hooks.create("RUN_TASK", task.assigneeNodeId, task.id, {
          prompt: this.hooks.prompt(stage, task, detail?.content ?? "（成员未补充任务细化 Markdown，按正式任务执行。）"),
          workspaceRequired: true, transport: this.repo.getNode(task.assigneeNodeId)?.workTransport ?? "auto",
          taskRevision: task.revision + 1, requirementRevision: stage.requirementRevision
        }, 1);
        this.repo.putJob(run);
        this.repo.putTask({ ...task, status: "STARTING", activeJobId: run.id, blockedReason: null,
          mockEvidence: { contractHashes: hashes, verifiedAt: now(), summary: String(evidence.summary ?? "本地契约测试通过").slice(0, 500) },
          revision: task.revision + 1, updatedAt: now() });
      }
      else if (job.kind === "INTEGRATE_TASK") {
        const task = this.repo.getTask(job.entityId);
        if (!task || task.activeJobId !== job.id || task.status !== "WAITING_INTEGRATION") throw invalidState("真实集成作业已过期");
        const evidence = result as { verified?: boolean; contractHashes?: Record<string, string>; headSha?: string; summary?: string } | null;
        const hashes = job.payload.contractHashes as Record<string, string>;
        const node = this.repo.getNode(task.assigneeNodeId);
        if (!evidence?.verified || JSON.stringify(evidence.contractHashes) !== JSON.stringify(hashes) || !evidence.headSha || node?.git?.headSha !== evidence.headSha ||
          Object.entries(hashes).some(([contractId, hash]) => this.repo.getContract(contractId)?.sha256 !== hash))
          throw revisionConflict("真实集成测试未通过或代码、契约版本已变化");
        this.repo.putTask({ ...task, status: "WAITING_CONFIRMATION", activeJobId: null, blockedReason: null,
          integrationEvidence: { contractHashes: hashes, headSha: evidence.headSha, verifiedAt: now(), summary: String(evidence.summary ?? "真实契约测试通过").slice(0, 500) },
          finishedAt: now(), revision: task.revision + 1, updatedAt: now() });
      }
      else if (job.kind === "RUN_TASK") {
        const task = this.repo.getTask(job.entityId);
        if (task?.activeJobId === job.id) this.repo.putTask({ ...task,
          ...(task.flow === "agile" || task.pauseRequested || task.status === "PAUSED" ? { runtimeId: null } : {
            status: (task.dependencyEdges ?? []).some((edge) => edge.mode === "CONTRACT") ? "WAITING_INTEGRATION" as const : "WAITING_CONFIRMATION" as const,
            finishedAt: now()
          }), activeJobId: null, revision: task.revision + 1, updatedAt: now() });
      }
  }
  fail(job: AgentJob, safeError: string): void {
      if (job.kind === "RUN_TASK" || job.kind === "PREPARE_MOCK" || job.kind === "INTEGRATE_TASK") {
        const task = this.repo.getTask(job.entityId); if (task?.activeJobId === job.id) this.repo.putTask({ ...task,
          ...(task.flow === "agile" || task.pauseRequested || task.status === "PAUSED" ? { runtimeId: null } : {
            status: job.kind === "INTEGRATE_TASK" ? "WAITING_INTEGRATION" as const : "FAILED" as const, blockedReason: safeError
          }), activeJobId: null, revision: task.revision + 1, updatedAt: now() });
      }
  }
}
