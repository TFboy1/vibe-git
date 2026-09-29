<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { notificationResource } from "@vibe-git/protocol";
import type { NotificationResource } from "@vibe-git/protocol";
import { useWorkspace } from "./store";
import { useRepository } from "./repository";
import { taskStatus } from "./team";
import Icon from "./components/Icon.vue";
const store = useWorkspace(), repository = useRepository(), route = useRoute(), router = useRouter();
const inboxOpen = ref(false), menuOpen = ref(false), createOpen = ref(false), search = ref(""), searchInput = ref<HTMLInputElement>();
const entries = [
  { path: "/", icon: "code", text: "Code", title: "成员工作情况", section: "code" },
  { path: "/issues", icon: "issue", text: "Issues", title: "需求变更", section: "issues" },
  { path: "/pulls", icon: "pull", text: "Pull requests", title: "代码合并申请", section: "pulls" },
  { path: "/agents", icon: "agent", text: "Agents", title: "Codex 对话", section: "agents" },
  { path: "/projects", icon: "project", text: "Projects", title: "任务与分工", section: "projects" },
  { path: "/requirements", icon: "book", text: "Wiki", title: "需求文档", section: "requirements" },
  { path: "/settings", icon: "settings", text: "Settings", title: "算力与团队设置", section: "settings" }
];
const unread = computed(() => store.data?.notifications.filter(note => !note.readAt).length ?? 0);
const notifications = computed(() => store.data?.notifications.map(note => ({ note, resource: notificationResource(note, store.data!) })) ?? []);
const activeTasks = computed(() => store.data?.tasks.filter(task => !task.archived && task.status !== "DONE").length ?? 0);
const stage = computed(() => store.flow?.status === "READY" ? 3 : store.flow?.draftMarkdown ? 2 : store.flow ? 1 : store.data?.room.requirementRevision ? 4 : 0);
function resourceStatus(resource: NotificationResource) { return resource.kind === "task" ? taskStatus[resource.status] ?? resource.status : resource.status; }
function viewNotification(resource: NotificationResource) {
  const target = resource.kind === "change" ? { path: "/issues", query: { change: resource.id } } : resource.kind === "task" ? { path: "/projects", query: { task: resource.id, view: "packages" } } :
    resource.kind === "requirement" ? { path: "/requirements", query: { revision: resource.id } } : { path: "/plans", query: { plan: resource.id } };
  void router.push(target); inboxOpen.value = false;
}
function toggleInbox() { inboxOpen.value = !inboxOpen.value; if (inboxOpen.value) void store.refresh().catch(e => { store.error = e instanceof Error ? e.message : String(e); }); }
function find() {
  const path = route.meta.section === "issues" ? "/issues" : route.meta.section === "projects" ? "/projects" : "/";
  void router.push({ path, query: search.value.trim() ? { q: search.value.trim() } : {} });
}
function keys(event: KeyboardEvent) {
  if (event.key === "Escape") { inboxOpen.value = false; menuOpen.value = false; createOpen.value = false; }
  const target = event.target as HTMLElement;
  if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !target.closest("input, textarea, select, [contenteditable=true]")) {
    event.preventDefault(); searchInput.value?.focus();
  }
}
watch(() => route.fullPath, () => { menuOpen.value = false; createOpen.value = false; search.value = typeof route.query.q === "string" ? route.query.q : ""; }, { immediate: true });
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
          <button class="header-icon" aria-label="打开工作台菜单" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"><Icon name="menu" :size="20" /></button>
          <RouterLink to="/" class="repository-brand" aria-label="Vibe-Git 首页">vg<span></span></RouterLink>
          <div class="repository-breadcrumb"><span>{{ repository.owner }}</span><span class="muted">/</span><RouterLink to="/">{{ repository.name }}</RouterLink><Icon name="chevron" :size="12" class="rotate" /></div>
        </div>
        <div class="global-tools">
          <form class="global-search" role="search" @submit.prevent="find"><Icon name="search" :size="17" /><input ref="searchInput" v-model="search" aria-label="搜索成员、任务或 Issues" placeholder="搜索成员、任务或 Issues" /><kbd>/</kbd></form>
          <RouterLink to="/agents" class="header-icon" aria-label="打开 Codex"><Icon name="agent" :size="20" /></RouterLink>
          <div class="header-popover-anchor"><button class="header-icon" aria-label="新建" :aria-expanded="createOpen" @click="createOpen = !createOpen"><Icon name="plus" :size="20" /></button><div v-if="createOpen" class="header-popover"><RouterLink to="/plans"><Icon name="document" :size="16" />个人计划</RouterLink><RouterLink :to="{ path: '/issues', query: { new: '1' } }"><Icon name="issue" :size="16" />需求 Issue</RouterLink><RouterLink to="/projects"><Icon name="project" :size="16" />任务分工</RouterLink></div></div>
          <button class="header-icon notification-button" aria-label="打开协作消息" :aria-expanded="inboxOpen" @click="toggleInbox"><Icon name="bell" :size="19" /><b v-if="unread">{{ unread > 99 ? '99+' : unread }}</b></button>
          <RouterLink to="/settings" class="avatar header-avatar" :title="store.data?.viewer.label ?? '账户设置'">{{ (store.data?.viewer.label ?? 'V').slice(0, 1).toUpperCase() }}</RouterLink>
        </div>
      </div>
      <nav class="repository-nav" aria-label="仓库导航"><RouterLink v-for="entry in entries" :key="entry.path" :to="entry.path" :title="entry.title" :class="{ active: route.meta.section === entry.section }" :aria-current="route.meta.section === entry.section ? 'page' : undefined"><Icon :name="entry.icon" :size="20" /><span>{{ entry.text }}</span><b v-if="entry.section === 'issues' && store.pendingChanges.length" class="nav-count">{{ store.pendingChanges.length }}</b><b v-if="entry.section === 'projects' && activeTasks" class="nav-count">{{ activeTasks }}</b></RouterLink></nav>
    </header>
    <div v-if="menuOpen" class="header-menu-backdrop" @click.self="menuOpen = false"><aside class="global-menu"><header><strong>Vibe-Git</strong><button class="icon-btn" aria-label="关闭工作台菜单" @click="menuOpen = false"><Icon name="close" /></button></header><RouterLink v-for="entry in entries" :key="entry.path" :to="entry.path"><Icon :name="entry.icon" />{{ entry.text }}<small>{{ entry.title }}</small></RouterLink><RouterLink to="/plans"><Icon name="people" />团队与个人计划</RouterLink><p v-if="store.project">{{ store.project.path }}</p></aside></div>
    <main class="repository-main">
      <div v-if="store.error" class="global-error" role="alert"><span>{{ store.error }}</span><button class="icon-btn" aria-label="关闭错误提示" @click="store.error = ''"><Icon name="close" :size="16" /></button></div>
      <div v-if="!store.ready" class="loading-page"><span class="working-dot"></span><p>正在连接协作房间…</p></div>
      <section v-else-if="!store.data" class="connection-page paper"><Icon name="code" :size="32" /><h1>进入你的团队工作区</h1><p>成员先使用邀请命令连接本机项目，再运行命令打开工作台。</p><code>vibe-git open</code><button class="btn primary" @click="store.start()">重新连接 <Icon name="arrow" /></button></section>
      <template v-else>
        <section class="repository-title-row"><div class="repository-title"><Icon name="book" :size="23" /><RouterLink to="/">{{ repository.name }}</RouterLink><span class="repo-visibility">Team</span></div><div class="repository-actions"><span class="connection-label"><i class="presence" :class="{ online: store.connected }"></i>{{ store.connected ? '实时同步' : '连接恢复中' }}</span><RouterLink to="/settings" class="btn small"><Icon name="people" :size="16" />{{ store.data.nodes.filter(node => !node.revoked).length }} 位成员</RouterLink><RouterLink to="/requirements" class="btn small"><Icon name="document" :size="16" />{{ store.data.room.requirementRevision ? '需求 R' + store.data.room.requirementRevision : '首轮计划' }}</RouterLink></div></section>
        <div v-if="!store.local" class="legacy-notice">请在自己的电脑运行 <code>vibe-git open</code>，进入可编辑的本机工作台。</div>
        <div v-if="route.path === '/plans'" class="code-subnav"><RouterLink to="/">成员工作</RouterLink><RouterLink to="/plans" class="active">个人计划</RouterLink><RouterLink to="/requirements">需求文档</RouterLink></div>
        <div v-if="route.path === '/plans' && (!store.data.room.requirementRevision || store.flow?.kind === 'initial')" class="phase-rail" aria-label="协作流程"><div v-for="(step, i) in ['计划收集', '冲突对齐', '需求确认', '任务派发']" :key="step" :class="{ current: i === stage, completed: i < stage }"><span>{{ i < stage ? '✓' : i + 1 }}</span>{{ step }}<i></i></div></div>
        <RouterView />
      </template>
    </main>
    <footer class="repository-footer"><span class="footer-brand">vg</span><span>Vibe-Git · 团队协作工作台</span><RouterLink to="/plans">个人计划</RouterLink><RouterLink to="/requirements">需求文档</RouterLink><RouterLink to="/settings">连接设置</RouterLink></footer>
    <div v-if="store.notice" class="toast" role="status"><Icon name="check" />{{ store.notice }}</div>
    <div v-if="inboxOpen" class="drawer-backdrop" @click.self="inboxOpen = false"><aside class="notification-drawer" aria-label="协作消息"><header class="section-head"><h2>Inbox <span class="count">{{ unread }}</span></h2><button class="icon-btn" aria-label="关闭消息" @click="inboxOpen = false"><Icon name="close" /></button></header><p class="muted small-text">消息保留事件记录，关联状态随房间同步。</p><div v-if="!notifications.length" class="empty-state">暂时没有消息。</div><article v-for="item in notifications" :key="item.note.id" class="notification-item" :class="{ unread: !item.note.readAt }"><small>{{ new Date(item.note.createdAt).toLocaleString('zh-CN') }}</small><h3>{{ item.note.title }}</h3><p>{{ item.note.body }}</p><div v-if="item.resource" class="notification-context"><span class="tag">当前状态 · {{ resourceStatus(item.resource) }}</span><button class="text-button" @click="viewNotification(item.resource)">查看{{ item.resource.kind === 'change' ? 'Issue' : item.resource.kind === 'task' ? '任务包' : item.resource.kind === 'plan' ? '个人计划' : '需求文档' }} <Icon name="arrow" :size="13" /></button></div><button v-if="!item.note.readAt && store.local" class="text-button" @click="store.mutate('/api/v1/notifications/' + item.note.id + '/read', {}, '', 'POST')">标为已读</button></article></aside></div>
  </div>
</template>
