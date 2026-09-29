export async function request<T>(path: string, body?: unknown, method?: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), options.timeoutMs ?? (path.includes("/compute/test") ? 310_000 : 30_000));
  const abort = () => controller.abort(); options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
    const response = await fetch(path, { method: method ?? (body === undefined ? "GET" : "POST"), credentials: "same-origin",
      signal: controller.signal, headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const raw = await response.text(); let value: unknown;
    try { value = raw ? JSON.parse(raw) : null; } catch { throw new Error("服务没有返回有效内容，请确认本机 CLI 已启动"); }
    if (!response.ok) throw new Error((value as { error?: string })?.error || "请求失败（" + response.status + "）");
    return value as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(options.signal?.aborted ? "本次生成已取消，已有草稿保留" : "请求超时，已有内容会保留，请稍后重试");
    throw error;
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
