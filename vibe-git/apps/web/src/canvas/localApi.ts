export interface WorkspaceInfo {
  path: string;
  name: string;
  branch: string;
  headSha: string;
  dirty: boolean;
  valid?: boolean;
  selected?: boolean;
  error?: string;
  suggestedPath?: string;
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

export async function bridge<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, {
    credentials: "same-origin",
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
    ...(signal ? { signal } : {}),
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

export async function bridgeStream<T>(path: string, body: unknown, onEvent: (type: string, value: unknown) => void, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    let reason = "";
    try { reason = (await response.json()).error ?? ""; } catch { /* older bridge */ }
    throw new Error(reason || `本机流式接口不可用 (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
    const pieces = buffer.split("\n\n"); buffer = pieces.pop() ?? "";
    for (const piece of pieces) {
      const line = piece.split("\n").find((item) => item.startsWith("data:"));
      if (!line) continue;
      const event = JSON.parse(line.slice(5).trim()) as { type: string; value: unknown };
      if (event.type === "error") throw new Error(String(event.value));
      if (event.type === "done") result = event.value as T;
      else onEvent(event.type, event.value);
    }
  }
  if (!result) throw new Error("连接已中断，请重试");
  return result;
}
