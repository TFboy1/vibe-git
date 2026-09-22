import { hostname } from "node:os";
import { resolve } from "node:path";
import type { DeviceSignal, ExecutionCommand, MemberId } from "@vibe-git/protocol";
import { acknowledgeCommand, nextCommand, sendHeartbeat } from "./client.js";
import { probeCodex } from "./codex-capability.js";
import { CodexExecutor, type ActiveRun, type ExecutionCompletion } from "./executor.js";
import { probeGit } from "./git-probe.js";

const memberId = (process.env.MEMBER_ID ?? "A") as MemberId;
if (!["A", "B", "C"].includes(memberId)) throw new Error("MEMBER_ID 必须是 A、B 或 C");
const configuredWorkUnitId = process.env.WORK_UNIT_ID?.trim() || undefined;
const configuredTaskId = process.env.TASK_ID?.trim() || undefined;
const hostUrl = (process.env.VIBE_HOST_URL ?? "http://localhost:8787").replace(/\/$/, "");
const workspace = resolve(process.env.VIBE_WORKSPACE ?? process.cwd());
const deviceId = process.env.DEVICE_ID ?? `${hostname()}-${memberId}`;
const codex = probeCodex();
const executor = new CodexExecutor(codex);
const activeRuns = new Map<string, { command: ExecutionCommand; run: ActiveRun }>();

const delay = (milliseconds: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const keyFor = (command: ExecutionCommand) => command.workUnitId ?? command.taskId;
const fallbackTransport = (command: ExecutionCommand): "app-server" | "cli" =>
  command.transportRequested === "app-server" || (command.transportRequested === "auto" && codex.transports.preferred === "app-server")
    ? "app-server" : "cli";

async function heartbeat(binding?: ExecutionCommand) {
  const active = binding ?? [...activeRuns.values()][0]?.command;
  const boundTaskId = active?.taskId ?? configuredTaskId;
  const boundWorkUnitId = active?.workUnitId ?? configuredWorkUnitId;
  const gitProbe = probeGit(workspace, memberId, boundTaskId ?? "UNBOUND", boundWorkUnitId ?? undefined);
  const gitReference = boundTaskId ? gitProbe : undefined;
  const device: DeviceSignal = {
    memberId, deviceId, relay: "available", codex: codex.state, git: gitProbe ? "available" : "unsupported",
    executionTransports: codex.transports,
    detail: `${codex.detail}；Git ${gitProbe ? `已读取 ${gitProbe.branch}@${gitProbe.headSha?.slice(0, 8)}${boundTaskId ? "" : "（等待任务绑定）"}` : "工作区不可读"}`,
    observedAt: new Date().toISOString()
  };
  await sendHeartbeat(hostUrl, memberId, device, gitReference);
  console.log(`[relay] ${memberId}/${deviceId} 已向 ${hostUrl} 上报：${device.detail}`);
}

async function report(command: ExecutionCommand, input: Parameters<typeof acknowledgeCommand>[3]) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return await acknowledgeCommand(hostUrl, memberId, command, input); }
    catch (error) { lastError = error; if (attempt < 3) await delay(attempt * 750); }
  }
  throw lastError;
}

async function finishStart(command: ExecutionCommand, run: ActiveRun, completion: ExecutionCompletion) {
  try {
    await report(command, {
      status: completion.status,
      transportUsed: run.transport,
      runtimeId: run.runtimeId,
      detail: completion.detail,
      outputSummary: completion.outputSummary
    });
    await heartbeat(command).catch((error) => console.error("[relay] 完成后的 Git 上报失败", error));
    console.log(`[relay] ${command.id} ${completion.status}：${completion.detail}`);
  } catch (error) {
    console.error(`[relay] ${command.id} 完成回执失败`, error);
  } finally {
    const current = activeRuns.get(keyFor(command));
    if (current?.command.id === command.id) activeRuns.delete(keyFor(command));
  }
}

async function handleStart(command: ExecutionCommand) {
  if (activeRuns.size > 0) {
    await report(command, {
      status: "FAILED", transportUsed: fallbackTransport(command),
      detail: `本 Relay 已有运行中的任务：${[...activeRuns.values()][0]?.command.id}`
    });
    return;
  }
  let run: ActiveRun | undefined;
  try {
    run = await executor.start(command, workspace);
    activeRuns.set(keyFor(command), { command, run });
    await report(command, {
      status: "STARTED", transportUsed: run.transport, runtimeId: run.runtimeId,
      detail: `${run.transport} 已收到真实启动回执`
    });
    await heartbeat(command).catch((error) => console.error("[relay] 启动后的 Git 上报失败", error));
    console.log(`[relay] ${command.id} 已通过 ${run.transport} 启动，runtime=${run.runtimeId}`);
    void run.done.then((completion) => finishStart(command, run!, completion));
  } catch (error) {
    if (run) await run.interrupt().catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    await report(command, { status: "FAILED", transportUsed: run?.transport ?? fallbackTransport(command), runtimeId: run?.runtimeId ?? null, detail });
    console.error(`[relay] ${command.id} 启动失败：${detail}`);
  }
}

async function handleInterrupt(command: ExecutionCommand) {
  const active = activeRuns.get(keyFor(command));
  if (!active) {
    await report(command, { status: "FAILED", transportUsed: fallbackTransport(command), runtimeId: command.runtimeId, detail: "本 Relay 未找到对应的活动轮次" });
    return;
  }
  const completion = await active.run.interrupt();
  await report(command, {
    status: completion.status === "INTERRUPTED" ? "INTERRUPTED" : "FAILED",
    transportUsed: active.run.transport, runtimeId: active.run.runtimeId,
    detail: completion.detail, outputSummary: completion.outputSummary
  });
}

async function commandLoop() {
  for (;;) {
    try {
      const command = await nextCommand(hostUrl, memberId, deviceId);
      if (!command) continue;
      if (command.kind === "INTERRUPT_WORK_UNIT") await handleInterrupt(command);
      else await handleStart(command);
    } catch (error) {
      console.error("[relay] 命令通道异常", error);
      await delay(2_000);
    }
  }
}

await heartbeat();
if (process.argv.includes("--once")) process.exit(0);
setInterval(() => heartbeat().catch((error) => console.error("[relay] 心跳失败", error)), 15_000).unref();
await commandLoop();
