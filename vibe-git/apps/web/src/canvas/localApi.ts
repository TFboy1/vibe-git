export interface WorkspaceInfo {
  path: string;
  name: string;
  branch: string;
  headSha: string;
  dirty: boolean;
  recent: Array<{ path: string; name: string }>;
  runningTask?: string | null;
}
export interface CodexInfo {
  status: "available" | "connecting" | "login_required" | "unavailable";
  reason?: string;
  verificationUrl?: string;
  userCode?: string;
  rateLimits?: Array<{ label: string; remainingPercent: number | null }>;
}
export async function bridge<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    credentials: "same-origin",
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (!r.ok) {
    let reason = "";
    try {
      reason = (await r.json()).error ?? "";
    } catch {}
    throw new Error(
      reason ||
        (r.status === 404
          ? "当前版本尚未提供此接口，请使用 vibe-git open 或等待本机桥更新。"
          : `操作失败 (${r.status})`),
    );
  }
  if (!r.headers.get("content-type")?.includes("application/json"))
    throw new Error("本机控制桥尚未提供此能力，请更新本机插件。");
  return r.json();
}
