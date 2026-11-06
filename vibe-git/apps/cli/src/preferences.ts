import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { CollaborationPreference } from "@vibe-git/protocol";
import { readJson, vibeHome, writeJson } from "./config.js";

// Separate from connection credentials: reconnecting or switching rooms must not lose this choice.
function preferencePath(workspace: string): string {
  const path = resolve(workspace);
  const key = createHash("sha256").update(process.platform === "win32" ? path.toLowerCase() : path, "utf8").digest("hex");
  return resolve(vibeHome(), "preferences", key + ".json");
}
export async function collaborationPreference(workspace: string): Promise<CollaborationPreference> {
  const saved = await readJson<CollaborationPreference>(preferencePath(workspace));
  return saved?.configured === true && ["assisted", "automatic"].includes(saved.mode)
    ? { mode: saved.mode, configured: true } : { mode: "assisted", configured: false };
}
export async function saveCollaborationPreference(workspace: string, mode: unknown): Promise<CollaborationPreference> {
  if (mode !== "assisted" && mode !== "automatic") throw new Error("介入偏好应为 assisted 或 automatic");
  const value: CollaborationPreference = { mode, configured: true };
  await writeJson(preferencePath(workspace), value);
  return value;
}
