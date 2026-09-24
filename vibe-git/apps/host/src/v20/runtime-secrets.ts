import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CollaborationNode } from "@vibe-git/protocol";
import { V20Repository } from "./repository.js";

export interface CaptainCredentialFile {
  roomId: string;
  nodeId: string;
  nodeToken: string;
}

interface InviteFile { roomId: string; inviteToken: string }

export const hashSecret = (value: string): string => createHash("sha256").update(value).digest("hex");
export const newSecret = (): string => randomBytes(32).toString("base64url");

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch { return undefined; }
}

async function writePrivate(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function ensureV20Runtime(repo: V20Repository, dataDir: string): Promise<{ captain: CaptainCredentialFile; inviteToken: string }> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const captainPath = join(dataDir, "captain.json");
  const invitePath = join(dataDir, "invite.json");
  let room = repo.room();
  if (!room) {
    room = { id: randomUUID(), createdAt: new Date().toISOString() };
    repo.putRoom(room);
    repo.setRequirementRevision(0);
    repo.setRequirementMarkdown("");
    repo.setMeta("v20_schema_version", "20");
  }

  let captain = await readJson<CaptainCredentialFile>(captainPath);
  const storedCaptain = repo.listNodes().find((node) => node.role === "captain");
  const captainValid = captain && captain.roomId === room.id && storedCaptain?.id === captain.nodeId
    && repo.credentialHashForNode(captain.nodeId) === hashSecret(captain.nodeToken);
  if (!captainValid) {
    const nodeId = storedCaptain?.id ?? `node-${randomUUID()}`;
    captain = { roomId: room.id, nodeId, nodeToken: newSecret() };
    const now = new Date().toISOString();
    const node: CollaborationNode = storedCaptain ? { ...storedCaptain, revoked: false } : {
      id: nodeId, label: "Captain", role: "captain", revoked: false, connected: false,
      workspaceReady: false, codex: "unverified", workTransport: "auto",
      activeJobCount: 0, rateLimits: [], git: null, currentTaskId: null, lastSeenAt: null,
      lastAuditJobAt: null, createdAt: now
    };
    repo.putNode(node, hashSecret(captain.nodeToken));
    await writePrivate(captainPath, captain);
  }

  let invite = await readJson<InviteFile>(invitePath);
  if (!invite || invite.roomId !== room.id || repo.inviteHash() !== hashSecret(invite.inviteToken)) {
    invite = { roomId: room.id, inviteToken: newSecret() };
    repo.setInviteHash(hashSecret(invite.inviteToken));
    await writePrivate(invitePath, invite);
  }
  if (!captain) throw new Error("Captain 凭据初始化失败");
  return { captain, inviteToken: invite.inviteToken };
}

export async function rotateInvite(repo: V20Repository, dataDir: string): Promise<string> {
  const room = repo.room();
  if (!room) throw new Error("Vibe-Git 房间尚未初始化");
  const inviteToken = newSecret();
  repo.setInviteHash(hashSecret(inviteToken));
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writePrivate(join(dataDir, "invite.json"), { roomId: room.id, inviteToken });
  return inviteToken;
}
