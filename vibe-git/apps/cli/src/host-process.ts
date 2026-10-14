import { spawn } from "node:child_process";
import { closeSync, existsSync } from "node:fs";
import { openLogFile } from "@vibe-git/protocol/logging";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { api, post } from "./api.js";
import { hostDataRoot, migrateLegacyHostData } from "./host-data.js";
import { hostLogPath, hostProcessPath, readJson, writeJson, type ClientConfig } from "./config.js";

export const LOCAL_HOST = "http://127.0.0.1:8787";
const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const ENTRY = fileURLToPath(new URL("../../host/dist/index.js", import.meta.url));
export interface HostProcess { pid: number; hostUrl: string; startedAt: string; root: string; workspace?: string; dataRoot?: string; roomId?: string }
export function isAlive(pid: number | null | undefined): boolean {
  if (!pid || !Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function waitForHost(base: string, timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await fetch(base + "/health", { signal: AbortSignal.timeout(2000) }).then(r => r.json()).catch(() => null) as { ok?: boolean; version?: string } | null;
    if (health?.ok && health.version === "0.20") return;
    if (health?.ok) throw new Error("8787 被旧版服务占用，请先停止旧服务");
    await new Promise(done => setTimeout(done, 300));
  }
  throw new Error(`Host 启动超时，请查看 ${hostLogPath()}`);
}
export async function startHost(workspace: string, previous?: ClientConfig | null, rootOverride?: string) {
  const existing = await readJson<HostProcess>(hostProcessPath());
  let info: HostProcess;
  const dataRoot = rootOverride ?? hostDataRoot(workspace);
  if (existing && isAlive(existing.pid)) {
    if (resolve(existing.workspace ?? "") !== resolve(workspace)) throw new Error("其他项目的 Host 正在运行，请先切换或停止原项目");
    await waitForHost(existing.hostUrl, 3000);
    info = existing;
  } else {
    if (!existsSync(ENTRY)) throw new Error("缺少 Host 构建，请先运行 npm run build");
    if (!rootOverride && previous?.hostUrl === LOCAL_HOST) await migrateLegacyHostData(dataRoot, previous.nodeId);
    const fd = openLogFile(hostLogPath());
    const child = spawn(process.execPath, [ENTRY], { detached: true, windowsHide: true, cwd: ROOT,
      stdio: ["ignore", fd, fd], env: { ...process.env, PORT: "8787", HOST: "0.0.0.0", VIBE_GIT_DATA_DIR: dataRoot, VIBE_GIT_TUNNEL_TARGET: LOCAL_HOST, VIBE_GIT_LOG_FILE: hostLogPath() } });
    child.unref(); closeSync(fd);
    info = { pid: child.pid!, hostUrl: LOCAL_HOST, startedAt: new Date().toISOString(), root: ROOT, workspace, dataRoot };
    await writeJson(hostProcessPath(), info);
    try { await waitForHost(LOCAL_HOST); }
    catch (error) { if (isAlive(info.pid)) process.kill(info.pid, "SIGTERM"); await rm(hostProcessPath(), { force: true }); throw error; }
  }
  const captain = await readJson<{ roomId: string; nodeId: string; nodeToken: string }>(resolve(info.dataRoot ?? dataRoot, "v20/captain.json"));
  if (!captain) throw new Error("项目的 Captain 凭据无法读取");
  info = { ...info, roomId: captain.roomId };
  await writeJson(hostProcessPath(), info);
  const config: ClientConfig = { ...(previous?.nodeId === captain.nodeId ? previous : {}),
    hostUrl: LOCAL_HOST, nodeId: captain.nodeId, nodeToken: captain.nodeToken, workspace,
    workTransport: previous?.nodeId === captain.nodeId ? previous.workTransport : "auto", daemonPid: null, connectedAt: new Date().toISOString() };
  return { config, info, roomId: captain.roomId };
}
export async function stopHost(config: ClientConfig | null): Promise<void> {
  const info = await readJson<HostProcess>(hostProcessPath());
  if (!info || !isAlive(info.pid)) { await rm(hostProcessPath(), { force: true }); return; }
  if (!config) throw new Error("当前连接不属于本机 Host，不能停止其他项目服务");
  const local = { ...config, hostUrl: info.hostUrl };
  const data = await api<{ viewer: { role: string } }>(local, "/api/v1/bootstrap");
  if (data.viewer.role !== "captain") throw new Error("只有本机项目的队长可以停止 Host");
  const health = await fetch(info.hostUrl + "/health", { signal: AbortSignal.timeout(2000) }).then(r => r.json()) as { pid?: number };
  if (health.pid !== undefined && health.pid !== info.pid) throw new Error("Host 进程标识已变化，停止操作已拒绝");
  await post(local, "/api/v1/local/cloudflare/stop").catch(() => undefined);
  process.kill(info.pid, "SIGTERM");
  for (let i = 0; i < 50 && isAlive(info.pid); i++) await new Promise(done => setTimeout(done, 100));
  if (isAlive(info.pid)) throw new Error("原 Host 尚未停止，请稍后重试");
  await rm(hostProcessPath(), { force: true });
}
export async function startTunnel(config: ClientConfig): Promise<string | null> {
  try {
    const tunnel = await api<{ installed: boolean; running: boolean }>(config, "/api/v1/local/cloudflare");
    if (!tunnel.installed) await post(config, "/api/v1/local/cloudflare/install");
    if (!tunnel.running) await post(config, "/api/v1/local/cloudflare/start");
    return null;
  } catch { return "本机项目已启动；远程连接尚未就绪，可在团队成员中重新生成邀请。"; }
}
