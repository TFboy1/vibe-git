<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { CodexModelSettings } from "@vibe-git/protocol";
import { request } from "../api";
import { useWorkspace } from "../store";
import Icon from "./Icon.vue";
const store = useWorkspace(), settings = ref<CodexModelSettings | null>(null), model = ref("");
const models = ref<Array<{ id: string; name: string }>>([]), loading = ref(false), error = ref("");
async function refresh() {
  loading.value = true; error.value = "";
  try {
    const [current, available] = await Promise.all([request<CodexModelSettings>("/api/local/codex/model"), request<Array<{ id: string; name: string }>>("/api/local/codex/models")]);
    settings.value = current; model.value = current.selectedModel ?? ""; models.value = available.filter(model => model.id !== "default"); error.value = current.error ?? "";
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { loading.value = false; }
}
async function save() {
  loading.value = true; error.value = "";
  try { settings.value = await request<CodexModelSettings>("/api/local/codex/model", { model: model.value || null }, "PUT"); store.notice = "本机默认模型已保存，后续 Codex 作业使用此设置"; }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { loading.value = false; }
}
onMounted(() => { if (store.local) void refresh(); });
</script>
<template>
  <form v-if="store.local" class="codex-model-control" @submit.prevent="save"><header class="section-head"><strong>本机默认模型</strong><button class="text-button" type="button" :disabled="loading" @click="refresh"><Icon name="activity" :size="15" />刷新模型</button></header><p>当前默认：<strong>{{ settings?.effectiveModel ?? '尚未读取' }}</strong><span v-if="settings"> · {{ settings.source === 'vibe-git' ? 'Vibe-Git 本机设置' : '继承 Codex 配置' }}</span></p><label class="field">选择模型<select v-model="model" class="input" :disabled="loading"><option value="">继承 Codex 默认{{ settings?.source === 'codex' && settings.effectiveModel ? '（' + settings.effectiveModel + '）' : '' }}</option><option v-if="model && !models.some(item => item.id === model)" :value="model">{{ model }}（刷新后核对）</option><option v-for="item in models" :key="item.id" :value="item.id">{{ item.name }} · {{ item.id }}</option></select></label><p class="muted small-text">本机所有项目的 Codex 分析、对话和执行共用此默认设置。正在运行的作业继续使用原模型；其他 Codex 工具的配置保持原样。</p><p v-if="error" class="inline-error" role="alert">{{ error }}</p><button class="btn" :disabled="loading">保存默认模型</button></form>
</template>
