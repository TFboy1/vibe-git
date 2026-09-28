import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import type { StageTask, V20BootstrapPayload } from "@vibe-git/protocol";
import { api } from "./api.js";
import { codexInvocation } from "./codex-command.js";
import { readJson, vibeHome, writeJson, type ClientConfig } from "./config.js";

const THREADS_PATH = () => resolve(vibeHome(), "local-chat-threads.json");
type ThreadRecord = { threadId: string; taskRevision: number; workspace: string };
type ThreadMap = Record<string, ThreadRecord>;
export const DETAIL_SCHEMA = { type: "object", additionalProperties: false,
  required: ["steps", "files", "mockUsage", "validation", "notes"], properties: {
    steps: { type: "array", items: { type: "string" } }, files: { type: "array", items: { type: "string" } },
    mockUsage: { type: "string" }, validation: { type: "array", items: { type: "string" } }, notes: { type: "string" }
  } } as const;
export interface ExecutionDetail { steps: string[]; files: string[]; mockUsage: string; validation: string[]; notes: string }
export interface PlanQuestion { id: string; header: string; question: string; options: Array<{ label: string; description: string }> }
export type PlanStep = { kind: "question"; questions: PlanQuestion[] } | { kind: "ready"; text: string };

function key(config: ClientConfig, taskId: string): string { return `${config.hostUrl}|${config.nodeId}|${taskId}`; }

export class LocalAppServer {
  private child: ChildProcessWithoutNullStreams;
  private counter = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private turnDone: { resolve(): void; reject(error: Error): void; timer: NodeJS.Timeout } | null = null;
  private finalText = "";
  private onDelta: (delta: string) => void = () => undefined;
  private onProgress: (status: string) => void = () => undefined;
  private reasoningSummary = "";
  private planQuestion: { requestId: number; questions: PlanQuestion[] } | null = null;
  private planQuestionWaiter: ((question: PlanStep) => void) | null = null;
  private planCompletion: Promise<void> | null = null;

  constructor(workspace: string) {
    const invocation = codexInvocation();
    this.child = spawn(invocation.file, [...invocation.prefixArgs, "app-server", "--stdio"],
      { cwd: workspace, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    createInterface({ input: this.child.stdout }).on("line", (line) => this.receive(line));
    this.child.once("error", (error) => this.failAll(error));
    this.child.once("close", () => this.failAll(new Error("本机 Codex App Server 已退出")));
  }
  private failAll(error: Error): void {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
    if (this.turnDone) { clearTimeout(this.turnDone.timer); this.turnDone.reject(error); this.turnDone = null; }
  }
  private receive(line: string): void {
    let value: { id?: number; method?: string; result?: unknown; error?: { message?: string }; params?: Record<string, unknown> };
    try { value = JSON.parse(line) as typeof value; } catch { return; }
    if (typeof value.id === "number" && !value.method) {
      const item = this.pending.get(value.id); if (!item) return;
      this.pending.delete(value.id); clearTimeout(item.timer);
      value.error ? item.reject(new Error(value.error.message ?? "Codex 请求失败")) : item.resolve(value.result);
      return;
    }
    if (typeof value.id === "number" && value.method) {
      if (value.method === "item/tool/requestUserInput" && this.planCompletion) {
        const raw = value.params?.questions;
        const questions = Array.isArray(raw) ? raw.flatMap((item) => {
          const question = item as Record<string, unknown>;
          if (typeof question.id !== "string" || typeof question.question !== "string") return [];
          const options = Array.isArray(question.options) ? question.options.flatMap((option) => {
            const choice = option as Record<string, unknown>;
            return typeof choice.label === "string" ? [{ label: choice.label, description: typeof choice.description === "string" ? choice.description : "" }] : [];
          }) : [];
          return [{ id: question.id, header: typeof question.header === "string" ? question.header : "", question: question.question, options }];
        }) : [];
        if (questions.length) {
          this.planQuestion = { requestId: value.id, questions };
          if (this.turnDone) clearTimeout(this.turnDone.timer);
          this.planQuestionWaiter?.({ kind: "question", questions });
          this.planQuestionWaiter = null;
          return;
        }
      }
      this.child.stdin.write(`${JSON.stringify({ id: value.id, error: { code: -32601, message: "只读细化不接受工具审批" } })}\n`);
      return;
    }
    if (value.method === "item/agentMessage/delta") {
      const delta = value.params?.delta;
      if (typeof delta === "string") { this.finalText += delta; this.onDelta(delta); }
    }
    if (value.method === "item/completed") {
      const item = value.params?.item as { type?: string; text?: string } | undefined;
      if (item?.type === "agentMessage") {
        if (typeof item.text === "string") this.finalText = item.text;
      }
    }
    if (value.method === "item/reasoning/summaryTextDelta") {
      const delta = value.params?.delta;
      if (typeof delta === "string" && delta.trim()) {
        this.reasoningSummary = (this.reasoningSummary + delta).slice(-320);
        this.onProgress(this.reasoningSummary.slice(-160));
      }
    }
    if (value.method === "item/started") {
      const item = value.params?.item as { type?: string } | undefined;
      if (item?.type === "commandExecution") this.onProgress("正在查看项目");
    }
    if (value.method === "turn/completed" && this.turnDone) {
      const turn = value.params?.turn as { status?: string; error?: { message?: string } } | undefined;
      const done = this.turnDone; this.turnDone = null; clearTimeout(done.timer);
      turn?.status === "failed" || turn?.error ? done.reject(new Error(turn?.error?.message ?? "Codex 对话失败")) : done.resolve();
    }
  }
  request<T>(method: string, params: unknown, timeout = 20_000): Promise<T> {
    const id = ++this.counter;
    return new Promise<T>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => { this.pending.delete(id); rejectPromise(new Error(`${method} 超时`)); }, timeout);
      this.pending.set(id, { resolve: (value) => resolvePromise(value as T), reject: rejectPromise, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  notify(method: string, params: unknown): void { this.child.stdin.write(`${JSON.stringify({ method, params })}\n`); }
  async initialize(): Promise<void> {
    await this.request("initialize", { clientInfo: { name: "vibe_git_local", title: "Vibe-Git Local", version: "0.21.0" }, capabilities: { experimentalApi: true } });
    this.notify("initialized", {});
  }
  async turn(threadId: string, text: string, workspace: string, onDelta: (delta: string) => void, outputSchema?: unknown, model?: string, timeoutMs = 180_000, _signal?: AbortSignal): Promise<string> {
    this.finalText = ""; this.onDelta = onDelta;
    const completed = new Promise<void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => { this.turnDone = null; rejectPromise(new Error("Codex 思考超时，请重试")); }, timeoutMs);
      this.turnDone = { resolve: resolvePromise, reject: rejectPromise, timer };
    });
    try {
      await this.request("turn/start", { threadId, input: [{ type: "text", text }], cwd: workspace,
        approvalPolicy: "never", sandboxPolicy: { type: "readOnly" }, summary: "concise", ...(model ? { model } : {}), ...(outputSchema ? { outputSchema } : {}) }, 30_000);
    } catch (error) {
      if (this.turnDone) { clearTimeout(this.turnDone.timer); this.turnDone = null; }
      void completed.catch(() => undefined);
      throw error;
    }
    await completed;
    return this.finalText;
  }
  async planMode(model?: string): Promise<{ mode: "plan"; settings: { model: string; developer_instructions: null; reasoning_effort?: string | null } }> {
    const listed = await this.request<{ data?: Array<{ mode?: string | null; model?: string | null; reasoning_effort?: string | null }> }>("collaborationMode/list", {}, 10_000);
    const preset = listed.data?.find((item) => item.mode === "plan");
    if (!preset) throw new Error("当前 Codex 不支持原生 Plan 模式，请更新 Codex CLI");
    const models = await this.request<{ data: Array<{ model: string; isDefault?: boolean }> }>("model/list", { limit: 100, includeHidden: false }, 10_000);
    if (model && !models.data.some((item) => item.model === model)) throw new Error("所选 Codex 模型当前不可用，请在算力网重新选择");
    const selected = model || preset.model || models.data.find((item) => item.isDefault)?.model || models.data[0]?.model;
    if (!selected) throw new Error("Codex 未返回可用模型");
    return { mode: "plan", settings: { model: selected, developer_instructions: null,
      ...(!model && preset.reasoning_effort ? { reasoning_effort: preset.reasoning_effort } : {}) } };
  }

  private async waitPlanStep(): Promise<PlanStep> {
    if (this.planQuestion) return { kind: "question", questions: this.planQuestion.questions };
    if (!this.planCompletion) throw new Error("Plan 会话未启动");
    const question = new Promise<PlanStep>((resolvePromise) => { this.planQuestionWaiter = resolvePromise; });
    try {
      await Promise.race([this.planCompletion, question.then(() => undefined)]);
      if (this.planQuestion) return { kind: "question", questions: (this.planQuestion as { requestId: number; questions: PlanQuestion[] }).questions };
      const text = this.finalText.trim();
      this.planCompletion = null;
      this.planQuestionWaiter = null;
      if (!text) throw new Error("Codex 未返回问题或需求草稿，请重试");
      return { kind: "ready", text };
    } finally { this.planQuestionWaiter = null; }
  }

  async startPlanTurn(threadId: string, prompt: string, workspace: string, mode: Awaited<ReturnType<LocalAppServer["planMode"]>>, model: string | undefined, onDelta: (delta: string) => void, onProgress: (status: string) => void): Promise<PlanStep> {
    this.finalText = ""; this.reasoningSummary = ""; this.onDelta = onDelta; this.onProgress = onProgress;
    this.planCompletion = new Promise<void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => { this.turnDone = null; rejectPromise(new Error("Codex 响应超时，请重试")); }, 120_000);
      this.turnDone = { resolve: resolvePromise, reject: rejectPromise, timer };
    });
    void this.planCompletion.catch(() => undefined);
    try {
      await this.request("turn/start", { threadId, input: [{ type: "text", text: prompt }], cwd: workspace,
        approvalPolicy: "never", sandboxPolicy: { type: "readOnly" }, collaborationMode: mode,
        ...(model ? { model } : {}) }, 30_000);
      return await this.waitPlanStep();
    } catch (error) {
      if (this.turnDone) { clearTimeout(this.turnDone.timer); this.turnDone = null; }
      void this.planCompletion?.catch(() => undefined);
      this.planCompletion = null;
      throw error;
    }
  }

  async answerPlanQuestion(answer: string, onDelta: (delta: string) => void, onProgress: (status: string) => void): Promise<PlanStep> {
    const pending = this.planQuestion;
    if (!pending || !this.planCompletion || !this.turnDone) throw new Error("Plan 当前没有待回答的问题");
    this.planQuestion = null;
    this.finalText = ""; this.reasoningSummary = ""; this.onDelta = onDelta; this.onProgress = onProgress;
    this.turnDone.timer = setTimeout(() => { const done = this.turnDone; this.turnDone = null; done?.reject(new Error("Codex 响应超时，请重试")); }, 120_000);
    this.child.stdin.write(`${JSON.stringify({ id: pending.requestId, result: { answers: Object.fromEntries(pending.questions.map((question) => [question.id, { answers: [answer] }])) } })}\n`);
    return this.waitPlanStep();
  }

  close(): void { if (!this.child.killed) this.child.kill(); }
}

async function taskContext(config: ClientConfig, taskId: string): Promise<{ task: StageTask; markdown: string }> {
  const result = await api<{ task: StageTask; markdown: string }>(config, `/api/v1/tasks/${encodeURIComponent(taskId)}/detail`);
  if (result.task.assigneeNodeId !== config.nodeId || result.task.archived) throw new Error("只能细化自己的当前切片");
  return result;
}

export async function chatWithCodex(config: ClientConfig, taskId: string, message: string,
  onDelta: (delta: string) => void, finalize = false): Promise<string | ExecutionDetail> {
  if (!finalize && (!message.trim() || Buffer.byteLength(message, "utf8") > 8_000)) throw new Error("对话内容必须非空且不超过 8 KiB");
  const context = await taskContext(config, taskId);
  const map = await readJson<ThreadMap>(THREADS_PATH()) ?? {};
  const mapKey = key(config, taskId);
  const previous = map[mapKey];
  const app = new LocalAppServer(config.workspace);
  try {
    await app.initialize();
    let threadId: string | null = null;
    if (previous && previous.taskRevision === context.task.revision && previous.workspace === config.workspace) {
      try { const resumed = await app.request<{ thread: { id: string } }>("thread/resume", { threadId: previous.threadId }); threadId = resumed.thread.id; }
      catch { /* stale local rollout starts a fresh thread */ }
    }
    if (!threadId) {
      const started = await app.request<{ thread: { id: string } }>("thread/start", { cwd: config.workspace,
        approvalPolicy: "never", sandbox: "read-only", serviceName: "vibe_git_local" });
      threadId = started.thread.id;
      map[mapKey] = { threadId, taskRevision: context.task.revision, workspace: config.workspace };
      await writeJson(THREADS_PATH(), map);
    }
    const prompt = finalize
      ? "根据本线程中已确认的切片讨论，只输出执行细节 JSON：steps、files、mockUsage、validation、notes。不得改变正式目标、边界、验收或接口契约；若发现冲突，在 notes 中提示提交 change.md。"
      : `你是当前成员本人日常 Codex，只读细化切片；不写代码、不执行修改。正式任务与接口契约不可由对话覆盖，需更改时提示走 Vibe-Git PR。\n<task>\n${context.markdown}\n</task>\n<member_question>\n${message}\n</member_question>`;
    const answer = await app.turn(threadId, prompt, config.workspace, onDelta, finalize ? DETAIL_SCHEMA : undefined);
    if (!finalize) return answer;
    const value = JSON.parse(answer) as ExecutionDetail;
    if (!Array.isArray(value.steps) || !Array.isArray(value.files) || !Array.isArray(value.validation) ||
      typeof value.mockUsage !== "string" || typeof value.notes !== "string") throw new Error("Codex 细化输出不符合结构化格式");
    return value;
  } finally { app.close(); }
}

export async function draftProposalWithCodex(config: ClientConfig, userPrompt?: string, model?: string): Promise<{ markdown: string }> {
  const data = await api<V20BootstrapPayload>(config, "/api/v1/bootstrap");
  const captainPlan = data.plans.find(plan => plan.ownerNodeId === data.nodes.find(node => node.role === "captain")?.id);
  const app = new LocalAppServer(config.workspace);
  try {
    await app.initialize();
    const started = await app.request<{ thread: { id: string } }>("thread/start", { cwd: config.workspace,
      approvalPolicy: "never", sandbox: "read-only", serviceName: "vibe_git_proposal_draft" });
    const prompt = [
      "你是成员本机的 Codex。只读查看当前 Git 工作区，形成一份可供人修改的个人项目提案 Markdown。不要写文件、执行修改、启动开发或输出源码。",
      "根据仓库结构和现有需求，写出建议目标、边界、自己适合认领的工作、接口依赖、验收标准与仍需队长决定的问题。不确定的内容明确标注为待确认，不替团队擅自决定。只输出 Markdown 正文。",
      `<role>${data.viewer.role}</role>`,
      `<current_requirement revision="${data.room.requirementRevision}">${data.room.currentRequirementMarkdown.slice(0, 40_000)}</current_requirement>`,
      ...(captainPlan && captainPlan.ownerNodeId !== data.viewer.id ? [`<captain_proposal>${captainPlan.content.slice(0, 40_000)}</captain_proposal>`] : []),
      ...(userPrompt?.trim() ? [`<user_prompt>${userPrompt.trim()}</user_prompt>`] : [])
    ].join("\n\n");
    const markdown = (await app.turn(started.thread.id, prompt, config.workspace, () => undefined, undefined, model)).trim();
    if (!markdown || Buffer.byteLength(markdown, "utf8") > 256 * 1024) throw new Error("Codex 生成的提案为空或过大");
    return { markdown };
  } finally { app.close(); }
}


export interface CodexModelOption { id: string; name: string; description?: string; isDefault?: boolean }
export async function listCodexModels(config: ClientConfig): Promise<CodexModelOption[]> {
  const app = new LocalAppServer(config.workspace);
  try {
    await app.initialize();
    const options: CodexModelOption[] = [{ id: "default", name: "Codex 默认模型" }];
    let cursor: string | null = null;
    do {
      const page: { data: Array<{ id: string; model?: string; displayName?: string; description?: string; isDefault?: boolean; hidden?: boolean }>; nextCursor?: string | null } =
        await app.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      for (const item of page.data ?? []) {
        if (item.hidden) continue;
        const id = item.model || item.id;
        if (id && !options.some((option) => option.id === id)) options.push({ id, name: item.displayName || id,
          ...(item.description ? { description: item.description } : {}), ...(item.isDefault !== undefined ? { isDefault: item.isDefault } : {}) });
      }
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return options;
  } finally { app.close(); }
}
