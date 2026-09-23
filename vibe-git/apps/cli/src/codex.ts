import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { CapabilityStateV20, RateLimitWindow, WorkTransport } from "@vibe-git/protocol";

const executable = () => process.env.CODEX_BIN?.trim() || "codex";
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function commandWorks(args: string[], env?: NodeJS.ProcessEnv): boolean {
  try {
    execFileSync(executable(), args, { encoding: "utf8", windowsHide: true, timeout: 8_000, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, ...env } });
    return true;
  } catch { return false; }
}

export function probeCodex(env?: NodeJS.ProcessEnv): { state: CapabilityStateV20; appServer: boolean; version: string | null } {
  try {
    const version = execFileSync(executable(), ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5_000, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, ...env } }).trim();
    const loggedIn = commandWorks(["login", "status"], env);
    return { state: loggedIn ? "available" : "unverified", appServer: loggedIn && commandWorks(["app-server", "--help"], env), version };
  } catch { return { state: "unsupported", appServer: false, version: null }; }
}

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

export interface RunResult { status: "completed" | "failed" | "interrupted"; detail: string }
export interface ActiveRun { runtimeId: string; transport: "app-server" | "cli"; done: Promise<RunResult>; interrupt(): Promise<RunResult> }

export async function runAudit(prompt: string, schema: unknown, workspace: string, codexHome: string): Promise<unknown> {
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(resolve(tmpdir(), "vibe-git-audit-"));
  const schemaPath = resolve(temp, "schema.json");
  const outputPath = resolve(temp, "result.json");
  await writeFile(schemaPath, JSON.stringify(schema), "utf8");
  try {
    await new Promise<void>((done, fail) => {
      const child = spawn(executable(), [
        "exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check",
        "--output-schema", schemaPath, "--output-last-message", outputPath, "--cd", workspace, "-"
      ], { cwd: workspace, windowsHide: true, env: { ...process.env, CODEX_HOME: codexHome }, stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 25 * 60_000);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-32_000); });
      child.once("error", (error) => { clearTimeout(timeout); fail(error); });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (timedOut) fail(new Error("Codex 审核超过 25 分钟，作业已停止"));
        else if (code === 0) done();
        else fail(new Error(stderr.trim().slice(-4_000) || `Codex 审核退出码 ${code ?? "null"}`));
      });
      child.stdin.end(prompt, "utf8");
    });
    return JSON.parse(await readFile(outputPath, "utf8")) as unknown;
  } finally { await rm(temp, { recursive: true, force: true }).catch(() => undefined); }
}

export async function startDevelopment(prompt: string, workspaceRaw: string, requested: WorkTransport, networkAccess = true): Promise<ActiveRun> {
  const workspace = resolve(workspaceRaw);
  const probe = probeCodex();
  if (probe.state !== "available") throw new Error("日常 Codex CLI 未登录或不可用");
  const transport = requested === "cli" ? "cli" : requested === "app-server" ? "app-server" : probe.appServer ? "app-server" : "cli";
  if (transport === "app-server" && !probe.appServer) throw new Error("本机 Codex App Server 不可用");
  if (transport === "app-server") {
    try { return await startAppServer(prompt, workspace, networkAccess); }
    catch (error) {
      if (requested !== "auto") throw error;
      return startCli(prompt, workspace);
    }
  }
  return startCli(prompt, workspace);
}

async function startCli(prompt: string, workspace: string): Promise<ActiveRun> {
  const child = spawn(executable(), ["exec", "--sandbox", "workspace-write", "--json", "--cd", workspace, "-"], {
    cwd: workspace, windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
  });
  const started = deferred<string>();
  const completion = deferred<RunResult>();
  let startSettled = false;
  let settled = false;
  let interrupted = false;
  let stderr = "";
  let eventError = "";
  const timer = setTimeout(() => {
    if (!startSettled) { startSettled = true; child.kill(); started.reject(new Error("Codex CLI 启动超时")); }
  }, 30_000);
  const finish = (value: RunResult) => { if (!settled) { settled = true; completion.resolve(value); } };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-32_000); });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let event: { type?: string; thread_id?: string; message?: string; error?: { message?: string } };
    try { event = JSON.parse(line) as typeof event; } catch { return; }
    if (event.type === "thread.started" && event.thread_id && !startSettled) {
      startSettled = true; clearTimeout(timer); started.resolve(event.thread_id);
    }
    if (event.type === "turn.failed" || event.type === "error") eventError = event.error?.message || event.message || event.type;
  });
  child.once("error", (error) => {
    if (!startSettled) { startSettled = true; clearTimeout(timer); started.reject(error); }
    finish({ status: "failed", detail: message(error) });
  });
  child.once("close", (code) => {
    clearTimeout(timer);
    if (!startSettled) { startSettled = true; started.reject(new Error(stderr.trim().slice(-2_000) || `Codex CLI 退出码 ${code ?? "null"}`)); }
    finish(interrupted
      ? { status: "interrupted", detail: "Codex CLI 已中断" }
      : code === 0 && !eventError ? { status: "completed", detail: "Codex CLI 轮次已完成" }
        : { status: "failed", detail: eventError || stderr.trim().slice(-2_000) || `Codex CLI 退出码 ${code ?? "null"}` });
  });
  child.stdin.end(prompt, "utf8");
  const runtimeId = await started.promise;
  return {
    runtimeId, transport: "cli", done: completion.promise,
    interrupt: async () => { interrupted = true; if (!child.killed) child.kill(); return completion.promise; }
  };
}

async function startAppServer(prompt: string, workspace: string, networkAccess: boolean): Promise<ActiveRun> {
  const child = spawn(executable(), ["app-server", "--stdio"], { cwd: workspace, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const client = new AppServerClient(child);
  try {
    await client.request("initialize", { clientInfo: { name: "vibe_git", title: "Vibe-Git", version: "0.20.0" } }, 20_000);
    client.notify("initialized", {});
    const thread = await client.request<{ thread: { id: string } }>("thread/start", {
      cwd: workspace, approvalPolicy: "never", sandbox: "workspaceWrite", serviceName: "vibe_git"
    }, 20_000);
    const turn = await client.request<{ turn: { id: string } }>("turn/start", {
      threadId: thread.thread.id, input: [{ type: "text", text: prompt }], cwd: workspace,
      approvalPolicy: "never", sandboxPolicy: { type: "workspaceWrite", writableRoots: [workspace], networkAccess }, summary: "concise"
    }, 30_000);
    const runtimeId = `${thread.thread.id}:${turn.turn.id}`;
    return {
      runtimeId, transport: "app-server", done: client.completion,
      interrupt: async () => {
        client.interrupting = true;
        try { await client.request("turn/interrupt", { threadId: thread.thread.id, turnId: turn.turn.id }, 15_000); }
        catch { client.kill(); }
        return client.completion;
      }
    };
  } catch (error) { client.kill(); throw error; }
}

class AppServerClient {
  private id = 1;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void; timer: NodeJS.Timeout }>();
  private completed = deferred<RunResult>();
  private settled = false;
  private stderr = "";
  interrupting = false;

  constructor(private child: ChildProcessWithoutNullStreams) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-32_000); });
    createInterface({ input: child.stdout }).on("line", (line) => this.line(line));
    child.once("error", (error) => this.finish({ status: "failed", detail: message(error) }));
    child.once("close", (code) => {
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error("Codex App Server 已退出")); }
      this.pending.clear();
      this.finish(this.interrupting ? { status: "interrupted", detail: "Codex App Server 已中断" } : { status: "failed", detail: this.stderr.trim().slice(-2_000) || `App Server 退出码 ${code ?? "null"}` });
    });
  }
  get completion() { return this.completed.promise; }
  kill() { if (!this.child.killed) this.child.kill(); }
  notify(method: string, params: unknown) { this.child.stdin.write(`${JSON.stringify({ method, params })}\n`); }
  request<T = unknown>(method: string, params: unknown, timeoutMs = 20_000): Promise<T> {
    const id = this.id++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex App Server ${method} 超时`)); }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }
  private line(line: string) {
    let value: { id?: number; method?: string; result?: unknown; error?: { message?: string }; params?: Record<string, unknown> };
    try { value = JSON.parse(line) as typeof value; } catch { return; }
    if (typeof value.id === "number" && !value.method) {
      const item = this.pending.get(value.id); if (!item) return;
      this.pending.delete(value.id); clearTimeout(item.timer);
      value.error ? item.reject(new Error(value.error.message || "App Server 请求失败")) : item.resolve(value.result);
      return;
    }
    if (typeof value.id === "number" && value.method) {
      this.child.stdin.write(`${JSON.stringify({ id: value.id, error: { code: -32601, message: "Vibe-Git 不接受交互请求" } })}\n`);
      return;
    }
    if (value.method === "turn/completed") {
      const turn = value.params?.turn as { status?: string; error?: { message?: string } } | undefined;
      const interrupted = this.interrupting || turn?.status === "interrupted";
      const failed = turn?.status === "failed" || Boolean(turn?.error);
      this.finish(interrupted ? { status: "interrupted", detail: "Codex App Server 已中断" } : failed ? { status: "failed", detail: turn?.error?.message || "Codex App Server 轮次失败" } : { status: "completed", detail: "Codex App Server 轮次已完成" });
      this.child.stdin.end(); setTimeout(() => this.kill(), 250);
    }
  }
  private finish(result: RunResult) { if (!this.settled) { this.settled = true; this.completed.resolve(result); } }
}

export async function readRateLimits(codexHome: string): Promise<RateLimitWindow[]> {
  const child = spawn(executable(), ["app-server", "--stdio"], { windowsHide: true, env: { ...process.env, CODEX_HOME: codexHome }, stdio: ["pipe", "pipe", "pipe"] });
  const client = new AppServerClient(child);
  try {
    await client.request("initialize", { clientInfo: { name: "vibe_git", title: "Vibe-Git", version: "0.20.0" } }, 10_000);
    client.notify("initialized", {});
    const result = await client.request<{ rateLimits: Snapshot; rateLimitsByLimitId?: Record<string, Snapshot> | null }>("account/rateLimits/read", {}, 10_000);
    const entries = result.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length
      ? Object.entries(result.rateLimitsByLimitId) : [[result.rateLimits.limitName || result.rateLimits.limitId || "codex", result.rateLimits] as const];
    const windows: RateLimitWindow[] = [];
    for (const [name, snapshot] of entries) {
      for (const [suffix, window] of [["5h", snapshot.primary], ["week", snapshot.secondary]] as const) {
        if (!window) continue;
        const used = typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent) ? Math.max(0, Math.min(100, window.usedPercent)) : null;
        windows.push({ label: `${name}:${suffix}`, usedPercent: used, remainingPercent: used === null ? null : 100 - used, resetsAt: window.resetsAt ?? null });
      }
    }
    return windows;
  } catch { return []; }
  finally { client.kill(); }
}

interface Snapshot {
  limitId?: string | null;
  limitName?: string | null;
  primary?: { usedPercent: number; resetsAt?: number | null } | null;
  secondary?: { usedPercent: number; resetsAt?: number | null } | null;
}
