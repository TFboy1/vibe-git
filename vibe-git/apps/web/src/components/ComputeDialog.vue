<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import type { LocalCodexStatus, LocalComputeStatus } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import { request } from "../api";
import Icon from "./Icon.vue";
const emit = defineEmits<{ close: [] }>(), store = useWorkspace();
const panel = ref<HTMLElement>(), provider = ref<"codex" | "api">(store.provider);
const baseUrl = ref("https://api.openai.com/v1"), model = ref(""), apiKey = ref(""), configured = ref(false);
const error = ref(""), message = ref(""), loading = ref(false), clearKey = ref(false);
const previousFocus = document.activeElement as HTMLElement | null;
const codexLabels = { available: "本机 Codex 已连接", connecting: "等待设备授权", login_required: "本机 Codex 需要登录", unavailable: "本机 Codex 未就绪" };
const apiStatus = computed(() => !store.compute?.ready ? "配置待补全" : store.compute.connection?.status === "passed" ? "连接测试通过" : store.compute.connection?.status === "failed" ? "连接测试失败" : "已配置，尚未测试连接");
onMounted(async () => {
  panel.value?.focus();
  await refreshStatus();
  if (store.compute) { provider.value = store.compute.provider; baseUrl.value = store.compute.baseUrl; model.value = store.compute.model; configured.value = store.compute.configured; }
});
onBeforeUnmount(() => previousFocus?.focus());
async function refreshStatus() {
  loading.value = true;
  try { await Promise.all([store.refresh(), store.refreshCompute(true)]); error.value = store.computeError; }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { loading.value = false; }
}
async function connectCodex() {
  loading.value = true; error.value = ""; message.value = "";
  try { store.codex = await request<LocalCodexStatus>("/api/local/codex/connect", {}); message.value = "已启动 Codex 设备授权。完成授权后点击刷新状态。"; }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { loading.value = false; }
}
function keys(event: KeyboardEvent) {
  if (event.key === "Escape" && !loading.value) emit("close");
  if (event.key !== "Tab") return;
  const elements = [...(panel.value?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, a[href]') ?? [])].filter(e => e.offsetParent !== null);
  const first = elements[0], last = elements.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
async function save(test = false) {
  loading.value = true; error.value = ""; message.value = "";
  try {
    const status = await request<LocalComputeStatus>("/api/local/compute", { provider: provider.value,
      ...(provider.value === "api" ? { baseUrl: baseUrl.value, model: model.value, ...(apiKey.value ? { apiKey: apiKey.value } : {}), clear: clearKey.value } : {}) });
    store.compute = status;
    apiKey.value = ""; configured.value = status.configured; clearKey.value = false;
    await store.refresh();
    if (test) { await request("/api/local/compute/test", {}); message.value = "Responses 连接和结构化输出测试通过。"; }
    else message.value = store.batchReviewEnabled ? "算力设置已保存，批量分析、冲突追问、需求生成与任务修订将使用这项配置。" : "本机算力设置已保存，API 可在此测试连接。";
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { await store.refreshCompute(); loading.value = false; }
}
</script>
<template>
  <div class="modal-backdrop" @click.self="!loading && emit('close')">
    <section ref="panel" class="modal compute-modal" role="dialog" aria-modal="true" aria-labelledby="compute-title" tabindex="-1" @keydown="keys">
      <header class="section-head"><span class="eyebrow">COMPUTE / 协作算力</span><button class="icon-btn" aria-label="关闭算力设置" :disabled="loading" @click="emit('close')"><Icon name="close" /></button></header>
      <h2 id="compute-title">协作算力与连接状态</h2><p class="muted">{{ store.batchReviewEnabled ? '批量变更分析、冲突追问、需求文档与任务分工共用这一配置。' : 'API 配置与连接测试保存在本机。' }}</p>
      <div class="provider-switch"><label :class="{ active: provider === 'codex' }"><input v-model="provider" type="radio" value="codex" name="provider" /> Codex 节点池</label><label :class="{ active: provider === 'api' }"><input v-model="provider" type="radio" value="api" name="provider" /> 自定义 API</label></div>
      <div v-if="provider === 'codex'" class="codex-pool"><div class="compute-state"><span class="presence" :class="{ online: store.codex?.status === 'available' }"></span><strong>{{ store.codex ? codexLabels[store.codex.status] : '正在读取本机状态…' }}</strong><button class="text-button" :disabled="loading" @click="refreshStatus">刷新状态</button></div><p v-if="store.codex?.reason" class="field-help">{{ store.codex.reason }}</p><div v-if="store.codex?.status === 'connecting'" class="device-auth"><p>在授权页面完成登录，再刷新状态。</p><a v-if="store.codex.verificationUrl" :href="store.codex.verificationUrl" target="_blank" rel="noopener noreferrer" class="text-button">打开 Codex 授权页面</a><code v-if="store.codex.userCode">{{ store.codex.userCode }}</code><p v-else class="field-help">授权地址和验证码生成中，稍后点击刷新状态即可查看。</p></div><button v-else-if="store.codex?.status !== 'available'" class="btn small" :disabled="loading" @click="connectCodex">连接本机 Codex <Icon name="arrow" :size="13" /></button><p>节点池：{{ store.data?.auditPool.available ?? 0 }} 个可用 · {{ store.data?.auditPool.busy ?? 0 }} 个忙碌。使用在线节点，按当前负载分配分析。</p><div v-for="node in store.data?.nodes" :key="node.id" class="pool-row"><span class="presence" :class="{ online: node.connected && node.codex === 'available' }"></span><strong>{{ node.label }}</strong><span class="muted">{{ !node.connected ? '离线' : node.codex === 'available' ? '已连接' : node.codex === 'unverified' ? '需要登录' : '未就绪' }}</span><small>{{ node.activeJobCount }} 个作业</small></div><p class="footnote">也可以在终端运行 <code>vibe-git codex bind</code> 完成登录。</p></div>
      <div v-else class="api-fields">
        <div class="compute-state"><span class="presence" :class="{ online: store.compute?.ready && store.compute.connection?.status === 'passed' }"></span><strong>已保存的 API · {{ apiStatus }}</strong><button class="text-button" :disabled="loading" @click="refreshStatus">刷新状态</button></div><p v-if="store.compute?.connection" class="field-help">最近测试：{{ new Date(store.compute.connection.checkedAt).toLocaleString('zh-CN') }}{{ store.compute.connection.error ? ' · ' + store.compute.connection.error : '' }}</p>
        <label class="field">Base URL<input v-model="baseUrl" class="input" type="url" placeholder="https://api.openai.com/v1" spellcheck="false" /></label><p class="field-help">填写 API 基础地址。程序只追加 /responses，不会自动补 /v1。</p>
        <label class="field">模型名<input v-model="model" class="input" placeholder="服务支持的模型名称" spellcheck="false" /></label>
        <label class="field">API Key<input v-model="apiKey" class="input" type="password" autocomplete="new-password" :placeholder="configured ? '已保存，留空保留现有 Key' : '只保存在队长这台电脑'" /></label>
        <label v-if="configured" class="inline-check"><input v-model="clearKey" type="checkbox" /> 清除本机保存的 Key</label><p class="footnote">使用原生 Responses 协议与 JSON Schema 结构化输出。Key 会留在队长本机，成员看不到。</p>
      </div>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p><p v-if="message" class="inline-success" role="status">{{ message }}</p>
      <footer class="modal-footer"><button v-if="provider === 'api'" class="btn" :disabled="loading || clearKey" @click="save(true)">{{ loading ? '请稍候…' : '保存并测试连接' }}</button><button class="btn primary" :disabled="loading" @click="save(false)">{{ loading ? '请稍候…' : '保存设置' }} <Icon name="check" /></button></footer>
    </section>
  </div>
</template>
