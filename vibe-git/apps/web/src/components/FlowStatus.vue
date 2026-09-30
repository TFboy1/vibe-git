<script setup lang="ts">
import type { AgileFlow } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import Icon from "./Icon.vue";
import ActionMenu from "./ActionMenu.vue";
withDefaults(defineProps<{ flow: AgileFlow; readonly?: boolean; hideCancel?: boolean }>(), { readonly: false, hideCancel: false });
const store = useWorkspace();
const phaseNames: Record<string, string> = { AGILE_ANALYZE: "正在分析需求与冲突", AGILE_DIALOGUE: "正在检查回答与必要追问", AGILE_REQUIREMENT: "正在生成完整需求文档", AGILE_ALLOCATE: "正在生成任务分工" };
</script>
<template>
  <div v-if="['ANALYZING', 'PLANNING'].includes(flow.status)" class="flow-status">
    <span class="working-dot"></span><div><strong>{{ phaseNames[flow.phase] }}</strong><p>你可以留在这里，也可以稍后回来。已提交的内容和裁决会保留。</p></div>
    <ActionMenu v-if="store.canManage && !readonly && !hideCancel" aria-label="更多流程操作" :disabled="store.busy"><button type="button" role="menuitem" class="danger" :disabled="store.busy" @click="store.mutate('/api/v1/agile/flows/' + flow.id + '/cancel', { expectedRevision: flow.revision })">取消本轮</button></ActionMenu>
  </div>
  <div v-else-if="flow.status === 'FAILED'" class="flow-status failure">
    <Icon name="clock" /><div><strong>本次分析未完成</strong><p>{{ flow.error }}</p><small>已保留你的回答与草稿。</small></div>
    <button v-if="store.canManage && !readonly" class="btn small" :disabled="store.busy" @click="store.mutate('/api/v1/agile/flows/' + flow.id + '/retry', { expectedRevision: flow.revision })">重试</button><RouterLink v-else-if="store.canManage" :to="flow.kind === 'initial' ? '/plans' : '/issues'" class="text-button">查看处理流程 <Icon name="arrow" :size="14" /></RouterLink>
  </div>
</template>
