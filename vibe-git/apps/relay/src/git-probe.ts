import { execFileSync } from "node:child_process";
import type { GitReference, MemberId } from "@vibe-git/protocol";

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function probeGit(cwd: string, memberId: MemberId, taskId: string, workUnitId?: string): GitReference | undefined {
  try {
    const branch = git(cwd, ["branch", "--show-current"]);
    const headSha = git(cwd, ["rev-parse", "HEAD"]);
    const dirty = git(cwd, ["status", "--porcelain"]).length > 0;
    let baseSha: string | null = null;
    try { baseSha = git(cwd, ["merge-base", "HEAD", "main"]); } catch { baseSha = headSha; }
    return { taskId, ...(workUnitId ? { workUnitId } : {}), memberId, branch: branch || "DETACHED", baseSha, headSha, dirty, observedAt: new Date().toISOString() };
  } catch {
    return undefined;
  }
}
