<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { AlignmentRun, CoordinationChange, VibePullRequest } from "@vibe-git/protocol";
import { request } from "../api";
import { useWorkspace } from "../store";
import { taskStatus } from "../team";
import Icon from "../components/Icon.vue";
import ActionMenu from "../components/ActionMenu.vue";
import FlowStatus from "../components/FlowStatus.vue";
import TaskAllocation from "../components/TaskAllocation.vue";
import TasksView from "./TasksView.vue";
const store = useWorkspace(), route = useRoute(), router = useRouter();
const query = computed(() => typeof route.query.q === "string" ? route.query.q : "");
const owner = ref(""), selected = ref<string[]>([]), assignee = ref("");
const view = computed(() => route.query.view === "packages" || route.query.task ? "packages" : "board");
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
  { key: "todo", title: "Todo", label: "待开始", statuses: ["DRAFT", "PUBLISHED", "REFINING", "READY", "STARTING", "PREPARING_MOCK"] },
  { key: "doing", title: "In progress", label: "进行中", statuses: ["IN_PROGRESS", "WAITING_INTEGRATION", "WAITING_CONFIRMATION"] },
  { key: "blocked", title: "Blocked", label: "暂停与阻塞", statuses: ["PAUSED", "BLOCKED", "FAILED"] },
  { key: "done", title: "Done", label: "已完成", statuses: ["DONE"] }
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
async function requestReassignment() {
  const picked = tasks.value.filter(task => selected.value.includes(task.id) && task.status !== "DONE");
  const target = members.value.find(node => node.id === assignee.value), revision = store.data?.room.requirementRevision;
  if (!store.canManage || !picked.length || !target || !revision) return;
  const content = ["# 调整任务负责人", "将以下任务分配给 " + target.label + "（节点 " + target.id + "）。", "## 调整范围",
    ...picked.map(task => ["### " + task.title, "任务 ID：" + task.id, "任务包 v" + (task.packageRevision ?? task.revision),
      "原负责人：" + store.name(task.assigneeNodeId) + "（" + task.assigneeNodeId + "）", "新负责人：" + target.label + "（" + target.id + "）",
      "原目标：" + task.goal, "保留目标、边界、验收和已记录进度；只调整负责人。"].join("\n\n")),
    "## 验收", "- 在统一审核和新版任务包发布后完成改派。", "- 保留任务历史；已完成任务不改派。"].join("\n\n");
  const issue = await store.mutate<VibePullRequest | CoordinationChange>(store.agileEnabled ? "/api/v1/agile/pull-requests" : "/api/v1/changes",
    { title: "改派 " + picked.length + " 项任务给 " + target.label, content, expectedRequirementRevision: revision }, "改派 Issue 已提交，请统一审核后发布新版分工");
  if (issue) { selected.value = []; await router.push({ path: "/issues", query: { change: issue.id } }); }
}
function setView(value: string) {
  const query = { ...route.query }; delete query.task;
  if (value === "packages") query.view = value; else delete query.view;
  void router.push({ path: "/projects", query, hash: route.hash });
}
</script>
<template>
  <div class="view-title-line"><div><h1>Projects</h1><p>{{ store.captain ? '选择工作、安排负责人，让团队按同一份需求推进。' : '查看自己的任务与团队当前阶段。' }}</p></div><ActionMenu aria-label="更多任务操作"><RouterLink :to="{ path: '/agents', query: { prompt: 'allocate', tasks: selected.join(','), assignee } }" role="menuitem"><Icon name="agent" :size="16" />Codex 分工建议</RouterLink></ActionMenu></div>
  <div class="project-view-tabs"><button :class="{ active: view === 'board' }" @click="setView('board')"><Icon name="project" :size="16" />任务看板</button><button :class="{ active: view === 'packages' }" @click="setView('packages')"><Icon name="document" :size="16" />任务包</button><span class="project-requirement"><Icon name="book" :size="16" />需求 R{{ store.data?.room.requirementRevision ?? 0 }}</span></div>
  <TasksView v-if="view === 'packages'" />
  <template v-else>
    <FlowStatus v-if="store.flow" :flow="store.flow" />
    <TaskAllocation v-if="store.canManage && store.flow?.status === 'READY'" :key="store.flow.id" :flow="store.flow" />
    <div v-else-if="store.canManage && store.flow?.status === 'DRAFT'" class="next-action"><div><strong>需求草稿已就绪</strong><p>先审核并保存需求，再生成分工。</p></div><RouterLink to="/requirements" class="btn primary">审核需求 <Icon name="arrow" :size="16" /></RouterLink></div>
    <section v-if="store.canManage && legacyDraft" class="paper legacy-allocation-panel"><header class="list-toolbar"><strong>待发布分工草稿</strong><span class="count">{{ legacyDraft.tasks.length }}</span></header><div class="allocation-bulk-bar"><label class="inline-check"><input type="checkbox" :disabled="store.busy" :checked="!!legacyDraft.tasks.length && legacySelection.length === legacyDraft.tasks.length" :indeterminate="!!legacySelection.length && legacySelection.length < legacyDraft.tasks.length" @change="legacySelection = ($event.target as HTMLInputElement).checked ? legacyDraft.tasks.map(task => task.id) : []" />选择任务 <span class="count">{{ legacySelection.length }}</span></label><template v-if="legacySelection.length"><select v-model="assignee" class="input" aria-label="选择草稿负责人"><option value="">选择负责人</option><option v-for="node in members" :key="node.id" :value="node.id">{{ node.label }} · {{ node.id.slice(-4) }}</option></select><button class="btn small" :disabled="store.busy || !assignee" @click="assignLegacy">分配选中任务</button></template></div><label v-for="task in legacyDraft.tasks" :key="task.id" class="legacy-draft-row"><input v-model="legacySelection" type="checkbox" :value="task.id" :disabled="store.busy" /><strong>{{ task.title }}</strong><span>{{ store.name(task.assigneeNodeId) }}</span></label><footer class="paper-footer"><span class="muted small-text">历史房间保留原有需求确认和发布规则。</span><button class="btn primary" :disabled="store.busy" @click="store.mutate('/api/v1/alignments/' + legacyDraft.id + (legacyDraft.source === 'stage_replan' ? '/activate-replan' : '/publish'), {}, '分工已发布')">发布分工 <Icon name="arrow" :size="15" /></button></footer></section>
    <div class="project-toolbar"><label v-if="store.canManage && selectable.length" class="inline-check"><input type="checkbox" :disabled="store.busy" :checked="selectedVisible === selectable.length" :indeterminate="selectedVisible > 0 && selectedVisible < selectable.length" @change="selectVisible(($event.target as HTMLInputElement).checked)" />选择当前任务</label><select v-model="owner" class="input owner-filter" aria-label="按负责人筛选"><option value="">所有负责人</option><option v-for="node in members" :key="node.id" :value="node.id">{{ node.label }} · {{ node.id.slice(-4) }}</option></select><span class="muted">{{ filtered.length }} 项任务</span></div>
    <div v-if="store.canManage && selected.length" class="project-bulk-bar"><span>已选 {{ selected.length }} 项</span><select v-model="assignee" class="input" aria-label="选择新负责人"><option value="">选择新负责人</option><option v-for="node in members" :key="node.id" :value="node.id">{{ node.label }} · {{ node.id.slice(-4) }}</option></select><button class="btn small" :disabled="store.busy || !assignee" @click="requestReassignment">提交改派 Issue</button><span class="muted small-text">已派发任务经统一审核后更新负责人。</span></div>
    <div class="project-board"><section v-for="column in columns" :key="column.key" class="board-column" :class="column.key"><header><i></i><strong>{{ column.title }}</strong><span class="count">{{ filtered.filter(task => column.statuses.includes(task.status)).length }}</span><small>{{ column.label }}</small></header><article v-for="task in filtered.filter(task => column.statuses.includes(task.status))" :key="task.id" class="board-task" :class="{ selected: selected.includes(task.id) }"><div class="board-task-meta"><span><Icon name="issue" :size="13" />{{ task.id.slice(-6).toUpperCase() }}</span><label v-if="store.canManage && task.status !== 'DONE'"><input v-model="selected" type="checkbox" :value="task.id" :disabled="store.busy" /><span class="sr-only">选择 {{ task.title }}</span></label></div><RouterLink :to="{ path: '/projects', query: { ...route.query, task: task.id, view: 'packages' } }" class="board-task-title">{{ task.title }}</RouterLink><p>{{ task.progressSummary || task.blockedReason || task.goal }}</p><div class="board-task-labels"><span class="tag" :class="{ amber: column.key === 'blocked', mint: task.status === 'DONE' }">{{ taskStatus[task.status] ?? task.status }}</span><span class="tag">v{{ task.packageRevision ?? task.revision }}</span></div><footer><span class="avatar tiny">{{ store.name(task.assigneeNodeId).slice(0, 1).toUpperCase() }}</span><span>{{ store.name(task.assigneeNodeId) }}</span><Icon v-if="task.dependencies.length" name="link" :size="13" :title="task.dependencies.length + ' 个前置任务'" /></footer></article><div v-if="!filtered.some(task => column.statuses.includes(task.status))" class="board-empty">暂无任务</div></section></div>
    <div v-if="!tasks.length && !store.flow && !legacyDraft" class="empty-state"><p>从个人计划开始，确认需求后即可生成和分配任务。</p><RouterLink to="/plans" class="btn">提交个人计划 <Icon name="arrow" :size="15" /></RouterLink></div>
  </template>
</template>
