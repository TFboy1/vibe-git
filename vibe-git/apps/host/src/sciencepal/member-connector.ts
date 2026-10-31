import {hasRunCapacity} from "./run-budget.js";
import { isLocalResearchPlatform, researchPlatformName } from "@vibe-git/protocol";
import {AgentExecutor} from '@vibe-git/relay/agent-executor';
import {AgentRegistry} from '@vibe-git/relay/agent-registry';
import type {ExecutionCommand} from '@vibe-git/protocol';
import { createHash, randomUUID } from "node:crypto";
import { isLatestSPRun, type SPContinuation, type SPProject, type SPTeamPacket, type SPAgentBinding, type projectNextActions } from "@vibe-git/protocol";
import { SciencePALError, type SciencePALRemote } from "./client.js";

export type MemberRequest = <T = any>(path: string, body?: unknown, method?: string) => Promise<T>;
export interface ConnectorJournal {
  projectId: string; packet?: SPTeamPacket;
  phase: "IDLE" | "CLAIMING" | "SUBMITTING" | "RUNNING" | "FAILING" | "OUTPUT" | "UNKNOWN";
  localRunId?: string;
  claimId?: string;
  remote?: { threadId: string; runId: string };
  knownRunIds?: string[];
  followUp?: {
    stage: "MESSAGE" | "START_READY" | "STARTING" | "LINK";
    threadId: string; previousRunId: string; baselineRunIds: string[];
    source: SPContinuation["source"]; nextRunId?: string;
    messageId?: string; replyText?: string; replySha256?: string;
  };
  output?: { threadId: string; runId: string; agentId: string; sandboxId: string; projectId?: string; base64: string };
}
/** One explicitly selected project, one member key, journal BEFORE every remote side effect. */
export class SciencePALMemberConnector {
  constructor(private readonly remote: SciencePALRemote, private readonly request: MemberRequest,
    readonly journal: ConnectorJournal, private readonly save: (value: ConnectorJournal) => Promise<void>) {}
  private async persist() { await this.save(this.journal); }
  private path(action: string) { return `/api/sciencepal-team/projects/${this.journal.projectId}/runs/${this.journal.localRunId}/${action}`; }
  private async clear() {
    delete this.journal.packet; delete this.journal.localRunId; delete this.journal.remote; delete this.journal.output;
    delete this.journal.claimId;
    delete this.journal.knownRunIds; delete this.journal.followUp;
    this.journal.phase = "IDLE"; await this.persist();
  }
  private async reportFailure() {
    this.journal.phase = "FAILING"; await this.persist();
    await this.request(this.path("status"), { status: "FAILED" });
    await this.clear(); return "远端执行失败，已确认 Host 回执";
  }
  async step(): Promise<string> {
    const j = this.journal;
    if (j.followUp) return this.advanceFollowUp();
    // Reconcile both new and legacy journals before replaying /started. A captain may
    // already have retried the failed run; this only reads its immutable identity.
    if (j.phase === "RUNNING" || j.phase === "FAILING") {
      const project = await this.request<SPProject>(`/api/sciencepal-team/projects/${j.projectId}`);
      const run = project.runs.find(r => r.id === j.localRunId);
      if (run?.status === "FAILED" && run.claimId === j.claimId && j.claimId && run.ownerNodeId === j.packet?.run.ownerNodeId &&
          (!j.remote || run.threadId === j.remote.threadId && run.runId === j.remote.runId)) {
        await this.clear(); return "Host 已记录原运行失败，已恢复连接器日志";
      }
    }
    if (j.phase === "FAILING") return this.reportFailure();
    if (j.phase === "UNKNOWN" || j.phase === "SUBMITTING") {
      j.phase = "UNKNOWN"; await this.persist();
      await this.request(this.path("status"), { status: "UNKNOWN" }).catch(() => undefined);
      return "UNKNOWN：提交结果未知，禁止自动重发；请核对 SciencePAL 线程";
    }
    if (j.phase === "IDLE") {
      const jobs = await this.request<{ projectId: string; paused: boolean; phase: string; run: { id: string; status: string; agent: SPAgentBinding } }[]>("/api/sciencepal-team/jobs");
      const next = jobs.find(x => x.projectId === j.projectId && (x.run.agent.platform ?? "sciencepal") === "sciencepal" && !x.paused && !["BLOCKED", "CHANGES_REQUESTED", "CHANGE_READY"].includes(x.phase) && x.run.status === "READY");
      if (!next) {
        const next = await this.request<ReturnType<typeof projectNextActions>>(`/api/sciencepal-team/projects/${j.projectId}/next`);
        return next.actions.map(a => `${a.isMine ? "我" : a.ownerLabel}：${a.title}。${a.detail}`).join("\n");
      }
      j.localRunId = next.run.id; j.claimId = randomUUID(); j.phase = "CLAIMING"; await this.persist();
    }
    if (j.phase === "CLAIMING") {
      j.packet = await this.request<SPTeamPacket>(this.path("claim"), { claimId: j.claimId });
      if ((j.packet.run.agent.platform ?? "sciencepal") !== "sciencepal") throw new Error("Codex 任务须使用本地 take / submit，不能发送到 SciencePAL");
      const files = j.packet.files.map(f => {
        const bytes = Buffer.from(f.base64, "base64");
        if (bytes.length !== f.size || createHash("sha256").update(bytes).digest("hex") !== f.sha256) throw new Error("任务包字节校验失败");
        return { filename: f.filename, bytes };
      });
      const agents = await this.remote.agents();
      const runtimeId = j.packet.run.agent.runtimeAgentId ?? j.packet.run.agent.id;
      if (!agents.some(a => a.id === runtimeId)) throw new Error("本账号无法使用所分配的 Agent，未提交任务");
      j.phase = "SUBMITTING"; await this.persist();
      try {
        const executor = new AgentExecutor(new AgentRegistry({sciencepal:this.remote}), {VIBE_AGENT:"sciencepal"});
        const handle = await executor.start({prompt:j.packet.run.prompt,transportRequested:"auto"} as ExecutionCommand, ".", {agentId:runtimeId,files});
        if(!handle.remote)throw Error("SciencePAL 适配器未返回远端回执");
        j.remote = handle.remote;
      } catch (error) {
        if (error instanceof SciencePALError && !error.uncertain) {
          if (error.retryable) { j.phase = "CLAIMING"; await this.persist(); throw error; }
          return this.reportFailure();
        }
        j.phase = "UNKNOWN"; await this.persist();
        await this.request(this.path("status"), { status: "UNKNOWN" }).catch(() => undefined);
        return "提交结果未知，已阻止重新提交";
      }
      j.phase = "RUNNING"; await this.persist();
    }
    if (j.phase === "RUNNING") {
      await this.request(this.path("started"), j.remote);
      const status = await this.remote.run(j.remote!.runId);
      if (["failed", "stopped", "cancelled", "error"].includes(status)) {
        return this.reportFailure();
      }
      if (["asked", "paused", "waiting_for_input"].includes(status)) {
        await this.request(this.path("status"), { status: "NEEDS_INPUT" });
        if (this.remote.threadRuns) {
          const known = j.knownRunIds ?? [j.remote!.runId];
          const next = await this.nextRun(j.remote!.threadId, j.remote!.runId, known, true);
          if (next) {
            j.followUp = { stage: "LINK", threadId: j.remote!.threadId, previousRunId: j.remote!.runId,
              baselineRunIds: known, source: "sciencepal-web", nextRunId: next };
            await this.persist(); return this.advanceFollowUp();
          }
        }
        return `NEEDS_INPUT：在本人 SciencePAL 原线程 ${j.remote!.threadId} 回复，或停止 work 后运行 reply PROJECT ANSWER.md；不自动猜测答案`;
      }
      if (status !== "completed") return `运行中：${status}`;
      const info = await this.remote.sandbox(j.remote!.threadId);
      if (info.agentId !== (j.packet!.run.agent.runtimeAgentId ?? j.packet!.run.agent.id)) throw new Error("远端 Agent 身份不匹配");
      const bytes = await this.remote.download(info.sandboxId, j.packet!.run.outputFilename);
      j.output = { ...j.remote!, ...info, base64: Buffer.from(bytes).toString("base64") }; j.phase = "OUTPUT"; await this.persist();
    }
    if (j.phase === "OUTPUT") {
      const result = await this.request<{ status: string }>(this.path("complete"), j.output);
      await this.clear(); return `成果已冻结：${result.status}`;
    }
    return "等待";
  }
  /** Only a single new run on this same, verified thread can be adopted. */
  private async nextRun(threadId: string, previousRunId: string, known: string[], publishLocation = false) {
    if (!this.remote.threadRuns) throw new Error("SciencePAL 不支持线程运行查询，不能安全续接");
    const info = await this.remote.sandbox(threadId), runs = await this.remote.threadRuns(threadId);
    const agentId = this.journal.packet!.run.agent.runtimeAgentId ?? this.journal.packet!.run.agent.id;
    const previous = runs.find(r => r.id === previousRunId);
    if (info.agentId !== agentId || !previous || new Set(runs.map(r => r.id)).size !== runs.length || runs.some(r => r.threadId !== threadId || r.agentId !== agentId || !Number.isFinite(Date.parse(r.startedAt)))) throw new Error("续接线程、Agent 或运行历史不匹配，未启动任务");
    const candidates = runs.filter(r => !known.includes(r.id));
    if (candidates.length > 1 || candidates.some(r => Date.parse(r.startedAt) < Date.parse(previous.startedAt))) throw new Error("发现多个或过早的续接运行，请核对原线程；不会猜选或重发");
    // Reuse the existing verified read; this does not send an answer or start a run.
    if (publishLocation && info.projectId) await this.request(this.path("status"), {
      status: "NEEDS_INPUT", location: { threadId, runId: previousRunId, projectId: info.projectId },
    });
    return candidates[0]?.id;
  }
  private async canReply() {
    const j = this.journal, p = await this.request<SPProject>(`/api/sciencepal-team/projects/${j.projectId}`);
    const r = p.runs.find(r => r.id === j.localRunId);
    if (!r || !isLatestSPRun(p.runs, r) || r.revision !== p.revision || r.ownerNodeId !== j.packet?.run.ownerNodeId || p.paused || !["RUNNING", "NEEDS_INPUT"].includes(r.status)) throw new Error("项目已暂停、被新版本替代或不允许回复，未提交答复");
    if ((r.continuations?.length ?? 0) >= 6 || !hasRunCapacity(p)) throw new Error("续接次数已达上限，未提交答复");
  }
  async reply(content: string): Promise<string> {
    const j = this.journal;
    if (j.followUp) throw new Error("已有待确认答复，请运行 work 恢复；不能替换或重复提交");
    if (j.phase !== "RUNNING" || !j.remote || !j.packet || !this.remote.addMessage || !this.remote.continueRun) throw new Error("当前没有可答复的原线程");
    if (!content.trim() || content.length > 8000) throw new Error("答复需为 1–8000 字符");
    await this.canReply();
    if (!["asked", "paused", "waiting_for_input"].includes(await this.remote.run(j.remote.runId))) throw new Error("原运行未等待输入，未发送答复");
    const known = j.knownRunIds ?? [j.remote.runId];
    if (await this.nextRun(j.remote.threadId, j.remote.runId, known)) throw new Error("网页已产生续接运行，请先运行 work 接回，未发送重复答复");
    await this.request(this.path("status"), { status: "NEEDS_INPUT" });
    j.followUp = { stage: "MESSAGE", threadId: j.remote.threadId, previousRunId: j.remote.runId, baselineRunIds: [...known],
      source: "member-reply", messageId: randomUUID(), replyText: content, replySha256: createHash("sha256").update(content).digest("hex") };
    await this.persist(); return this.advanceFollowUp();
  }
  private async advanceFollowUp(): Promise<string> {
    const j = this.journal, f = j.followUp!;
    if (f.stage === "MESSAGE") {
      await this.canReply();
      if (await this.nextRun(f.threadId, f.previousRunId, f.baselineRunIds)) throw new Error("答复期间出现外部续接运行，请核对；未再次发送或启动");
      // Official API deduplicates this exact message ID + content after a timeout.
      await this.remote.addMessage!(f.threadId, f.messageId!, f.replyText!);
      f.stage = "START_READY"; await this.persist();
    }
    if (f.stage === "START_READY") {
      await this.canReply();
      const existing = await this.nextRun(f.threadId, f.previousRunId, f.baselineRunIds);
      if (existing) { f.nextRunId = existing; f.stage = "LINK"; await this.persist(); }
      else {
        f.stage = "STARTING"; await this.persist(); // start has no idempotency guarantee
        try { f.nextRunId = (await this.remote.continueRun!(f.threadId)).runId; }
        catch (error) {
          if (error instanceof SciencePALError && !error.uncertain) { f.stage = "START_READY"; await this.persist(); throw error; }
          return "续接启动结果未知：已保存答复，work 只查询原线程，不重复启动";
        }
        f.stage = "LINK"; await this.persist();
      }
    }
    if (f.stage === "STARTING") {
      const existing = await this.nextRun(f.threadId, f.previousRunId, f.baselineRunIds);
      if (!existing) return "续接启动待确认：原线程尚无唯一新运行；不会重发 start";
      f.nextRunId = existing; f.stage = "LINK"; await this.persist();
    }
    if (f.stage === "LINK") {
      // Confirm returned IDs through the original thread, even on a successful POST.
      if (await this.nextRun(f.threadId, f.previousRunId, f.baselineRunIds) !== f.nextRunId) return "等待续接运行出现在原线程；不会重新启动";
      await this.request(this.path("continued"), { threadId: f.threadId, previousRunId: f.previousRunId, runId: f.nextRunId, source: f.source,
        ...(f.source === "member-reply" ? { messageId: f.messageId, replySha256: f.replySha256 } : {}) });
      j.remote = { threadId: f.threadId, runId: f.nextRunId! };
      j.knownRunIds = [...f.baselineRunIds, f.nextRunId!];
      delete j.followUp; j.phase = "RUNNING"; await this.persist();
      return "已接回原线程的新运行，继续执行与采集；续接历史已保存";
    }
    return "等待续接";
  }
  async recover(threadId: string) {
    if (!["UNKNOWN", "SUBMITTING"].includes(this.journal.phase) || !this.journal.packet || !this.remote.threadRuns) throw new Error("没有可恢复的未知提交");
    const info = await this.remote.sandbox(threadId), runs = await this.remote.threadRuns(threadId);
    if (info.agentId !== (this.journal.packet.run.agent.runtimeAgentId ?? this.journal.packet.run.agent.id) || runs.length !== 1 || runs[0]!.agentId !== info.agentId || runs[0]!.threadId !== threadId) throw new Error("线程身份不匹配或有多个运行，需要人工核对");
    if (!Number.isFinite(Date.parse(runs[0]!.startedAt)) || Date.parse(runs[0]!.startedAt) < Date.parse(this.journal.packet.run.createdAt) - 30_000) throw new Error("线程早于本次任务，不能恢复");
    const project = await this.request<SPProject>(`/api/sciencepal-team/projects/${this.journal.projectId}`);
    if (project.runs.some(r => r.id !== this.journal.localRunId && r.threadId === threadId)) throw new Error("线程已绑定其他运行");
    this.journal.remote = { threadId, runId: runs[0]!.id }; this.journal.phase = "RUNNING"; await this.persist();
  }
}
