<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AgileFlow, AgileTaskDraft } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import Icon from "./Icon.vue";
import TaskChangeComparison from "./TaskChangeComparison.vue";
const props = defineProps<{ flow: AgileFlow }>(), store = useWorkspace();
const tasks = ref<AgileTaskDraft[]>([]), removed = ref<string[]>([]), dirty = ref(false), expanded = ref("");
const selectedKeys = ref<string[]>([]), assignee = ref("");
const availableMembers = computed(() => store.data?.nodes.filter(node => !node.revoked) ?? []);
const changedIds = computed(() => new Set([...props.flow.affectedTaskIds, ...tasks.value.map(task => task.sourceTaskId).filter(Boolean), ...removed.value]));
const preserved = computed(() => props.flow.taskSnapshot.filter(task => !changedIds.value.has(task.id)));
const original = (task: AgileTaskDraft) => props.flow.taskSnapshot.find(before => before.id === task.sourceTaskId);
const dependencies = computed(() => [...tasks.value.map(task => ({ id: task.key, title: task.title })), ...preserved.value.map(task => ({ id: task.id, title: task.title }))]);
watch(() => [props.flow.id, props.flow.allocationDraftRevision, JSON.stringify(props.flow.tasks)] as const, () => {
    if (!dirty.value) { tasks.value = JSON.parse(JSON.stringify(props.flow.tasks)); removed.value = [...props.flow.removedTaskIds];
      if (!tasks.value.some(task => task.key === expanded.value)) expanded.value = tasks.value.find(task => task.sourceTaskId)?.key ?? tasks.value[0]?.key ?? ""; }
}, { immediate: true });
watch(tasks, values => { selectedKeys.value = selectedKeys.value.filter(key => values.some(task => task.key === key)); }, { deep: true });
function assignSelected() {
  if (!selectedKeys.value.length || !availableMembers.value.some(node => node.id === assignee.value)) return;
  tasks.value.forEach(task => { if (selectedKeys.value.includes(task.key)) task.assigneeNodeId = assignee.value; });
  dirty.value = true; store.notice = "负责人已调整，保存分工后统一派发";
}
function add() {
  const key = "task-" + crypto.randomUUID();
  tasks.value.push({ key, sourceTaskId: null, title: "", goal: "", boundary: "", acceptance: [""],
    assigneeNodeId: store.data?.viewer.id ?? "", dependencies: [], ownedPaths: [], excludedPaths: [], requirementRefs: [] });
  expanded.value = key; dirty.value = true;
}
function remove(task: AgileTaskDraft) {
  if (task.sourceTaskId && !removed.value.includes(task.sourceTaskId)) removed.value.push(task.sourceTaskId);
  tasks.value = tasks.value.filter(item => item.key !== task.key);
  selectedKeys.value = selectedKeys.value.filter(key => key !== task.key);
  tasks.value.forEach(item => { item.dependencies = item.dependencies.filter(key => key !== task.key); }); dirty.value = true;
}
function lines(task: AgileTaskDraft, field: "acceptance" | "ownedPaths" | "excludedPaths" | "requirementRefs", event: Event) {
  task[field] = (event.target as HTMLTextAreaElement).value.split(/\r?\n/).map(value => value.trim()).filter(Boolean); dirty.value = true;
}
async function save(): Promise<AgileFlow | null> {
  if (!dirty.value) return props.flow;
  const saved = await store.mutate<AgileFlow>("/api/v1/agile/flows/" + props.flow.id + "/allocation", {
    expectedRevision: props.flow.revision, draftRevision: props.flow.draftRevision, tasks: tasks.value, removedTaskIds: removed.value
  }, "分工调整已保存");
  if (saved) { dirty.value = false; tasks.value = JSON.parse(JSON.stringify(saved.tasks)); removed.value = [...saved.removedTaskIds]; }
  return saved;
}
async function publish() {
  if (!store.checkRequirementDraft(props.flow)) return;
  const saved = await save(); if (!saved) return;
  await store.mutate("/api/v1/agile/flows/" + saved.id + "/publish", { expectedRevision: saved.revision }, "正式需求与任务包已向全员派发");
}
</script>
<template>
  <section class="paper allocation-paper">
    <header class="section-head"><div><span class="eyebrow">ALLOCATION PREVIEW / 分工预览</span><h2>把共同目标交给具体的人。</h2><p class="muted">基于需求草稿 v{{ flow.draftRevision }}。调整目标、负责人、边界和验收后，统一派发。</p></div><span class="tag mint">{{ tasks.length + preserved.filter(t => t.status !== 'DONE').length }} 项工作</span></header>
    <div class="allocation-bulk-bar"><label class="inline-check"><input type="checkbox" :checked="!!tasks.length && selectedKeys.length === tasks.length" :indeterminate="!!selectedKeys.length && selectedKeys.length < tasks.length" @change="selectedKeys = ($event.target as HTMLInputElement).checked ? tasks.map(task => task.key) : []" />选择任务 <span class="count">{{ selectedKeys.length }}</span></label><label class="sr-only" for="allocation-assignee">批量分配负责人</label><select id="allocation-assignee" v-model="assignee" class="input"><option value="">选择负责人</option><option v-for="node in availableMembers" :key="node.id" :value="node.id">{{ node.label }} · {{ node.id.slice(-4) }}</option></select><button class="btn small" :disabled="!selectedKeys.length || !assignee || store.busy" @click="assignSelected">分配选中任务</button><span class="muted small-text">草稿确认后统一派发。</span></div>
    <article v-for="(task, index) in tasks" :key="task.key" class="allocation-row">
      <label class="allocation-select"><input v-model="selectedKeys" type="checkbox" :value="task.key" :disabled="store.busy" /><span class="sr-only">选择任务 {{ task.title }}</span></label>
      <button class="allocation-summary" :aria-expanded="expanded === task.key" @click="expanded = expanded === task.key ? '' : task.key"><span class="task-index">{{ String(index + 1).padStart(2, '0') }}</span><span><strong>{{ task.title || '填写任务标题' }}</strong><small>{{ task.sourceTaskId ? flow.taskSnapshot.find(t => t.id === task.sourceTaskId)?.status === 'DONE' ? '关联返工 · 原完成记录保留' : '修订现有任务' : '新任务' }} · {{ store.name(task.assigneeNodeId) }}</small></span><span class="acceptance-count">{{ task.acceptance.length }} 项验收</span><Icon name="chevron" :class="{ rotate: expanded === task.key }" /></button>
      <div v-if="expanded === task.key" class="allocation-fields" @input="dirty = true" @change="dirty = true">
        <div class="form-grid"><label class="field">任务标题<input v-model="task.title" class="input" maxlength="160" /></label><label class="field">负责人<select v-model="task.assigneeNodeId" class="input"><option v-for="node in availableMembers" :key="node.id" :value="node.id">{{ node.label }} · {{ node.id.slice(-4) }}</option></select></label></div>
        <label class="field">具体目标<textarea v-model="task.goal" class="input" rows="3"></textarea></label><label class="field">职责边界<textarea v-model="task.boundary" class="input" rows="2"></textarea></label>
        <label class="field">验收要求 <small>每行一项</small><textarea :value="task.acceptance.join('\n')" class="input" rows="3" @input="lines(task, 'acceptance', $event)"></textarea></label>
        <div class="form-grid"><label class="field">负责路径 <small>已知的相对路径，可留空</small><textarea :value="task.ownedPaths.join('\n')" class="input mono" rows="2" @input="lines(task, 'ownedPaths', $event)"></textarea></label><label class="field">排除路径<textarea :value="task.excludedPaths.join('\n')" class="input mono" rows="2" @input="lines(task, 'excludedPaths', $event)"></textarea></label></div>
        <fieldset class="dependency-options"><legend>前置依赖</legend><label v-for="dependency in dependencies.filter(d => d.id !== task.key)" :key="dependency.id" class="inline-check"><input v-model="task.dependencies" type="checkbox" :value="dependency.id" />{{ dependency.title }}</label><span v-if="dependencies.length <= 1" class="muted small-text">暂无其他任务。</span></fieldset>
        <label class="field">需求引用 <small>每行一个章节标题或原文片段</small><textarea :value="task.requirementRefs.join('\n')" class="input" rows="2" @input="lines(task, 'requirementRefs', $event)"></textarea></label>
        <TaskChangeComparison v-if="original(task)" :before="original(task)!" :after="task" :before-revision="original(task)!.packageRevision ?? original(task)!.revision" unchanged-reason="目标、边界和验收尚未改变。若本次只调整了负责人、标题、依赖或路径，请核对上方字段；所有字段都相同时不能作为修订发布。" />
        <button class="text-button danger" @click="remove(task)">{{ task.sourceTaskId ? '撤销这项任务' : '移除这项新任务' }}</button>
      </div>
    </article>
    <button class="text-button add-task" @click="add"><Icon name="plus" :size="16" /> 添加任务</button>
    <div v-if="preserved.length" class="preserved-tasks"><span class="eyebrow">KEEPING THE MOMENTUM / 保留原有工作</span><div v-for="task in preserved" :key="task.id"><Icon name="check" :size="14" /><strong>{{ task.title }}</strong><span>{{ store.name(task.assigneeNodeId) }}</span><small>{{ task.status === 'DONE' ? '完成记录保留' : '负责人和当前进度保留' }}</small></div></div>
    <div v-if="removed.length" class="removed-tasks"><strong>本轮将归档</strong><span v-for="id in removed" :key="id">{{ flow.taskSnapshot.find(t => t.id === id)?.title }}</span></div>
    <footer class="paper-footer allocation-footer"><div><strong>准备好就一起开工。</strong><p>需求 R{{ flow.baseRequirementRevision + 1 }} 与整批任务包同时发布。成员无需领取或确认。</p></div><div class="button-row"><button class="btn" :disabled="store.busy || !dirty" @click="save">保存调整</button><button class="btn primary" :disabled="store.busy" @click="publish">派发任务包 <Icon name="arrow" /></button></div></footer>
  </section>
</template>
