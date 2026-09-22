import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import type { ExecutionCommand } from "@vibe-git/protocol";
import type { CodexProbe } from "./codex-capability.js";

export interface ExecutionCompletion {
  status: "COMPLETED" | "FAILED" | "INTERRUPTED";
  detail: string;
  outputSummary: string | null;
}

export interface ActiveRun {
  transport: "app-server" | "cli";
  runtimeId: string;
  done: Promise<ExecutionCompletion>;
  interrupt(): Promise<ExecutionCompletion>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function trimOutput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(-8_000) : null;
}

export class CodexExecutor {
  constructor(
    private readonly capability: CodexProbe,
    private readonly executable = process.env.CODEX_BIN?.trim() || "codex"
  ) {}

  async start(command: ExecutionCommand, workspaceRaw: string): Promise<ActiveRun> {
    if (!command.prompt) throw new Error("开工命令缺少任务提示");
    const workspace = resolve(workspaceRaw);
    const transport = this.selectTransport(command);
    return transport === "app-server"
      ? this.startAppServer(command, workspace)
      : this.startCli(command, workspace);
  }

  private selectTransport(command: ExecutionCommand): "app-server" | "cli" {
    let requested = command.transportRequested;
    if (requested === "auto") requested = this.capability.transports.preferred;
    if (requested === "auto") requested = this.capability.transports.appServer === "available" ? "app-server" : "cli";
    if (requested === "app-server" && this.capability.transports.appServer !== "available") throw new Error("本机 Codex App Server 不可用");
    if (requested === "cli" && this.capability.transports.cli !== "available") throw new Error("本机 Codex CLI 不可用或未登录");
    return requested;
  }

  private async startCli(command: ExecutionCommand, workspace: string): Promise<ActiveRun> {
    const child = spawn(this.executable, ["exec", "--sandbox", "workspace-write", "--json", "--cd", workspace, "-"], {
      cwd: workspace, windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
    });
    const started = deferred<string>();
    const completion = deferred<ExecutionCompletion>();
    let settled = false;
    let startupSettled = false;
    let interruptRequested = false;
    let threadId = "";
    let finalMessage = "";
    let stderr = "";
    let failedEvent = "";
    const startupTimer = setTimeout(() => {
      if (startupSettled) return;
      startupSettled = true;
      child.kill();
      started.reject(new Error("Codex CLI 在 30 秒内未返回 thread.started"));
    }, 30_000);
    const finish = (result: ExecutionCompletion) => {
      if (settled) return;
      settled = true;
      completion.resolve(result);
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-32_000); });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let event: { type?: string; thread_id?: string; message?: string; error?: { message?: string }; item?: { type?: string; text?: string } };
      try { event = JSON.parse(line) as typeof event; } catch { return; }
      if (event.type === "thread.started" && event.thread_id) {
        threadId = event.thread_id;
        if (!startupSettled) { startupSettled = true; clearTimeout(startupTimer); started.resolve(threadId); }
      }
      if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) finalMessage = event.item.text;
      if (event.type === "turn.failed" || event.type === "error") failedEvent = event.error?.message || event.message || event.type;
    });
    child.once("error", (error) => {
      if (!startupSettled) { startupSettled = true; clearTimeout(startupTimer); started.reject(error); }
      finish({ status: "FAILED", detail: errorText(error), outputSummary: trimOutput(finalMessage) });
    });
    child.once("close", (code, signal) => {
      clearTimeout(startupTimer);
      if (!startupSettled) {
        startupSettled = true;
        started.reject(new Error(`Codex CLI 启动失败：${stderr.trim().slice(-2_000) || `退出码 ${code ?? "null"}`}`));
      }
      if (interruptRequested) finish({ status: "INTERRUPTED", detail: `Codex CLI 已中断${signal ? ` (${signal})` : ""}`, outputSummary: trimOutput(finalMessage) });
      else if (code === 0 && !failedEvent) finish({ status: "COMPLETED", detail: "Codex CLI 轮次已完成", outputSummary: trimOutput(finalMessage) });
      else finish({ status: "FAILED", detail: failedEvent || stderr.trim().slice(-2_000) || `Codex CLI 退出码 ${code ?? "null"}`, outputSummary: trimOutput(finalMessage) });
    });
    child.stdin.end(command.prompt, "utf8");
    const runtimeId = await started.promise;
    return {
      transport: "cli", runtimeId, done: completion.promise,
      interrupt: async () => {
        interruptRequested = true;
        if (!child.killed) child.kill();
        return completion.promise;
      }
    };
  }

  private async startAppServer(command: ExecutionCommand, workspace: string): Promise<ActiveRun> {
    const child = spawn(this.executable, ["app-server", "--stdio"], {
      cwd: workspace, windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
    });
    const client = new AppServerClient(child);
    try {
      await client.request("initialize", { clientInfo: { name: "vibe_git_relay", title: "Vibe-Git Relay", version: "0.1.0" } }, 20_000);
      client.notify("initialized", {});
      const threadResult = await client.request<{ thread: { id: string } }>("thread/start", {
        cwd: workspace, approvalPolicy: "never", sandbox: "workspaceWrite", serviceName: "vibe_git_relay"
      }, 20_000);
      const threadId = threadResult.thread.id;
      const turnResult = await client.request<{ turn: { id: string } }>("turn/start", {
        threadId,
        input: [{ type: "text", text: command.prompt }],
        cwd: workspace,
        approvalPolicy: "never",
        sandboxPolicy: { type: "workspaceWrite", writableRoots: [workspace], networkAccess: true },
        summary: "concise"
      }, 30_000);
      const turnId = turnResult.turn.id;
      const runtimeId = `${threadId}:${turnId}`;
      return {
        transport: "app-server", runtimeId, done: client.completion,
        interrupt: async () => {
          client.markInterruptRequested();
          try { await client.request("turn/interrupt", { threadId, turnId }, 15_000); }
          catch { client.kill(); }
          return client.completion;
        }
      };
    } catch (error) {
      client.kill();
      throw error;
    }
  }
}

class AppServerClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void; timer: NodeJS.Timeout }>();
  private readonly completed = deferred<ExecutionCompletion>();
  private completionSettled = false;
  private interruptRequested = false;
  private stderr = "";
  private finalMessage = "";

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-32_000); });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    child.once("error", (error) => this.failAll(error));
    child.once("close", (code, signal) => {
      this.failPending(new Error(`Codex App Server 已退出：${code ?? "null"}${signal ? ` (${signal})` : ""}`));
      if (!this.completionSettled) this.finish({
        status: this.interruptRequested ? "INTERRUPTED" : "FAILED",
        detail: this.interruptRequested ? "Codex App Server 已中断" : this.stderr.trim().slice(-2_000) || `App Server 退出码 ${code ?? "null"}`,
        outputSummary: trimOutput(this.finalMessage)
      });
    });
  }

  get completion() { return this.completed.promise; }

  markInterruptRequested() { this.interruptRequested = true; }
  kill() { if (!this.child.killed) this.child.kill(); }

  notify(method: string, params: unknown) {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 20_000): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Codex App Server ${method} 超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolvePromise(value as T), reject: rejectPromise, timer });
      this.child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  private handleLine(line: string) {
    let message: { id?: number; method?: string; result?: unknown; error?: { message?: string }; params?: Record<string, unknown> };
    try { message = JSON.parse(line) as typeof message; } catch { return; }
    if (typeof message.id === "number" && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || "Codex App Server 请求失败"));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.id === "number" && message.method) {
      this.child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: "Vibe-Git 自动执行不接受交互请求" } })}\n`);
      return;
    }
    if (message.method === "item/agentMessage/delta") {
      const delta = message.params?.delta;
      if (typeof delta === "string") this.finalMessage = (this.finalMessage + delta).slice(-32_000);
    }
    if (message.method === "item/completed") {
      const item = message.params?.item as { type?: string; text?: string; content?: Array<{ text?: string }> } | undefined;
      if (item?.type === "agentMessage") this.finalMessage = item.text || item.content?.map((part) => part.text ?? "").join("") || this.finalMessage;
    }
    if (message.method === "turn/completed") {
      const turn = message.params?.turn as { status?: string; error?: { message?: string } } | undefined;
      const status = turn?.status;
      const interrupted = this.interruptRequested || status === "interrupted";
      const failed = status === "failed" || Boolean(turn?.error);
      this.finish({
        status: interrupted ? "INTERRUPTED" : failed ? "FAILED" : "COMPLETED",
        detail: interrupted ? "Codex App Server 轮次已中断" : failed ? turn?.error?.message || "Codex App Server 轮次失败" : "Codex App Server 轮次已完成",
        outputSummary: trimOutput(this.finalMessage)
      });
      this.child.stdin.end();
      setTimeout(() => this.kill(), 250);
    }
  }

  private finish(result: ExecutionCompletion) {
    if (this.completionSettled) return;
    this.completionSettled = true;
    this.completed.resolve(result);
  }

  private failPending(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  private failAll(error: Error) {
    this.failPending(error);
    this.finish({ status: "FAILED", detail: error.message, outputSummary: trimOutput(this.finalMessage) });
  }
}
