<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { CHANGE_STATUS_LABELS } from "@vibe-git/protocol";
import type { AgileDecision, AgileFlow, CoordinationChange, MarkdownDocument, VibePullRequest } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import { request } from "../api";
import MarkdownEditor from "../components/MarkdownEditor.vue";
import PlanWizard from "../components/PlanWizard.vue";
import FlowStatus from "../components/FlowStatus.vue";
import Icon from "../components/Icon.vue";
import ActionMenu from "../components/ActionMenu.vue";
import LegacyChangeReview from "../components/LegacyChangeReview.vue";
import LegacyPullRequestReview from "../components/LegacyPullRequestReview.vue";
const store = useWorkspace(), compose = ref(false), title = ref(""), content = ref(""), baseRevision = ref(store.data?.room.requirementRevision ?? 0);
const route = useRoute(), router = useRouter(), statusFilter = ref("open");
const query = computed(() => typeof route.query.q === "string" ? route.query.q : "");
const selected = ref(""), document = ref<MarkdownDocument | null>(null), reading = ref(false), readError = ref("");
const selectedPRs = ref<string[]>([]), selectionEdited = ref(false), decisions = ref<AgileDecision[]>([]), decisionsDirty = ref(false);
const prs = computed(() => store.changes);
const openIssues = computed(() => prs.value.filter(item => !['APPLIED', 'REJECTED'].includes(item.status)));
const closedIssues = computed(() => prs.value.filter(item => ['APPLIED', 'REJECTED'].includes(item.status)));
const filteredIssues = computed(() => (statusFilter.value === 'open' ? openIssues.value : statusFilter.value === 'closed' ? closedIssues.value : prs.value).filter(item =>
  [item.title, item.id, store.name(item.submitterNodeId), item.content].join(' ').toLowerCase().includes(query.value.trim().toLowerCase())));
const canCompose = computed(() => store.local && !!store.data?.room.requirementRevision && !!store.data?.stages.some(stage => stage.status !== "COMPLETED"));
const review = computed(() => store.flow?.kind === "review" ? store.flow : null);
const resolving = computed(() => review.value?.issues.some(issue => !issue.answer));
const canDecide = computed(() => store.canManage && review.value && ["DECIDING", "DRAFT", "READY", "FAILED"].includes(review.value.status));
const statusNames = CHANGE_STATUS_LABELS;
const currentPR = computed(() => prs.value.find(pr => pr.id === selected.value));
const legacyChange = computed(() => store.data?.coordination?.changes.find(change => change.id === selected.value));
const legacyPR = computed(() => store.data?.pullRequests.find(pr => pr.id === selected.value && pr.flow !== "agile"));
const selectedBatch = computed(() => [...(store.data?.agile?.flows ?? [])].reverse().find(flow => flow.kind === "review" && flow.changeSnapshot.some(change => change.id === selected.value) && flow.status !== "CANCELLED"));
const oldReview = computed(() => legacyPR.value && store.data?.reviews.find(review => review.id === legacyPR.value?.reviewId));
const canSelect = computed(() => store.canManage && store.batchReviewEnabled && !store.flow && !store.reviewStage?.reviewId);
const selectedPendingCount = computed(() => store.pendingPRs.filter(pr => selectedPRs.value.includes(pr.id)).length);
const markdown = computed(() => document.value?.content ?? currentPR.value?.content ?? "");
const selectedTitle = computed(() => currentPR.value?.source === "legacy_pr" ? document.value?.content.match(/^#\s+(.+)$/m)?.[1] ?? currentPR.value.title : currentPR.value?.title);
const cacheKey = "vibe-pr:" + store.data?.room.id + ":" + store.data?.viewer.id;
const selectionKey = cacheKey + ":selection";
try { const cached = localStorage.getItem(selectionKey); if (cached) { selectedPRs.value = JSON.parse(cached); selectionEdited.value = true; } } catch { /* default selection */ }
try { const raw = localStorage.getItem(cacheKey); if (raw) { const cached = JSON.parse(raw); title.value = cached.title ?? ""; content.value = cached.content ?? ""; baseRevision.value = cached.baseRevision ?? baseRevision.value; compose.value = !!(title.value || content.value); } } catch { /* fresh draft */ }
watch([title, content, baseRevision], () => { try { localStorage.setItem(cacheKey, JSON.stringify({ title: title.value, content: content.value, baseRevision: baseRevision.value })); } catch { /* keep draft in memory */ } });
watch(() => store.data?.room.requirementRevision, revision => { if (!title.value && !content.value) baseRevision.value = revision ?? 0; });
watch(prs, items => { if (!items.some(pr => pr.id === selected.value)) selected.value = ""; });
watch(() => route.query.change, id => { selected.value = typeof id === "string" && prs.value.some(pr => pr.id === id) ? id : ""; }, { immediate: true });
watch(() => route.query.new, value => { if (value === "1" && canCompose.value) compose.value = true; }, { immediate: true });
watch(() => store.pendingPRs, items => { if (!selectionEdited.value) selectedPRs.value = items.map(pr => pr.id); else selectedPRs.value = selectedPRs.value.filter(id => items.some(pr => pr.id === id)); }, { immediate: true });
watch(selectedPRs, ids => { if (selectionEdited.value) { try { localStorage.setItem(selectionKey, JSON.stringify(ids)); } catch { /* keep selection in memory */ } } }, { deep: true });
watch(() => review.value?.id, () => { decisionsDirty.value = false; });
watch(() => review.value?.decisions, values => { if (!decisionsDirty.value) decisions.value = JSON.parse(JSON.stringify(values ?? [])); }, { immediate: true });
let generation = 0;
watch(() => [selected.value, currentPR.value?.documentId] as const, async ([id]) => {
  const version = ++generation; document.value = null; readError.value = "";
  const pr = prs.value.find(pr => pr.id === id); if (!pr?.documentId) { reading.value = false; return; }
  reading.value = true;
  try { const result = await request<MarkdownDocument>("/api/v1/documents/" + pr.documentId); if (version === generation) document.value = result; }
  catch (e) { if (version === generation) readError.value = e instanceof Error ? e.message : String(e); }
  finally { if (version === generation) reading.value = false; }
}, { immediate: true });
async function submit() {
  if (!canCompose.value) return;
  const pr = await store.mutate<VibePullRequest | CoordinationChange>(store.agileEnabled ? "/api/v1/agile/pull-requests" : "/api/v1/changes", { title: title.value, content: content.value, expectedRequirementRevision: baseRevision.value }, store.agileEnabled ? "需求变更 Issue 已提交，等待队长统一审核" : "需求变更已提交，等待队长审核");
  if (pr) { title.value = ""; content.value = ""; compose.value = false; selected.value = pr.id; baseRevision.value = store.data?.room.requirementRevision ?? 0; await router.push({ path: '/issues', query: { change: pr.id } }); }
}
async function saveDecisions(): Promise<AgileFlow | null> {
  if (!review.value) return null;
  if (!decisionsDirty.value) return review.value;
  const saved = await store.mutate<AgileFlow>("/api/v1/agile/flows/" + review.value.id + "/decisions", { expectedRevision: review.value.revision, decisions: decisions.value });
  if (saved) { decisionsDirty.value = false; decisions.value = JSON.parse(JSON.stringify(saved.decisions)); }
  return saved;
}
async function generate() {
  const flow = await saveDecisions(); if (!flow) return;
  await store.mutate("/api/v1/agile/flows/" + flow.id + "/requirement", { expectedRevision: flow.revision });
}
async function beginReview() {
  if (!canSelect.value || !selectedPRs.value.length) return;
  const flow = await store.mutate("/api/v1/agile/reviews", { expectedRequirementRevision: store.data?.room.requirementRevision, changeIds: [...selectedPRs.value] }, "选中的 Issue 已进入同一审核批次，AI 正在联合分析");
  if (flow) { selectionEdited.value = false; try { localStorage.removeItem(selectionKey); } catch { /* best effort */ } }
}
function selectBatch(all: boolean) { selectionEdited.value = true; selectedPRs.value = all ? store.pendingPRs.map(pr => pr.id) : []; }
function openIssue(id: string) { void router.push({ path: '/issues', query: { ...(query.value ? { q: query.value } : {}), change: id } }); }
</script>
<template>
  <div class="view-title-line"><div><h1>Issues</h1><p>{{ store.batchReviewEnabled ? '提出需求变更，选择多个 Issue 统一分析和发布。' : '保留本房间的需求提案和审核记录。' }}</p></div><div class="button-row"><ActionMenu v-if="!currentPR" aria-label="更多 Issue 操作"><RouterLink :to="{ path: '/agents', query: { prompt: 'issues' } }" role="menuitem"><Icon name="agent" :size="16" />Codex 分析建议</RouterLink></ActionMenu><button v-if="store.local" class="btn" :class="{ primary: !compose }" :disabled="!canCompose" @click="compose = !compose"><Icon :name="compose ? 'close' : 'plus'" :size="16" />{{ compose ? '收起草稿' : 'New issue' }}</button></div></div>
  <p v-if="store.canManage && !store.batchReviewEnabled" class="inline-error">当前协作服务尚未加载批量审核功能。重新启动协作服务后刷新工作台，即可勾选多个 Issue；已有提案和任务保留。</p>
  <section v-if="compose" class="paper compose-paper"><header class="section-head"><div><span class="eyebrow">CHANGE PROPOSAL / 变更提案</span><h2>说明要改变什么，以及为什么。</h2></div><span class="tag">基于 R{{ baseRevision }}</span></header><label class="field">变更标题<input v-model="title" class="input" :disabled="!canCompose" placeholder="例如：首轮增加需求历史导出" maxlength="160" /></label><MarkdownEditor :model-value="content" :readonly="!canCompose" filename="change-proposal.md" :outline="false" compact @update:model-value="content = $event" @error="store.error = $event" />
    <div v-if="baseRevision !== store.data?.room.requirementRevision" class="inline-error">你编写期间正式需求已更新为 R{{ store.data?.room.requirementRevision }}。先核对新版，再更新提交基础。<button class="text-button" @click="baseRevision = store.data?.room.requirementRevision ?? 0">已核对，改为基于新版提交</button></div>
    <footer class="paper-footer"><span class="muted small-text">草稿保存在本机，提交后进入待审核队列；审核期间新增的变更留到下一批。</span><button class="btn primary" :disabled="!canCompose || store.busy || !title.trim() || !content.trim() || baseRevision !== store.data?.room.requirementRevision || (!store.agileEnabled && content.length > 16000)" @click="submit">{{ store.agileEnabled ? '提交需求变更 Issue' : '提交需求变更' }} <Icon name="arrow" /></button></footer>
  </section>
  <div v-if="review" class="review-area">
    <div v-if="store.canManage" class="review-tools"><ActionMenu aria-label="更多本批审核操作" :disabled="store.busy"><button type="button" role="menuitem" :disabled="store.busy" @click="store.mutate('/api/v1/agile/flows/' + review.id + '/cancel', { expectedRevision: review.revision })">取消审核，恢复原任务</button><button v-if="review.decisions.length" type="button" role="menuitem" class="danger" :disabled="store.busy" @click="store.mutate('/api/v1/agile/flows/' + review.id + '/reject', { expectedRevision: review.revision })">退回整批 Issue</button></ActionMenu></div>
    <FlowStatus :flow="review" hide-cancel /><PlanWizard :flow="review" />
    <section v-if="review.decisions.length" class="paper review-decisions"><header class="section-head"><div><span class="eyebrow">BATCH REVIEW / 本批审核</span><h2>{{ review.changeSnapshot.length }} 个 Issue，一次统一决定。</h2><p class="muted">{{ review.summary }}</p></div><span class="tag amber">{{ review.affectedTaskIds.length }} 项任务受影响</span></header>
      <div v-for="decision in decisions" :key="decision.changeId" class="verdict-row"><div><strong>{{ review.changeSnapshot.find(pr => pr.id === decision.changeId)?.document.content.match(/^#\s+(.+)$/m)?.[1] ?? decision.changeId }}</strong><small>{{ store.name(review.changeSnapshot.find(pr => pr.id === decision.changeId)?.submitterNodeId ?? '') }}</small></div><fieldset :disabled="!canDecide || store.busy" @change="decisionsDirty = true"><legend class="sr-only">Issue 裁决</legend><label><input v-model="decision.verdict" type="radio" :name="decision.changeId" value="accept" /> 采纳</label><label><input v-model="decision.verdict" type="radio" :name="decision.changeId" value="reject" /> 退回</label></fieldset><label class="verdict-reason"><span class="sr-only">裁决原因</span><input v-model="decision.rationale" class="input" :disabled="!canDecide || store.busy" placeholder="裁决原因" @input="decisionsDirty = true" /></label></div>
      <div v-if="review.affectedTaskIds.length" class="affected-list"><span class="eyebrow">影响范围</span><span v-for="id in review.affectedTaskIds" :key="id">{{ review.taskSnapshot.find(task => task.id === id)?.title }}{{ store.data?.tasks.find(task => task.id === id)?.status === 'DONE' ? ' · 需要后续修订' : ' · 暂停中' }}</span></div>
      <footer class="paper-footer"><span class="muted small-text">{{ resolving ? '请先处理上方冲突，再生成完整新版需求。' : '确认本批结论后生成新版需求草稿；编辑需求、预览分工后统一派发。' }}</span><div class="button-row"><RouterLink v-if="review.draftMarkdown && !decisionsDirty" to="/requirements" class="btn">查看需求草稿</RouterLink><button v-if="canDecide" class="btn primary" :disabled="store.busy || resolving" @click="generate">{{ decisions.every(d => d.verdict === 'reject') ? '确认全部退回' : review.draftMarkdown ? '确认审核并重新生成' : '确认审核并生成需求' }}<Icon name="arrow" /></button></div></footer>
    </section>
  </div>
  <div class="issues-workspace">
    <template v-if="!currentPR">
    <section class="paper issue-list-panel"><header class="issue-list-toolbar"><div class="issue-status-filters"><button :class="{ active: statusFilter === 'open' }" @click="statusFilter = 'open'"><Icon name="issue" :size="17" />{{ openIssues.length }} Open</button><button :class="{ active: statusFilter === 'closed' }" @click="statusFilter = 'closed'"><Icon name="check" :size="17" />{{ closedIssues.length }} Closed</button><button :class="{ active: statusFilter === 'all' }" @click="statusFilter = 'all'">全部</button></div><label v-if="canSelect && store.pendingPRs.length" class="inline-check issue-selection-tools"><input type="checkbox" :disabled="store.busy" :checked="selectedPendingCount === store.pendingPRs.length" :indeterminate="selectedPendingCount > 0 && selectedPendingCount < store.pendingPRs.length" @change="selectBatch(($event.target as HTMLInputElement).checked)" />全选待审 <span class="muted">已选 {{ selectedPendingCount }}</span></label></header>
      <article v-for="pr in filteredIssues" :key="pr.id" class="issue-list-row"><label v-if="canSelect && store.pendingPRs.some(item => item.id === pr.id)" class="issue-checkbox"><span class="sr-only">将 {{ pr.title }} 纳入审核批次</span><input v-model="selectedPRs" type="checkbox" :value="pr.id" :disabled="store.busy" @change="selectionEdited = true" /></label><Icon :name="['APPLIED', 'REJECTED'].includes(pr.status) ? 'check' : 'issue'" :size="21" class="issue-state-icon" :class="{ closed: ['APPLIED', 'REJECTED'].includes(pr.status) }" /><div><button class="issue-title" @click="openIssue(pr.id)">{{ pr.title }}</button><span class="tag" :class="{ mint: pr.status === 'APPLIED', amber: pr.status === 'IN_REVIEW' }">{{ statusNames[pr.status] }}</span><small>#{{ pr.id.slice(-6).toUpperCase() }} · {{ store.name(pr.submitterNodeId) }} 于 {{ new Date(pr.createdAt).toLocaleDateString('zh-CN') }} 提出 · 基于需求 R{{ pr.baseRequirementRevision }}{{ pr.source !== 'agile_pr' ? ' · 历史提案' : '' }}</small></div><Icon name="chevron" :size="15" /></article>
      <div v-if="!filteredIssues.length" class="empty-state large"><Icon name="issue" :size="35" /><h2>{{ prs.length ? '没有匹配的 Issues' : '还没有需求 Issues' }}</h2><p>{{ prs.length ? '切换 Open / Closed 或调整搜索条件。' : store.data?.room.requirementRevision ? '把需要改变的需求和理由写下来，再由队长统一审核。' : '首轮需求派发后，就可以提交需求变更。' }}</p></div>
      <footer v-if="store.canManage && store.batchReviewEnabled && store.pendingPRs.length" class="issue-batch-action"><p>{{ review ? '当前批次已冻结，其他 Issue 留到下一批。' : store.reviewStage?.reviewId ? '先完成或取消当前审核，再选择下一批。' : '选中的 ' + selectedPRs.length + ' 个 Issue 将联合分析，生成同一份需求与任务修订。' }}</p><button class="btn primary" :disabled="store.busy || !canSelect || !selectedPRs.length" @click="beginReview">统一审核 {{ selectedPRs.length }} 个 Issues <Icon name="arrow" :size="16" /></button></footer>
    </section></template>
    <template v-else><RouterLink :to="{ path: '/issues', query: query ? { q: query } : {} }" class="issue-back-link"><Icon name="arrow" :size="15" />返回 Issues</RouterLink><section class="paper pr-document">
      <header v-if="currentPR" class="document-header"><div><span class="eyebrow">CHANGE / {{ currentPR.id.slice(-6).toUpperCase() }}</span><h2>{{ selectedTitle || '变更内容' }}</h2><p>{{ store.name(currentPR.submitterNodeId) }} · 基于需求 R{{ currentPR.baseRequirementRevision }}{{ currentPR.decidedAt ? ' · ' + new Date(currentPR.decidedAt).toLocaleString('zh-CN') + ' 完成审核' : '' }}</p></div><span class="tag">{{ statusNames[currentPR.status] }}</span></header>
      <div v-if="reading" class="empty-state">正在读取变更说明…</div><p v-else-if="readError" class="inline-error">{{ readError }}</p>
      <MarkdownEditor v-else-if="currentPR" :key="currentPR.id" :model-value="markdown" readonly :outline="false" :filename="document?.filename ?? 'change.md'" @error="store.error = $event" />
      <div v-else class="empty-state large"><span class="empty-number">04</span><h3>让变化留下一份清楚的说明。</h3><p>选择左侧记录查看，或提出你的变更。</p></div>
      <section v-if="selectedBatch" class="legacy-pr-review"><span class="eyebrow">BATCH REVIEW / 统一审核</span><h3>纳入 {{ selectedBatch.changeSnapshot.length }} 个 Issue 的审核批次</h3><p class="muted small-text">{{ selectedBatch.summary || 'AI 正在分析本批 Issue 之间及其与现有需求、任务的冲突。' }}</p><p v-if="selectedBatch.id === review?.id" class="muted small-text">本 Issue 已纳入上方审核，裁决完成后统一生成需求、预览任务修订并派发。</p><RouterLink v-if="selectedBatch.status === 'PUBLISHED'" :to="{ path: '/requirements', query: { revision: selectedBatch.publishedRequirementRevision } }" class="text-button">已统一发布需求 R{{ selectedBatch.publishedRequirementRevision }} · 查看需求历史 <Icon name="arrow" :size="14" /></RouterLink></section>
      <p v-else-if="store.batchReviewEnabled && currentPR && ['PENDING', 'QUEUED'].includes(currentPR.status)" class="legacy-detail-note">{{ store.canManage ? '返回 Issues 列表，勾选要一起处理的变更，再统一审核。AI 将联合分析并生成一份修订。' : '等待队长选择审核批次；成员无需逐条确认或领取任务。' }}</p>
      <LegacyChangeReview v-if="legacyChange && (!store.batchReviewEnabled || ['APPLIED', 'REJECTED'].includes(legacyChange.status))" :key="legacyChange.id" :change="legacyChange" />
      <LegacyPullRequestReview v-else-if="legacyPR && !selectedBatch && (oldReview || !store.batchReviewEnabled)" :key="legacyPR.id" :pr="legacyPR" />
    </section></template>
  </div>
</template>
