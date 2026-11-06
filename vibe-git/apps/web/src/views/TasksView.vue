<script setup lang="ts">
import { failureMessage } from "../api";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { StageTask, TaskExecutionPackage } from "@vibe-git/protocol";
import { taskDependencyBlockers } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import { useHistory } from "../history";
import { request } from "../api";
import { taskStatus, taskNextStep } from "../team";
import MarkdownEditor from "../components/MarkdownEditor.vue";
import Icon from "../components/Icon.vue";
import TaskAssignment from "../components/TaskAssignment.vue";
const store = useWorkspace(), filter = ref("active"), pack = ref<TaskExecutionPackage | null>(null), loading = ref(false), detailError = ref("");
const route = useRoute(), router = useRouter();
const selected = computed(() => typeof route.query.task === "string" ? route.query.task : "");
const linkedError = ref(""), linkedLoading = ref(false);
function openTask(id: string) { void router.push({ path: route.path, query: { ...route.query, task: id } }); }
function setOwner(value: string) { const query = { ...route.query }; if (value) query.owner = value; else delete query.owner; void router.push({ path: route.path, query }); }
function back() { const query = { ...route.query }; delete query.task; void router.push({ path: route.path, query }); }
const linkedTask = ref<StageTask | null>(null);
const statusNames = taskStatus;
const query = computed(() => typeof route.query.q === "string" ? route.query.q.trim().toLowerCase() : "");
const archive = useHistory<StageTask>("archivedTasks"), completedHistory = useHistory<StageTask>("completedTasks");
watch(filter, value => { if (value === "archive") void archive.load(); if (value === "done") void completedHistory.load(); });
const all = computed(() => [...new Map([...(store.data?.tasks ?? []), ...(linkedTask.value && !store.data?.tasks.some(task => task.id === linkedTask.value?.id) ? [linkedTask.value] : []), ...(store.data?.agile?.archivedTasks ?? []), ...(filter.value === "archive" ? archive.items.value : filter.value === "done" ? completedHistory.items.value.filter(task => !store.data?.tasks.some(current => current.id === task.id)) : [])].map(task => [task.id, task])).values()].filter(task => store.captain || task.assigneeNodeId === store.data?.viewer.id));
const filtered = computed(() => all.value.filter(task =>
  (filter.value === "archive" ? task.archived : !task.archived && (filter.value === "done" ? task.status === "DONE" : task.status !== "DONE")) &&
  (!route.query.owner || task.assigneeNodeId === route.query.owner) &&
  (!query.value || [task.id, task.title, task.goal, task.progressSummary, store.name(task.assigneeNodeId)].join(" ").toLowerCase().includes(query.value))));
const task = computed(() => all.value.find(task => task.id === selected.value));
const manualInstruction = ref("");
const nextStep = computed(() => task.value ? taskNextStep(task.value, store.data?.tasks ?? [], store.name, store.data?.contracts ?? []) : "");
const syncOnly = computed(() => !!task.value && (task.value.status === "PAUSED" || task.value.pauseRequested || task.value.status === "DONE" ||
  taskDependencyBlockers(task.value, store.data?.tasks ?? [], store.data?.contracts ?? []).length > 0));
const instruction = computed(() => task.value ? [
  "请使用 Vibe-Git Skill 处理我的任务。任务 ID：" + task.value.id + "；标题：" + JSON.stringify(task.value.title) + "。",
  task.value.flow === "agile" ? "先同步 task inbox，核对本人身份、暂停与修订消息，再读取该任务最新任务包。不要使用网页展示的旧版本执行或回填汇报。" : "先调用 Skill 核对历史房间的执行流程、本人身份和暂停消息，再读取该任务最新任务包。",
  syncOnly.value ? "本次先同步状态。如果暂停、硬依赖未完成或接口不可用，请停止旧版本工作并说明等待原因；如果已完成，仅查看完成记录，不重新开工。" : "确认任务属于本人、未归档、未暂停且硬依赖已完成或契约已发布后，在当前开发会话按任务目标、边界和验收执行。接口依赖可按契约并行开发。",
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
let linkedController: AbortController | undefined;
watch(() => route.query.task, async id => {
  linkedController?.abort(); const controller = linkedController = new AbortController();
  linkedError.value = ""; linkedTask.value = null; linkedLoading.value = false;
  if (typeof id !== "string") return;
  linkedLoading.value = true;
  try {
    const target = all.value.find(item => item.id === id) ?? await request<StageTask>("/api/v1/workspace/tasks/" + encodeURIComponent(id), undefined, undefined, { signal: controller.signal });
    if (controller.signal.aborted) return;
    linkedTask.value = target; filter.value = target.archived ? "archive" : target.status === "DONE" ? "done" : "active";
  } catch (e) { if (!controller.signal.aborted) linkedError.value = failureMessage(e); }
  finally { if (!controller.signal.aborted) linkedLoading.value = false; }
}, { immediate: true });
onBeforeUnmount(() => linkedController?.abort());
let generation = 0;
watch(() => [task.value?.id, task.value?.packageRevision, task.value?.revision, task.value?.status, task.value?.progressSummary] as const, async ([id]) => {
  const version = ++generation; pack.value = null; detailError.value = ""; manualInstruction.value = "";
  if (!id || task.value?.archived) { loading.value = false; return; }
  loading.value = true;
  try { const result = await request<TaskExecutionPackage>("/api/v1/tasks/" + encodeURIComponent(id) + "/package"); if (version === generation) pack.value = result; }
  catch (e) { if (version === generation) detailError.value = failureMessage(e); }
  finally { if (version === generation) loading.value = false; }
}, { immediate: true });
</script>
<template>
  <template v-if="!selected">
    <div class="task-list-toolbar"><div class="task-filter" aria-label="任务筛选"><button v-for="item in [{ value: 'active', text: '进行中' }, { value: 'done', text: '已完成' }, { value: 'archive', text: '已归档' }]" :key="item.value" :class="{ active: filter === item.value }" :aria-pressed="filter === item.value" @click="filter = item.value">{{ item.text }}</button></div><label v-if="store.captain" class="task-owner-filter"><span class="sr-only">按负责人筛选</span><select class="input" :value="route.query.owner ?? ''" @change="setOwner(($event.target as HTMLSelectElement).value)"><option value="">所有负责人</option><option v-for="node in store.data?.nodes ?? []" :key="node.id" :value="node.id">{{ node.label }}{{ node.revoked ? '（已移除）' : '' }}</option></select></label><span class="muted">{{ filtered.length }} 项任务</span></div>
    <div v-if="filter !== 'active'" class="history-pagination"><button class="btn small" :disabled="(filter === 'archive' ? archive : completedHistory).loading.value" @click="(filter === 'archive' ? archive : completedHistory).load()">最新一页</button><button v-if="(filter === 'archive' ? archive : completedHistory).nextCursor.value" class="btn small" :disabled="(filter === 'archive' ? archive : completedHistory).loading.value" @click="(filter === 'archive' ? archive : completedHistory).load(true)">更早记录</button><p v-if="(filter === 'archive' ? archive : completedHistory).loading.value" role="status">正在读取记录…</p><p v-if="(filter === 'archive' ? archive : completedHistory).error.value" class="inline-error" role="alert">{{ (filter === 'archive' ? archive : completedHistory).error.value }}</p></div>
    <div v-if="store.canManage && store.flow?.status === 'READY'" class="next-action"><div><strong>新分工等待发布</strong><p>发布后，新的任务包会出现在这里。</p></div><RouterLink to="/projects" class="text-button">前往分工 <Icon name="arrow" :size="15" /></RouterLink></div>
    <section class="paper execution-list" aria-label="任务列表">
      <button v-for="item in filtered" :key="item.id" class="execution-row" @click="openTask(item.id)"><span class="task-state-dot" :class="item.status.toLowerCase()"></span><span class="execution-row-body"><strong>{{ item.title }}</strong><small>{{ store.name(item.assigneeNodeId) }}<template v-if="item.blockedReason"> · {{ item.blockedReason }}</template></small></span><span class="tag" :class="{ amber: ['PAUSED', 'BLOCKED', 'FAILED'].includes(item.status) }">{{ item.archived ? '已归档' : statusNames[item.status] ?? item.status }}</span><Icon name="chevron" :size="15" /></button>
      <div v-if="!filtered.length" class="empty-state large"><Icon name="tasks" :size="30" /><h2>{{ query || route.query.owner ? '没有匹配的任务' : filter === 'active' ? '暂时没有待执行任务' : '这个分类还没有任务' }}</h2><p>{{ query || route.query.owner ? '调整搜索条件或筛选后再查看。' : store.captain ? '确认需求与分工并发布后，任务会出现在这里。' : '任务由队长派发，你无需领取或确认。' }}</p><RouterLink v-if="filter === 'active' && !all.length" :to="store.captain ? '/projects' : '/requirements'" class="text-button">{{ store.captain ? '查看分工' : '查看团队需求' }} <Icon name="arrow" :size="14" /></RouterLink></div>
    </section>
  </template>
  <template v-else>
    <button class="text-button detail-back" @click="back"><Icon name="arrow" :size="15" />返回任务列表</button>
    <p v-if="linkedError" class="inline-error" role="alert">{{ linkedError }}</p>
    <div v-else-if="linkedLoading && !task" class="empty-state" role="status">正在读取任务…</div>
    <section v-else-if="task" class="paper task-document task-detail-page">
      <header class="document-header"><div><h2>{{ task.title }}</h2><p>{{ store.name(task.assigneeNodeId) }}</p></div><span class="tag" :class="{ amber: ['PAUSED', 'BLOCKED', 'FAILED'].includes(task.status), mint: task.status === 'DONE' }">{{ task.archived ? '已归档' : statusNames[task.status] ?? task.status }}</span></header>
      <div class="task-goal"><h3>任务目标</h3><p>{{ task.goal }}</p><p v-if="task.blockedReason" class="inline-error" role="alert">{{ task.blockedReason }}</p></div>
      <div class="task-handoff"><div><strong>下一步</strong><p>{{ nextStep }}</p></div><button v-if="store.local && !task.archived && task.assigneeNodeId === store.data?.viewer.id" class="btn primary" @click="copyInstruction"><Icon name="copy" :size="16" />{{ syncOnly ? '复制同步指令' : '复制给开发 AI' }}</button></div>
      <div v-if="manualInstruction" class="manual-instruction"><label for="task-instruction">无法访问剪贴板，请手动复制以下指令到开发 AI：</label><textarea id="task-instruction" :value="manualInstruction" class="input mono" rows="8" readonly @focus="($event.target as HTMLTextAreaElement).select()"></textarea></div>
      <div v-if="task?.status === 'PAUSED'" class="pause-notice"><Icon name="pause" /><div><strong>已请求暂停，等待开发 AI 同步。</strong><p>网页状态不代表 AI 已经停止。下一次 Skill 同步会读取消息；新版任务包发布后再按新版继续。</p></div></div>
      <div v-if="task?.reworkOfTaskId" class="linked-work"><Icon name="link" :size="15" /><span>这是已完成任务的后续修订，原完成与验收记录保留。</span><RouterLink v-if="all.some(item => item.id === task?.reworkOfTaskId)" :to="{ path: '/projects', query: { task: task.reworkOfTaskId, view: 'packages' } }" class="text-button">查看原任务</RouterLink><code v-else>{{ task.reworkOfTaskId }}</code></div>
      <details v-if="task?.reportEvidence?.length" class="completion-evidence"><summary>{{ task.status === 'DONE' ? '查看完成汇报与验收证据' : '查看已有汇报与证据' }}</summary><article v-for="report in task.reportEvidence" :key="report.reportId"><strong>{{ report.summary }}</strong><ul v-if="report.evidence.length"><li v-for="(evidence, index) in report.evidence" :key="index">{{ evidence }}</li></ul></article></details>
      <p v-if="detailError" class="inline-error" role="alert">{{ detailError }}</p>
      <details class="workspace-disclosure"><summary><Icon name="document" :size="17" /><strong>完整任务包与技术细节</strong><span>边界、验收、依赖和版本</span><Icon name="chevron" :size="15" /></summary><div class="task-version">任务包 v{{ pack?.taskRevision ?? task.packageRevision ?? task.revision }} · 需求 R{{ pack?.requirementRevision ?? task.requirementRevision ?? store.data?.room.requirementRevision }}</div><div v-if="loading" class="empty-state" role="status">正在读取任务包…</div><MarkdownEditor v-else-if="!detailError" :key="task.id" :model-value="content" readonly :outline="false" :filename="'task-' + task.id + '.md'" @error="store.error = $event" /></details>
      <details v-if="store.canManage" class="workspace-disclosure"><summary><Icon name="people" :size="17" /><strong>调整负责人</strong><Icon name="chevron" :size="15" /></summary><div class="disclosure-body"><TaskAssignment :key="task.id" :tasks="[task]" /></div></details>
    </section>
    <p v-else class="inline-error" role="alert">此任务不存在或当前身份无权查看，请返回任务列表。</p>
  </template>
</template>
