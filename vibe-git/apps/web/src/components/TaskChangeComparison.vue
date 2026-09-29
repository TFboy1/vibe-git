<script setup lang="ts">
import { computed } from "vue";
import type { TaskChangeContent } from "@vibe-git/protocol";
const props = defineProps<{ before: TaskChangeContent; after: TaskChangeContent | null; beforeRevision: number; afterRevision?: number; unchangedReason?: string }>();
const goalChanged = computed(() => !!props.after && props.before.goal.trim() !== props.after.goal.trim());
const boundaryChanged = computed(() => !!props.after && props.before.boundary.trim() !== props.after.boundary.trim());
const acceptanceChanged = computed(() => !!props.after && JSON.stringify(props.before.acceptance.map(item => item.trim())) !== JSON.stringify(props.after.acceptance.map(item => item.trim())));
const fieldsChanged = computed(() => Number(goalChanged.value) + Number(boundaryChanged.value) + Number(acceptanceChanged.value));
</script>
<template>
  <details class="task-change-preview" open>
    <summary>任务内容对比 · {{ fieldsChanged ? fieldsChanged + ' 类字段有修订' : '尚无字段修订' }} · v{{ beforeRevision }}<template v-if="fieldsChanged"> → {{ afterRevision ? 'v' + afterRevision : '待发布草稿' }}</template></summary>
    <div class="form-grid">
      <div><span class="eyebrow">修订前 · v{{ beforeRevision }}</span><h4>目标{{ after && !goalChanged ? ' · 未改变' : '' }}</h4><p :class="{ 'diff-removed': goalChanged }">{{ before.goal }}</p><h4>职责边界{{ after && !boundaryChanged ? ' · 未改变' : '' }}</h4><p :class="{ 'diff-removed': boundaryChanged }">{{ before.boundary }}</p><h4>验收{{ after && !acceptanceChanged ? ' · 未改变' : '' }}</h4><ul><li v-for="(item, i) in before.acceptance" :key="i" :class="{ 'diff-removed': after && item.trim() !== after.acceptance[i]?.trim() }">{{ item }}</li></ul></div>
      <div v-if="after && fieldsChanged"><span class="eyebrow">{{ afterRevision ? '修订后 · v' + afterRevision : '待发布草稿' }}</span><h4>目标{{ !goalChanged ? ' · 未改变' : '' }}</h4><p :class="{ 'diff-added': goalChanged }">{{ after.goal }}</p><h4>职责边界{{ !boundaryChanged ? ' · 未改变' : '' }}</h4><p :class="{ 'diff-added': boundaryChanged }">{{ after.boundary }}</p><h4>验收{{ !acceptanceChanged ? ' · 未改变' : '' }}</h4><ul><li v-for="(item, i) in after.acceptance" :key="i" :class="{ 'diff-added': item.trim() !== before.acceptance[i]?.trim() }">{{ item }}</li></ul></div>
      <div v-else class="revision-empty"><span class="eyebrow">{{ afterRevision ? '本次任务字段保持不变' : '尚未生成具体修订' }}</span><p>{{ unchangedReason ?? (afterRevision ? '本次记录没有修改任务的目标、边界或验收。' : '生成 AI 修订草稿，或修改上面的任务字段后，这里会显示真实差异。') }}</p></div>
    </div>
  </details>
</template>
