<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { taskContentChanged } from "@vibe-git/protocol";
import type { ChangeImpact, CoordinationChange, TaskChangeContent, TaskRevisionDraft } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import { request } from "../api";
import Icon from "./Icon.vue";
import TaskChangeComparison from "./TaskChangeComparison.vue";

interface ReviewRow {
  taskId: string; revision: number; title: string; affected: "" | "yes" | "no";
  goal: string; boundary: string; acceptance: string; before: TaskChangeContent;
}
const props = defineProps<{ change: CoordinationChange }>();
const store = useWorkspace(), impact = ref<ChangeImpact | null>(null), loading = ref(false), error = ref(""), hint = ref("");
const checklist = ref<HTMLElement>(), attempted = ref(false), rows = ref<ReviewRow[]>([]);
const revising = ref(false);
let revisionController: AbortController | null = null;
const editable = computed(() => store.canManage && props.change.status === "PENDING");
const stale = computed(() => props.change.baseRequirementRevision !== store.data?.room.requirementRevision);
const formalVersion = computed(() => store.data?.requirementVersions.find(version => version.sourceId === (props.change.reviewId ?? props.change.id)));
const lines = (text: string) => text.split("\n").map(line => line.trim()).filter(Boolean);
const candidate = (row: ReviewRow): TaskChangeContent => ({ goal: row.goal.trim(), boundary: row.boundary.trim(), acceptance: lines(row.acceptance) });
const changed = (row: ReviewRow) => taskContentChanged(row.before, candidate(row));
function rowProblem(row: ReviewRow): string {
  if (!row.affected) return "请选择受影响或不受影响";
  if (row.affected === "no") return "";
  if (!row.goal.trim() || !row.boundary.trim() || !lines(row.acceptance).length) return "请填写修订后的目标、边界和至少一项验收";
  if (!changed(row)) return "尚无具体修订：点击 AI 生成此任务修订，或修改目标、边界、验收中的至少一项";
  if (lines(row.acceptance).length > 100 || lines(row.acceptance).some(line => line.length > 4000)) return "验收最多 100 项，每项不超过 4000 字符";
  return "";
}
const blockers = computed(() => {
  const result: string[] = [];
  if (!editable.value) result.push("请使用队长的本机工作台审核");
  if (stale.value) result.push("提案基于旧版需求，核对新版后需要重新提交");
  if (!impact.value) result.push("任务影响列表尚未读取成功，请重新读取");
  if (impact.value && (impact.value.requirementRevision !== store.data?.room.requirementRevision || impact.value.changeRevision !== props.change.revision)) result.push("审核依据已变化，请刷新任务版本后重新核对");
  if (rows.value.some(row => store.data?.tasks.find(task => task.id === row.taskId)?.revision !== row.revision)) result.push("任务版本已变化，请刷新任务版本；旧修订不会覆盖新版任务");
  if (store.data?.stages.find(stage => stage.id === props.change.stageId)?.status === "COMPLETED") result.push("原开发阶段已结束，不能继续应用此阶段的变更");
  if (store.data?.stages.find(stage => stage.id === props.change.stageId)?.reviewId) result.push("当前阶段正在批次审核，请先完成或取消该批审核");
  for (const row of rows.value) { const problem = rowProblem(row); if (problem) result.push(row.title + "：" + problem); }
  return result;
});
const confirmed = computed(() => rows.value.filter(row => !rowProblem(row)).length);
const cacheKey = "vibe-change-review:" + store.data?.room.id + ":" + store.data?.viewer.id + ":" + props.change.id;
let generation = 0;
onBeforeUnmount(() => { generation++; revisionController?.abort(); });
async function loadImpact() {
  const version = ++generation; loading.value = true; error.value = ""; hint.value = ""; attempted.value = false;
  try {
    await store.refresh();
    const result = await request<ChangeImpact>("/api/v1/changes/" + props.change.id + "/impact");
    if (version !== generation) return;
    let cached: { requirementRevision: number; rows: ReviewRow[] } | null = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null"); } catch { /* use server snapshot */ }
    const drafts = cached?.requirementRevision === result.requirementRevision && Array.isArray(cached.rows) ? cached.rows : [];
    let skipped = 0;
    rows.value = result.tasks.map(item => {
      const task = store.data?.tasks.find(task => task.id === item.taskId);
      const before = { goal: task?.goal ?? "", boundary: task?.boundary ?? "", acceptance: [...(task?.acceptance ?? [])] };
      const row: ReviewRow = { taskId: item.taskId, revision: item.revision, title: item.title, affected: "", ...before, acceptance: before.acceptance.join("\n"), before };
      const draft = drafts.find(draft => draft.taskId === item.taskId);
      if (draft && draft.revision === item.revision && ["", "yes", "no"].includes(draft.affected) && typeof draft.goal === "string" && typeof draft.boundary === "string" && typeof draft.acceptance === "string") {
        Object.assign(row, { affected: draft.affected, goal: draft.goal, boundary: draft.boundary, acceptance: draft.acceptance });
      } else if (draft) skipped++;
      return row;
    });
    impact.value = result;
    if (skipped) hint.value = "部分任务已更新，已读取最新内容，请重新确认这些任务的影响和修订。";
  } catch (e) { if (version === generation) { impact.value = null; error.value = e instanceof Error ? e.message : String(e); } }
  finally { if (version === generation) loading.value = false; }
}
watch([() => props.change.id, () => editable.value, () => stale.value], () => {
  if (editable.value && !stale.value) void loadImpact();
  else { generation++; loading.value = false; revisionController?.abort(); }
}, { immediate: true });
watch(rows, () => {
  if (!impact.value || loading.value || !editable.value) return;
  try { localStorage.setItem(cacheKey, JSON.stringify({ requirementRevision: impact.value.requirementRevision, rows: rows.value })); } catch { /* keep draft in memory */ }
}, { deep: true });
async function adoptSuggestions() {
  const suggestion = props.change.suggestion;
  if (suggestion?.status !== "READY" || !impact.value) return;
  if (impact.value.tasks.some(task => suggestion.taskRevisions[task.taskId] !== task.revision)) { error.value = "AI 建议依据的任务版本已变化，请重新分析。"; return; }
  error.value = ""; const incomplete: string[] = [];
  for (const row of rows.value) {
    const finding = suggestion.findings.find(finding => finding.taskId === row.taskId);
    if (finding?.impact === "affected") {
      row.affected = "yes";
      if (finding.update) { row.goal = finding.update.goal; row.boundary = finding.update.boundary; row.acceptance = finding.update.acceptance.join("\n"); }
      else if (!changed(row)) incomplete.push(row.taskId);
    } else if (finding?.impact === "unaffected") row.affected = "no";
  }
  if (incomplete.length) await generateRevisions(incomplete);
  else hint.value = "AI 建议已填入，请核对下面的任务及修订内容，再确认发布。";
}
async function generateRevisions(taskIds = rows.value.filter(row => row.affected === "yes" && !changed(row)).map(row => row.taskId)) {
  if (!editable.value || !impact.value || stale.value || revising.value || loading.value) return;
  if (!taskIds.length) { error.value = "当前受影响任务已有修订草稿，可以直接编辑和核对差异。"; return; }
  const version = ++generation;
  const input = { expectedRevision: impact.value.changeRevision, expectedRequirementRevision: impact.value.requirementRevision,
    taskIds, taskRevisions: Object.fromEntries(rows.value.filter(row => taskIds.includes(row.taskId)).map(row => [row.taskId, row.revision])) };
  revisionController = new AbortController(); revising.value = true; error.value = ""; hint.value = "正在根据需求变更生成具体任务修订，原任务与已有草稿保持保存。";
  try {
    const result = await request<TaskRevisionDraft>("/api/local/changes/" + props.change.id + "/revision-draft", input, "POST", { signal: revisionController.signal, timeoutMs: 310_000 });
    if (version !== generation) return;
    await store.refresh();
    if (version !== generation) return;
    if (result.changeRevision !== props.change.revision || result.requirementRevision !== store.data?.room.requirementRevision ||
      taskIds.some(id => result.taskRevisions[id] !== rows.value.find(row => row.taskId === id)?.revision || result.taskRevisions[id] !== store.data?.tasks.find(task => task.id === id)?.revision)) throw new Error("任务版本已变化，旧草稿不会覆盖新内容；请刷新后重新生成。" );
    for (const item of result.updates) {
      const row = rows.value.find(row => row.taskId === item.taskId);
      if (row && taskIds.includes(row.taskId)) { row.goal = item.update.goal; row.boundary = item.update.boundary; row.acceptance = item.update.acceptance.join("\n"); }
    }
    hint.value = "已生成 " + result.updates.length + " 项具体修订。请核对下方标红的差异，再确认发布。";
  } catch (e) { if (version === generation) { error.value = e instanceof Error ? e.message : String(e); hint.value = "生成失败，原任务和已有审核草稿保留，可重试或手动修改。"; } }
  finally { revising.value = false; revisionController = null; }
}
async function apply() {
  if (revising.value) return;
  attempted.value = true;
  if (blockers.value.length || !impact.value) { checklist.value?.focus(); return; }
  const result = await store.mutate<CoordinationChange>("/api/v1/changes/" + props.change.id + "/apply", {
    expectedRevision: impact.value.changeRevision, expectedRequirementRevision: impact.value.requirementRevision,
    decisions: rows.value.map(row => ({ taskId: row.taskId, expectedRevision: row.revision, affected: row.affected === "yes",
      ...(row.affected === "yes" ? { update: { goal: row.goal.trim(), boundary: row.boundary.trim(), acceptance: lines(row.acceptance) } } : {}) }))
  }, "需求变更已采纳，需求和受影响任务已更新");
  if (result) { try { localStorage.removeItem(cacheKey); } catch { /* best effort */ } }
}
</script>
<template>
  <div class="legacy-change-review">
    <p v-if="change.status !== 'PENDING'" class="muted small-text">{{ change.status === 'APPLIED' ? '已采纳' + (formalVersion ? '，对应正式需求 R' + formalVersion.revision : '') + '。发送时的通知作为历史事件保留。' : '本变更已退回，保留原始提案供参考。' }}</p>
    <div v-if="change.taskChanges?.length" class="change-snapshots"><h3>已发布的任务修订</h3><article v-for="snapshot in change.taskChanges" :key="snapshot.taskId"><strong>{{ snapshot.title }}</strong><TaskChangeComparison :before="snapshot.before" :after="snapshot.after" :before-revision="snapshot.beforeRevision" :after-revision="snapshot.afterRevision" :unchanged-reason="change.contractIds.length ? '本次修改了接口约定，任务的目标、边界和验收保持不变。' : undefined" /></article></div>
    <p v-if="change.status === 'PENDING' && !editable" class="legacy-detail-note">本变更等待队长审核。队长使用 <code>vibe-git open</code> 打开的本机工作台可以确认或退回。</p>
    <template v-if="editable">
      <header class="section-head"><div><span class="eyebrow">REVIEW / 原有流程审核</span><h3>确认影响 → 生成具体修订 → 核对并发布</h3><p class="muted small-text">AI 根据原任务和变更生成目标、边界与验收草稿，由队长核对真实差异后确认。</p></div><button class="btn small" :disabled="store.busy || stale || loading || revising || change.suggestion?.status === 'QUEUED'" @click="store.mutate('/api/v1/changes/' + change.id + '/suggest', { expectedRevision: change.revision })">{{ change.suggestion?.status === 'QUEUED' ? '分析中…' : 'AI 分析影响' }}<Icon name="arrow" :size="13" /></button></header>
      <p v-if="stale" class="inline-error">本提案基于 R{{ change.baseRequirementRevision }}，正式需求已更新为 R{{ store.data?.room.requirementRevision }}。保留此记录供参考，请核对新版后重新提交。</p>
      <p v-if="change.suggestion?.status === 'FAILED'" class="inline-error">{{ change.suggestion.error }}；原提案和任务保留，可以重试分析。</p>
      <div v-if="!stale" class="review-toolbar"><button v-if="change.suggestion?.status === 'READY'" class="btn small" :disabled="loading || store.busy || revising || !impact" @click="adoptSuggestions">{{ revising ? '生成修订中…' : '使用 AI 建议并生成修订' }} <Icon name="check" :size="13" /></button><button class="text-button" :disabled="loading || store.busy || revising" @click="loadImpact">{{ impact ? '刷新任务版本' : '重新读取任务' }}</button><span class="muted small-text">已核对 {{ confirmed }}/{{ rows.length }} 项任务</span></div>
      <p v-if="hint" class="review-hint" role="status">{{ hint }}</p><p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <div v-if="loading" class="muted small-text">读取任务影响列表…</div>
      <template v-if="!stale && !loading && impact">
        <article v-for="row in rows" :key="row.taskId" class="legacy-impact-row"><header><strong>{{ row.title }} · v{{ row.revision }}</strong><label><span class="sr-only">{{ row.title }}是否受影响</span><select v-model="row.affected" class="input" :disabled="revising"><option value="" disabled>请选择影响</option><option value="yes">受影响，需要修订</option><option value="no">已确认不受影响</option></select></label></header><p class="muted small-text">{{ change.suggestion?.findings.find(finding => finding.taskId === row.taskId)?.reason ?? impact.tasks.find(task => task.taskId === row.taskId)?.reasons.join('；') }}</p><div v-if="row.affected === 'yes'"><div class="review-toolbar"><button class="btn small" :disabled="store.busy || revising" @click="generateRevisions([row.taskId])">{{ revising ? '正在生成具体修订…' : changed(row) ? 'AI 重新生成此任务草稿' : 'AI 生成此任务修订' }} <Icon name="arrow" :size="13" /></button></div><label class="field">修订后的目标<textarea v-model="row.goal" class="input" :disabled="revising" maxlength="4000" rows="2"></textarea></label><label class="field">修订后的边界<textarea v-model="row.boundary" class="input" :disabled="revising" maxlength="4000" rows="2"></textarea></label><label class="field">修订后的验收（每行一项）<textarea v-model="row.acceptance" class="input" :disabled="revising" rows="3"></textarea></label><TaskChangeComparison :before="row.before" :after="changed(row) ? candidate(row) : null" :before-revision="row.revision" /></div><p v-if="rowProblem(row)" class="field-help" :class="{ 'inline-error': attempted }">{{ rowProblem(row) }}</p></article>
        <p v-if="!rows.length" class="muted small-text">本阶段没有需要确认的任务，可直接确认需求变更。</p>
      </template>
      <div ref="checklist" class="review-checklist" tabindex="-1" :class="{ invalid: attempted && blockers.length }" :role="attempted && blockers.length ? 'alert' : 'status'"><template v-if="blockers.length"><strong>确认前还需要完成 {{ blockers.length }} 项</strong><ul><li v-for="problem in blockers" :key="problem">{{ problem }}</li></ul></template><p v-else>任务影响与具体修订已齐全。确认后发布需求 R{{ (store.data?.room.requirementRevision ?? 0) + 1 }}。</p></div>
      <footer class="paper-footer"><button class="text-button danger" :disabled="store.busy || loading || revising" @click="store.mutate('/api/v1/changes/' + change.id + '/reject', { expectedRevision: change.revision }, '需求变更已退回')">退回此变更</button><button class="btn primary" :disabled="store.busy || loading || revising" @click="apply">确认采纳并发布 <Icon name="arrow" /></button></footer>
    </template>
  </div>
</template>
