<script setup lang="ts">
import { computed } from "vue";
import type { VibePullRequest } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import MarkdownEditor from "./MarkdownEditor.vue";
import Icon from "./Icon.vue";
const props = defineProps<{ pr: VibePullRequest }>(), store = useWorkspace();
const stage = computed(() => store.data?.stages.find(stage => stage.id === props.pr.stageId));
const review = computed(() => store.data?.reviews.find(review => review.id === props.pr.reviewId));
const queued = computed(() => store.data?.pullRequests.filter(pr => pr.flow !== "agile" && pr.stageId === props.pr.stageId && pr.status === "QUEUED") ?? []);
const statuses = { QUEUED: "等待分析", RUNNING: "分析中", NEEDS_EVIDENCE: "读取原有流程依据", AWAITING_CAPTAIN: "等待队长确认", APPLIED: "已发布", REJECTED: "已退回", FAILED: "分析失败", CANCELLED: "已取消" };
const canStart = computed(() => store.canManage && props.pr.status === "QUEUED" && stage.value?.status === "ACTIVE" && !stage.value.reviewId);
const canApply = computed(() => store.canManage && review.value?.status === "AWAITING_CAPTAIN" && stage.value?.reviewId === review.value.id && stage.value.status === "AWAITING_APPLY");
const canCancel = computed(() => store.canManage && review.value && ["NEEDS_EVIDENCE", "QUEUED", "RUNNING"].includes(review.value.status));
</script>
<template>
  <section class="legacy-pr-review">
    <header class="section-head"><div><span class="eyebrow">BATCH REVIEW / 原有 PR 审核</span><h3>{{ review ? statuses[review.status] : '统一审核本阶段的待审 PR' }}</h3></div><span v-if="review" class="tag">{{ review.changeIds.length }} 个 PR</span></header>
    <template v-if="!review">
      <p class="muted small-text">{{ queued.length }} 个待审 PR 可纳入同一批次。原有房间保留现有审核流程，队长现在就可以启动审核。</p>
      <p v-if="!store.canManage" class="review-hint">请在队长本机运行 <code>vibe-git open</code>，进入工作台审核。</p>
      <p v-else-if="stage?.reviewId" class="review-hint">本阶段已有审核批次，当前待审 PR 留到下一批。</p>
      <p v-else-if="stage?.status !== 'ACTIVE'" class="review-hint">当前阶段尚不可启动审核，请先确认阶段状态。</p>
      <button v-if="canStart" class="btn primary" :disabled="store.busy" @click="store.mutate('/api/v1/reviews', { force: true }, '本阶段的待审 PR 已纳入统一审核')">开始审核 {{ queued.length }} 个 PR <Icon name="arrow" /></button>
    </template>
    <template v-else>
      <p v-if="review.error" class="inline-error" role="alert">{{ review.error }}</p>
      <p v-if="['NEEDS_EVIDENCE', 'QUEUED', 'RUNNING'].includes(review.status)" class="review-hint">审核尚未完成，完成后会出现“确认审核并发布”。原有流程需要相关节点同步依据。{{ review.pendingNodeIds?.length ? '等待节点：' + review.pendingNodeIds.map(id => store.name(id)).join('、') : '' }}</p>
      <MarkdownEditor v-if="review.summaryMarkdown" :model-value="review.summaryMarkdown" readonly :outline="false" compact filename="review-summary.md" @error="store.error = $event" />
      <div v-if="review.decisions.length" class="legacy-verdicts"><h4>本批结论</h4><article v-for="decision in review.decisions" :key="decision.changeId"><span class="tag" :class="{ mint: decision.verdict === 'accept' }">{{ decision.verdict === 'accept' ? '采纳' : '退回' }}</span><p>{{ decision.rationale }}</p><small class="muted">PR {{ decision.changeId.slice(-6).toUpperCase() }}</small></article></div>
      <details v-if="review.requirementPatchMarkdown" class="task-change-preview" open><summary>待发布的需求修订</summary><MarkdownEditor :model-value="review.requirementPatchMarkdown" readonly :outline="false" compact filename="requirement-patch.md" @error="store.error = $event" /></details>
      <div v-if="review.replacementTasks.length" class="legacy-verdicts"><h4>任务修订</h4><article v-for="(task, index) in review.replacementTasks" :key="index"><strong>{{ task.title }} · {{ store.name(task.assigneeNodeId) }}</strong><p>{{ task.goal }}</p><p class="muted small-text">{{ task.boundary }}</p><ul><li v-for="(item, i) in task.acceptance" :key="i">{{ item }}</li></ul></article></div>
      <p v-if="review.status === 'AWAITING_CAPTAIN' && !store.canManage" class="review-hint">分析已完成，等待队长在本机工作台确认发布。</p>
      <footer v-if="canApply || canCancel" class="paper-footer"><template v-if="canApply"><button class="text-button danger" :disabled="store.busy" @click="store.mutate('/api/v1/reviews/' + review.id + '/reject', {}, '本批 PR 已退回，暂停任务已恢复')">退回本批 PR</button><button class="btn primary" :disabled="store.busy" @click="store.mutate('/api/v1/reviews/' + review.id + '/apply', {}, '审核已确认，需求和任务修订已发布')">确认审核并发布 <Icon name="arrow" /></button></template><button v-else-if="canCancel" class="text-button danger" :disabled="store.busy" @click="store.mutate('/api/v1/reviews/' + review.id + '/cancel', {}, '审核已取消，PR 已返回待审队列')">取消本批审核</button></footer>
    </template>
  </section>
</template>
