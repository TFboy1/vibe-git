<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { AgileFlow } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import MarkdownEditor from "../components/MarkdownEditor.vue";
import FlowStatus from "../components/FlowStatus.vue";
import Icon from "../components/Icon.vue";
const store = useWorkspace(), mode = ref("live"), value = ref(""), saving = ref(false), dirty = ref(false);
const route = useRoute();
watch(() => route.query.revision, revision => { if (typeof revision === "string" && store.data?.requirementVersions.some(item => item.revision === Number(revision))) mode.value = "R:" + revision; }, { immediate: true });
let timer: ReturnType<typeof setTimeout> | undefined, seenDraftRevision = -1, seenFlowId = "";
const cacheKey = (id: string) => "vibe-requirement:" + store.data?.room.id + ":" + id;
function cache(markdown: string) {
  if (!seenFlowId) return;
  try { localStorage.setItem(cacheKey(seenFlowId), JSON.stringify({ markdown, draftRevision: seenDraftRevision })); } catch { /* retain unsaved text in memory */ }
}
const current = computed(() => store.flow), liveDraft = computed(() => current.value?.draftMarkdown ?? "");
const canEdit = computed(() => store.canManage && mode.value === "live" && !!liveDraft.value && current.value?.status !== "DECIDING");
const canAllocate = computed(() => canEdit.value && (current.value?.status === "DRAFT" || (current.value?.status === "READY" && dirty.value)));
const allocationReady = computed(() => canEdit.value && current.value?.status === "READY" && !dirty.value);
const displayed = computed(() => mode.value.startsWith("R:") ? store.data?.requirementVersions.find(v => v.revision === Number(mode.value.slice(2)))?.markdown ?? "" :
  mode.value.startsWith("D:") ? current.value?.draftHistory.find(v => v.revision === Number(mode.value.slice(2)))?.markdown ?? "" :
  liveDraft.value ? value.value : store.data?.room.currentRequirementMarkdown ?? "");
watch(() => [current.value?.id, current.value?.draftRevision, current.value?.draftMarkdown] as const, ([id, revision, markdown]) => {
  if (id !== seenFlowId || !dirty.value) {
    value.value = markdown ?? ""; seenDraftRevision = revision ?? -1; seenFlowId = id ?? ""; dirty.value = false;
    if (id && markdown) {
      try {
        const saved = localStorage.getItem(cacheKey(id));
        if (saved) {
          const draft = JSON.parse(saved) as { markdown: string; draftRevision: number };
          if (draft.markdown !== markdown) {
            value.value = draft.markdown; seenDraftRevision = draft.draftRevision; dirty.value = true;
            if (draft.draftRevision !== revision) store.error = "已恢复本机未保存正文。服务端需求已更新，请先导出本机草稿，再核对版本。";
          }
        }
      } catch { /* server version remains available */ }
    }
  }
}, { immediate: true });
function edit(markdown: string) {
  value.value = markdown; dirty.value = value.value !== liveDraft.value; cache(markdown); clearTimeout(timer);
  timer = setTimeout(() => void save(), 1_200);
}
async function save(): Promise<boolean> {
  clearTimeout(timer);
  const flow = current.value;
  if (!dirty.value) return true;
  if (!flow || saving.value || !canEdit.value) return false;
  if (flow.draftRevision !== seenDraftRevision) { store.error = "需求在另一个窗口发生变化。你的正文已保留，请先导出，再核对最新版本。"; return false; }
  saving.value = true; const sent = value.value;
  const saved = await store.mutate<AgileFlow>("/api/v1/agile/flows/" + flow.id + "/draft", { expectedRevision: flow.revision, markdown: sent });
  saving.value = false;
  if (!saved) return false;
  seenDraftRevision = saved.draftRevision; dirty.value = value.value !== sent;
  try { if (!dirty.value) localStorage.removeItem(cacheKey(flow.id)); else cache(value.value); } catch { /* next load still has server history */ }
  if (dirty.value) timer = setTimeout(() => void save(), 1_200);
  return !dirty.value;
}
function restoreServer() {
  if (!current.value) return;
  value.value = current.value.draftMarkdown; dirty.value = false; seenDraftRevision = current.value.draftRevision;
  try { localStorage.removeItem(cacheKey(current.value.id)); } catch { /* no local cache */ }
}
async function allocate() {
  if (!canAllocate.value || store.busy || saving.value || !value.value.trim() || !(await save())) return;
  await store.generateAllocation();
}
onBeforeUnmount(() => { clearTimeout(timer); if (dirty.value && !saving.value) void save(); });
</script>
<template>
  <div class="intro-line"><p>一份所有人遵循的需求。<span>{{ liveDraft ? '队长直接修改正文，确认无误后生成分工。' : '正式版本会与任务包一起发布，并保留完整历史。' }}</span></p></div>
  <FlowStatus v-if="current" :flow="current" />
  <section v-if="!displayed && !liveDraft" class="paper empty-state large"><Icon name="book" :size="35" /><h2>需求文档会在计划对齐后出现。</h2><p>先提交本轮计划，再由队长处理冲突。没有冲突时，AI 会直接生成需求草稿。</p><RouterLink to="/plans" class="btn">前往个人计划 <Icon name="arrow" /></RouterLink></section>
  <section v-else class="paper requirements-paper">
    <header class="document-header"><div><span class="eyebrow">{{ liveDraft && mode === 'live' ? 'WORKING DRAFT / 需求草稿' : 'REQUIREMENT / 正式需求' }}</span><h2>{{ liveDraft && mode === 'live' ? '共同需求 · R' + ((current?.baseRequirementRevision ?? 0) + 1) : '团队需求文档' }}</h2><p>{{ canEdit ? '点击正文即可编辑，改动自动保存。' : mode === 'live' && liveDraft ? '队长正在编辑，这份草稿发布后才成为正式需求。' : '此版本只读，可以通过需求变更 Issue 提出修订。' }}</p></div><label class="version-picker"><span class="sr-only">选择文档版本</span><select v-model="mode" class="input"><option value="live">{{ liveDraft ? '当前需求草稿' : '当前正式版本 R' + store.data?.room.requirementRevision }}</option><optgroup label="正式版本"><option v-for="version in [...(store.data?.requirementVersions ?? [])].reverse()" :key="version.revision" :value="'R:' + version.revision">R{{ version.revision }} · {{ new Date(version.createdAt).toLocaleDateString('zh-CN') }}</option></optgroup><optgroup v-if="current?.draftHistory.length" label="草稿历史"><option v-for="version in [...(current?.draftHistory ?? [])].reverse()" :key="version.revision" :value="'D:' + version.revision">草稿 v{{ version.revision }} · {{ new Date(version.createdAt).toLocaleTimeString('zh-CN') }}</option></optgroup></select></label></header>
    <div v-if="canEdit" class="save-status"><span :class="{ unsaved: dirty }"><i class="presence" :class="{ online: !dirty }"></i>{{ saving ? '保存中…' : dirty ? '有待保存的修改' : '已保存 · 草稿 v' + current?.draftRevision }}</span><button v-if="dirty" class="text-button" :disabled="saving" @click="save">立即保存</button><button v-if="dirty && seenDraftRevision !== current?.draftRevision" class="text-button" @click="restoreServer">舍弃本机草稿，恢复服务器版本</button><small>修改需求后，已有分工草稿需要重新生成。</small></div>
    <MarkdownEditor :model-value="displayed" :readonly="!canEdit" :filename="'requirements-' + (mode === 'live' ? 'current' : mode.replace(':', '-')) + '.md'" @update:model-value="edit" @error="store.error = $event" />
    <footer v-if="canEdit" class="paper-footer"><span class="muted small-text">{{ allocationReady ? '分工草稿已就绪，请到任务看板审核并派发。' : '确认正文后生成分工，最后由队长统一派发任务。' }}</span><RouterLink v-if="allocationReady" to="/projects" class="btn primary">审核分工 <Icon name="arrow" /></RouterLink><button v-else-if="canAllocate" class="btn primary" :disabled="store.busy || saving || !value.trim()" @click="allocate">生成分工 <Icon name="arrow" /></button></footer>
  </section>
</template>
