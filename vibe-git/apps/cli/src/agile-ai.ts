import { assertJsonSchema } from "@vibe-git/protocol";
import type { AgileProvider, LocalComputeStatus, V20BootstrapPayload } from "@vibe-git/protocol";
import { createHash } from "node:crypto";
import { api } from "./api.js";
import { saveConfig, defaultCodexHome, type ClientConfig } from "./config.js";
import { runAudit } from "./codex.js";

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export function responsesUrl(baseUrl = DEFAULT_BASE_URL): string {
  const url = new URL(baseUrl.trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Base URL 须为没有凭据、查询或片段的 HTTP(S) 地址");
  const base = url.toString().replace(/\/+$/, "");
  if (/\/responses$/.test(base)) throw new Error("Base URL 请填写 API 基础地址，程序会追加 /responses");
  return base + "/responses";
}
function settings(config: ClientConfig) {
  return { apiKey: config.openaiApiKey || process.env.OPENAI_API_KEY?.trim() || "",
    baseUrl: config.openaiBaseUrl || DEFAULT_BASE_URL, model: config.openaiModel || "" };
}
function settingsSignature(config: ClientConfig): string {
  return createHash("sha256").update(JSON.stringify(settings(config))).digest("hex");
}
export function computeStatus(config: ClientConfig): LocalComputeStatus {
  const value = settings(config);
  const tested = config.apiConnection?.signature === settingsSignature(config) ? config.apiConnection : null;
  return { provider: config.aiProvider ?? "codex", baseUrl: value.baseUrl, model: value.model,
    configured: Boolean(value.apiKey), ready: Boolean(value.apiKey && value.model.trim()),
    keySource: config.openaiApiKey ? "local" : value.apiKey ? "environment" : "none",
    connection: tested ? { status: tested.status, checkedAt: tested.checkedAt, ...(tested.error ? { error: tested.error } : {}) } : null };
}
function safeMessage(message: string, key: string): string {
  return (key ? message.split(key).join("[已隐藏]") : message).replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]").slice(0, 2_000);
}
function responseText(response: unknown): string {
  if (!response || typeof response !== "object") throw new Error("Responses 返回内容无效");
  const value = response as { status?: string; error?: { message?: string }; output_text?: string; output?: Array<{ content?: Array<{ type: string; text?: string; refusal?: string }> }> };
  if (value.error || value.status === "failed" || value.status === "incomplete") throw new Error(value.error?.message || "Responses 未完整生成结果");
  if (typeof value.output_text === "string") return value.output_text;
  const content = value.output?.flatMap(item => item.content ?? []) ?? [];
  if (content.some(item => item.type === "refusal")) throw new Error("模型拒绝了本次请求，请检查输入后重试");
  return content.filter(item => item.type === "output_text").map(item => item.text ?? "").join("");
}
export async function runResponses(config: ClientConfig, prompt: string, schema: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const { apiKey, baseUrl, model } = settings(config);
  if (!apiKey) throw new Error("请在队长本机算力设置中保存 API Key");
  if (!model.trim()) throw new Error("请填写你的 API 服务支持的模型名");
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5 * 60_000);
  const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(responsesUrl(baseUrl), {
      method: "POST", signal: controller.signal, headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
      body: JSON.stringify({ model, store: false, stream: true, input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
        text: { format: { type: "json_schema", name: "vibe_agile_result", strict: true, schema } } })
    });
    if (!response.ok) {
      let reason = "";
      try { const error = await response.json() as { error?: { message?: string } }; reason = error.error?.message ?? ""; } catch { /* no untrusted raw response in logs */ }
      throw new Error("Responses 请求失败（HTTP " + response.status + "）" + (reason ? "：" + safeMessage(reason, apiKey) : ""));
    }
    let output = "";
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      if (!response.body) throw new Error("Responses 流没有正文");
      const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
      let pending = "", bytes = 0, completed = false;
      const processEvent = (frame: string) => {
        const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") return;
        const event = JSON.parse(data) as { type: string; delta?: string; response?: unknown; error?: { message?: string }; message?: string };
        if (event.type === "response.output_text.delta") output += event.delta ?? "";
        if (event.type === "response.completed") { output = responseText(event.response) || output; completed = true; }
        if (["error", "response.failed", "response.incomplete"].includes(event.type)) {
          if (event.response) responseText(event.response);
          throw new Error(event.error?.message || event.message || "Responses 流执行失败");
        }
      };
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength; if (bytes > 8 * 1024 * 1024) throw new Error("Responses 输出超过长度限制");
          pending = (pending + decoder.decode(part.value, { stream: true })).replace(/\r\n/g, "\n");
          let end: number;
          while ((end = pending.indexOf("\n\n")) >= 0) { processEvent(pending.slice(0, end)); pending = pending.slice(end + 2); }
        }
        pending += decoder.decode(); if (pending.trim()) processEvent(pending);
        if (!completed) throw new Error("Responses 流提前结束，未收到完整结果");
      } finally { await reader.cancel().catch(() => undefined); }
    } else output = responseText(await response.json());
    if (!output.trim()) throw new Error("Responses 未返回结构化文本");
    let result: unknown;
    try { result = JSON.parse(output); } catch { throw new Error("Responses 结果不是有效 JSON，请确认接口支持结构化输出"); }
    assertJsonSchema(result, schema);
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Responses 请求已取消或超时，工作草稿已保留");
    throw new Error(safeMessage(error instanceof Error ? error.message : String(error), apiKey));
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
export async function runStructuredJob(config: ClientConfig, provider: AgileProvider, prompt: string, schema: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const result = provider === "api" ? await runResponses(config, prompt, schema, signal) : await runAudit(prompt, schema, config.workspace, defaultCodexHome(), signal);
  assertJsonSchema(result, schema);
  return result;
}
export async function saveCompute(config: ClientConfig, input: Record<string, unknown>) {
  const bootstrap = await api<{ viewer: { role: string } }>(config, "/api/v1/bootstrap");
  if (bootstrap.viewer.role !== "captain") throw new Error("只有队长可以配置本轮协作算力");
  if (input.provider !== "api" && input.provider !== "codex") throw new Error("请选择 Codex 或 API");
  const updated = { ...config, aiProvider: input.provider as AgileProvider };
  if (input.clear === true) delete updated.openaiApiKey;
  if (input.apiKey !== undefined && input.apiKey !== "") {
    if (typeof input.apiKey !== "string" || /[\r\n]/.test(input.apiKey) || input.apiKey.length > 16_000) throw new Error("API Key 内容无效");
    updated.openaiApiKey = input.apiKey.trim();
  }
  if (input.provider === "api" && input.baseUrl !== undefined) {
    if (typeof input.baseUrl !== "string") throw new Error("Base URL 无效");
    responsesUrl(input.baseUrl); updated.openaiBaseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  }
  if (input.provider === "api" && input.model !== undefined) {
    if (typeof input.model !== "string" || !input.model.trim() || input.model.length > 200 || /[\r\n]/.test(input.model)) throw new Error("模型名称无效");
    updated.openaiModel = input.model.trim();
  }
  if (updated.aiProvider === "api" && !settings(updated).apiKey && input.clear !== true) throw new Error("使用 API 前请先保存 Key");
  if (updated.aiProvider === "api" && !settings(updated).model.trim()) throw new Error("请填写 API 服务支持的模型名");
  if (settingsSignature(updated) !== settingsSignature(config)) delete updated.apiConnection;
  await saveConfig(updated); Object.assign(config, updated);
  if (!updated.openaiApiKey) delete config.openaiApiKey;
  if (!updated.apiConnection) delete config.apiConnection;
  return computeStatus(config);
}
export async function savePanelCompute(config: ClientConfig, input: Record<string, unknown>, changed: () => Promise<void>) {
  const result = await saveCompute(config, input);
  await changed();
  const state = await api<Pick<V20BootstrapPayload, "agile">>(config, "/api/v1/bootstrap");
  // Historical Hosts have no /agile routes. Local settings and connection tests still work.
  if (state.agile) await api(config, "/api/v1/agile/compute", { method: "PUT", body: JSON.stringify({ provider: result.provider }) });
  return result;
}
export async function testCompute(config: ClientConfig): Promise<{ ok: true; model: string }> {
  const snapshot = { ...config }, signature = settingsSignature(snapshot);
  try {
    const result = await runResponses(snapshot, '连接测试：仅输出 {"ok":true}，不调用任何工具。', {
      type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean", enum: [true] } }
    });
    if ((result as { ok: boolean }).ok !== true) throw new Error("接口未正确支持结构化 Responses 输出");
    if (settingsSignature(config) !== signature) throw new Error("测试期间 API 配置已变化，请测试新配置");
    config.apiConnection = { signature, status: "passed", checkedAt: new Date().toISOString() };
    await saveConfig(config);
    return { ok: true, model: settings(snapshot).model };
  } catch (error) {
    const message = safeMessage(error instanceof Error ? error.message : String(error), settings(snapshot).apiKey);
    if (settingsSignature(config) === signature) {
      config.apiConnection = { signature, status: "failed", checkedAt: new Date().toISOString(), error: message };
      await saveConfig(config);
    }
    throw new Error(message);
  }
}
