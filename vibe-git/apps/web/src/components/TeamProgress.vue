<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkspace } from "../store";
import { useRepository } from "../repository";
import { currentWork, relativeTime, taskStatus } from "../team";
import { useHistory } from "../history";
import { request } from "../api";
import Icon from "../components/Icon.vue";
const store = useWorkspace(), repository = useRepository(), route = useRoute(), router = useRouter();
const historyKind = ref("flows"), historyDetail = ref("");
const history = useHistory<{ id: string; title?: string; name?: string; summary?: string; status?: string; sequence?: number }>(() => historyKind.value);
let historyController: AbortController | undefined;
watch(historyKind, () => { historyController?.abort(); historyDetail.value = ""; void history.load(); });
async function readHistory(id: string) {
  historyController?.abort(); const controller = historyController = new AbortController();
  try {
    const record = await request<Record<string, unknown>>("/api/v1/history/" + historyKind.value + "/" + encodeURIComponent(id), undefined, undefined, { signal: controller.signal });
    if (!controller.signal.aborted) historyDetail.value = [record.title ?? record.name ?? record.summary ?? "历史记录", record.requirementMarkdown ?? record.draftMarkdown ?? record.content ?? "", record.goal ?? record.signature ?? ""].filter(Boolean).join("\n\n");
  } catch (e) { if (!controller.signal.aborted) store.reportError(e); }
}
onBeforeUnmount(() => historyController?.abort());
const query = computed(() => typeof route.query.q === "string" ? route.query.q : "");
const branch = ref(""), refreshing = ref(false);
const members = computed(() => (store.data?.nodes ?? []).filter(node => !node.revoked));
const branches = computed(() => [...new Set(members.value.map(node => node.git?.branch).filter((value): value is string => !!value))]);
const rows = computed(() => members.value.map(node => ({ node, ...currentWork(node, store.data?.tasks ?? []) })).filter(row =>
  (!branch.value || row.node.git?.branch === branch.value) && (!query.value.trim() ||
    [row.node.label, row.node.id, row.summary, row.task?.title, row.node.git?.branch].join(" ").toLowerCase().includes(query.value.trim().toLowerCase()))));
const working = computed(() => store.data?.tasks.filter(task => task.status === "IN_PROGRESS" && !task.archived).length ?? 0);
const blocked = computed(() => store.data?.tasks.filter(task => ["PAUSED", "BLOCKED", "FAILED"].includes(task.status) && !task.archived).length ?? 0);
const latestGit = computed(() => [...members.value].filter(node => node.git).sort((a, b) => b.git!.observedAt.localeCompare(a.git!.observedAt))[0]);
function clearFilters() {
  branch.value = "";
  const query = { ...route.query }; delete query.q;
  void router.replace({ path: route.path, query, hash: route.hash });
}
async function refresh() {
  refreshing.value = true;
  try { await Promise.all([store.refresh(), store.local ? store.refreshProject() : Promise.resolve()]); }
  catch (e) { store.reportError(e); }
  finally { refreshing.value = false; }
}
</script>
<template>
  <section aria-label="团队 Git 状态">
      <div class="repo-toolbar">
        <label class="branch-picker"><Icon name="branch" :size="18" /><select v-model="branch" aria-label="按 Git 分支筛选成员"><option value="">所有分支</option><option v-for="name in branches" :key="name" :value="name">{{ name }}</option></select></label>
        <span class="toolbar-stat"><Icon name="branch" :size="17" /><b>{{ branches.length }}</b> 个分支</span>
        <span class="toolbar-stat"><Icon name="people" :size="17" /><b>{{ members.length }}</b> 位成员</span><RouterLink v-if="store.canManage" to="/settings#team" class="btn small">管理成员</RouterLink>
        <button class="btn toolbar-refresh" :disabled="refreshing" @click="refresh"><Icon name="activity" :size="17" /><span class="sr-only">刷新工作情况</span></button>
      </div>
      <section class="paper team-code-panel">
        <header class="team-code-header"><span class="avatar mini">{{ (latestGit?.label ?? repository.owner).slice(0, 1).toUpperCase() }}</span><strong>团队工作情况</strong><span class="muted">{{ working }} 项进行中<span v-if="blocked"> · {{ blocked }} 项暂停或受阻</span></span><span class="team-code-sync"><Icon name="clock" :size="16" />{{ relativeTime(latestGit?.git?.observedAt) }}同步</span></header>
        <div class="table-scroll"><table class="team-code-table"><caption class="sr-only">团队成员的当前任务、Git 状态和最近同步</caption><thead><tr><th>成员</th><th>当前工作</th><th>Git 分支 / 提交</th><th class="last-sync">最近同步</th></tr></thead><tbody>
          <tr v-for="row in rows" :key="row.node.id">
            <td><RouterLink :to="{ path: '/plans', query: { plan: row.node.id } }" class="member-cell"><span class="avatar mini" :class="{ captain: row.node.role === 'captain' }">{{ row.node.label.slice(0, 1).toUpperCase() }}</span><span><strong>{{ row.node.label }}</strong><small>{{ row.node.role === 'captain' ? '队长' : '成员' }} · {{ row.node.id.slice(-4) }}</small></span></RouterLink></td>
            <td class="current-work-cell"><RouterLink v-if="row.task && (store.captain || row.task.assigneeNodeId === store.data?.viewer.id)" :to="{ path: '/projects', query: { task: row.task.id, view: 'packages' } }" class="work-title">{{ row.task.title }}</RouterLink><span v-else-if="row.task" class="work-title">{{ row.task.title }}</span><span v-else class="muted">{{ row.node.currentTaskId ? '任务正在执行' : '等待分配任务' }}</span><p v-if="row.task" :title="row.summary"><span class="work-state" :class="row.task.status.toLowerCase()">{{ taskStatus[row.task.status] ?? row.task.status }}</span><span>{{ row.summary === row.task.title ? '任务包 v' + (row.task.packageRevision ?? row.task.revision) : row.summary }}</span></p><p v-else class="muted">{{ store.data?.plans.some(plan => plan.ownerNodeId === row.node.id) ? '已补充想法' : '可直接接任务' }}</p></td>
            <td class="git-cell"><template v-if="row.node.git"><span><Icon name="branch" :size="14" />{{ row.node.git.branch }}</span><small><code :title="row.node.git.headSha">{{ row.node.git.headSha.slice(0, 7) }}</code><span :class="{ 'dirty-git': row.node.git.dirty }">{{ row.node.git.dirty ? '有未提交修改' : '工作区干净' }}</span></small></template><span v-else class="muted">等待 Git 同步</span></td>
            <td class="last-sync"><time :title="row.node.lastSeenAt ? new Date(row.node.lastSeenAt).toLocaleString('zh-CN') : ''">{{ relativeTime(row.node.lastSeenAt) }}</time><small><i class="presence" :class="{ online: row.node.connected }"></i>{{ row.node.connected ? '在线' : '离线' }}</small></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="4" class="empty-state">没有匹配的成员。<button class="text-button" @click="clearFilters">清空筛选</button></td></tr>
        </tbody></table></div>
        <footer class="table-footnote"><Icon name="activity" :size="14" />工作情况来自任务汇报与本机 Git 同步。Skill 提交后，分支和提交标识会在这里更新。</footer>
      </section>

  </section>
  <div class="workspace-tools">
    <details class="paper workspace-disclosure" @toggle="($event.target as HTMLDetailsElement).open && history.load()">
      <summary><Icon name="clock" :size="17" /><strong>历史协作记录</strong><span>按需读取</span><Icon name="chevron" :size="15" /></summary>
      <div class="disclosure-body workspace-history">
        <div class="workspace-history-toolbar"><label class="field">记录类型<select v-model="historyKind" class="input"><option value="flows">需求整理与审核</option><option value="stages">需求阶段</option><option value="workstreams">历史工作分组</option><option value="contracts">接口约定</option><option value="intents">历史需求草稿</option><option value="reviews">历史审核</option><option value="alignments">历史分工</option></select></label><div class="button-row"><button class="btn small" :disabled="history.loading.value" @click="history.load()">最新一页</button><button v-if="history.nextCursor.value" class="btn small" :disabled="history.loading.value" @click="history.load(true)">更早记录</button></div></div>
        <p v-if="history.loading.value" class="muted" role="status">正在读取记录…</p><p v-else-if="history.error.value" class="inline-error" role="alert">{{ history.error.value }}</p><p v-else-if="!history.items.value.length" class="muted">暂无此类历史记录。</p>
        <ul v-else class="workspace-history-list"><li v-for="record in history.items.value" :key="record.id"><button class="text-button" @click="readHistory(record.id)">{{ record.title ?? record.name ?? record.summary ?? (record.sequence ? '第 ' + record.sequence + ' 阶段' : '历史记录') }} <Icon name="arrow" :size="14" /></button></li></ul>
        <pre v-if="historyDetail">{{ historyDetail }}</pre>
      </div>
    </details>
  </div>
</template>
