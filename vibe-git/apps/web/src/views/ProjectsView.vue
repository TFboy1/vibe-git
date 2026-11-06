<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { AlignmentRun } from "@vibe-git/protocol";
import { request } from "../api";
import { useWorkspace } from "../store";
import { taskStatus } from "../team";
import Icon from "../components/Icon.vue";
import ActionMenu from "../components/ActionMenu.vue";
import FlowStatus from "../components/FlowStatus.vue";
import TaskAllocation from "../components/TaskAllocation.vue";
import TasksView from "./TasksView.vue";
import TeamProgress from "../components/TeamProgress.vue";
import TaskAssignment from "../components/TaskAssignment.vue";
const store = useWorkspace(), route = useRoute(), router = useRouter();
const query = computed(() => typeof route.query.q === "string" ? route.query.q : "");
const owner = ref(typeof route.query.owner === "string" ? route.query.owner : ""), selected = ref<string[]>([]), assignee = ref("");
const execution = computed(() => route.meta.section === "execution" || !!route.query.task || !!route.query.owner || !!route.query.q || ["packages", "board", "progress"].includes(String(route.query.view)));
const view = computed(() => route.query.task ? "packages" : ["board", "progress"].includes(String(route.query.view)) ? "board" : "packages");
watch(() => route.query.owner, value => { owner.value = typeof value === "string" ? value : ""; });
const members = computed(() => store.data?.nodes.filter(node => !node.revoked) ?? []);
const tasks = computed(() => (store.data?.tasks ?? []).filter(task => !task.archived && (store.captain || task.assigneeNodeId === store.data?.viewer.id)));
const filtered = computed(() => tasks.value.filter(task => (!owner.value || task.assigneeNodeId === owner.value) &&
  (!query.value.trim() || [task.id, task.title, task.goal, task.progressSummary, store.name(task.assigneeNodeId)].join(" ").toLowerCase().includes(query.value.trim().toLowerCase()))));
const selectable = computed(() => filtered.value.filter(task => task.status !== "DONE"));
const selectedVisible = computed(() => selectable.value.filter(task => selected.value.includes(task.id)).length);
function selectVisible(checked: boolean) {
  const ids = selectable.value.map(task => task.id);
  selected.value = checked ? [...new Set([...selected.value, ...ids])] : selected.value.filter(id => !ids.includes(id));
}
const columns = [
  { key: "todo", title: "待开始", label: "待开始", statuses: ["DRAFT", "PUBLISHED", "REFINING", "READY", "STARTING", "PREPARING_MOCK"] },
  { key: "doing", title: "进行中", label: "进行中", statuses: ["IN_PROGRESS", "WAITING_INTEGRATION", "WAITING_CONFIRMATION"] },
  { key: "blocked", title: "暂停与阻塞", label: "暂停与阻塞", statuses: ["PAUSED", "BLOCKED", "FAILED"] },
  { key: "done", title: "已完成", label: "已完成", statuses: ["DONE"] }
];
const legacyDraft = computed(() => !store.flow ? [...(store.data?.alignments ?? [])].reverse().find(run =>
  run.status === "READY" && !run.publishedStageId && !run.detailJobIds?.length) : undefined);
const legacySelection = ref<string[]>([]);
watch(tasks, values => { selected.value = selected.value.filter(id => values.some(task => task.id === id && task.status !== "DONE")); });
watch(() => legacyDraft.value?.id, () => { legacySelection.value = []; });
async function assignLegacy() {
  const alignment = legacyDraft.value, ids = [...legacySelection.value], target = assignee.value;
  if (!alignment || !ids.length || !members.value.some(node => node.id === target)) return;
  await store.perform(async () => {
    try { for (const taskId of ids) await request<AlignmentRun>("/api/v1/alignments/" + alignment.id + "/assign", { taskId, assigneeNodeId: target }); }
    finally { await store.refresh(); }
  }, "选中草稿的负责人已保存");
}
function setView(value: string) {
  const query = { ...route.query }; delete query.task;
  if (value === "board") query.view = value; else delete query.view;
  void router.push({ path: "/execute", query, hash: route.hash });
}
</script>
<template>
  <div class="view-title-line"><div><h1>{{ execution ? '执行任务' : '确认分工' }}</h1><p>{{ execution ? (store.captain ? '查看团队任务，点开一项了解进度和下一步。' : '找到你的任务，把指令交给当前的开发 AI。') : (store.captain ? '检查任务与负责人，确认后统一发布。' : '查看队长为你安排的工作。') }}</p></div><ActionMenu aria-label="更多任务操作"><RouterLink :to="{ path: '/agents', query: { prompt: 'allocate', tasks: selected.join(','), assignee } }" role="menuitem"><Icon name="agent" :size="16" />AI 分工建议</RouterLink></ActionMenu></div>
  <nav v-if="execution" class="project-view-tabs" aria-label="执行视图"><button :class="{ active: view === 'packages' }" :aria-current="view === 'packages' ? 'page' : undefined" @click="setView('packages')">{{ store.captain ? '团队任务' : '我的任务' }}</button><button :class="{ active: view === 'board' }" :aria-current="view === 'board' ? 'page' : undefined" @click="setView('board')">团队进度</button></nav>
  <TasksView v-if="execution && view === 'packages'" />
  <template v-else-if="!execution">
    <FlowStatus v-if="store.flow" :flow="store.flow" />
    <TaskAllocation v-if="store.canManage && store.flow && (store.flow.status === 'READY' || (store.flow.status === 'FAILED' && store.flow.phase === 'AGILE_ALLOCATE'))" :key="store.flow.id" :flow="store.flow" />
    <div v-else-if="store.canManage && store.flow?.status === 'DRAFT'" class="next-action"><div><strong>需求草稿已就绪</strong><p>先审核并保存需求，再生成分工。</p></div><RouterLink to="/requirements" class="btn primary">审核需求 <Icon name="arrow" :size="16" /></RouterLink></div>
    <section v-if="store.canManage && legacyDraft" class="paper legacy-allocation-panel"><header class="list-toolbar"><strong>待发布分工草稿</strong><span class="count">{{ legacyDraft.tasks.length }}</span></header><div class="allocation-bulk-bar"><label class="inline-check"><input type="checkbox" :disabled="store.busy" :checked="!!legacyDraft.tasks.length && legacySelection.length === legacyDraft.tasks.length" :indeterminate="!!legacySelection.length && legacySelection.length < legacyDraft.tasks.length" @change="legacySelection = ($event.target as HTMLInputElement).checked ? legacyDraft.tasks.map(task => task.id) : []" />选择任务 <span class="count">{{ legacySelection.length }}</span></label><template v-if="legacySelection.length"><select v-model="assignee" class="input" aria-label="选择草稿负责人"><option value="">选择负责人</option><option v-for="node in members" :key="node.id" :value="node.id">{{ node.label }} · {{ node.id.slice(-4) }}</option></select><button class="btn small" :disabled="store.busy || !assignee" @click="assignLegacy">分配选中任务</button></template></div><label v-for="task in legacyDraft.tasks" :key="task.id" class="legacy-draft-row"><input v-model="legacySelection" type="checkbox" :value="task.id" :disabled="store.busy" /><strong>{{ task.title }}</strong><span>{{ store.name(task.assigneeNodeId) }}</span></label><footer class="paper-footer"><span class="muted small-text">历史房间保留原有需求确认和发布规则。</span><button class="btn primary" :disabled="store.busy" @click="store.mutate('/api/v1/alignments/' + legacyDraft.id + (legacyDraft.source === 'stage_replan' ? '/activate-replan' : '/publish'), {}, '分工已发布')">发布分工 <Icon name="arrow" :size="15" /></button></footer></section>
    <section v-if="!legacyDraft && !(store.canManage && store.flow && ['READY', 'FAILED'].includes(store.flow.status))" class="paper allocation-results">
      <header class="list-toolbar"><strong>{{ store.captain ? '已发布的分工' : '分配给我的任务' }}</strong><RouterLink to="/execute" class="text-button">进入执行 <Icon name="arrow" :size="14" /></RouterLink></header>
      <article v-for="task in tasks" :key="task.id"><RouterLink :to="{ path: '/execute', query: { task: task.id } }" class="work-title">{{ task.title }}</RouterLink><span class="muted">{{ store.name(task.assigneeNodeId) }}</span><span class="tag">{{ taskStatus[task.status] ?? task.status }}</span></article>
      <div v-if="!tasks.length" class="empty-state"><p>{{ store.captain ? '确认需求后，AI 会生成任务分工。' : '队长发布后，你的分工会出现在这里。' }}</p><RouterLink v-if="store.captain" to="/requirements" class="text-button">前往需求 <Icon name="arrow" :size="14" /></RouterLink></div>
    </section>
  </template>
  <template v-else>
    <div class="project-toolbar"><label v-if="store.canManage && selectable.length" class="inline-check"><input type="checkbox" :disabled="store.busy" :checked="selectedVisible === selectable.length" :indeterminate="selectedVisible > 0 && selectedVisible < selectable.length" @change="selectVisible(($event.target as HTMLInputElement).checked)" />选择当前任务</label><select v-model="owner" class="input owner-filter" aria-label="按负责人筛选"><option value="">所有负责人</option><option v-for="node in store.data?.nodes ?? []" :key="node.id" :value="node.id">{{ node.label }} · {{ node.id.slice(-4) }}</option></select><span class="muted">{{ filtered.length }} 项任务</span></div>
    <div v-if="store.canManage && selected.length" class="project-bulk-bar"><span>已选 {{ selected.length }} 项</span><TaskAssignment :tasks="tasks.filter(task => selected.includes(task.id))" /></div>
    <div class="project-board"><section v-for="column in columns" :key="column.key" class="board-column" :class="column.key"><header><i></i><strong>{{ column.title }}</strong><span class="count">{{ filtered.filter(task => column.statuses.includes(task.status)).length }}</span></header><article v-for="task in filtered.filter(task => column.statuses.includes(task.status))" :key="task.id" class="board-task" :class="{ selected: selected.includes(task.id) }"><div class="board-task-meta"><span><Icon name="issue" :size="13" />{{ task.id.slice(-6).toUpperCase() }}</span><label v-if="store.canManage && task.status !== 'DONE'"><input v-model="selected" type="checkbox" :value="task.id" :disabled="store.busy" /><span class="sr-only">选择 {{ task.title }}</span></label></div><RouterLink :to="{ path: '/projects', query: { ...route.query, task: task.id, view: 'packages' } }" class="board-task-title">{{ task.title }}</RouterLink><p>{{ task.progressSummary || task.blockedReason || task.goal }}</p><div class="board-task-labels"><span class="tag" :class="{ amber: column.key === 'blocked', mint: task.status === 'DONE' }">{{ taskStatus[task.status] ?? task.status }}</span><span class="tag">v{{ task.packageRevision ?? task.revision }}</span></div><footer><span class="avatar tiny">{{ store.name(task.assigneeNodeId).slice(0, 1).toUpperCase() }}</span><span>{{ store.name(task.assigneeNodeId) }}</span><Icon v-if="task.dependencies.length" name="link" :size="13" :title="task.dependencies.length + ' 个前置任务'" /></footer></article><div v-if="!filtered.some(task => column.statuses.includes(task.status))" class="board-empty">暂无任务</div></section></div>
    <details class="paper workspace-disclosure team-git-details" :open="route.query.view === 'progress'"><summary><Icon name="branch" :size="17" /><strong>Git 状态与协作记录</strong><span>按需查看</span><Icon name="chevron" :size="15" /></summary><div class="disclosure-body"><TeamProgress /></div></details>
  </template>
</template>
