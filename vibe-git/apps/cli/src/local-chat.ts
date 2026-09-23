import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import type { StageTask } from "@vibe-git/protocol";
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

function key(config: ClientConfig, taskId: string): string { return `${config.hostUrl}|${config.nodeId}|${taskId}`; }

class LocalAppServer {
  private child: ChildProcessWithoutNullStreams;
  private counter = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private turnDone: { resolve(): void; reject(error: Error): void; timer: NodeJS.Timeout } | null = null;
  private finalText = "";
  private onDelta: (delta: string) => void = () => undefined;

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
      this.child.stdin.write(`${JSON.stringify({ id: value.id, error: { code: -32601, message: "只读细化不接受工具审批" } })}\n`);
      return;
    }
    if (value.method === "item/agentMessage/delta") {
      const delta = value.params?.delta;
      if (typeof delta === "string") { this.finalText += delta; this.onDelta(delta); }
    }
    if (value.method === "item/completed") {
      const item = value.params?.item as { type?: string; text?: string } | undefined;
      if (item?.type === "agentMessage" && typeof item.text === "string") this.finalText = item.text;
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
    await this.request("initialize", { clientInfo: { name: "vibe_git_local", title: "Vibe-Git Local", version: "0.21.0" } });
    this.notify("initialized", {});
  }
  async turn(threadId: string, text: string, workspace: string, onDelta: (delta: string) => void, outputSchema?: unknown): Promise<string> {
    this.finalText = ""; this.onDelta = onDelta;
    const completed = new Promise<void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => { this.turnDone = null; rejectPromise(new Error("Codex 对话超时")); }, 180_000);
      this.turnDone = { resolve: resolvePromise, reject: rejectPromise, timer };
    });
    try {
      await this.request("turn/start", { threadId, input: [{ type: "text", text }], cwd: workspace,
        approvalPolicy: "never", sandboxPolicy: { type: "readOnly" }, summary: "concise", ...(outputSchema ? { outputSchema } : {}) }, 30_000);
    } catch (error) {
      if (this.turnDone) { clearTimeout(this.turnDone.timer); this.turnDone = null; }
      void completed.catch(() => undefined);
      throw error;
    }
    await completed;
    return this.finalText;
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
        approvalPolicy: "never", sandbox: "readOnly", serviceName: "vibe_git_local" });
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
