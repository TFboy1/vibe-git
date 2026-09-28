import { resolve } from "node:path";
import type { V20BootstrapPayload } from "@vibe-git/protocol";
import { api } from "./api.js";
import { readJson, saveConfig, vibeHome, writeJson, type ClientConfig } from "./config.js";
import { inspectWorkspace } from "./local-workspace.js";
import type { IntentClarificationResult } from "./intent-clarifier.js";

const THREADS_PATH = () => resolve(vibeHome(), "local-openai-intent-threads.json");
const DEFAULT_MODEL = "gpt-5";
type Message = { role: "user" | "assistant"; content: string };
type Thread = { workspace: string; messages: Message[]; updatedAt: string };
type Threads = Record<string, Thread>;
export interface OpenAIConnectionStatus { configured: boolean; source: "environment" | "local" | "none"; model: string }
export function openAIStatus(config: ClientConfig): OpenAIConnectionStatus {
  const source = process.env.OPENAI_API_KEY?.trim() ? "environment" : config.openaiApiKey?.trim() ? "local" : "none";
  return { configured: source !== "none", source, model: config.openaiModel?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL };
}
export async function saveOpenAIConfig(config: ClientConfig, apiKey: string | undefined, model: string | undefined, clear = false): Promise<OpenAIConnectionStatus> {
  const next = { ...config };
  if (clear) delete next.openaiApiKey;
  else if (apiKey !== undefined) { if (apiKey.trim().length < 20 || apiKey.length > 500) throw new Error("OpenAI API Key 格式不正确"); next.openaiApiKey = apiKey.trim(); }
  if (model !== undefined) { const value = model.trim(); if (!/^[A-Za-z0-9._:-]{2,100}$/.test(value)) throw new Error("模型名称格式不正确"); next.openaiModel = value; }
  await saveConfig(next);
  Object.assign(config, next);
  if (clear) delete config.openaiApiKey;
  return openAIStatus(next);
}
function key(config: ClientConfig): string | null { return process.env.OPENAI_API_KEY?.trim() || config.openaiApiKey?.trim() || null; }
function validate(value: unknown): IntentClarificationResult {
  const result = value as IntentClarificationResult;
  if (!result || !["question", "ready"].includes(result.status) || typeof result.question !== "string" || typeof result.summary !== "string" || typeof result.title !== "string" || typeof result.content !== "string" || !Array.isArray(result.acceptance) || !result.acceptance.every(item => typeof item === "string") || typeof result.constraints !== "string" || !Array.isArray(result.options) || !result.options.every(option => typeof option.label === "string" && typeof option.description === "string")) throw new Error("OpenAI 返回的需求澄清结果格式无效");
  return result;
}
function partialField(raw: string, field: string): string {
  const match = raw.match(new RegExp('"' + field + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)'));
  if (!match) return "";
  try { return JSON.parse('"' + match[1] + '"') as string; } catch { return ""; }
}
export async function clarifyIntentWithOpenAI(config: ClientConfig, sessionId: string, message: string, start: boolean, model?: string, externalSignal?: AbortSignal, onProgress: (type: "status" | "preview", value: string) => void = () => undefined): Promise<IntentClarificationResult> {
  const apiKey = key(config); if (!apiKey) throw new Error("尚未配置 OpenAI API Key。请在算力网配置，或设置 OPENAI_API_KEY 环境变量。");
  if (!message.trim() || Buffer.byteLength(message, "utf8") > 12_000) throw new Error("需求内容不能为空且不超过 12 KiB");
  const workspace = await inspectWorkspace(config.workspace); if (!workspace.valid) throw new Error(workspace.error ?? "请先选择独立的 Git 项目工作区");
  const data = await api<V20BootstrapPayload>(config, "/api/v1/bootstrap");
  const threads = await readJson<Threads>(THREADS_PATH()) ?? {};
  const threadKey = config.hostUrl + "|" + config.nodeId + "|" + sessionId;
  const previous = threads[threadKey]; const history = !start && previous?.workspace === config.workspace ? previous.messages : [];
  const system = ["你是 Vibe-Git 的需求澄清助手，工作方式类似 Codex Plan 模式。", "每轮只问一个最关键的问题，并提供恰好三个简洁选项（label、description），用户也能自定义回答。优先澄清目标、核心行为、成功标准、边界和约束；不要一次列问题清单，不要生成任务分工。用户说可以了或信息足够时输出 status=ready，此时 options 为空数组。只读工作区，不执行命令，不写文件。严格输出 JSON。", "项目：" + workspace.name + "\n当前需求：" + data.room.currentRequirementMarkdown.slice(0, 20000)].join("\n\n");
  const current = (start ? "用户初始想法：" : "用户回答：") + message.trim();
  const userMessage: Message = { role: "user", content: current };
  const input = [{ role: "system", content: system }, ...history, userMessage];
  const controller = new AbortController(); const abort = () => controller.abort(); externalSignal?.addEventListener("abort", abort, { once: true }); if (externalSignal?.aborted) controller.abort(); const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    onProgress("status", "正在连接 OpenAI API");
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", authorization: "Bearer " + apiKey }, body: JSON.stringify({ model: model?.trim() || openAIStatus(config).model, input, store: false, stream: true, text: { format: { type: "json_schema", name: "intent_clarification", strict: true, schema: { type: "object", additionalProperties: false, required: ["status", "question", "options", "summary", "title", "content", "acceptance", "constraints"], properties: { status: { enum: ["question", "ready"] }, question: { type: "string" }, options: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "description"], properties: { label: { type: "string" }, description: { type: "string" } } } }, summary: { type: "string" }, title: { type: "string" }, content: { type: "string" }, acceptance: { type: "array", items: { type: "string" } }, constraints: { type: "string" } } } } } }) });
    if (!response.ok || !response.body) {
      let payload: any = null; try { payload = await response.json(); } catch { /* unavailable */ }
      throw new Error(payload?.error?.message || "OpenAI API 请求失败（" + response.status + "）");
    }
    onProgress("status", "正在生成回答");
    let buffer = "", raw = "", completed = false, preview = "", lastCount = 0;
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, "\n");
      const pieces = buffer.split("\n\n"); buffer = pieces.pop() ?? "";
      for (const piece of pieces) {
        const line = piece.split("\n").find((part) => part.startsWith("data:"));
        if (!line) continue;
        let event: { type?: string; delta?: string; response?: { error?: { message?: string } }; message?: string };
        try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          raw += event.delta;
          const next = partialField(raw, "question") || partialField(raw, "content");
          if (next && next !== preview) { preview = next; onProgress("preview", next.slice(-2000)); }
          if (raw.length - lastCount >= 40) { lastCount = raw.length; onProgress("status", `已接收 ${raw.length} 字`); }
        }
        if (event.type === "response.completed") completed = true;
        if (event.type === "response.failed" || event.type === "error") throw new Error(event.response?.error?.message || event.message || "OpenAI API 生成失败");
      }
    }
    if (!completed || !raw) throw new Error("OpenAI API 流提前结束，请重试");
    const result = validate(JSON.parse(raw));
    const assistantMessage: Message = { role: "assistant", content: JSON.stringify(result) };
    threads[threadKey] = { workspace: config.workspace, messages: [...history, userMessage, assistantMessage].slice(-12), updatedAt: new Date().toISOString() };
    await writeJson(THREADS_PATH(), threads);
    return result;
  } catch (error) { if (error instanceof Error && error.name === "AbortError") throw new Error("OpenAI API 请求超时，请重试或更换模型"); throw error; } finally { clearTimeout(timer); externalSignal?.removeEventListener("abort", abort); }
}
