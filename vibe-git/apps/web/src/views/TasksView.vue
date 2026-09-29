<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { StageTask, TaskExecutionPackage } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import { request } from "../api";
import TaskAllocation from "../components/TaskAllocation.vue";
import MarkdownEditor from "../components/MarkdownEditor.vue";
import FlowStatus from "../components/FlowStatus.vue";
import Icon from "../components/Icon.vue";
const store = useWorkspace(), filter = ref("active"), selected = ref(""), pack = ref<TaskExecutionPackage | null>(null), loading = ref(false), detailError = ref("");
const route = useRoute();
const statusNames: Record<string, string> = { PUBLISHED: "待开发", IN_PROGRESS: "进行中", BLOCKED: "遇到阻塞", PAUSED: "审核中暂停", DONE: "已完成", FAILED: "执行失败" };
const all = computed(() => [...(store.data?.tasks ?? []), ...(store.data?.agile?.archivedTasks ?? [])].filter(task => store.captain || task.assigneeNodeId === store.data?.viewer.id));
const filtered = computed(() => all.value.filter(task => filter.value === "archive" ? task.archived : !task.archived && (filter.value === "done" ? task.status === "DONE" : filter.value === "all" || task.status !== "DONE")));
const task = computed(() => all.value.find(task => task.id === selected.value));
const content = computed(() => task.value?.archived ? ["# " + task.value.title, "此任务在需求修订后归档。原记录保留。", "## 原目标", task.value.goal, "## 原边界", task.value.boundary,
  "## 验收", task.value.acceptance.map(v => "- " + v).join("\n"), "## 进度与证据", task.value.progressSummary ?? "", ...(task.value.reportEvidence ?? []).map(r => r.summary + "\n" + r.evidence.join("\n"))].join("\n\n") : pack.value?.markdown ?? "");
watch(filtered, tasks => { if (!tasks.some(task => task.id === selected.value)) selected.value = tasks[0]?.id ?? ""; }, { immediate: true });
watch(() => route.query.task, id => {
  const target = typeof id === "string" ? all.value.find(item => item.id === id) : undefined;
  if (target) { filter.value = target.archived ? "archive" : target.status === "DONE" ? "done" : "active"; selected.value = target.id; }
}, { immediate: true });
let generation = 0;
watch(() => [selected.value, task.value?.packageRevision, task.value?.revision, task.value?.status, task.value?.progressSummary] as const, async ([id]) => {
  const version = ++generation; pack.value = null; detailError.value = "";
  if (!id || task.value?.archived) { loading.value = false; return; }
  loading.value = true;
  try { const result = await request<TaskExecutionPackage>("/api/v1/tasks/" + encodeURIComponent(id) + "/package"); if (version === generation) pack.value = result; }
  catch (e) { if (version === generation) detailError.value = e instanceof Error ? e.message : String(e); }
  finally { if (version === generation) loading.value = false; }
}, { immediate: true });
</script>
<template>
  <div class="intro-line"><p>{{ store.captain ? '让每个人拿到清楚、可执行的工作。' : '你的目标、边界和验收都在这里。' }}<span>{{ store.captain ? '先审核分工，再统一派发。' : '通过 Vibe-Git Skill 向开发 AI 传达开工和进度即可。' }}</span></p><span v-if="store.data?.room.requirementRevision" class="tag mint">当前需求 R{{ store.data.room.requirementRevision }}</span></div>
  <FlowStatus v-if="store.flow" :flow="store.flow" />
  <TaskAllocation v-if="store.canManage && store.flow?.status === 'READY'" :flow="store.flow" />
  <section v-else-if="!all.length" class="paper empty-state large"><span class="empty-number">03</span><h2>{{ store.flow?.draftMarkdown ? '确认需求后，再开始分工。' : '任务包将在队长派发后到达。' }}</h2><p>{{ store.captain ? '先审核完整的需求 MD。AI 生成分工后，可以调整负责人和任务内容，再统一派发。' : '你不需要领取或确认。派发后，任务包会自动出现在这里。' }}</p><RouterLink v-if="store.captain" to="/requirements" class="btn">查看需求文档 <Icon name="arrow" /></RouterLink></section>
  <div v-if="all.length" class="task-workspace" :class="{ 'after-allocation': store.flow?.status === 'READY' && store.canManage }">
    <aside class="task-list-panel paper"><header class="section-head"><span class="eyebrow">{{ store.captain ? 'TEAM TASKS' : 'MY TASKS' }}</span><span class="count">{{ all.filter(t => !t.archived).length }}</span></header><h2>{{ store.captain ? '团队任务' : '我的任务' }}</h2><div class="task-filter" aria-label="任务筛选"><button v-for="item in [{ value: 'active', text: '进行中' }, { value: 'done', text: '完成' }, { value: 'archive', text: '归档' }]" :key="item.value" :class="{ active: filter === item.value }" @click="filter = item.value">{{ item.text }}</button></div>
      <div v-if="!filtered.length" class="empty-state small">这个分类还没有任务。</div><button v-for="item in filtered" :key="item.id" class="task-list-row" :class="{ selected: selected === item.id }" @click="selected = item.id"><span class="task-state-dot" :class="item.status.toLowerCase()"></span><span><strong>{{ item.title }}</strong><small>{{ store.name(item.assigneeNodeId) }} · {{ item.archived ? '已归档' : statusNames[item.status] ?? item.status }}</small></span><Icon name="chevron" :size="15" /></button>
      <p class="task-list-note">{{ store.agileEnabled ? '无需在网页开工。让 AI 调用 Skill 同步任务包。' : '历史任务保留原有状态和执行流程，调用 Skill 核对最新版任务包。' }}</p>
    </aside>
    <section class="paper task-document">
      <header v-if="task" class="document-header"><div><span class="eyebrow">EXECUTION PACKAGE / 任务包</span><h2>{{ task.title }}</h2><p>{{ store.name(task.assigneeNodeId) }} · 任务包 v{{ pack?.taskRevision ?? task.packageRevision ?? task.revision }} · 需求 R{{ pack?.requirementRevision ?? task.requirementRevision ?? store.data?.room.requirementRevision }}</p></div><span class="tag" :class="{ amber: task.status === 'PAUSED', mint: task.status === 'DONE' }">{{ task.archived ? '已归档' : statusNames[task.status] ?? task.status }}</span></header>
      <div v-if="task?.status === 'PAUSED'" class="pause-notice"><Icon name="pause" /><div><strong>需求审核中，这项任务暂时暂停。</strong><p>开发 AI 在下一次 Skill 同步时读取暂停消息。修订任务包派发后，再按新版继续。</p></div></div>
      <div v-if="task?.reworkOfTaskId" class="linked-work"><Icon name="link" :size="15" />这是已完成任务的后续修订，原完成记录保留。</div>
      <div v-if="loading" class="empty-state"><span class="working-dot"></span> 正在读取任务包…</div><p v-else-if="detailError" class="inline-error">{{ detailError }}</p>
      <MarkdownEditor v-else-if="task" :key="task.id" :model-value="content" readonly :filename="'task-' + task.id + '.md'" @error="store.error = $event" /><div v-else class="empty-state">从左侧选择一项任务。</div>
    </section>
  </div>
</template>
