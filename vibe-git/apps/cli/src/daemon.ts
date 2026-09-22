import { appendFile, mkdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import type { AgentJob, GitSnapshot, NodeHeartbeatInput, RateLimitWindow } from "@vibe-git/protocol";
import { api, post } from "./api.js";
import { auditCodexHome, daemonLogPath, loadConfig, saveConfig, type ClientConfig } from "./config.js";
import { probeCodex, readRateLimits, runAudit, startDevelopment, type ActiveRun } from "./codex.js";

const active = new Map<string, ActiveRun>();
let stopping = false;
let quota: RateLimitWindow[] = [];
let lastQuotaAt = 0;

async function log(value: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${value.replace(/[\r\n]+/g, " ").slice(0, 4_000)}\n`;
  await mkdir(dirname(daemonLogPath()), { recursive: true });
  await appendFile(daemonLogPath(), line, "utf8").catch(() => undefined);
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 8_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function probeGit(workspace: string): GitSnapshot | null {
  try {
    const headSha = git(workspace, ["rev-parse", "HEAD"]);
    if (!/^[0-9a-f]{40}$/i.test(headSha)) return null;
    return {
      branch: git(workspace, ["branch", "--show-current"]) || "DETACHED",
      headSha: headSha.toLowerCase(), dirty: Boolean(git(workspace, ["status", "--porcelain"])), observedAt: new Date().toISOString()
    };
  } catch { return null; }
}

async function heartbeat(config: ClientConfig, taskId?: string): Promise<void> {
  const normal = probeCodex();
  const audit = probeCodex({ CODEX_HOME: auditCodexHome() });
  if (audit.state === "available" && Date.now() - lastQuotaAt > 5 * 60_000) {
    quota = await readRateLimits(auditCodexHome());
    lastQuotaAt = Date.now();
  }
  const gitState = probeGit(config.workspace);
  const input: NodeHeartbeatInput = {
    workspaceReady: Boolean(gitState), auditCodex: audit.state, workCodex: normal.state,
    workTransport: config.workTransport, rateLimits: quota, git: gitState,
    currentTaskId: taskId ?? active.keys().next().value ?? null
  };
  await post(config, "/api/v1/nodes/heartbeat", input);
}

async function report(config: ClientConfig, job: AgentJob, body: Record<string, unknown>): Promise<void> {
  await post(config, `/api/v1/jobs/${encodeURIComponent(job.id)}/status`, { leaseToken: job.leaseToken, ...body });
}

async function executeJob(config: ClientConfig, job: AgentJob): Promise<void> {
  try {
    if (!job.leaseToken) throw new Error("Host 返回了无租约作业");
    if (job.kind === "ALIGN_PLANS" || job.kind === "REVIEW_CHANGES") {
      const runtimeId = `audit-${process.pid}-${Date.now()}`;
      await report(config, job, { phase: "started", runtimeId });
      const result = await runAudit(String(job.payload.prompt ?? ""), job.payload.outputSchema, config.workspace, auditCodexHome());
      await report(config, job, { phase: "completed", runtimeId, result });
      return;
    }
    if (job.kind === "RUN_TASK") {
      const requested = ["auto", "app-server", "cli"].includes(String(job.payload.transport)) ? String(job.payload.transport) as ClientConfig["workTransport"] : config.workTransport;
      const run = await startDevelopment(String(job.payload.prompt ?? ""), config.workspace, requested);
      active.set(job.entityId, run);
      await report(config, job, { phase: "started", runtimeId: run.runtimeId });
      await heartbeat(config).catch(() => undefined);
      const result = await run.done;
      active.delete(job.entityId);
      await heartbeat(config).catch(() => undefined);
      await report(config, job, { phase: result.status === "completed" ? "completed" : result.status === "interrupted" ? "interrupted" : "failed", runtimeId: run.runtimeId, error: result.detail });
      return;
    }
    if (job.kind === "INTERRUPT_TASK") {
      await report(config, job, { phase: "started", runtimeId: String(job.payload.runtimeId ?? "") });
      const run = active.get(job.entityId);
      if (run) { await run.interrupt(); active.delete(job.entityId); }
      await report(config, job, { phase: "completed", result: { interrupted: Boolean(run) } });
      return;
    }
    if (job.kind === "SYNC_NODE") {
      await report(config, job, { phase: "started", runtimeId: `sync-${Date.now()}` });
      await heartbeat(config, job.entityId === config.nodeId ? undefined : job.entityId);
      await report(config, job, { phase: "completed", result: { syncedAt: new Date().toISOString() } });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await log(`${job.kind} ${job.id} 失败：${detail}`);
    if (job.leaseToken) await report(config, job, { phase: "failed", error: detail }).catch(() => undefined);
  }
}

export async function runDaemon(): Promise<void> {
  const config = await loadConfig();
  if (!config) return;
  await stat(config.workspace);
  await saveConfig({ ...config, daemonPid: process.pid });
  await log(`节点守护进程启动：${config.nodeId}`);
  const stop = () => { stopping = true; for (const run of active.values()) void run.interrupt(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);

  let nextHeartbeat = 0;
  while (!stopping) {
    if (Date.now() >= nextHeartbeat) {
      await heartbeat(config).catch((error) => log(`心跳失败：${error instanceof Error ? error.message : String(error)}`));
      nextHeartbeat = Date.now() + 15_000;
    }
    try {
      const job = await api<AgentJob | null>(config, "/api/v1/nodes/jobs/next", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      if (job) void executeJob(config, job);
    } catch (error) {
      await log(`获取作业失败：${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  const latest = await loadConfig(false);
  if (latest?.daemonPid === process.pid) await saveConfig({ ...latest, daemonPid: null });
  await log("节点守护进程停止");
}
