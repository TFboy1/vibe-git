<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { recoveryAdvice, notificationResource } from "@vibe-git/protocol";
import type { NotificationResource } from "@vibe-git/protocol";
import { useWorkspace } from "./store";
import { useRepository } from "./repository";
import { taskStatus } from "./team";
import { request } from "./api";
import Icon from "./components/Icon.vue";
import ProjectSwitcher from "./components/ProjectSwitcher.vue";
import AnalysisActivity from "./components/AnalysisActivity.vue";
const store = useWorkspace(), repository = useRepository(), route = useRoute(), router = useRouter();
const inboxOpen = ref(false), search = ref(""), searchInput = ref<HTMLInputElement>();
const searchPlaceholder = computed(() => section.value === "allocation" || route.query.task || route.query.change || route.query.batch || route.query.new ? "" : typeof route.meta.searchPlaceholder === "string" ? route.meta.searchPlaceholder : "");
const entries = [
  { path: "/requirements", text: "需求", section: "requirements" },
  { path: "/projects", text: "分工", section: "allocation" },
  { path: "/execute", text: "执行", section: "execution" },
  { path: "/issues", text: "审核", section: "review" }
];
const unread = computed(() => store.data?.notifications.filter(note => !note.readAt).length ?? 0);
const notifications = computed(() => store.data?.notifications.map(note => ({ note, resource: notificationResource(note, store.data!) })) ?? []);
const section = computed(() => route.meta.section === "projects"
  ? route.query.task || route.query.owner || route.query.q || ["packages", "board", "progress"].includes(String(route.query.view)) ? "execution" : "allocation"
  : route.meta.section);
const stage = computed(() => {
  const flow = store.flow;
  if (flow) {
    if (flow.phase === "AGILE_ALLOCATE" || flow.status === "READY") return "allocation";
    if (flow.status === "DRAFT") return "requirements";
    return flow.kind === "review" ? "review" : "requirements";
  }
  if (store.reviewStage?.reviewId || store.pendingChanges.length) return "review";
  if (store.data?.alignments.some(run => run.status === "READY" && !run.publishedStageId && !run.detailJobIds?.length)) return "allocation";
  return store.data?.room.requirementRevision ? "execution" : "requirements";
});
function resourceStatus(resource: NotificationResource) { return resource.kind === "task" ? taskStatus[resource.status] ?? resource.status : resource.status; }
function viewNotification(resource: NotificationResource) {
  const target = resource.kind === "change" ? { path: "/issues", query: { change: resource.id } } : resource.kind === "task" ? { path: "/projects", query: { task: resource.id, view: "packages" } } :
    resource.kind === "requirement" ? { path: "/requirements", query: { revision: resource.id } } : { path: "/plans", query: { plan: resource.id } };
  void router.push(target); inboxOpen.value = false;
}
const errorAdvice = computed(() => store.recovery ?? recoveryAdvice());
async function resolveNotification(id: string) {
  try { const resource = await request<NotificationResource | null>("/api/v1/notifications/" + encodeURIComponent(id) + "/resource"); if (resource) viewNotification(resource); else store.notice = "关联记录暂不可用，原消息仍保留"; }
  catch (e) { store.reportError(e); }
}
async function recover() {
  if (!store.connected) { await store.start(); return; }
  try { await store.refresh(); store.error = ""; store.recovery = null; if (store.local) await store.refreshStartup(); }
  catch (e) { store.reportError(e); }
}
function toggleInbox() { inboxOpen.value = !inboxOpen.value; if (inboxOpen.value) void store.refresh(["notifications"]).catch(e => { store.reportError(e); }); }
function find() {
  if (!searchPlaceholder.value) return;
  const query = { ...route.query };
  delete query.change; delete query.task; delete query.batch;
  if (search.value.trim()) query.q = search.value.trim(); else delete query.q;
  void router.push({ path: route.path, query, hash: route.hash });
}
function keys(event: KeyboardEvent) {
  if (event.key === "Escape") inboxOpen.value = false;
  const target = event.target as HTMLElement;
  if (event.key === "/" && searchInput.value && !event.ctrlKey && !event.metaKey && !event.altKey && !target.closest("input, textarea, select, [contenteditable=true]")) {
    event.preventDefault(); searchInput.value?.focus();
  }
}
watch(() => route.fullPath, () => { search.value = typeof route.query.q === "string" ? route.query.q : ""; }, { immediate: true });
onMounted(() => { void store.start(); window.addEventListener("keydown", keys); });
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
watch(() => store.notice, value => { clearTimeout(noticeTimer); if (value) noticeTimer = setTimeout(() => { store.notice = ""; }, 4_500); });
onBeforeUnmount(() => { store.stop(); clearTimeout(noticeTimer); window.removeEventListener("keydown", keys); });
</script>
<template>
  <div class="github-shell">
    <header class="repository-header">
      <div class="global-bar">
        <div class="global-identity">
          <RouterLink to="/" class="repository-brand" aria-label="Vibe-Git 首页">vg<span></span></RouterLink>
          <div class="repository-breadcrumb"><ProjectSwitcher v-if="store.local" /><RouterLink v-else to="/">{{ repository.name }}</RouterLink></div>
        </div>

        <div class="global-tools">
          <button class="header-icon notification-button" aria-label="打开协作消息" :aria-expanded="inboxOpen" @click="toggleInbox"><Icon name="bell" :size="19" /><b v-if="unread">{{ unread > 99 ? '99+' : unread }}</b></button>
          <RouterLink to="/settings" class="header-icon" :class="{ active: section === 'settings' }" aria-label="设置"><Icon name="settings" :size="19" /></RouterLink>
        </div>
      </div>
      <nav class="repository-nav workflow-nav" aria-label="协作步骤">
        <RouterLink to="/" :class="{ active: route.path === '/' }" :aria-current="route.path === '/' ? 'page' : undefined" class="workflow-home"><Icon name="code" :size="18" />首页</RouterLink>
        <RouterLink v-for="(entry, index) in entries" :key="entry.path" :to="entry.path" :class="{ active: section === entry.section, 'current-stage': stage === entry.section }" :aria-current="section === entry.section ? 'page' : undefined"><span class="step-number">{{ index + 1 }}</span><span>{{ entry.text }}</span><small v-if="stage === entry.section">当前阶段</small></RouterLink>
      </nav>
    </header>
    <main class="repository-main">
      <div v-if="store.error" class="global-error" role="alert"><div><strong>{{ errorAdvice.title }}</strong><p>{{ store.error }}</p><small>{{ errorAdvice.preserved }}</small><p>下一步：{{ errorAdvice.next }}</p><button v-if="errorAdvice.syncFirst" class="text-button" :disabled="store.busy" @click="recover">同步实际状态</button></div><button class="icon-btn" aria-label="关闭错误提示" @click="store.error = ''"><Icon name="close" :size="16" /></button></div>
      <div v-if="!store.ready" class="loading-page"><span class="working-dot"></span><p>正在连接协作房间…</p></div>
      <section v-else-if="!store.data" class="connection-page paper"><Icon name="code" :size="32" /><h1>进入你的团队工作区</h1><p>成员先使用邀请命令连接本机项目，再运行命令打开工作台。</p><code>vibe-git open</code><button class="btn primary" @click="store.start()">重新连接 <Icon name="arrow" /></button></section>
      <template v-else>
        <div v-if="!store.local" class="legacy-notice">请在自己的电脑运行 <code>vibe-git open</code>，进入可编辑的本机工作台。</div>
        <nav v-if="section === 'requirements'" class="code-subnav" aria-label="需求视图"><RouterLink to="/requirements" :class="{ active: route.path === '/requirements' }" :aria-current="route.path === '/requirements' ? 'page' : undefined">团队需求</RouterLink><RouterLink to="/plans" :class="{ active: route.path === '/plans' }" :aria-current="route.path === '/plans' ? 'page' : undefined">补充想法（可选）</RouterLink></nav>
        <nav v-if="section === 'review'" class="code-subnav" aria-label="审核分类"><RouterLink to="/issues" :class="{ active: route.path !== '/pulls' }" :aria-current="route.path !== '/pulls' ? 'page' : undefined">需求变更</RouterLink><RouterLink to="/pulls" :class="{ active: route.path === '/pulls' }" :aria-current="route.path === '/pulls' ? 'page' : undefined">代码合并请求</RouterLink></nav>
        <div v-if="searchPlaceholder" class="page-tools"><form v-if="searchPlaceholder" class="global-search page-search" role="search" @submit.prevent="find"><Icon name="search" :size="17" /><input ref="searchInput" v-model="search" type="search" :aria-label="searchPlaceholder" :placeholder="searchPlaceholder" @search="!search.trim() && find()" /><kbd>/</kbd></form></div>
        <RouterLink v-if="section === 'agents'" :to="route.query.prompt === 'allocate' ? '/projects' : '/issues'" class="text-button detail-back"><Icon name="arrow" :size="15" />返回工作区</RouterLink>
        <RouterView />
      </template>
    </main>
    <AnalysisActivity />
    <footer class="repository-footer"><span class="footer-brand">vg</span><span>Vibe-Git · 团队协作工作台</span></footer>
    <div v-if="store.notice" class="toast" role="status"><Icon name="check" />{{ store.notice }}</div>
    <div v-if="inboxOpen" class="drawer-backdrop" @click.self="inboxOpen = false"><aside class="notification-drawer" aria-label="协作消息"><header class="section-head"><h2>协作消息 <span class="count">{{ unread }}</span></h2><button class="icon-btn" aria-label="关闭消息" @click="inboxOpen = false"><Icon name="close" /></button></header><p class="muted small-text">消息保留事件记录，关联状态随房间同步。</p><div v-if="!notifications.length" class="empty-state">暂时没有消息。</div><article v-for="item in notifications" :key="item.note.id" class="notification-item" :class="{ unread: !item.note.readAt }"><small>{{ new Date(item.note.createdAt).toLocaleString('zh-CN') }}</small><h3>{{ item.note.title }}</h3><p>{{ item.note.body }}</p><div v-if="item.resource" class="notification-context"><span class="tag">当前状态 · {{ resourceStatus(item.resource) }}</span><button class="text-button" @click="viewNotification(item.resource)">查看{{ item.resource.kind === 'change' ? '需求变更' : item.resource.kind === 'task' ? '任务包' : item.resource.kind === 'plan' ? '个人计划' : '需求文档' }} <Icon name="arrow" :size="13" /></button></div><button v-if="!item.resource && item.note.entityId" class="text-button" @click="resolveNotification(item.note.id)">查看关联记录</button><button v-if="!item.note.readAt && store.local" class="text-button" @click="store.mutate('/api/v1/notifications/' + item.note.id + '/read', {}, '', 'POST')">标为已读</button></article></aside></div>
  </div>
</template>
