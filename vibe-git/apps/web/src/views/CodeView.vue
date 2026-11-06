<script setup lang="ts">
import { computed } from "vue";
import { useWorkspace } from "../store";
import { taskNextStep, taskStatus } from "../team";
import Icon from "../components/Icon.vue";
const store = useWorkspace();
const blockers = computed(() => store.startup?.checks.filter(check => !check.ready && check.required) ?? []);
const tasks = computed(() => (store.captain ? (store.data?.tasks ?? []).filter(task => !task.archived && task.status !== "DONE") : store.myTasks)
  .slice().sort((a, b) => Number(["PAUSED", "BLOCKED", "FAILED"].includes(b.status)) - Number(["PAUSED", "BLOCKED", "FAILED"].includes(a.status))).slice(0, 3));
const nextPath = computed(() => store.nextAction.path === "/projects" && !store.flow && !store.data?.alignments.some(run => run.status === "READY" && !run.publishedStageId) ? "/execute" : store.nextAction.path);
</script>
<template>
  <div class="home-focus">
    <section class="paper workspace-overview" aria-label="当前行动">
      <div class="workspace-action">
        <div><span class="workspace-kicker">{{ store.captain ? '团队的下一步' : '我的下一步' }}</span><h1>{{ store.nextAction.title }}</h1><p>{{ store.nextAction.body }}</p></div>
        <RouterLink :to="nextPath" class="btn primary">{{ store.nextAction.label }} <Icon name="arrow" :size="16" /></RouterLink>
      </div>
      <div v-if="store.local && blockers.length" class="workspace-checks">
        <article v-for="check in blockers" :key="check.key" class="workspace-check required"><Icon name="issue" :size="18" /><div><strong>{{ check.label }}尚未就绪</strong><p>{{ check.detail }}</p></div><RouterLink :to="check.path" class="text-button">去处理 <Icon name="arrow" :size="14" /></RouterLink></article>
      </div>
    </section>
    <section v-if="tasks.length" class="paper home-tasks"><header class="section-head"><h2>{{ store.captain ? '需要关注的任务' : '我的待办' }}</h2><RouterLink to="/execute" class="text-button">查看全部 <Icon name="arrow" :size="14" /></RouterLink></header>
      <article v-for="task in tasks" :key="task.id"><div><RouterLink :to="{ path: '/execute', query: { task: task.id } }" class="work-title">{{ task.title }}</RouterLink><p>{{ taskNextStep(task, store.data?.tasks ?? [], store.name, store.data?.contracts ?? []) }}</p></div><span class="tag" :class="{ amber: ['PAUSED', 'BLOCKED', 'FAILED'].includes(task.status) }">{{ taskStatus[task.status] ?? task.status }}</span></article>
    </section>
    <p class="home-help">在 Codex 中说出目标，或说“继续我的任务”，也可以从上方步骤查看和处理。</p>
  </div>
</template>
