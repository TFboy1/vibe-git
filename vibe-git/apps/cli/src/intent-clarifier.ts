import { resolve } from "node:path";
import type { V20BootstrapPayload } from "@vibe-git/protocol";
import { api } from "./api.js";
import { LocalAppServer, type PlanStep } from "./local-chat.js";
import { readJson, vibeHome, writeJson, type ClientConfig } from "./config.js";
import { inspectWorkspace } from "./local-workspace.js";

const INTENT_THREADS_PATH = () => resolve(vibeHome(), "local-intent-threads.json");
type IntentThread = { threadId: string; workspace: string; updatedAt: string };
type IntentThreadMap = Record<string, IntentThread>;
export interface IntentClarificationResult {
  status: "question" | "ready";
  question: string;
  summary: string;
  title: string;
  content: string;
  acceptance: string[];
  constraints: string;
  options?: Array<{ label: string; description: string }>;
}
type Session = { app: LocalAppServer; threadId: string; workspace: string; pending: boolean; busy: boolean; timer: NodeJS.Timeout };
const sessions = new Map<string, Session>();
function forget(key: string): void {
  const session = sessions.get(key);
  if (!session) return;
  clearTimeout(session.timer);
  session.app.close();
  sessions.delete(key);
}
function keepAlive(key: string, session: Session): void {
  clearTimeout(session.timer);
  session.timer = setTimeout(() => forget(key), 30 * 60_000);
}
export function endIntentSession(config: ClientConfig, sessionId: string): void {
  forget(`${config.hostUrl}|${config.nodeId}|${sessionId}`);
}

export async function clarifyIntentWithCodex(config: ClientConfig, sessionId: string, message: string, start = false, model?: string, signal?: AbortSignal, onProgress: (type: "status" | "delta", value: string) => void = () => undefined): Promise<IntentClarificationResult> {
  const workspace = await inspectWorkspace(config.workspace);
  if (!workspace.valid) throw new Error(workspace.error ?? "请先选择独立的 Git 项目工作区");
  if (!message.trim() || Buffer.byteLength(message, "utf8") > 12_000) throw new Error("需求内容不能为空且不超过 12 KiB");
  if (signal?.aborted) throw new Error("请求已取消");
  onProgress("status", "正在读取项目需求");
  const data = await api<V20BootstrapPayload>(config, "/api/v1/bootstrap");
  if (signal?.aborted) throw new Error("请求已取消");
  const maps = await readJson<IntentThreadMap>(INTENT_THREADS_PATH()) ?? {};
  const mapKey = `${config.hostUrl}|${config.nodeId}|${sessionId}`;
  const previous = maps[mapKey];
  if (start || sessions.get(mapKey)?.workspace !== config.workspace) forget(mapKey);
  let session = sessions.get(mapKey);
  if (session?.busy) throw new Error("上一轮仍在进行，请稍候");
  if (!session) {
    onProgress("status", "正在连接 Codex Plan");
    const app = new LocalAppServer(config.workspace);
    try {
      await app.initialize();
      let threadId: string | null = null;
      if (!start && previous?.workspace === config.workspace) {
        try { threadId = (await app.request<{ thread: { id: string } }>("thread/resume", { threadId: previous.threadId })).thread.id; } catch { /* stale thread */ }
      }
      if (!threadId) {
        threadId = (await app.request<{ thread: { id: string } }>("thread/start", { cwd: config.workspace, approvalPolicy: "never", sandbox: "read-only", serviceName: "vibe_git_intent" })).thread.id;
      }
      if (signal?.aborted) throw new Error("请求已取消");
      session = { app, threadId, workspace: config.workspace, pending: false, busy: false, timer: setTimeout(() => forget(mapKey), 30 * 60_000) };
      sessions.set(mapKey, session);
      maps[mapKey] = { threadId, workspace: config.workspace, updatedAt: new Date().toISOString() };
      await writeJson(INTENT_THREADS_PATH(), maps);
    } catch (error) { app.close(); throw error; }
  }
  const active = session;
  active.busy = true;
  keepAlive(mapKey, active);
  const abort = () => forget(mapKey);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const prompt = start ? [
      "You are operating in native Codex Plan mode. When clarification is needed, call the built-in request_user_input tool.",
      "Ask exactly one important question at a time. Give exactly three concise selectable options. The UI also supports custom text input. Do not output JSON or invent a questionnaire protocol.",
      "Clarify goal, users, core behavior, success criteria, boundaries, and constraints. Do not generate implementation tasks yet. When information is sufficient, produce a concise editable Markdown requirement draft and stop asking questions.",
      "Read the workspace if useful, but do not write files, execute commands, or modify code.",
      `<project_context>${workspace.name}\n${data.room.currentRequirementMarkdown.slice(0, 20_000)}</project_context>`,
      `<user_message>${message.trim()}</user_message>`
    ].join("\n\n") : [
      "Continue the current native Codex Plan conversation. Use request_user_input to ask one important question with three selectable options if clarification is still needed; otherwise produce the concise editable Markdown requirement draft.",
      "Do not output JSON and do not create implementation tasks.",
      `<user_answer>${message.trim()}</user_answer>`
    ].join("\n\n");
    onProgress("status", active.pending ? "正在继续 Plan" : "正在梳理需求");
    const delta = (value: string) => onProgress("delta", value);
    const progress = (value: string) => onProgress("status", value);
    const step: PlanStep = active.pending
      ? await active.app.answerPlanQuestion(message.trim(), delta, progress)
      : await active.app.startPlanTurn(active.threadId, prompt, config.workspace, await active.app.planMode(model), model, delta, progress);
    active.pending = step.kind === "question";
    const firstQuestion = step.kind === "question" ? step.questions[0] : undefined;
    const result: IntentClarificationResult = firstQuestion
      ? { status: "question", question: firstQuestion.question, options: firstQuestion.options.slice(0, 3), summary: "", title: "", content: "", acceptance: [], constraints: "" }
      : { status: "ready", question: "", summary: "", title: step.kind === "ready" ? step.text.match(/^#\s+(.+)$/m)?.[1] ?? "新需求" : "新需求", content: step.kind === "ready" ? step.text : "", acceptance: [], constraints: "" };
    if (result.status === "ready") forget(mapKey);
    else keepAlive(mapKey, active);
    return result;
  } catch (error) { forget(mapKey); throw error; }
  finally { active.busy = false; signal?.removeEventListener("abort", abort); }
}
