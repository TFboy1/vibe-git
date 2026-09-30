<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkspace } from "../store";
import { useRepository } from "../repository";
import { currentWork, relativeTime, taskStatus } from "../team";
import Icon from "../components/Icon.vue";
import MarkdownEditor from "../components/MarkdownEditor.vue";
const store = useWorkspace(), repository = useRepository(), route = useRoute(), router = useRouter();
const query = computed(() => typeof route.query.q === "string" ? route.query.q : "");
const branch = ref(""), refreshing = ref(false);
const members = computed(() => (store.data?.nodes ?? []).filter(node => !node.revoked));
const branches = computed(() => [...new Set(members.value.map(node => node.git?.branch).filter((value): value is string => !!value))]);
const rows = computed(() => members.value.map(node => ({ node, ...currentWork(node, store.data?.tasks ?? []) })).filter(row =>
  (!branch.value || row.node.git?.branch === branch.value) && (!query.value.trim() ||
    [row.node.label, row.node.id, row.summary, row.task?.title, row.node.git?.branch].join(" ").toLowerCase().includes(query.value.trim().toLowerCase()))));
const working = computed(() => store.data?.tasks.filter(task => task.status === "IN_PROGRESS" && !task.archived).length ?? 0);
const blocked = computed(() => store.data?.tasks.filter(task => ["PAUSED", "BLOCKED", "FAILED"].includes(task.status) && !task.archived).length ?? 0);
const completed = computed(() => store.data?.tasks.filter(task => task.status === "DONE" && !task.archived).length ?? 0);
const latestGit = computed(() => [...members.value].filter(node => node.git).sort((a, b) => b.git!.observedAt.localeCompare(a.git!.observedAt))[0]);
const requirement = computed(() => store.data?.room.currentRequirementMarkdown ?? "");
function clearFilters() {
  branch.value = "";
  const query = { ...route.query }; delete query.q;
  void router.replace({ path: route.path, query, hash: route.hash });
}
async function refresh() {
  refreshing.value = true;
  try { await Promise.all([store.refresh(), store.local ? store.refreshProject() : Promise.resolve()]); }
  catch (e) { store.error = e instanceof Error ? e.message : String(e); }
  finally { refreshing.value = false; }
}
</script>
<template>
  <div class="repository-grid">
    <div class="repository-primary">
      <div class="repo-toolbar">
        <label class="branch-picker"><Icon name="branch" :size="18" /><select v-model="branch" aria-label="按 Git 分支筛选成员"><option value="">所有分支</option><option v-for="name in branches" :key="name" :value="name">{{ name }}</option></select></label>
        <span class="toolbar-stat"><Icon name="branch" :size="17" /><b>{{ branches.length }}</b> 个分支</span>
        <span class="toolbar-stat"><Icon name="people" :size="17" /><b>{{ members.length }}</b> 位成员</span>
        <button class="btn toolbar-refresh" :disabled="refreshing" @click="refresh"><Icon name="activity" :size="17" /><span class="sr-only">刷新工作情况</span></button>
      </div>
      <section class="paper team-code-panel">
        <header class="team-code-header"><span class="avatar mini">{{ (latestGit?.label ?? repository.owner).slice(0, 1).toUpperCase() }}</span><strong>团队工作情况</strong><span class="muted">{{ working }} 项进行中<span v-if="blocked"> · {{ blocked }} 项暂停或受阻</span></span><span class="team-code-sync"><Icon name="clock" :size="16" />{{ relativeTime(latestGit?.git?.observedAt) }}同步</span></header>
        <div class="table-scroll"><table class="team-code-table"><caption class="sr-only">团队成员的当前任务、Git 状态和最近同步</caption><thead><tr><th>成员</th><th>当前工作</th><th>Git 分支 / 提交</th><th class="last-sync">最近同步</th></tr></thead><tbody>
          <tr v-for="row in rows" :key="row.node.id">
            <td><RouterLink :to="{ path: '/plans', query: { plan: row.node.id } }" class="member-cell"><span class="avatar mini" :class="{ captain: row.node.role === 'captain' }">{{ row.node.label.slice(0, 1).toUpperCase() }}</span><span><strong>{{ row.node.label }}</strong><small>{{ row.node.role === 'captain' ? '队长' : '成员' }} · {{ row.node.id.slice(-4) }}</small></span></RouterLink></td>
            <td class="current-work-cell"><RouterLink v-if="row.task && (store.captain || row.task.assigneeNodeId === store.data?.viewer.id)" :to="{ path: '/projects', query: { task: row.task.id, view: 'packages' } }" class="work-title">{{ row.task.title }}</RouterLink><span v-else-if="row.task" class="work-title">{{ row.task.title }}</span><span v-else class="muted">{{ row.node.currentTaskId ? '任务正在执行' : '等待分配任务' }}</span><p v-if="row.task" :title="row.summary"><span class="work-state" :class="row.task.status.toLowerCase()">{{ taskStatus[row.task.status] ?? row.task.status }}</span><span>{{ row.summary === row.task.title ? '任务包 v' + (row.task.packageRevision ?? row.task.revision) : row.summary }}</span></p><p v-else class="muted">{{ store.data?.plans.some(plan => plan.ownerNodeId === row.node.id) ? '计划已提交' : '等待提交个人计划' }}</p></td>
            <td class="git-cell"><template v-if="row.node.git"><span><Icon name="branch" :size="14" />{{ row.node.git.branch }}</span><small><code :title="row.node.git.headSha">{{ row.node.git.headSha.slice(0, 7) }}</code><span :class="{ 'dirty-git': row.node.git.dirty }">{{ row.node.git.dirty ? '有未提交修改' : '工作区干净' }}</span></small></template><span v-else class="muted">等待 Git 同步</span></td>
            <td class="last-sync"><time :title="row.node.lastSeenAt ? new Date(row.node.lastSeenAt).toLocaleString('zh-CN') : ''">{{ relativeTime(row.node.lastSeenAt) }}</time><small><i class="presence" :class="{ online: row.node.connected }"></i>{{ row.node.connected ? '在线' : '离线' }}</small></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="4" class="empty-state">没有匹配的成员。<button class="text-button" @click="clearFilters">清空筛选</button></td></tr>
        </tbody></table></div>
        <footer class="table-footnote"><Icon name="activity" :size="14" />工作情况来自任务汇报与本机 Git 同步。Skill 提交后，分支和提交标识会在这里更新。</footer>
      </section>
      <section class="paper repository-readme"><header class="readme-heading"><div><Icon name="book" :size="18" /><strong>README</strong><span class="muted">/ 团队需求</span></div><RouterLink v-if="requirement || store.flow?.draftMarkdown" to="/requirements" class="btn small">{{ store.canManage && store.flow?.draftMarkdown ? '编辑需求' : '查看完整文档' }}<Icon name="arrow" :size="15" /></RouterLink></header><MarkdownEditor v-if="requirement" :model-value="requirement" readonly compact :outline="false" :tools="false" filename="requirements.md" @error="store.error = $event" /><div v-else class="readme-empty"><h2>{{ store.flow?.draftMarkdown ? '共同需求草稿已就绪' : '从每个人的计划开始' }}</h2><p>{{ store.flow?.draftMarkdown ? '审核并保存共同需求后，即可生成分工。' : '提交个人计划，解决需求冲突，再把任务分给具体的人。' }}</p><RouterLink v-if="!store.flow?.draftMarkdown" to="/plans" class="text-button">进入个人计划 <Icon name="arrow" :size="14" /></RouterLink></div></section>
    </div>
    <aside class="repository-about">
      <section><header><h2>About</h2></header><p>共同确定需求，让每位队友知道现在做什么、下一步做什么。</p><a v-if="repository.url" :href="repository.url.href" target="_blank" rel="noopener noreferrer" class="about-repo-link"><Icon name="link" :size="17" />{{ repository.url.host + repository.url.pathname }}</a><dl class="repository-stats"><div><dt><Icon name="book" :size="17" />需求版本</dt><dd>R{{ store.data?.room.requirementRevision ?? 0 }}</dd></div><div><dt><Icon name="people" :size="17" />已提交计划</dt><dd>{{ store.data?.plans.length ?? 0 }} / {{ members.length }}</dd></div><div><dt><Icon name="issue" :size="17" />待审 Issues</dt><dd>{{ store.pendingChanges.length }}</dd></div><div><dt><Icon name="project" :size="17" />已完成任务</dt><dd>{{ completed }} / {{ store.data?.tasks.filter(task => !task.archived).length ?? 0 }}</dd></div></dl><small class="room-id">Room {{ store.data?.room.id.slice(0, 8) }}</small></section>
      <section><header><h2>Members <span class="count">{{ members.length }}</span></h2></header><div class="contributor-avatars"><span v-for="node in members" :key="node.id" class="avatar" :title="node.label + ' · ' + node.id.slice(-4)">{{ node.label.slice(0, 1).toUpperCase() }}<i class="presence" :class="{ online: node.connected }"></i></span></div></section>
      <section><header><h2>Agent connection</h2></header><p class="connection-summary"><i class="presence" :class="{ online: store.computeAvailable }"></i>{{ store.computeLabel }}</p></section>
    </aside>
  </div>
</template>
