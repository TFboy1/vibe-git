<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CollaborationNode, LocalCodexStatus, RateLimitWindow, StageTask } from "@vibe-git/protocol";
import { request } from "../api";
import { useWorkspace } from "../store";
import { useRepository } from "../repository";
import { relativeTime, taskStatus } from "../team";
import Icon from "../components/Icon.vue";
import ComputeDialog from "../components/ComputeDialog.vue";
const store = useWorkspace(), repository = useRepository();
const label = ref(store.data?.viewer.label ?? ""), remote = ref(repository.remote), repoError = ref(""), quotaLoading = ref(false), invitation = ref("");
const removing = ref<CollaborationNode | null>(null), taskSnapshot = ref<StageTask[]>([]), removalError = ref(""), removalPanel = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;
watch(removing, async (node, before) => {
  if (node && !before) { previousFocus = document.activeElement as HTMLElement; await nextTick(); removalPanel.value?.focus(); }
  else if (!node) previousFocus?.focus();
});
function modalKeys(event: KeyboardEvent) {
  if (event.key === "Escape" && !store.busy) { removing.value = null; return; }
  if (event.key !== "Tab") return;
  const elements = [...(removalPanel.value?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]') ?? [])];
  const first = elements[0], last = elements.at(-1);
  if (event.shiftKey && (document.activeElement === first || document.activeElement === removalPanel.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  else if (!elements.length) event.preventDefault();
}
const members = computed(() => store.data?.nodes.filter(node => !node.revoked) ?? []);
const limits = computed(() => store.codex?.rateLimits.length ? store.codex.rateLimits : store.data?.viewer.rateLimits ?? []);
const codexLabels = { available: "本机 Codex 已连接", connecting: "等待设备授权", login_required: "本机 Codex 需要登录", unavailable: "本机 Codex 未就绪" };
function remaining(window: RateLimitWindow) {
  const value = window.remainingPercent ?? (window.usedPercent === null ? null : 100 - window.usedPercent);
  return value === null ? null : Math.max(0, Math.min(100, value));
}
function resetTime(value: number | null) { return value === null ? "重置时间暂不可用" : new Date(value * 1000).toLocaleString("zh-CN"); }
async function refreshQuota() {
  quotaLoading.value = true;
  try {
    store.codex = await request<LocalCodexStatus>("/api/local/codex");
    store.chatAvailable = (await request<{ chat: boolean }>("/api/local/capabilities")).chat;
  }
  catch (e) { store.error = e instanceof Error ? e.message : String(e); }
  finally { quotaLoading.value = false; }
}
async function connectCodex() {
  quotaLoading.value = true;
  try { store.codex = await request<LocalCodexStatus>("/api/local/codex/connect", {}); store.notice = "设备授权已启动，请完成登录后刷新状态"; }
  catch (e) { store.error = e instanceof Error ? e.message : String(e); }
  finally { quotaLoading.value = false; }
}
async function invite() {
  if (!store.canManage || store.busy) return;
  const result = await store.perform(() => request<{ command: string }>("/api/v1/invite"));
  if (!result) return;
  invitation.value = result.command;
  try { await navigator.clipboard.writeText(result.command); store.notice = "邀请命令已复制，请发给你的队友"; }
  catch { store.notice = "已生成邀请命令，可以在下方手动复制"; }
}
function saveRepository() {
  repoError.value = "";
  try { repository.save(remote.value); remote.value = repository.remote; store.notice = "Git 仓库入口已保存"; }
  catch (e) { repoError.value = e instanceof Error ? e.message : String(e); }
}
async function reviewRemoval(node: CollaborationNode) {
  if (!store.canManage || node.role === "captain") return;
  removalError.value = "";
  const updated = await store.perform(async () => { await store.refresh(); return store.data?.nodes.find(item => item.id === node.id); });
  if (updated === null) { removalError.value = store.error; return; }
  if (!updated || updated.revoked) { removing.value = null; store.notice = "该成员已不在当前团队，成员列表已刷新"; return; }
  taskSnapshot.value = (store.data?.tasks ?? []).filter(task => task.assigneeNodeId === node.id && task.status !== "DONE").map(task => JSON.parse(JSON.stringify(task)) as StageTask);
  removing.value = { ...updated };
}
async function removeMember() {
  const node = removing.value; if (!node || !store.canManage) return;
  const result = await store.mutate<CollaborationNode>("/api/v1/nodes/" + node.id + "/revoke",
    { expectedActiveTaskRevisions: Object.fromEntries(taskSnapshot.value.map(task => [task.id, task.revision])) }, "成员已移除，未完成任务暂停并保留原记录");
  if (result) removing.value = null;
  else removalError.value = store.error;
}
async function rename() { await store.mutate("/api/v1/agile/profile", { label: label.value }, "显示名字已更新", "PUT"); }
onMounted(() => { if (store.local && !store.canManage) void refreshQuota(); });
onBeforeUnmount(() => { if (removing.value) previousFocus?.focus(); });
</script>
<template>
  <div class="settings-layout">
    <nav class="settings-nav" aria-label="设置分类"><h2>Settings</h2><a href="#compute"><Icon name="agent" :size="17" />算力与 API</a><a href="#usage"><Icon name="activity" :size="17" />Codex 连接与额度</a><a href="#team"><Icon name="people" :size="17" />团队成员</a><a href="#repository"><Icon name="branch" :size="17" />Git 仓库</a><a href="#profile"><Icon name="settings" :size="17" />个人资料</a><div class="settings-role"><Icon name="shield" :size="16" /><span>{{ store.captain ? '队长权限' : '成员权限' }}<small>{{ store.data?.viewer.id.slice(-6) }}</small></span></div></nav>
    <div class="settings-content">
      <section id="compute" class="settings-section"><ComputeDialog v-if="store.canManage" embedded /><template v-else><h2>协作算力</h2><p class="connection-summary"><i class="presence" :class="{ online: store.computeAvailable }"></i>{{ store.computeLabel }}</p><p class="muted">团队 API 与节点池配置由队长管理。本机 Codex 连接和额度可以在下方查看。</p></template></section>
      <section id="usage" class="settings-section">
        <header class="settings-section-title"><h2>Codex 连接与额度</h2><button class="btn small" :disabled="quotaLoading || !store.local" @click="refreshQuota"><Icon name="activity" :size="15" />{{ quotaLoading ? '读取中…' : '刷新状态与额度' }}</button></header>
        <p class="muted">管理本机设备授权，查看当前登录账户的额度窗口与重置时间。</p>
        <p v-if="store.local" class="connection-summary"><i class="presence" :class="{ online: store.codex?.status === 'available' }"></i>{{ store.codex ? codexLabels[store.codex.status] : '连接状态暂不可用' }}</p>
        <div v-if="limits.length" class="quota-grid">
          <article v-for="(limit, index) in limits" :key="limit.label + ':' + index" class="quota-card"><header><strong>{{ limit.label }}</strong><span>{{ remaining(limit) === null ? '暂不可用' : '剩余 ' + Math.round(remaining(limit)!) + '%' }}</span></header><progress v-if="remaining(limit) !== null" :value="remaining(limit)!" max="100" :aria-label="limit.label + ' 剩余额度'"></progress><small>{{ resetTime(limit.resetsAt) }}</small></article>
        </div>
        <div v-else class="quota-empty"><Icon name="activity" :size="22" /><span>暂未获取到额度信息。连接 Codex 后刷新；没有返回的窗口不会显示为 0%。</span></div>
        <div v-if="store.local && store.codex?.status !== 'available'" class="codex-login-inline">
          <button v-if="store.codex?.status !== 'connecting'" class="btn" :disabled="quotaLoading" @click="connectCodex">连接本机 Codex <Icon name="arrow" :size="15" /></button>
          <template v-else>
            <a v-if="store.codex.verificationUrl" :href="store.codex.verificationUrl" target="_blank" rel="noopener noreferrer" class="btn">打开设备授权页面 <Icon name="external" :size="14" /></a>
            <code v-if="store.codex.userCode">{{ store.codex.userCode }}</code>
            <span class="muted">{{ store.codex.verificationUrl ? '授权完成后刷新状态与额度。' : '授权地址和验证码生成中，稍后刷新状态与额度。' }}</span>
          </template>
          <p v-if="store.codex?.reason" class="muted">{{ store.codex.reason }}</p>
        </div>
      </section>
      <section id="team" class="settings-section"><header class="settings-section-title"><h2>Collaborators <span class="count">{{ members.length }}</span></h2><button v-if="store.canManage" class="btn small" :disabled="store.busy" @click="invite"><Icon name="plus" :size="15" />邀请成员</button></header><p class="muted">成员按节点身份区分，可以使用相同的显示名字。</p><div v-if="invitation" class="invite-command"><code>{{ invitation }}</code><p>队友运行邀请命令连接自己的项目，再运行 vibe-git open。邀请仅发送给预期成员。</p><button class="icon-btn" aria-label="收起邀请命令" @click="invitation = ''"><Icon name="close" :size="16" /></button></div><div class="paper settings-member-list"><article v-for="node in members" :key="node.id"><span class="avatar">{{ node.label.slice(0, 1).toUpperCase() }}</span><div><strong>{{ node.label }}<span v-if="node.id === store.data?.viewer.id" class="tag">你</span></strong><small>{{ node.id.slice(-8) }} · {{ node.role === 'captain' ? '队长' : '成员' }} · {{ relativeTime(node.lastSeenAt) }}同步</small></div><span class="member-presence"><i class="presence" :class="{ online: node.connected }"></i>{{ node.connected ? '在线' : '离线' }}</span><button v-if="store.canManage && node.role !== 'captain'" class="btn small danger" :disabled="store.busy" @click="reviewRemoval(node)">移除</button><span v-else class="tag">{{ node.role === 'captain' ? 'Owner' : 'Member' }}</span></article></div></section>
      <section id="repository" class="settings-section"><h2>Git repository</h2><p class="muted">设置代码 PR 的仓库入口。使用 GitHub / GitLab 原生审查与合并；入口保存在当前浏览器。</p><form class="repository-settings-form" @submit.prevent="saveRepository"><label class="field">仓库页面地址<input v-model="remote" class="input" type="url" required placeholder="https://github.com/team/project" /></label><p v-if="repoError" class="inline-error" role="alert">{{ repoError }}</p><div class="button-row"><button class="btn">保存仓库入口</button><a v-if="repository.pullUrl" :href="repository.pullUrl" target="_blank" rel="noopener noreferrer" class="btn">打开代码 PR <Icon name="external" :size="14" /></a></div></form><p v-if="store.project" class="workspace-path"><Icon name="folder" :size="15" /><span>本机工作区 <code>{{ store.project.path }}</code></span></p><p v-if="store.projectError" class="inline-error">{{ store.projectError }}</p></section>
      <section id="profile" class="settings-section"><h2>Profile</h2><p class="muted">更新在团队中显示的名字。</p><form class="profile-settings-form" @submit.prevent="rename"><label class="field">显示名字<input v-model="label" class="input" maxlength="40" :disabled="!store.local" /></label><button class="btn" :disabled="store.busy || !store.local || !label.trim() || label.trim() === store.data?.viewer.label">保存名字</button></form></section>
    </div>
  </div>
  <div v-if="removing" class="modal-backdrop" @click.self="!store.busy && (removing = null)"><section ref="removalPanel" class="modal member-removal-modal" role="dialog" aria-modal="true" aria-labelledby="remove-member-title" tabindex="-1" @keydown="modalKeys"><header class="section-head"><h2 id="remove-member-title">移除 {{ removing.label }}？</h2><button class="icon-btn" :disabled="store.busy" aria-label="取消移除成员" @click="removing = null"><Icon name="close" /></button></header><p>该成员将无法继续连接房间，正在执行的作业会取消。{{ taskSnapshot.length }} 项未完成任务将暂停，原任务和完成记录保留。</p><ul v-if="taskSnapshot.length" class="removal-task-list"><li v-for="task in taskSnapshot" :key="task.id"><strong>{{ task.title }}</strong><span>{{ taskStatus[task.status] ?? task.status }} · v{{ task.packageRevision ?? task.revision }}</span></li></ul><p class="muted">移除后可以在 Projects 提交改派 Issue，安排其他队友继续。</p><p v-if="removalError" class="inline-error" role="alert">{{ removalError }}<button class="text-button" :disabled="store.busy" @click="reviewRemoval(removing)">刷新任务影响</button></p><footer class="modal-footer"><button class="btn" :disabled="store.busy" @click="removing = null">取消</button><button class="btn danger-solid" :disabled="store.busy || !!removalError" @click="removeMember">确认移除成员</button></footer></section></div>
</template>
