<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AgileFlow } from "@vibe-git/protocol";
import { useWorkspace } from "../store";
import Icon from "./Icon.vue";
const props = defineProps<{ flow: AgileFlow }>(), store = useWorkspace();
const issue = computed(() => props.flow.issues.find(item => !item.answer));
const answered = computed(() => props.flow.issues.filter(item => item.answer).length);
const selected = ref(""), custom = ref("");
watch(() => issue.value?.id, () => { selected.value = ""; custom.value = ""; });
function source(id: string) {
  const plan = props.flow.planSnapshot.find(doc => doc.id === id);
  if (plan) return store.name(plan.ownerNodeId) + " · " + plan.filename;
  const pr = props.flow.changeSnapshot.find(pr => pr.id === id || pr.document.id === id);
  if (pr) return store.name(pr.submitterNodeId) + " · 变更 Issue";
  const task = props.flow.taskSnapshot.find(task => task.id === id);
  return task?.title ?? id;
}
async function answer() {
  if (!issue.value) return;
  await store.mutate("/api/v1/agile/flows/" + props.flow.id + "/answer", {
    expectedRevision: props.flow.revision, issueId: issue.value.id,
    answer: selected.value === "custom" ? { kind: "custom", text: custom.value } : { kind: "option", optionId: selected.value.slice(7) }
  });
}
</script>
<template>
  <section v-if="issue && flow.status === 'DECIDING'" class="wizard paper">
    <header class="section-head"><span class="eyebrow">PLAN MODE / 冲突裁决</span><span class="muted small-text">已处理 {{ answered }} / {{ flow.issues.length }}</span></header>
    <h2>{{ issue.title }}</h2><p class="lead">{{ issue.reason }}</p>
    <div class="evidence-list"><blockquote v-for="(evidence, i) in issue.evidence" :key="i"><span>{{ source(evidence.sourceId) }}</span><p>{{ evidence.excerpt }}</p></blockquote></div>
    <fieldset :disabled="!store.canManage || store.busy"><legend class="sr-only">选择解决方案</legend>
      <label v-for="(option, i) in issue.options" :key="option.id" class="choice" :class="{ selected: selected === 'option:' + option.id }">
        <input v-model="selected" type="radio" :value="'option:' + option.id" :name="'issue-' + issue.id" /><span class="choice-letter">{{ ['A', 'B', 'C'][i] }}</span><span><strong>{{ option.label }}</strong><small>{{ option.impact }}</small></span><Icon v-if="selected === 'option:' + option.id" name="check" />
      </label>
      <label class="choice custom-choice" :class="{ selected: selected === 'custom' }"><input v-model="selected" type="radio" value="custom" :name="'issue-' + issue.id" /><span class="choice-letter">＋</span><span><strong>我有自己的方案</strong><small>写下你的决定，AI 会结合这条回答继续整合。</small></span></label>
      <textarea v-if="selected === 'custom'" v-model="custom" class="input custom-answer" rows="3" placeholder="说明希望如何处理这项冲突…" aria-label="自定义解决方案"></textarea>
    </fieldset>
    <footer class="wizard-footer"><span class="muted">{{ store.canManage ? '每次处理一项，必要时会继续追问。' : '队长正在统一裁决，你的原始计划会作为依据。' }}</span><button v-if="store.canManage" class="btn primary" :disabled="!selected || (selected === 'custom' && !custom.trim()) || store.busy" @click="answer">确认并继续 <Icon name="arrow" /></button></footer>
  </section>
  <details v-if="answered > 0" class="decision-history"><summary>已确认的 {{ answered }} 项裁决</summary><div v-for="item in flow.issues.filter(i => i.answer)" :key="item.id"><strong>{{ item.title }}</strong><p>{{ item.answer?.kind === 'custom' ? item.answer.text : item.options.find(option => item.answer?.kind === 'option' && option.id === item.answer.optionId)?.label }}</p></div></details>
</template>
