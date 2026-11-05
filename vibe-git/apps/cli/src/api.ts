import type { ClientConfig } from "./config.js";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}

export async function api<T>(config: Pick<ClientConfig, "hostUrl" | "nodeToken">, path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = path.endsWith("/jobs/next") ? 35_000 : path.includes("cloudflare/install") ? 180_000 : 30_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.hostUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: { authorization: `Bearer ${config.nodeToken}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers }
    });
    if (response.status === 204) return null as T;
    const text = await response.text();
    let value: unknown = text;
    try { value = text ? JSON.parse(text) : null; } catch { /* text response */ }
    if (!response.ok) {
      const shaped = value as { error?: string; code?: string } | null;
      throw new ApiError(response.status, shaped?.error || `Host 返回 ${response.status}`, shaped?.code);
    }
    return value as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const write = !["GET", "HEAD"].includes(init.method ?? "GET");
    throw new ApiError(0, write ? "连接中断，操作结果尚未确认" : "连接中断或响应超时", write ? "WRITE_UNCERTAIN" : controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR");
  } finally { clearTimeout(timeout); }
}

export const post = <T>(config: Pick<ClientConfig, "hostUrl" | "nodeToken">, path: string, body: unknown = {}) =>
  api<T>(config, path, { method: "POST", body: JSON.stringify(body) });
