<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { AgileFlow, MarkdownDocument } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import MarkdownEditor from "../components/MarkdownEditor.vue";
import PlanWizard from "../components/PlanWizard.vue";
import FlowStatus from "../components/FlowStatus.vue";
import Icon from "../components/Icon.vue";
const store = useWorkspace(), selected = ref("mine"), value = ref(""), skip = ref<string[]>([]);
const route = useRoute(), router = useRouter();
watch(() => route.query.plan, id => { if (typeof id === "string") selected.value = id === store.data?.viewer.id ? "mine" : id; }, { immediate: true });
const current = computed(() => store.data?.plans.find(plan => plan.ownerNodeId === store.data?.viewer.id));
const members = computed(() => store.data?.nodes.filter(node => !node.revoked) ?? []);
const missing = computed(() => members.value.filter(node => !store.data?.plans.some(plan => plan.ownerNodeId === node.id)));
const skippedMissingNodeIds = computed(() => missing.value.filter(node => skip.value.includes(node.id)).map(node => node.id));
const waiting = computed(() => missing.value.filter(node => !skip.value.includes(node.id)));
const submittedCount = computed(() => members.value.length - missing.value.length);
const selectedPlan = computed(() => store.data?.plans.find(plan => plan.ownerNodeId === selected.value));
const initialFlow = computed(() => store.flow?.kind === "initial" ? store.flow : null);
const dirty = computed(() => value.value.trim() !== (current.value?.content ?? "").trim());
const canSubmit = computed(() => store.local);
const integrationBlocker = computed(() => {
  if (!store.canManage) return "请在队长电脑运行 vibe-git open，进入可操作的本机工作台。";
  if (store.flow) return "已有进行中的整合或审核，请先完成或取消本轮。";
  if (!store.data?.room.requirementRevision && !store.agileEnabled) return "历史房间的首轮计划请使用 vibe-git align start 启动对齐。";
  if (store.data?.room.requirementRevision && !store.data.agile?.planIntegrationEnabled) return "协作服务尚未加载新一轮计划整合功能，请重新启动新版服务后刷新工作台。";
  if (store.data?.room.requirementRevision && !store.reviewStage) return "当前没有可更新的需求阶段。";
  if (store.reviewStage?.reviewId || ['REVIEWING', 'AWAITING_APPLY'].includes(store.reviewStage?.status ?? '')) return "当前阶段已有审核，请先完成或取消。";
  if (!submittedCount.value) return "至少需要一份已提交的计划。";
  if (waiting.value.length) return "仍在等待 " + waiting.value.map(node => node.label).join("、") + "的计划；暂不参与的人可在团队列表中勾选跳过。";
  if (dirty.value && !skippedMissingNodeIds.value.includes(store.data?.viewer.id ?? "")) return "你的计划还有本机未提交的修改，请先提交或更新计划。";
  return "";
});
let initialized = false, lastRevision = 0;
const cacheKey = computed(() => "vibe-plan:" + store.data?.room.id + ":" + store.data?.viewer.id);
watch(current, plan => {
  if (!initialized) {
    let cached: string | null = null; try { cached = localStorage.getItem(cacheKey.value); } catch { /* private mode */ }
    value.value = cached ?? plan?.content ?? ""; initialized = true;
  } else if (!dirty.value && (plan?.revision ?? 0) !== lastRevision) value.value = plan?.content ?? "";
  lastRevision = plan?.revision ?? 0;
}, { immediate: true });
function edit(markdown: string) { value.value = markdown; try { localStorage.setItem(cacheKey.value, markdown); } catch { /* document still in memory */ } }
async function submit() {
  if (!canSubmit.value) return;
  const plan = current.value;
  const path = store.agileEnabled ? "/api/v1/agile/plan" : plan ? "/api/v1/plans/" + encodeURIComponent(plan.id) : "/api/v1/plans";
  const saved = await store.mutate<MarkdownDocument>(path, { expectedRevision: plan?.revision ?? 0, content: value.value, filename: plan?.filename ?? "plan.md" }, "你的计划已提交", store.agileEnabled || plan ? "PUT" : "POST");
  if (saved) { value.value = saved.content; lastRevision = saved.revision; try { localStorage.removeItem(cacheKey.value); } catch { /* no persistent cache */ } }
}
function createPlan() { edit("# 我的计划\n\n## 目标\n\n说明希望解决的问题。\n\n## 范围\n\n写下本轮要完成的内容。\n\n## 验收\n\n- 如何确认这轮工作完成？\n"); }
async function integrate() {
  if (store.busy || integrationBlocker.value) return;
  const flow = await store.mutate<AgileFlow>(store.data?.agile?.planIntegrationEnabled ? "/api/v1/agile/plan-integrations" : "/api/v1/agile/initial", {
    expectedRequirementRevision: store.data?.room.requirementRevision ?? 0, skipMissingNodeIds: skippedMissingNodeIds.value
  }, "本轮计划已进入整合，AI 正在分析共同需求与冲突");
  if (flow?.kind === "review") await router.push("/issues");
}
</script>
<template>
  <div class="intro-line"><p>先把每个人的想法放在一起。<span>计划可以简短，但请写清目标、范围和验收。</span></p></div>
  <section v-if="store.captain && !initialFlow" id="integrate-plans" class="next-action">
    <div><strong>{{ store.data?.room.requirementRevision ? '把本轮计划整合进团队需求' : '把每个人的计划整理成共同需求' }}</strong><p>{{ submittedCount }} / {{ members.length - skippedMissingNodeIds.length }} 份计划已提交{{ skippedMissingNodeIds.length ? ' · 本轮跳过 ' + skippedMissingNodeIds.length + ' 人' : '' }}。{{ store.data?.room.requirementRevision ? '基于当前 R' + store.data.room.requirementRevision + ' 联合审核，确认后生成新版需求草稿。' : 'AI 分析共同目标和冲突，由队长确认需求草稿。' }}</p><p v-if="integrationBlocker" id="plan-integration-reason" role="status">{{ integrationBlocker }}</p></div>
    <RouterLink v-if="store.flow?.kind === 'review'" to="/issues" class="btn primary">查看本轮审核 <Icon name="arrow" /></RouterLink>
    <button v-else class="btn primary" :disabled="store.busy || !!integrationBlocker" :aria-describedby="integrationBlocker ? 'plan-integration-reason' : undefined" @click="integrate">整合计划形成需求 <Icon name="arrow" /></button>
  </section>
  <FlowStatus v-if="initialFlow" :flow="initialFlow" />
  <PlanWizard v-if="initialFlow" :flow="initialFlow" />
  <div v-if="initialFlow && ['DRAFT', 'READY'].includes(initialFlow.status)" class="next-action"><div><strong>{{ initialFlow.status === 'READY' ? '分工草稿已经准备好。' : '共同需求已经写成文档。' }}</strong><p>{{ initialFlow.status === 'READY' ? '审核负责人、目标和验收后即可派发。' : '队长可以直接编辑正文，确认后开始分工。' }}</p></div><RouterLink class="btn primary" :to="initialFlow.status === 'READY' ? '/projects' : '/requirements'">{{ initialFlow.status === 'READY' ? '查看分工' : '查看需求文档' }}<Icon name="arrow" /></RouterLink></div>
  <div class="room-grid">
    <section class="paper plans-paper">
      <header class="section-head"><div><span class="eyebrow">PERSONAL PLAN / 个人计划</span><h2>{{ selected === 'mine' ? store.data?.room.requirementRevision ? '你的个人计划' : '你的第一轮计划' : store.name(selected) + '的计划' }}</h2></div><button v-if="selected === 'mine' && canSubmit && !current && !value.trim()" class="btn small" @click="createPlan"><Icon name="plus" :size="15" />开始创建计划</button><span v-else-if="selected === 'mine'" class="tag" :class="{ mint: current && !dirty }">{{ current ? dirty ? '有未提交修改' : '已提交 · v' + current.revision : '待提交' }}</span></header>
      <div class="document-tabs"><button :class="{ active: selected === 'mine' }" @click="selected = 'mine'">我的计划</button><button v-for="plan in store.data?.plans.filter(p => p.ownerNodeId !== store.data?.viewer.id)" :key="plan.id" :class="{ active: selected === plan.ownerNodeId }" @click="selected = plan.ownerNodeId">{{ store.name(plan.ownerNodeId) }}</button></div>
      <MarkdownEditor v-if="selected === 'mine'" :model-value="value" :readonly="!canSubmit" filename="my-plan.md" :outline="false" @update:model-value="edit" @error="store.error = $event" />
      <MarkdownEditor v-else :key="selected" :model-value="selectedPlan?.content ?? ''" readonly :filename="selectedPlan?.filename ?? 'plan.md'" :outline="false" @error="store.error = $event" />
      <footer v-if="selected === 'mine'" class="paper-footer"><span class="muted small-text">{{ !canSubmit ? '请在自己的电脑运行 vibe-git open，再创建或提交计划。' : dirty ? '草稿保存在本机，提交后队友才能看到。' : current ? '计划已同步到房间，收齐后由队长整合；单项调整也可提交需求变更。' : '支持直接编写或导入 Markdown。' }}</span><button v-if="canSubmit" class="btn primary" :disabled="store.busy || !value.trim() || (!!current && !dirty)" @click="submit">{{ current ? '更新计划' : '提交计划' }}<Icon name="arrow" /></button></footer>
    </section>
    <aside class="room-aside">
      <section class="team-panel"><header class="section-head"><span class="eyebrow">THE TEAM</span><span class="count">{{ members.length }}</span></header><h2>一起开工的人</h2><div v-for="node in members" :key="node.id" class="member-row"><span class="avatar" :class="{ captain: node.role === 'captain' }">{{ node.label.slice(0, 1).toUpperCase() }}</span><div><strong>{{ node.label }}<small>{{ node.role === 'captain' ? '队长' : node.id.slice(-4) }}</small></strong><span><i class="presence" :class="{ online: node.connected }"></i>{{ node.connected ? '在线' : '离线' }} · {{ store.data?.plans.some(plan => plan.ownerNodeId === node.id) ? '计划已提交' : '等待计划' }}</span><label v-if="store.canManage && !store.flow && missing.some(n => n.id === node.id)" class="inline-check skip-label"><input v-model="skip" :value="node.id" type="checkbox" /> 本轮暂不参与</label></div><Icon v-if="store.data?.plans.some(plan => plan.ownerNodeId === node.id)" name="check" :size="15" /></div>
      </section>
      <section v-if="!store.captain && !store.flow" class="round-action"><span class="eyebrow">NEXT UP</span><h3>由队长整合本轮计划</h3><p>已提交的计划会作为整合依据，需求草稿由队长统一确认。</p></section>
      <div v-if="store.flow?.kind === 'review'" class="round-action"><span class="eyebrow">REVIEW IN PROGRESS</span><h3>正在审核需求变更</h3><p>本轮个人计划已保留，修订将在需求变更页统一处理。</p><RouterLink to="/changes" class="text-button">查看审核 <Icon name="arrow" :size="14" /></RouterLink></div>
    </aside>
  </div>
</template>
