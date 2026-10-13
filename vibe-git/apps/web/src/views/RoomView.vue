<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkspace } from "../store";
import MarkdownEditor from "../components/MarkdownEditor.vue";
import FlowStatus from "../components/FlowStatus.vue";
import Icon from "../components/Icon.vue";
const store = useWorkspace(), selected = ref("mine");
const route = useRoute(), router = useRouter();
watch(() => route.query.plan, id => { if (typeof id === "string") selected.value = id === store.data?.viewer.id ? "mine" : id; }, { immediate: true });
const current = computed(() => store.ownPlan);
const members = computed(() => store.data?.nodes.filter(node => !node.revoked) ?? []);
const missing = computed(() => members.value.filter(node => !store.data?.plans.some(plan => plan.ownerNodeId === node.id)));
const submittedCount = computed(() => members.value.length - missing.value.length);
const selectedPlan = computed(() => store.data?.plans.find(plan => plan.ownerNodeId === selected.value));
const initialFlow = computed(() => store.flow?.kind === "initial" ? store.flow : null);
const canSubmit = computed(() => store.local);
async function integrate() {
  const flow = await store.startRequirement();
  if (flow) await router.push(flow.kind === "review" ? "/issues" : "/requirements");
}
</script>
<template>
  <div class="intro-line"><p>按需补充你的想法。<span>可以简述建议或导入已有计划；只负责执行的成员无需提交。</span></p><RouterLink to="/requirements" class="btn">查看团队需求 <Icon name="arrow" /></RouterLink></div>
  <section v-if="store.captain && !initialFlow" id="integrate-plans" class="next-action">
    <div><strong>{{ store.data?.room.requirementRevision ? '汇总本轮想法，修订团队需求' : '根据目标与已有想法生成需求' }}</strong><p>{{ submittedCount }} 份输入已提交，无需等待所有成员。{{ store.data?.room.requirementRevision ? '基于当前正式需求统一审核。' : 'AI 会追问关键缺口，并提供可比较的方案。' }}{{ store.planDraftDirty ? '开始时会先提交自己的本机草稿。' : '' }}</p><p v-if="store.integrationBlocker" id="plan-integration-reason" role="status">{{ store.integrationBlocker }} <RouterLink v-if="!store.computeAvailable && store.canManage" to="/settings#compute" class="text-button">配置协作算力</RouterLink></p></div>
    <RouterLink v-if="store.flow?.kind === 'review'" to="/issues" class="btn primary">查看本轮审核 <Icon name="arrow" /></RouterLink>
    <button v-else class="btn primary" :disabled="store.busy || !!store.integrationBlocker" :aria-describedby="store.integrationBlocker ? 'plan-integration-reason' : undefined" @click="integrate">{{ store.data?.room.requirementRevision ? '汇总本轮想法' : '生成需求' }} <Icon name="arrow" /></button>
  </section>
  <FlowStatus v-if="initialFlow" :flow="initialFlow" />
  <div v-if="initialFlow" class="next-action"><div><strong>{{ store.nextAction.title }}</strong><p>需求问答和正文编辑集中在需求页，已提交的输入会保留。</p></div><RouterLink class="btn primary" :to="initialFlow.status === 'READY' ? '/projects' : '/requirements'">{{ initialFlow.status === 'READY' ? '审核分工' : '继续需求流程' }}<Icon name="arrow" /></RouterLink></div>
  <div class="room-grid">
    <section class="paper plans-paper">
      <header class="section-head"><div><span class="eyebrow">可选输入</span><h2>{{ selected === 'mine' ? '我的目标与想法' : store.name(selected) + '的想法' }}</h2></div><span v-if="selected === 'mine'" class="tag" :class="{ mint: current && !store.planDraftDirty }">{{ store.planDraftDirty ? '有未提交修改' : current ? '已提交 · v' + current.revision : '可选提交' }}</span></header>
      <div class="document-tabs"><button :class="{ active: selected === 'mine' }" @click="selected = 'mine'">我的想法</button><button v-for="plan in store.data?.plans.filter(p => p.ownerNodeId !== store.data?.viewer.id)" :key="plan.id" :class="{ active: selected === plan.ownerNodeId }" @click="selected = plan.ownerNodeId">{{ store.name(plan.ownerNodeId) }}</button></div>
      <MarkdownEditor v-if="selected === 'mine'" :model-value="store.planDraft" :readonly="!canSubmit" filename="my-ideas.md" :outline="false" placeholder="写下你对目标、范围或实现方式的建议，也可以导入已有计划。" @update:model-value="store.editPlanDraft" @error="store.error = $event" />
      <MarkdownEditor v-else :key="selected" :model-value="selectedPlan?.content ?? ''" readonly :filename="selectedPlan?.filename ?? 'plan.md'" :outline="false" @error="store.error = $event" />
      <div v-if="selected === 'mine' && store.planDraftConflict" class="save-status"><span class="unsaved">已提交内容发生变化，请先导出本机草稿，再核对版本。</span><button class="text-button" @click="store.resetPlanDraft">恢复已提交内容</button></div>
      <footer v-if="selected === 'mine'" class="paper-footer"><span class="muted small-text">{{ !canSubmit ? '请在自己的电脑运行 vibe-git open，再提交想法。' : store.planDraftDirty ? '草稿保存在本机，提交后队友才能看到。' : current ? '想法已同步。若本轮分析已开始，后续更新留到下一轮。' : '无需填写完整规格，也可以直接等待任务。' }}</span><button v-if="canSubmit" class="btn primary" :disabled="store.busy || !store.planDraft.trim() || (!!current && !store.planDraftDirty) || store.planDraftConflict" @click="store.submitPlan">{{ current ? '更新想法' : '提交想法' }}<Icon name="arrow" /></button></footer>
    </section>
    <aside class="room-aside">
      <section class="team-panel"><header class="section-head"><span class="eyebrow">团队成员</span><span class="count">{{ members.length }}</span></header><h2>一起开工的人</h2><div v-for="node in members" :key="node.id" class="member-row"><span class="avatar" :class="{ captain: node.role === 'captain' }">{{ node.label.slice(0, 1).toUpperCase() }}</span><div><strong>{{ node.label }}<small>{{ node.role === 'captain' ? '队长' : node.id.slice(-4) }}</small></strong><span><i class="presence" :class="{ online: node.connected }"></i>{{ node.connected ? '在线' : '离线' }} · {{ store.data?.plans.some(plan => plan.ownerNodeId === node.id) ? '已补充想法' : '可直接接任务' }}</span></div><Icon v-if="store.data?.plans.some(plan => plan.ownerNodeId === node.id)" name="check" :size="15" /></div>
      </section>
      <section v-if="!store.captain && !store.flow" class="round-action"><span class="eyebrow">下一步</span><h3>由队长确认需求并派发</h3><p>提交想法是可选的。任务派发后，让现有开发 AI 调用 Skill 同步即可。</p></section>
      <div v-if="store.flow?.kind === 'review'" class="round-action"><span class="eyebrow">REVIEW IN PROGRESS</span><h3>正在审核需求变更</h3><p>本轮个人计划已保留，修订将在需求变更页统一处理。</p><RouterLink to="/changes" class="text-button">查看审核 <Icon name="arrow" :size="14" /></RouterLink></div>
    </aside>
  </div>
</template>
