<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkspace } from "../store";
import { useAgents } from "../agents";
import { useRepository } from "../repository";
import { request } from "../api";
import { taskStatus } from "../team";
import Icon from "../components/Icon.vue";
import MarkdownEditor from "../components/MarkdownEditor.vue";
import FlowStatus from "../components/FlowStatus.vue";
const workspace = useWorkspace(), agents = useAgents(), repository = useRepository(), route = useRoute(), router = useRouter();
const input = ref(""), chatBody = ref<HTMLElement>(), composer = ref<HTMLTextAreaElement>(), autoScroll = ref(true), modelsLoading = ref(false);
const models = ref<Array<{ id: string; name: string }>>([{ id: "", name: "Codex 默认模型" }]);
const modelOptions = computed(() => agents.model && !models.value.some(model => model.id === agents.model)
  ? [...models.value, { id: agents.model, name: agents.model }] : models.value);
const presets = [
  { key: "issues", icon: "issue", title: "分析 Issues 与代码 PR", text: "分析当前待审核的需求 Issues 与代码 PR，找出需求之间、需求与任务、需求与代码变更的冲突，提出解决方案和需要队长决定的问题。请先使用当前可见的资料，缺少代码 diff 时明确列出所需资料。" },
  { key: "allocate", icon: "project", title: "分配任务给队友", text: "结合当前需求、成员计划、现有任务和工作进度，提出团队分工建议，说明负责人、目标、边界、验收和依赖。保留已完成记录与未受影响任务的进度，待队长在 Projects 确认后统一派发。" },
  { key: "progress", icon: "activity", title: "整理工作与 Git 进度", text: "根据已同步的任务状态、进度和 Git 分支/提交标识，整理团队工作情况、阻塞点和下一步。不把工作区修改或提交标识直接当成任务完成证据。" },
  { key: "review", icon: "pull", title: "审查代码合并方案", text: "结合当前需求和任务职责，列出代码 PR 的审查重点、潜在冲突和合并顺序。代码 PR 使用原生 Git 流程；缺少真实 diff 和检查结果时不要推断代码已经通过审查。" }
];
const selectedTaskIds = computed(() => typeof route.query.tasks === "string" ? route.query.tasks.split(",") : []);
const selectedTasks = computed(() => workspace.data?.tasks.filter(task => selectedTaskIds.value.includes(task.id)) ?? []);
const targetOwner = computed(() => typeof route.query.assignee === "string" ? workspace.data?.nodes.find(node => node.id === route.query.assignee) : undefined);
const lastAssistant = computed(() => [...agents.messages].reverse().find(message => message.role === "assistant" && !message.interrupted));
const latestQuestion = computed(() => agents.pendingQuestion && lastAssistant.value?.question ? lastAssistant.value : undefined);
function usePreset(key: string) {
  const preset = presets.find(item => item.key === key); if (!preset) return;
  const node = typeof route.query.node === "string" ? workspace.data?.nodes.find(node => node.id === route.query.node) : undefined;
  input.value = preset.text + (repository.url ? "\n代码仓库：" + repository.url.href + "。" : "") + (selectedTasks.value.length ? "\n\n本次重点任务：" + selectedTasks.value.map(task => task.title + "（" + task.id + "）").join("、") : "") +
    (targetOwner.value ? "\n希望分配给：" + targetOwner.value.label + "（" + targetOwner.value.id + "）。" : "") +
    (node?.git ? "\n本次重点成员：" + node.label + "，分支 " + node.git.branch + "，提交 " + node.git.headSha + "。" : "");
  void nextTick(() => composer.value?.focus());
}
watch(() => route.fullPath, () => { if (typeof route.query.prompt === "string") usePreset(route.query.prompt); }, { immediate: true });
watch(() => [agents.messages.length, agents.messages.at(-1)?.text, agents.status], async () => {
  await nextTick(); if (autoScroll.value && chatBody.value) chatBody.value.scrollTop = chatBody.value.scrollHeight;
});
function trackScroll() { if (chatBody.value) autoScroll.value = chatBody.value.scrollHeight - chatBody.value.scrollTop - chatBody.value.clientHeight < 100; }
async function send(value = input.value) {
  if (!value.trim() || agents.busy || !workspace.local) return;
  input.value = ""; autoScroll.value = true; await agents.send(value);
  if (agents.error && !input.value) input.value = value;
}
function submitKey(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); }
}
async function loadModels() {
  modelsLoading.value = true;
  try { const available = await request<Array<{ id: string; name: string }>>("/api/local/codex/models"); models.value = [{ id: "", name: "Codex 默认模型" }, ...available.filter(model => model.id !== "default")]; }
  catch (e) { agents.error = e instanceof Error ? e.message : String(e); }
  finally { modelsLoading.value = false; }
}
async function copyInstruction() {
  const instruction = (input.value.trim() || presets[0]!.text) + "\n\n请先调用 Vibe-Git Skill 同步消息和任务包版本，再处理本次指令。需要检查代码 PR 时使用本机 Git 或已登录的 Git 托管 CLI，按实际 diff 和验证结果分析。\n\n当前团队状态：\n" + agents.context();
  try { await navigator.clipboard.writeText(instruction); workspace.notice = "指令和团队上下文已复制，可粘贴到本机 Codex"; }
  catch { agents.error = "无法访问剪贴板，请手动复制指令"; }
}
async function useDraft(kind: "plan" | "issue") {
  if (!lastAssistant.value?.text || !workspace.data) return;
  try {
    const data = workspace.data, text = lastAssistant.value.text;
    if (kind === "plan") localStorage.setItem("vibe-plan:" + data.room.id + ":" + data.viewer.id, text);
    else localStorage.setItem("vibe-pr:" + data.room.id + ":" + data.viewer.id, JSON.stringify({ title: text.match(/^#\s+(.+)$/m)?.[1]?.slice(0, 160) || "Codex 需求建议", content: text, baseRevision: data.room.requirementRevision }));
    await router.push(kind === "plan" ? "/plans" : "/issues"); workspace.notice = "建议已放入草稿，可编辑后提交";
  } catch { agents.error = "无法保存本机草稿，请复制回答后在计划或 Issues 中编辑"; }
}
async function allocate() {
  await workspace.generateAllocation();
}
</script>
<template>
  <div class="view-title-line"><div><h1>Agents</h1><p>和 Codex 一起分析需求、代码协作与团队分工。</p></div><button class="btn" :disabled="agents.busy" @click="agents.reset()"><Icon name="plus" :size="16" />新对话</button></div>
  <div class="agents-layout">
    <section class="paper agent-conversation">
      <header class="agent-chat-header"><span class="agent-avatar"><Icon name="agent" :size="22" /></span><div><strong>Codex</strong><small>{{ repository.name }} · {{ workspace.chatAvailable ? '本机已连接' : '等待本机连接' }}</small></div><span class="tag">Plan</span><select v-model="agents.model" :disabled="agents.busy" aria-label="选择 Codex 模型"><option v-for="model in modelOptions" :key="model.id" :value="model.id">{{ model.name }}</option></select><button class="icon-btn" :disabled="agents.busy || modelsLoading || !workspace.local" aria-label="刷新 Codex 模型" @click="loadModels"><Icon name="activity" :size="16" /></button></header>
      <div ref="chatBody" class="agent-chat-body" @scroll="trackScroll">
        <div v-if="!agents.messages.length" class="agent-welcome"><span class="agent-welcome-icon"><Icon name="agent" :size="38" /></span><h2>我们先处理哪件事？</h2><p>从需求冲突、代码审查或下一轮分工开始。<br />当前团队状态会随问题一起交给 Codex。</p><div class="agent-preset-grid"><button v-for="preset in presets" :key="preset.key" @click="usePreset(preset.key)"><Icon :name="preset.icon" :size="19" /><strong>{{ preset.title }}</strong><Icon name="arrow" :size="15" /></button></div></div>
        <article v-for="message in agents.messages" :key="message.id" class="chat-message" :class="message.role"><span class="avatar mini" :class="{ 'agent-avatar': message.role === 'assistant' }"><Icon v-if="message.role === 'assistant'" name="agent" :size="17" /><template v-else>{{ workspace.data?.viewer.label.slice(0, 1).toUpperCase() }}</template></span><div class="message-content"><header><strong>{{ message.role === 'assistant' ? 'Codex' : workspace.data?.viewer.label }}</strong><time>{{ new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</time><span v-if="message.interrupted" class="tag amber">未完成</span></header><p v-if="message.role === 'user'" class="user-message-text">{{ message.text }}</p><p v-else-if="agents.busy && message.id === agents.messages.at(-1)?.id" class="streamed-message">{{ message.text || agents.status }}</p><MarkdownEditor v-else :model-value="message.text" readonly compact :outline="false" filename="codex-analysis.md" @error="agents.error = $event" /><div v-if="message.id === latestQuestion?.id" class="chat-question-options"><button v-for="(option, index) in message.question?.options" :key="index" :disabled="agents.busy" @click="send(option.label)"><b>{{ ['A', 'B', 'C'][index] }}</b><span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span></button><button :disabled="agents.busy" @click="input = ''; composer?.focus()"><b>↳</b><span><strong>自定义回答</strong><small>在下方输入你的选择和理由。</small></span></button></div></div></article>
        <div v-if="agents.busy" class="agent-stream-status" role="status"><span class="working-dot"></span>{{ agents.status || 'Codex 正在思考…' }}</div>
      </div>
      <div v-if="agents.error" class="chat-error" role="alert">{{ agents.error }}<button class="icon-btn" aria-label="关闭对话错误" @click="agents.error = ''"><Icon name="close" :size="14" /></button></div>
      <footer class="agent-composer"><div v-if="agents.messages.length" class="chat-quick-prompts"><button v-for="preset in presets.slice(0, 3)" :key="preset.key" :disabled="agents.busy" @click="usePreset(preset.key)">{{ preset.title }}</button></div><form @submit.prevent="send()"><textarea ref="composer" v-model="input" :disabled="agents.busy || !workspace.local" :placeholder="latestQuestion ? '输入你的自定义回答…' : '向 Codex 提问，或选择上面的默认指令…'" aria-label="发送给 Codex 的消息" rows="3" @keydown="submitKey"></textarea><div class="composer-actions"><span>Enter 发送 · Shift + Enter 换行</span><button v-if="agents.busy" type="button" class="btn small" @click="agents.stop()"><Icon name="pause" :size="15" />停止生成</button><button v-else class="btn primary small" :disabled="!workspace.local || !input.trim()"><Icon name="send" :size="15" />发送</button></div></form><p class="chat-mode-note">本机 Codex · 只读 Plan 分析。审核与任务派发在工作台确认。</p></footer>
    </section>
    <aside class="agent-context"><section><h2>当前上下文</h2><RouterLink to="/requirements"><Icon name="book" :size="17" />需求文档<span>R{{ workspace.data?.room.requirementRevision ?? 0 }}</span></RouterLink><RouterLink to="/issues"><Icon name="issue" :size="17" />待审 Issues<span>{{ workspace.pendingChanges.length }}</span></RouterLink><RouterLink to="/pulls"><Icon name="pull" :size="17" />代码 PR<span><Icon name="external" :size="13" /></span></RouterLink><RouterLink to="/projects"><Icon name="project" :size="17" />任务包<span>{{ workspace.data?.tasks.length ?? 0 }}</span></RouterLink><p v-if="selectedTasks.length" class="selected-context">本次选择了 {{ selectedTasks.length }} 项任务<span v-if="targetOwner">，建议分配给 {{ targetOwner.label }}</span>。</p><ul v-if="selectedTasks.length" class="context-task-list"><li v-for="task in selectedTasks" :key="task.id">{{ task.title }}<small>{{ taskStatus[task.status] }} · {{ workspace.name(task.assigneeNodeId) }}</small></li></ul></section>
      <section><h2>团队操作</h2><FlowStatus v-if="workspace.flow" :flow="workspace.flow" /><button v-if="workspace.canManage && workspace.flow?.status === 'DRAFT'" class="btn primary full-width" :disabled="workspace.busy" @click="allocate">AI 生成分工草稿</button><RouterLink v-if="workspace.flow?.status === 'READY'" to="/projects" class="btn primary full-width">确认分工并派发 <Icon name="arrow" :size="15" /></RouterLink><RouterLink to="/issues" class="text-button">选择 Issues 统一审核 <Icon name="arrow" :size="13" /></RouterLink><button class="text-button" @click="copyInstruction"><Icon name="copy" :size="15" />复制指令给本机 Codex</button><p class="muted">需要执行 Git 操作时，把指令交给本机 Codex；Skill 先同步消息和任务版本。</p></section>
      <section v-if="lastAssistant?.text && !agents.busy && !agents.pendingQuestion"><h2>继续使用这份建议</h2><button class="text-button" @click="useDraft('plan')"><Icon name="document" :size="15" />放入个人计划草稿</button><button v-if="workspace.data?.room.requirementRevision" class="text-button" @click="useDraft('issue')"><Icon name="issue" :size="15" />作为需求 Issue 草稿</button><p class="muted">编辑后提交，正式需求和任务保留现有审核流程。</p></section>
      <section><h2>连接与额度</h2><p class="connection-summary"><i class="presence" :class="{ online: workspace.computeAvailable }"></i>{{ workspace.computeLabel }}</p><RouterLink to="/settings" class="text-button">打开 Settings <Icon name="settings" :size="14" /></RouterLink></section>
    </aside>
  </div>
</template>
