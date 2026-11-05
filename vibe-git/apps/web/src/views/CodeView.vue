<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkspace } from "../store";
import { useRepository } from "../repository";
import { currentWork, relativeTime, taskStatus, taskNextStep } from "../team";
import { useHistory } from "../history";
import { request } from "../api";
import Icon from "../components/Icon.vue";
import MarkdownEditor from "../components/MarkdownEditor.vue";
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
const missingChecks = computed(() => store.startup?.checks.filter(check => !check.ready) ?? []);
const passedChecks = computed(() => store.startup?.checks.filter(check => check.ready) ?? []);
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
  catch (e) { store.reportError(e); }
  finally { refreshing.value = false; }
}
</script>
<template>
  <section class="paper workspace-overview" aria-label="当前行动">
    <div class="workspace-action">
      <div><span class="workspace-kicker">{{ store.captain ? '团队协作' : '我的下一步' }}</span><h1>{{ store.nextAction.title }}</h1><p>{{ store.nextAction.body }}</p></div>
      <RouterLink :to="store.nextAction.path" class="btn primary">{{ store.nextAction.label }} <Icon name="arrow" :size="16" /></RouterLink>
    </div>
    <p class="workspace-prompt"><Icon name="agent" :size="17" /><span>在 Codex 中说出目标，或说 <code>继续我的任务</code>。这里随时可以查看进度、编辑和接管。</span></p>
    <div v-if="store.local && missingChecks.length" class="workspace-checks">
      <article v-for="check in missingChecks" :key="check.key" class="workspace-check" :class="{ required: check.required }">
        <Icon :name="check.key === 'preference' ? 'settings' : 'issue'" :size="18" />
        <div><strong>{{ check.label }}{{ check.required ? '尚未就绪' : '可以稍后选择' }}</strong><p>{{ check.detail }}</p></div>
        <RouterLink :to="check.path" class="btn small">{{ check.key === 'preference' ? '选择偏好' : check.key === 'ai' ? '连接 AI' : '去处理' }} <Icon name="arrow" :size="14" /></RouterLink>
      </article>
    </div>
    <details v-if="store.local" class="workspace-disclosure workspace-preferences">
      <summary><Icon name="settings" :size="16" /><strong>协作设置</strong><span>{{ store.preference.configured ? (store.preference.mode === 'automatic' ? '偏自动' : '多人工介入') : '暂按多人工介入' }}<template v-if="store.startup"> · {{ passedChecks.length }}/{{ store.startup.checks.length }} 项已就绪</template></span><Icon name="chevron" :size="15" /></summary>
      <div class="disclosure-body">
        <div class="workspace-preference"><p>{{ store.preference.mode === 'automatic' ? 'Codex 在当前授权内继续推进，你可以随时编辑需求或分工。' : 'Codex 准备好完整需求与分工后，发布前集中请你确认。' }}</p><RouterLink to="/settings#preference" class="text-button">{{ store.preference.configured ? '修改偏好' : '选择偏好' }} <Icon name="arrow" :size="14" /></RouterLink></div>
        <ul v-if="passedChecks.length" class="workspace-ready-list"><li v-for="check in passedChecks" :key="check.key"><Icon name="check" :size="15" /><span><strong>{{ check.label }}</strong><small>{{ check.detail }}</small></span></li></ul>
        <button v-if="store.startup" class="text-button" :disabled="store.busy" @click="store.refreshStartup">重新检查连接与条件</button>
      </div>
    </details>
  </section>
  <section v-if="store.myTasks.length" class="paper home-tasks"><header class="section-head"><h2>我的开发任务 <span class="count">{{ store.myTasks.length }}</span></h2><RouterLink :to="{ path: '/projects', query: { view: 'packages' } }" class="text-button">查看任务包 <Icon name="arrow" :size="14" /></RouterLink></header><article v-for="task in store.myTasks" :key="task.id"><div><RouterLink :to="{ path: '/projects', query: { task: task.id, view: 'packages' } }" class="work-title">{{ task.title }}</RouterLink><p>{{ taskNextStep(task, store.data?.tasks ?? [], store.name, store.data?.contracts ?? []) }}</p></div><span class="tag" :class="{ amber: task.status === 'PAUSED' || task.status === 'BLOCKED' }">{{ taskStatus[task.status] ?? task.status }}</span></article></section>
  <div class="repository-grid">
    <div class="repository-primary">
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
      <section class="paper repository-readme">
        <header class="readme-heading"><div><Icon name="book" :size="18" /><strong>团队需求</strong><span class="muted">{{ store.data?.room.requirementRevision ? 'R' + store.data.room.requirementRevision : '待发布' }}</span></div><RouterLink to="/requirements" class="btn small">{{ store.canManage && store.flow?.draftMarkdown ? '编辑需求' : '查看需求' }}<Icon name="arrow" :size="15" /></RouterLink></header>
        <MarkdownEditor v-if="requirement" :model-value="requirement" readonly compact :outline="false" :tools="false" filename="requirements.md" @error="store.error = $event" /><div v-else class="readme-empty"><h2>{{ store.flow?.draftMarkdown ? '共同需求草稿已就绪' : '从一个目标开始' }}</h2><p>{{ store.flow?.draftMarkdown ? '审核需求和分工后，一次发布正式版本。' : '队长简述目标，AI 补齐需求，再把任务分给具体的人。' }}</p><RouterLink to="/requirements" class="text-button">{{ store.flow?.draftMarkdown ? '查看需求草稿' : '前往需求页' }} <Icon name="arrow" :size="14" /></RouterLink></div>
      </section>
    </div>
    <aside class="repository-about">
      <section><header><h2>团队概况</h2></header><p>共同确定需求，让每位队友知道现在做什么、下一步做什么。</p><a v-if="repository.url" :href="repository.url.href" target="_blank" rel="noopener noreferrer" class="about-repo-link"><Icon name="link" :size="17" />{{ repository.url.host + repository.url.pathname }}</a><dl class="repository-stats"><div><dt><Icon name="book" :size="17" />需求版本</dt><dd>R{{ store.data?.room.requirementRevision ?? 0 }}</dd></div><div><dt><Icon name="people" :size="17" />可选想法</dt><dd>{{ store.data?.plans.length ?? 0 }} 份</dd></div><div><dt><Icon name="issue" :size="17" />待审变更</dt><dd>{{ store.pendingChanges.length }}</dd></div><div><dt><Icon name="project" :size="17" />已完成任务</dt><dd>{{ completed }} / {{ store.data?.tasks.filter(task => !task.archived).length ?? 0 }}</dd></div></dl><small class="room-id">Room {{ store.data?.room.id.slice(0, 8) }}</small></section>
      <section><header><h2>团队成员 <span class="count">{{ members.length }}</span></h2></header><div class="contributor-avatars"><span v-for="node in members" :key="node.id" class="avatar" :title="node.label + ' · ' + node.id.slice(-4)">{{ node.label.slice(0, 1).toUpperCase() }}<i class="presence" :class="{ online: node.connected }"></i></span></div></section>
      <section><header><h2>AI 连接</h2></header><p class="connection-summary"><i class="presence" :class="{ online: store.computeAvailable }"></i>{{ store.computeLabel }}</p></section>
    </aside>
  </div>
  <div class="workspace-tools">
    <details class="paper workspace-disclosure">
      <summary><Icon name="more" :size="17" /><strong>进阶工具</strong><span>代码审查与分析</span><Icon name="chevron" :size="15" /></summary>
      <nav class="disclosure-body workspace-links" aria-label="进阶工具"><RouterLink to="/pulls"><Icon name="pull" :size="16" />代码合并请求</RouterLink><RouterLink to="/agents"><Icon name="agent" :size="16" />AI 分析详情</RouterLink><RouterLink to="/plans"><Icon name="document" :size="16" />补充想法与历史流程</RouterLink><RouterLink to="/requirements"><Icon name="book" :size="16" />需求与协作阶段</RouterLink></nav>
    </details>
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
