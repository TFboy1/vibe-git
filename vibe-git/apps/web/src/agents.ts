import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { MarkdownDocument } from "@vibe-git/protocol";
import { request, stream } from "./api";
import { useWorkspace } from "./store";

export interface AgentMessage {
  id: string; role: "user" | "assistant"; text: string; createdAt: string; interrupted?: boolean;
  question?: { text: string; options: Array<{ label: string; description: string }> };
}
interface PlanResult { status: "question" | "ready"; question: string; options?: Array<{ label: string; description: string }>; content: string; title: string }

export const useAgents = defineStore("agents", () => {
  const workspace = useWorkspace(), messages = ref<AgentMessage[]>([]), busy = ref(false), status = ref(""), error = ref("");
  const sessionId = ref(crypto.randomUUID()), pendingQuestion = ref(false), model = ref("");
  const sourceDocuments = new Map<string, string>();
  const key = computed(() => "vibe-agents:" + workspace.data?.room.id + ":" + workspace.data?.viewer.id);
  let controller: AbortController | null = null;
  function persist() {
    if (!workspace.data) return;
    try { localStorage.setItem(key.value, JSON.stringify({ sessionId: sessionId.value, messages: messages.value.slice(-40), pendingQuestion: pendingQuestion.value, model: model.value })); }
    catch { /* The active conversation remains in memory when storage is full. */ }
  }
  watch(key, () => {
    controller?.abort(); messages.value = []; sourceDocuments.clear(); pendingQuestion.value = false; error.value = ""; sessionId.value = crypto.randomUUID();
    if (!workspace.data) return;
    try {
      const cached = JSON.parse(localStorage.getItem(key.value) ?? "null");
      if (cached && Array.isArray(cached.messages)) {
        messages.value = cached.messages.filter((item: AgentMessage) => item && ["user", "assistant"].includes(item.role) && typeof item.id === "string" && typeof item.text === "string").slice(-40);
        if (typeof cached.sessionId === "string") sessionId.value = cached.sessionId;
        pendingQuestion.value = cached.pendingQuestion === true; model.value = typeof cached.model === "string" ? cached.model : "";
      }
    } catch { /* Begin a new conversation if the local history cannot be read. */ }
  }, { immediate: true });
  function context() {
    const data = workspace.data;
    if (!data) return "";
    return JSON.stringify({ project: workspace.project?.name, role: data.viewer.role, viewer: data.viewer.id,
      requirementRevision: data.room.requirementRevision, requirement: data.room.currentRequirementMarkdown.slice(0, 3500),
      members: data.nodes.filter(node => !node.revoked).map(node => ({ id: node.id, name: node.label, connected: node.connected, git: node.git })),
      plans: data.plans.map(plan => ({ owner: plan.ownerNodeId, revision: plan.revision, content: plan.content.slice(0, 600) })),
      issues: workspace.pendingChanges.map(issue => ({ id: issue.id, title: issue.title, content: (issue.content || sourceDocuments.get(issue.documentId ?? "") || "正文尚未读取，请以 Issues 文档为准").slice(0, 650), baseRevision: issue.baseRequirementRevision, status: issue.status })),
      tasks: data.tasks.filter(task => !task.archived).map(task => ({ id: task.id, title: task.title, owner: task.assigneeNodeId, goal: task.goal.slice(0, 450), status: task.status, version: task.packageRevision ?? task.revision, progress: task.progressSummary })),
      flow: workspace.flow ? { id: workspace.flow.id, status: workspace.flow.status, summary: workspace.flow.summary } : null });
  }
  const encoder = new TextEncoder();
  function clip(value: string, bytes: number) {
    if (encoder.encode(value).length <= bytes) return value;
    return new TextDecoder().decode(encoder.encode(value).slice(0, Math.max(0, bytes - 60))) + "\n（上下文节选，以正式需求和任务包为准）";
  }
  async function readIssueDocuments(signal: AbortSignal) {
    const ids = [...new Set(workspace.pendingChanges.filter(issue => !issue.content && issue.documentId && !sourceDocuments.has(issue.documentId)).map(issue => issue.documentId!))].slice(0, 12);
    if (!ids.length) return;
    status.value = "正在同步需求 Issues 正文…";
    const results = await Promise.allSettled(ids.map(id => request<MarkdownDocument>("/api/v1/documents/" + encodeURIComponent(id), undefined, "GET", { signal, timeoutMs: 20_000 })));
    results.forEach((result, index) => { if (result.status === "fulfilled" && typeof result.value.content === "string") sourceDocuments.set(ids[index]!, result.value.content); });
    if (signal.aborted) throw new Error("生成已停止，已收到的内容保留");
  }
  function prompt(message: string, omitLast = 0) {
    const header = "请根据我的请求与当前团队状态提供中文分析或建议。Issues 是需求变更，代码 PR 由原生 Git 托管。缺少代码 diff 时明确说明需要哪些材料。当前对话为只读 Plan，实际审核和分派由工作台完成。\n";
    const history = messages.value.slice(0, omitLast ? -omitLast : undefined).filter(item => item.text).slice(-4).map(item => item.role + ": " + item.text.slice(0, 700)).join("\n");
    const available = 11_800 - encoder.encode(header + "\n我的请求：\n" + message).length;
    return header + "\n团队状态：\n" + clip(context(), Math.floor(available * .78)) + "\n最近对话：\n" + clip(history, Math.floor(available * .18)) + "\n我的请求：\n" + message;
  }
  async function send(value: string) {
    const message = value.trim();
    if (busy.value || !message) return;
    if (!workspace.local) { error.value = "请运行 vibe-git open，使用本机 Codex 对话"; return; }
    if (encoder.encode(message).length > 8000) { error.value = "本次输入超过 8 KiB，请分段发送"; return; }
    error.value = ""; busy.value = true; status.value = "正在连接本机 Codex…";
    messages.value.push({ id: crypto.randomUUID(), role: "user", text: message, createdAt: new Date().toISOString() });
    const answer = { id: crypto.randomUUID(), role: "assistant" as const, text: "", createdAt: new Date().toISOString() };
    messages.value.push(answer); persist();
    const target = () => messages.value.find(item => item.id === answer.id);
    const active = new AbortController(); controller = active;
    try {
      if (!pendingQuestion.value) await readIssueDocuments(active.signal);
      const requestMessage = pendingQuestion.value ? message : prompt(message, 2);
      await stream("/api/local/intent-clarify", { provider: "codex", sessionId: sessionId.value, message: requestMessage, start: !pendingQuestion.value, ...(model.value ? { model: model.value } : {}) }, active.signal, event => {
        const current = target(); if (!current) return;
        if (event.type === "status") status.value = String(event.value);
        if (event.type === "delta" || event.type === "preview") current.text += String(event.value ?? "");
        if (event.type === "done") {
          const result = event.value as PlanResult;
          if (!result || !["ready", "question"].includes(result.status)) throw new Error("Codex 返回的对话内容无效");
          pendingQuestion.value = result.status === "question";
          if (result.status === "question") {
            current.text = result.question;
            current.question = { text: result.question, options: (result.options ?? []).filter(option => typeof option.label === "string" && typeof option.description === "string").slice(0, 3) };
          } else { current.text = result.content || current.text; current.question = undefined; }
        }
      });
      await workspace.refresh().catch(() => undefined);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      const current = target(); if (current) { current.interrupted = true; if (!current.text) current.text = "本次没有生成完整回答。可以重新发送或开启新对话。"; }
      pendingQuestion.value = false;
    } finally { if (controller === active) controller = null; busy.value = false; status.value = ""; persist(); }
  }
  async function reset() {
    if (busy.value) return;
    const previous = sessionId.value;
    messages.value = []; pendingQuestion.value = false; sessionId.value = crypto.randomUUID(); error.value = ""; persist();
    if (workspace.local) await request("/api/local/intent-clarify/end", { sessionId: previous }).catch(() => undefined);
  }
  const stop = () => controller?.abort();
  return { messages, busy, status, error, pendingQuestion, model, send, stop, reset, context };
});
