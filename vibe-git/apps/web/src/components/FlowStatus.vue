<script setup lang="ts">
import type { AgileFlow } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import Icon from "./Icon.vue";
defineProps<{ flow: AgileFlow }>();
const store = useWorkspace();
const phaseNames: Record<string, string> = { AGILE_ANALYZE: "正在分析需求与冲突", AGILE_DIALOGUE: "正在检查回答与必要追问", AGILE_REQUIREMENT: "正在生成完整需求文档", AGILE_ALLOCATE: "正在生成任务分工" };
</script>
<template>
  <div v-if="['ANALYZING', 'PLANNING'].includes(flow.status)" class="flow-status">
    <span class="working-dot"></span><div><strong>{{ phaseNames[flow.phase] }}</strong><p>你可以留在这里，也可以稍后回来。已提交的内容和裁决会保留。</p></div>
    <button v-if="store.canManage" class="btn quiet small" :disabled="store.busy" @click="store.mutate('/api/v1/agile/flows/' + flow.id + '/cancel', { expectedRevision: flow.revision })">取消本轮</button>
  </div>
  <div v-else-if="flow.status === 'FAILED'" class="flow-status failure">
    <Icon name="clock" /><div><strong>本次分析未完成</strong><p>{{ flow.error }}</p><small>已保留你的回答与草稿。</small></div>
    <button v-if="store.canManage" class="btn small" :disabled="store.busy" @click="store.mutate('/api/v1/agile/flows/' + flow.id + '/retry', { expectedRevision: flow.revision })">重试</button>
  </div>
</template>
