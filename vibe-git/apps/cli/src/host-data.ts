import { existsSync } from "node:fs";
import { cp, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { readJson, vibeHome } from "./config.js";

export function hostDataRoot(workspace: string): string {
  return resolve(process.env.VIBE_GIT_DATA_DIR?.trim() || resolve(workspace, ".vibe-git", "host"));
}

/** 仅在旧 Captain 凭据与本机节点一致时复制旧房间；原数据始终保留。 */
export async function migrateLegacyHostData(destination: string, captainNodeId: string, source = resolve(vibeHome(), "host")): Promise<boolean> {
  if (destination === source || existsSync(resolve(destination, "workspace.db")) || !existsSync(resolve(source, "workspace.db"))) return false;
  const captain = await readJson<{ nodeId: string }>(resolve(source, "v20", "captain.json"));
  if (captain?.nodeId !== captainNodeId) return false;
  if (existsSync(destination) && (await readdir(destination)).length) throw new Error(`目标房间数据目录已有文件，请先检查：${destination}`);
  await mkdir(destination, { recursive: true });
  const db = new DatabaseSync(resolve(source, "workspace.db"));
  try { await backup(db, resolve(destination, "workspace.db")); }
  finally { db.close(); }
  if (existsSync(resolve(source, "v20"))) await cp(resolve(source, "v20"), resolve(destination, "v20"), { recursive: true, force: false });
  return true;
}
