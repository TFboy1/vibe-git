import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { WorkTransport } from "@vibe-git/protocol";

export interface ClientConfig {
  hostUrl: string;
  nodeId: string;
  nodeToken: string;
  workspace: string;
  workTransport: WorkTransport;
  daemonPid: number | null;
  connectedAt: string;
}

export const vibeHome = () => resolve(process.env.VIBE_GIT_HOME?.trim() || resolve(homedir(), ".vibe-git"));
export const configPath = () => resolve(vibeHome(), "client.json");
export const defaultCodexHome = () => resolve(process.env.CODEX_HOME?.trim() || resolve(homedir(), ".codex"));
export const auditCodexHome = () => resolve(vibeHome(), "audit-codex");
export const daemonLogPath = () => resolve(vibeHome(), "daemon.log");
export const hostProcessPath = () => resolve(vibeHome(), "host-process.json");
export const hostLogPath = () => resolve(vibeHome(), "host.log");

export async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch { return null; }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

export async function loadConfig(required = true): Promise<ClientConfig | null> {
  const config = await readJson<ClientConfig>(configPath());
  if (!config && required) throw new Error("尚未连接。队长请运行 vibe-git host start，成员请运行队长提供的 connect 命令。");
  return config;
}

export async function saveConfig(config: ClientConfig): Promise<void> { await writeJson(configPath(), config); }

