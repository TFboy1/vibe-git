<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useWorkspace } from "../store";
import Icon from "./Icon.vue";
const store = useWorkspace(), expanded = ref(false), now = ref(Date.now()), dismissed = ref("");
const clock = setInterval(() => { now.value = Date.now(); }, 1000);
onBeforeUnmount(() => clearInterval(clock));
const phaseNames: Record<string, string> = { AGILE_ANALYZE: "需求与冲突分析", AGILE_DIALOGUE: "检查回答", AGILE_REQUIREMENT: "生成需求", AGILE_ALLOCATE: "生成分工" };
const eventNames: Record<string, string> = { "agile.queued": "已加入分析队列，等待执行节点", "job.leased": "执行节点已接到作业", "job.started": "作业已开始", "job.completed": "作业完成", "job.failed": "作业失败", "agile.updated": "本轮状态已更新", "agile.cancelled": "本轮已取消" };
const records = computed(() => store.activities.map(event => {
  const value = event.payload as { message?: string; detail?: string; model?: string; error?: string; phase?: string; kind?: string; executorNodeId?: string; status?: string; execution?: number };
  return { ...event, message: value.message || value.error || eventNames[event.type] || (value.status ? "状态：" + value.status : "流程已更新"), detail: value.detail,
    model: value.model, executor: value.executorNodeId, phase: value.kind || value.phase || "", execution: value.execution };
}));
const latest = computed(() => records.value.at(-1));
const model = computed(() => [...records.value].reverse().find(event => event.model)?.model);
const executor = computed(() => [...records.value].reverse().find(event => event.executor)?.executor);
const active = computed(() => store.activityFlow && ["ANALYZING", "PLANNING"].includes(store.activityFlow.status));
const elapsed = computed(() => {
  const start = Date.parse([...records.value].reverse().find(record => record.type === "agile.queued")?.createdAt ?? store.activityFlow?.createdAt ?? "");
  const seconds = Math.max(0, Math.floor(((active.value ? now.value : Date.parse(store.activityFlow?.updatedAt ?? "")) - start) / 1000));
  return Number.isFinite(seconds) ? Math.floor(seconds / 60) + "分 " + seconds % 60 + "秒" : "";
});
watch(() => store.activityFlow?.id, () => { expanded.value = false; });
</script>
<template>
  <aside v-if="store.activityFlow && dismissed !== store.activityFlow.id" class="analysis-activity" :class="{ expanded }" aria-label="分析活动记录">
    <header><button class="activity-toggle" type="button" :aria-expanded="expanded" aria-controls="activity-history" @click="expanded = !expanded"><span class="activity-indicator" :class="{ running: active }"></span><strong>{{ phaseNames[store.activityFlow.phase] ?? '协作分析' }}</strong><span>{{ elapsed }}</span><Icon name="chevron" :size="14" /></button><button v-if="!active" class="icon-btn" aria-label="收起本轮活动窗口" @click="dismissed = store.activityFlow.id"><Icon name="close" :size="14" /></button></header>
    <p class="latest-activity" role="status">{{ latest?.message ?? '正在读取本轮活动记录…' }}</p>
    <div class="activity-meta"><span>{{ executor ? store.name(executor) : active ? '等待执行节点' : '未记录执行节点' }}</span><span>{{ model ?? (active ? '执行开始后显示模型' : '此轮未记录模型') }}</span></div>
    <small v-if="latest">最近更新 {{ new Date(latest.createdAt).toLocaleTimeString('zh-CN') }}<template v-if="active && now - Date.parse(latest.createdAt) > 15000"> · 等待新的运行事件</template></small>
    <div v-if="expanded" id="activity-history" class="activity-history"><button v-if="store.moreActivities" class="text-button" @click="store.loadActivities(true)">加载更早记录</button><article v-for="(record, index) in records" :key="record.seq"><header><time>{{ new Date(record.createdAt).toLocaleTimeString('zh-CN') }}</time><span v-if="record.phase">{{ phaseNames[record.phase] ?? record.phase }}</span><span v-if="record.entityType === 'agent_job' && records[index - 1]?.entityId !== record.entityId">{{ record.execution ? '第 ' + record.execution + ' 次执行' : '执行记录' }}</span></header><p>{{ record.message }}</p><details v-if="record.detail"><summary>查看详情</summary><pre>{{ record.detail }}</pre></details></article><p v-if="store.activityError" class="inline-error" role="alert">{{ store.activityError }}<button class="text-button" @click="store.loadActivities()">重新读取</button></p></div>
  </aside>
</template>
