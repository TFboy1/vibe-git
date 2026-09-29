<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { notificationResource } from "@vibe-git/protocol";
import type { NotificationResource } from "@vibe-git/protocol";
import { useWorkspace } from "./store";
import Icon from "./components/Icon.vue";
import ComputeDialog from "./components/ComputeDialog.vue";
const store = useWorkspace(), route = useRoute(), router = useRouter();
const computeOpen = ref(false), inboxOpen = ref(false), menuOpen = ref(false);
const entries = [{ path: "/", icon: "room", text: "房间与计划", n: "01" }, { path: "/requirements", icon: "document", text: "需求文档", n: "02" },
  { path: "/tasks", icon: "tasks", text: "任务包", n: "03" }, { path: "/changes", icon: "changes", text: "需求变更", n: "04" }];
const unread = computed(() => store.data?.notifications.filter(n => !n.readAt).length ?? 0);
const notifications = computed(() => store.data?.notifications.map(note => ({ note, resource: notificationResource(note, store.data!) })) ?? []);
const taskStates: Record<string, string> = { PUBLISHED: "待开发", IN_PROGRESS: "进行中", BLOCKED: "遇到阻塞", PAUSED: "已暂停", DONE: "已完成", FAILED: "执行失败", WAITING_CONFIRMATION: "待确认" };
function resourceStatus(resource: NotificationResource) { return resource.kind === "task" ? taskStates[resource.status] ?? resource.status : resource.status; }
function viewNotification(resource: NotificationResource) {
  const target = resource.kind === "change" ? { path: "/changes", query: { change: resource.id } } : resource.kind === "task" ? { path: "/tasks", query: { task: resource.id } } :
    resource.kind === "requirement" ? { path: "/requirements", query: { revision: resource.id } } : { path: "/", query: { plan: resource.id } };
  void router.push(target); inboxOpen.value = false;
}
function toggleInbox() { inboxOpen.value = !inboxOpen.value; if (inboxOpen.value) void store.refresh().catch(e => { store.error = e instanceof Error ? e.message : String(e); }); }
const stage = computed(() => store.flow?.status === "READY" ? 3 : store.flow?.draftMarkdown ? 2 : store.flow ? 1 : store.data?.room.requirementRevision ? 4 : 0);
watch(() => route.path, () => { menuOpen.value = false; });
onMounted(store.start); onBeforeUnmount(store.stop);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
watch(() => store.notice, value => { clearTimeout(noticeTimer); if (value) noticeTimer = setTimeout(() => { store.notice = ""; }, 4_500); });
onBeforeUnmount(() => clearTimeout(noticeTimer));
</script>
<template>
  <div class="app-shell" :class="{ 'menu-open': menuOpen }">
    <aside class="sidebar">
      <RouterLink to="/" class="brand" aria-label="Vibe-Git 首页"><span class="brand-mark">v<span>·</span>g</span><span>vibe-git<small>共同想清楚，一起开工。</small></span></RouterLink>
      <div class="workspace-label"><span class="eyebrow">TEAM WORKSPACE</span><span class="live-label"><span class="presence" :class="{ online: store.connected }"></span>{{ store.connected ? '协作中' : '连接中' }}</span></div>
      <nav class="main-nav" aria-label="工作台导航"><RouterLink v-for="entry in entries" :key="entry.path" :to="entry.path" :class="{ active: route.path === entry.path }"><Icon :name="entry.icon" /><span>{{ entry.text }}</span><b v-if="entry.path === '/changes' && store.pendingChanges.length">{{ store.pendingChanges.length }}</b><small v-else>{{ entry.n }}</small></RouterLink></nav>
      <div class="sidebar-note"><span class="eyebrow">LESS CEREMONY.<br />MORE CLARITY.</span><p>需求对齐之后，<br />每个人都知道下一步。</p><div class="tiny-line"></div></div>
      <div class="sidebar-bottom">
        <button v-if="store.canManage" class="compute-link" @click="computeOpen = true"><span class="presence" :class="{ online: store.computeAvailable }"></span><span>协作算力<small>{{ store.computeLabel }}</small></span><Icon name="settings" :size="16" /></button>
        <div v-else-if="store.data" class="compute-link compute-readonly"><span class="presence" :class="{ online: store.computeAvailable }"></span><span>协作算力<small>{{ store.computeLabel }}</small></span></div>
        <div v-if="store.data" class="identity"><span class="avatar">{{ store.data.viewer.label.slice(0, 1).toUpperCase() }}</span><span><strong>{{ store.data.viewer.label }}</strong><small>{{ store.captain ? '队长' : '团队成员' }} · {{ store.data.viewer.id.slice(-4) }}</small></span><span class="identity-dot"></span></div>
      </div>
    </aside>
    <div v-if="menuOpen" class="sidebar-scrim" @click="menuOpen = false"></div>
    <div class="workspace">
      <header class="topbar"><div class="breadcrumb"><button class="icon-btn mobile-menu" aria-label="打开导航" @click="menuOpen = !menuOpen"><Icon name="menu" /></button><span>工作台</span><Icon name="chevron" :size="13" /><strong>{{ route.meta.title }}</strong></div><div class="topbar-actions"><span v-if="store.data" class="revision-chip"><span class="presence online"></span>{{ store.data.room.requirementRevision ? '需求 R' + store.data.room.requirementRevision : '首轮计划' }}</span><button class="icon-btn notification-button" aria-label="打开协作消息" :aria-expanded="inboxOpen" @click="toggleInbox"><Icon name="bell" /><b v-if="unread">{{ unread }}</b></button></div></header>
      <main class="main-content">
        <div v-if="store.error" class="global-error" role="alert"><span>{{ store.error }}</span><button class="icon-btn" aria-label="关闭错误提示" @click="store.error = ''"><Icon name="close" :size="16" /></button></div>
        <div v-if="!store.ready" class="loading-page"><span class="working-dot"></span><p>正在连接你的协作房间…</p></div>
        <section v-else-if="!store.data" class="connection-page paper"><span class="eyebrow">WELCOME TO VIBE-GIT</span><h1>从本机进入协作房间。</h1><p>队长先启动房间，成员使用邀请命令连接项目，再运行下面的命令打开工作台。</p><code>vibe-git open</code><button class="btn" @click="store.start()">重新连接 <Icon name="arrow" /></button></section>
        <template v-else>
          <div v-if="!store.agileEnabled" class="legacy-notice">这个房间保留原有流程。个人计划可以继续提交，历史需求变更、任务和通知也保留在工作台中。</div>
          <div v-if="!store.local" class="legacy-notice">当前会话只有查看权限。请在自己的电脑运行 <code>vibe-git open</code> 打开可编辑的本机工作台。</div>
          <div class="page-heading"><div><span class="eyebrow">{{ route.meta.eyebrow }} / VIBE-GIT</span><h1>{{ route.meta.title }}</h1></div><span class="room-stamp">ROOM <b>{{ store.data.room.id.slice(0, 8).toUpperCase() }}</b></span></div>
          <div v-if="!store.data.room.requirementRevision || store.flow" class="phase-rail" aria-label="协作流程"><div v-for="(step, i) in ['计划收集', '冲突对齐', '需求确认', '任务派发']" :key="step" :class="{ current: i === stage, completed: i < stage }"><span>{{ i < stage ? '✓' : String(i + 1).padStart(2, '0') }}</span>{{ step }}<i></i></div></div>
          <RouterView />
        </template>
      </main>
      <footer class="workspace-footer"><span>VIBE-GIT / 超敏捷协作</span><span>计划可以不同，方向一起确定。</span></footer>
    </div>
    <div v-if="store.notice" class="toast" role="status"><Icon name="check" />{{ store.notice }}</div>
    <div v-if="inboxOpen" class="drawer-backdrop" @click.self="inboxOpen = false"><aside class="notification-drawer" aria-label="协作消息"><header class="section-head"><div><span class="eyebrow">TEAM INBOX</span><h2>协作消息</h2></div><button class="icon-btn" aria-label="关闭消息" @click="inboxOpen = false"><Icon name="close" /></button></header><p class="muted small-text">消息记录发送时的事件，下方显示关联记录的当前状态。未读消息数包含任务和历史事件，待审变更数仅统计尚未审核的变更。</p><div v-if="!notifications.length" class="empty-state">暂时没有消息。</div><article v-for="item in notifications" :key="item.note.id" class="notification-item" :class="{ unread: !item.note.readAt }"><small>{{ new Date(item.note.createdAt).toLocaleString('zh-CN') }}</small><h3>{{ item.note.title }}</h3><p>{{ item.note.body }}</p><div v-if="item.resource" class="notification-context"><span class="tag">当前状态 · {{ resourceStatus(item.resource) }}</span><button class="text-button" @click="viewNotification(item.resource)">查看{{ item.resource.kind === 'change' ? '需求变更' : item.resource.kind === 'task' ? '任务包' : item.resource.kind === 'plan' ? '个人计划' : '需求文档' }} <Icon name="arrow" :size="13" /></button></div><button v-if="!item.note.readAt && store.local" class="text-button" @click="store.mutate('/api/v1/notifications/' + item.note.id + '/read', {}, '', 'POST')">标为已读</button></article></aside></div>
    <ComputeDialog v-if="computeOpen" @close="computeOpen = false" />
  </div>
</template>
