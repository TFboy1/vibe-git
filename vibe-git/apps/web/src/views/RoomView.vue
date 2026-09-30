<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { MarkdownDocument } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import MarkdownEditor from "../components/MarkdownEditor.vue";
import PlanWizard from "../components/PlanWizard.vue";
import FlowStatus from "../components/FlowStatus.vue";
import Icon from "../components/Icon.vue";
const store = useWorkspace(), selected = ref("mine"), value = ref(""), skip = ref<string[]>([]);
const route = useRoute();
watch(() => route.query.plan, id => { if (typeof id === "string") selected.value = id === store.data?.viewer.id ? "mine" : id; }, { immediate: true });
const current = computed(() => store.data?.plans.find(plan => plan.ownerNodeId === store.data?.viewer.id));
const missing = computed(() => store.data?.nodes.filter(node => !store.data?.plans.some(plan => plan.ownerNodeId === node.id)) ?? []);
const selectedPlan = computed(() => store.data?.plans.find(plan => plan.ownerNodeId === selected.value));
const initialFlow = computed(() => store.flow?.kind === "initial" ? store.flow : null);
const dirty = computed(() => value.value.trim() !== (current.value?.content ?? "").trim());
const canSubmit = computed(() => store.local);
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
</script>
<template>
  <div class="intro-line"><p>先把每个人的想法放在一起。<span>计划可以简短，但请写清目标、范围和验收。</span></p></div>
  <FlowStatus v-if="initialFlow" :flow="initialFlow" />
  <PlanWizard v-if="initialFlow" :flow="initialFlow" />
  <div v-if="initialFlow && ['DRAFT', 'READY'].includes(initialFlow.status)" class="next-action"><div><strong>{{ initialFlow.status === 'READY' ? '分工草稿已经准备好。' : '共同需求已经写成文档。' }}</strong><p>{{ initialFlow.status === 'READY' ? '审核负责人、目标和验收后即可派发。' : '队长可以直接编辑正文，确认后开始分工。' }}</p></div><RouterLink class="btn primary" :to="initialFlow.status === 'READY' ? '/projects' : '/requirements'">{{ initialFlow.status === 'READY' ? '查看分工' : '查看需求文档' }}<Icon name="arrow" /></RouterLink></div>
  <div class="room-grid">
    <section class="paper plans-paper">
      <header class="section-head"><div><span class="eyebrow">PERSONAL PLAN / 个人计划</span><h2>{{ selected === 'mine' ? store.data?.room.requirementRevision ? '你的个人计划' : '你的第一轮计划' : store.name(selected) + '的计划' }}</h2></div><button v-if="selected === 'mine' && canSubmit && !current && !value.trim()" class="btn small" @click="createPlan"><Icon name="plus" :size="15" />开始创建计划</button><span v-else-if="selected === 'mine'" class="tag" :class="{ mint: current && !dirty }">{{ current ? dirty ? '有未提交修改' : '已提交 · v' + current.revision : '待提交' }}</span></header>
      <div class="document-tabs"><button :class="{ active: selected === 'mine' }" @click="selected = 'mine'">我的计划</button><button v-for="plan in store.data?.plans.filter(p => p.ownerNodeId !== store.data?.viewer.id)" :key="plan.id" :class="{ active: selected === plan.ownerNodeId }" @click="selected = plan.ownerNodeId">{{ store.name(plan.ownerNodeId) }}</button></div>
      <MarkdownEditor v-if="selected === 'mine'" :model-value="value" :readonly="!canSubmit" filename="my-plan.md" :outline="false" @update:model-value="edit" @error="store.error = $event" />
      <MarkdownEditor v-else :key="selected" :model-value="selectedPlan?.content ?? ''" readonly :filename="selectedPlan?.filename ?? 'plan.md'" :outline="false" @error="store.error = $event" />
      <footer v-if="selected === 'mine'" class="paper-footer"><span class="muted small-text">{{ !canSubmit ? '请在自己的电脑运行 vibe-git open，再创建或提交计划。' : dirty ? '草稿保存在本机，提交后队友才能看到。' : current ? '计划已同步到房间。已发布需求的调整请提交需求变更。' : '支持直接编写或导入 Markdown。' }}</span><button v-if="canSubmit" class="btn primary" :disabled="store.busy || !value.trim() || (!!current && !dirty)" @click="submit">{{ current ? '更新计划' : '提交计划' }}<Icon name="arrow" /></button></footer>
    </section>
    <aside class="room-aside">
      <section class="team-panel"><header class="section-head"><span class="eyebrow">THE TEAM</span><span class="count">{{ store.data?.nodes.length }}</span></header><h2>一起开工的人</h2><div v-for="node in store.data?.nodes" :key="node.id" class="member-row"><span class="avatar" :class="{ captain: node.role === 'captain' }">{{ node.label.slice(0, 1).toUpperCase() }}</span><div><strong>{{ node.label }}<small>{{ node.role === 'captain' ? '队长' : node.id.slice(-4) }}</small></strong><span><i class="presence" :class="{ online: node.connected }"></i>{{ node.connected ? '在线' : '离线' }} · {{ store.data?.plans.some(plan => plan.ownerNodeId === node.id) ? '计划已提交' : '等待计划' }}</span><label v-if="store.canManage && !store.flow && !store.data?.room.requirementRevision && missing.some(n => n.id === node.id)" class="inline-check skip-label"><input v-model="skip" :value="node.id" type="checkbox" /> 本轮暂不参与</label></div><Icon v-if="store.data?.plans.some(plan => plan.ownerNodeId === node.id)" name="check" :size="15" /></div>
      </section>
      <section v-if="!store.data?.room.requirementRevision && !store.flow" class="round-action"><span class="eyebrow">NEXT UP</span><h3>{{ missing.filter(n => !skip.includes(n.id)).length ? '等想法到齐。' : '开始找出共同方向。' }}</h3><p>{{ missing.filter(n => !skip.includes(n.id)).length ? '收齐本轮参与者的计划后，队长启动整合。暂时不能参与的人可以明确跳过。' : 'AI 会整理所有计划，只为真实冲突提问，由队长统一确认。' }}</p><button v-if="store.canManage && store.data?.agile?.enabled" class="btn primary full-width" :disabled="store.busy || missing.some(n => !skip.includes(n.id)) || skip.length === store.data?.nodes.length" @click="store.mutate('/api/v1/agile/initial', { expectedRequirementRevision: 0, skipMissingNodeIds: skip })">整合本轮计划 <Icon name="arrow" /></button></section>
      <div v-if="store.flow?.kind === 'review'" class="round-action"><span class="eyebrow">REVIEW IN PROGRESS</span><h3>正在审核需求变更</h3><p>本轮个人计划已保留，修订将在需求变更页统一处理。</p><RouterLink to="/changes" class="text-button">查看审核 <Icon name="arrow" :size="14" /></RouterLink></div>
    </aside>
  </div>
</template>
