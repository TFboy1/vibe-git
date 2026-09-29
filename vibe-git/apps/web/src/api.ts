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

export interface StreamEvent { type: string; value: unknown }
export async function stream(path: string, body: unknown, signal: AbortSignal, receive: (event: StreamEvent) => void) {
  const controller = new AbortController(), abort = () => controller.abort();
  const timer = setTimeout(abort, 165_000);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(path, { method: "POST", credentials: "same-origin", signal: controller.signal,
      headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(body) });
    if (!response.ok) {
      const value = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(value?.error || "Codex 连接失败（" + response.status + "）");
    }
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("服务没有返回有效的对话流");
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "", done = false;
    function dispatch(block: string) {
      const payload = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (!payload) return;
      const event = JSON.parse(payload) as StreamEvent;
      if (event.type === "error") throw new Error(typeof event.value === "string" ? event.value : "Codex 本次对话失败");
      if (event.type === "done") done = true;
      receive(event);
    }
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) { dispatch(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
      if (buffer.length > 2_000_000) throw new Error("对话内容过大，请缩小本次问题范围");
      if (chunk.done) { if (buffer.trim()) dispatch(buffer); break; }
    }
    if (!done) throw new Error("连接中断，已收到的内容保留，可以重新发送");
  } catch (e) {
    if (controller.signal.aborted) throw new Error(signal.aborted ? "生成已停止，已收到的内容保留" : "对话超时，已收到的内容保留，请重试");
    throw e;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); await reader?.cancel().catch(() => undefined); }
}
