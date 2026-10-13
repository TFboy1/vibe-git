<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { TaskExecutionPackage } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import { request } from "../api";
import { taskStatus, taskNextStep } from "../team";
import MarkdownEditor from "../components/MarkdownEditor.vue";
import FlowStatus from "../components/FlowStatus.vue";
import Icon from "../components/Icon.vue";
import TaskAssignment from "../components/TaskAssignment.vue";
const store = useWorkspace(), filter = ref("active"), selected = ref(""), pack = ref<TaskExecutionPackage | null>(null), loading = ref(false), detailError = ref("");
const route = useRoute();
const statusNames = taskStatus;
const query = computed(() => typeof route.query.q === "string" ? route.query.q.trim().toLowerCase() : "");
const all = computed(() => [...(store.data?.tasks ?? []), ...(store.data?.agile?.archivedTasks ?? [])].filter(task => store.captain || task.assigneeNodeId === store.data?.viewer.id));
const filtered = computed(() => all.value.filter(task =>
  (filter.value === "archive" ? task.archived : !task.archived && (filter.value === "done" ? task.status === "DONE" : task.status !== "DONE")) &&
  (!query.value || [task.id, task.title, task.goal, task.progressSummary, store.name(task.assigneeNodeId)].join(" ").toLowerCase().includes(query.value))));
const task = computed(() => all.value.find(task => task.id === selected.value));
const manualInstruction = ref("");
const nextStep = computed(() => task.value ? taskNextStep(task.value, store.data?.tasks ?? [], store.name) : "");
const syncOnly = computed(() => !!task.value && (task.value.status === "PAUSED" || task.value.pauseRequested || task.value.status === "DONE" ||
  (pack.value ? pack.value.dependencies.some(item => item.status !== "DONE") : task.value.dependencies.some(id => store.data?.tasks.find(item => item.id === id)?.status !== "DONE"))));
const instruction = computed(() => task.value ? [
  "请使用 Vibe-Git Skill 处理我的任务。任务 ID：" + task.value.id + "；标题：" + JSON.stringify(task.value.title) + "。",
  task.value.flow === "agile" ? "先同步 task inbox，核对本人身份、暂停与修订消息，再读取该任务最新任务包。不要使用网页展示的旧版本执行或回填汇报。" : "先调用 Skill 核对历史房间的执行流程、本人身份和暂停消息，再读取该任务最新任务包。",
  syncOnly.value ? "本次先同步状态。如果暂停或依赖未完成，请停止旧版本工作并说明等待原因；如果已完成，仅查看完成记录，不重新开工。" : "确认任务属于本人、未归档、未暂停且前置依赖已完成后，在当前开发会话按任务目标、边界和验收执行。",
  task.value.flow === "agile" ? "每次调用 Skill 先同步需求修订，通过 Skill 汇报实际开工、进度、阻塞或完成。携带实际读取并执行的任务包与需求版本，完成附真实验收证据。不要为旧成果补填新版本号。" : "按历史任务原有的开工、同步和完成确认流程处理，保留实际验证证据，不用新版汇报命令替代旧流程。"
].join("\n\n") : "");
async function copyInstruction() {
  if (!task.value || task.value.archived || task.value.assigneeNodeId !== store.data?.viewer.id) return;
  const text = instruction.value;
  try { await navigator.clipboard.writeText(text); manualInstruction.value = ""; store.notice = "任务指令已复制，粘贴到你当前的开发 AI 即可"; }
  catch { manualInstruction.value = text; }
}
const content = computed(() => task.value?.archived ? ["# " + task.value.title, "此任务在需求修订后归档。原记录保留。", "## 原目标", task.value.goal, "## 原边界", task.value.boundary,
  "## 验收", task.value.acceptance.map(v => "- " + v).join("\n"), "## 进度与证据", task.value.progressSummary ?? "", ...(task.value.reportEvidence ?? []).map(r => r.summary + "\n" + r.evidence.join("\n"))].join("\n\n") : pack.value?.markdown ?? "");
watch(() => [task.value?.id, task.value?.status, task.value?.archived] as const, ([id, status, archived], before) => {
  if (!id || id !== before?.[0]) return;
  if (archived) filter.value = "archive";
  else if (status === "DONE" && before[1] !== "DONE") filter.value = "done";
});
watch(filtered, tasks => { if (!tasks.some(task => task.id === selected.value)) selected.value = tasks[0]?.id ?? ""; }, { immediate: true });
watch(() => route.query.task, id => {
  const target = typeof id === "string" ? all.value.find(item => item.id === id) : undefined;
  if (target) { filter.value = target.archived ? "archive" : target.status === "DONE" ? "done" : "active"; selected.value = target.id; }
}, { immediate: true });
let generation = 0;
watch(() => [selected.value, task.value?.packageRevision, task.value?.revision, task.value?.status, task.value?.progressSummary] as const, async ([id]) => {
  const version = ++generation; pack.value = null; detailError.value = ""; manualInstruction.value = "";
  if (!id || task.value?.archived) { loading.value = false; return; }
  loading.value = true;
  try { const result = await request<TaskExecutionPackage>("/api/v1/tasks/" + encodeURIComponent(id) + "/package"); if (version === generation) pack.value = result; }
  catch (e) { if (version === generation) detailError.value = e instanceof Error ? e.message : String(e); }
  finally { if (version === generation) loading.value = false; }
}, { immediate: true });
</script>
<template>
  <div class="intro-line"><p>{{ store.captain ? '让每个人拿到清楚、可执行的工作。' : '你的目标、边界和验收都在这里。' }}<span>{{ store.captain ? '先审核分工，再统一派发。' : '通过 Vibe-Git Skill 向开发 AI 传达开工和进度即可。' }}</span></p><span v-if="store.data?.room.requirementRevision" class="tag mint">当前需求 R{{ store.data.room.requirementRevision }}</span></div>
  <FlowStatus v-if="store.flow" :flow="store.flow" readonly />
  <div v-if="store.canManage && store.flow?.status === 'READY'" class="next-action"><div><strong>分工草稿已就绪</strong><p>任务包视图保留已派发记录；新分工在任务看板审核并派发。</p></div><RouterLink :to="{ path: '/projects', query: query ? { q: route.query.q } : {} }" class="btn">查看分工 <Icon name="arrow" :size="15" /></RouterLink></div>
  <section v-else-if="!all.length" class="paper empty-state large"><span class="empty-number">03</span><h2>{{ store.flow?.draftMarkdown ? '确认需求后，再开始分工。' : '任务包将在队长派发后到达。' }}</h2><p>{{ store.captain ? '先审核完整的需求 MD。AI 生成分工后，可以调整负责人和任务内容，再统一派发。' : '你不需要领取或确认。派发后，任务包会自动出现在这里。' }}</p><RouterLink v-if="store.captain" to="/requirements" class="btn">查看需求文档 <Icon name="arrow" /></RouterLink></section>
  <div v-if="all.length" class="task-workspace">
    <aside class="task-list-panel paper"><header class="section-head"><span class="eyebrow">{{ store.captain ? 'TEAM TASKS' : 'MY TASKS' }}</span><span class="count">{{ all.filter(t => !t.archived).length }}</span></header><h2>{{ store.captain ? '团队任务' : '我的任务' }}</h2><div class="task-filter" aria-label="任务筛选"><button v-for="item in [{ value: 'active', text: '进行中' }, { value: 'done', text: '完成' }, { value: 'archive', text: '归档' }]" :key="item.value" :class="{ active: filter === item.value }" @click="filter = item.value">{{ item.text }}</button></div>
      <div v-if="!filtered.length" class="empty-state small">{{ query ? '当前分类没有匹配的任务，请调整顶栏搜索或切换分类。' : '这个分类还没有任务。' }}</div><button v-for="item in filtered" :key="item.id" class="task-list-row" :class="{ selected: selected === item.id }" @click="selected = item.id"><span class="task-state-dot" :class="item.status.toLowerCase()"></span><span><strong>{{ item.title }}</strong><small>{{ store.name(item.assigneeNodeId) }} · {{ item.archived ? '已归档' : statusNames[item.status] ?? item.status }}</small></span><Icon name="chevron" :size="15" /></button>
      <p class="task-list-note">{{ store.agileEnabled ? '复制当前任务的指令给开发 AI，Skill 会同步版本并汇报。附验收证据汇报完成后，无需网页确认。' : '历史任务保留原有执行流程，调用 Skill 核对最新版任务包。' }}</p>
    </aside>
    <section class="paper task-document">
      <header v-if="task" class="document-header"><div><span class="eyebrow">EXECUTION PACKAGE / 任务包</span><h2>{{ task.title }}</h2><p>{{ store.name(task.assigneeNodeId) }} · 任务包 v{{ pack?.taskRevision ?? task.packageRevision ?? task.revision }} · 需求 R{{ pack?.requirementRevision ?? task.requirementRevision ?? store.data?.room.requirementRevision }}</p></div><span class="tag" :class="{ amber: task.status === 'PAUSED', mint: task.status === 'DONE' }">{{ task.archived ? '已归档' : statusNames[task.status] ?? task.status }}</span></header>
      <TaskAssignment v-if="task && store.canManage" :key="task.id" :tasks="[task]" />
      <div v-if="task" class="task-handoff"><div><strong>下一步</strong><p>{{ nextStep }}</p></div><button v-if="store.local && !task.archived && task.assigneeNodeId === store.data?.viewer.id" class="btn primary" @click="copyInstruction"><Icon name="copy" :size="16" />{{ syncOnly ? '复制同步指令' : '复制给开发 AI' }}</button></div>
      <div v-if="manualInstruction" class="manual-instruction"><label for="task-instruction">无法访问剪贴板，请手动复制以下指令到开发 AI：</label><textarea id="task-instruction" :value="manualInstruction" class="input mono" rows="8" readonly @focus="($event.target as HTMLTextAreaElement).select()"></textarea></div>
      <div v-if="task?.status === 'PAUSED'" class="pause-notice"><Icon name="pause" /><div><strong>已请求暂停，等待开发 AI 同步。</strong><p>网页状态不代表 AI 已经停止。下一次 Skill 同步会读取消息；新版任务包发布后再按新版继续。</p></div></div>
      <div v-if="task?.reworkOfTaskId" class="linked-work"><Icon name="link" :size="15" /><span>这是已完成任务的后续修订，原完成与验收记录保留。</span><RouterLink v-if="all.some(item => item.id === task?.reworkOfTaskId)" :to="{ path: '/projects', query: { task: task.reworkOfTaskId, view: 'packages' } }" class="text-button">查看原任务</RouterLink><code v-else>{{ task.reworkOfTaskId }}</code></div>
      <details v-if="task?.reportEvidence?.length" class="completion-evidence"><summary>{{ task.status === 'DONE' ? '查看完成汇报与验收证据' : '查看已有汇报与证据' }}</summary><article v-for="report in task.reportEvidence" :key="report.reportId"><strong>{{ report.summary }}</strong><ul v-if="report.evidence.length"><li v-for="(evidence, index) in report.evidence" :key="index">{{ evidence }}</li></ul></article></details>
      <div v-if="loading" class="empty-state"><span class="working-dot"></span> 正在读取任务包…</div><p v-else-if="detailError" class="inline-error">{{ detailError }}</p>
      <MarkdownEditor v-else-if="task" :key="task.id" :model-value="content" readonly :filename="'task-' + task.id + '.md'" @error="store.error = $event" /><div v-else class="empty-state">从左侧选择一项任务。</div>
    </section>
  </div>
</template>
