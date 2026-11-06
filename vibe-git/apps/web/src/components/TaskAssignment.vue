<script setup lang="ts">
import { computed, ref } from "vue";
import type { StageTask } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import Icon from "./Icon.vue";
const props = defineProps<{ tasks: StageTask[] }>();
const store = useWorkspace(), open = ref(false), target = ref("");
const members = computed(() => store.data?.nodes.filter(node => !node.revoked) ?? []);
const blocker = computed(() => props.tasks.map(store.assignmentBlocker).find(Boolean) ?? "");
async function assign() {
  if (!target.value || blocker.value) return;
  const result = await store.mutate<StageTask[]>("/api/v1/tasks/assign", { taskIds: props.tasks.map(task => task.id), assigneeNodeId: target.value,
    expectedTaskRevisions: Object.fromEntries(props.tasks.map(task => [task.id, task.revision])) }, "负责人已更新，新负责人可以同步任务包接续");
  if (result) { open.value = false; target.value = ""; }
}
</script>
<template>
  <div class="task-assignment">
    <button v-if="!open" type="button" class="btn small" :disabled="store.busy || !!blocker || !tasks.length" :title="blocker" @click="open = true"><Icon name="people" :size="15" />更换负责人<span v-if="tasks.length > 1">（{{ tasks.length }} 项）</span></button>
    <form v-else class="assignment-form" @submit.prevent="assign">
      <label class="field">新负责人<select v-model="target" class="input" :disabled="store.busy"><option value="">选择成员</option><option v-for="node in members" :key="node.id" :value="node.id">{{ node.label }} · {{ node.id.slice(-4) }}</option></select></label>
      <p>{{ tasks.length }} 项任务会立即更换负责人，保留目标、进度和证据；原开发 AI 在下次同步后停止旧任务。</p>
      <div class="button-row"><button class="btn primary small" :disabled="store.busy || !target || !!blocker">确认更换负责人</button><button type="button" class="btn small" :disabled="store.busy" @click="open = false">取消</button></div>
    </form>
    <p v-if="blocker" class="muted small-text">{{ blocker }}</p>
  </div>
</template>
