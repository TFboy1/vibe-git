<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useWorkspace } from "../store";
import { useRepository } from "../repository";
import { relativeTime } from "../team";
import Icon from "../components/Icon.vue";
import ActionMenu from "../components/ActionMenu.vue";
const store = useWorkspace(), repository = useRepository(), route = useRoute();
const query = computed(() => typeof route.query.q === "string" ? route.query.q : "");
const branches = computed(() => (store.data?.nodes ?? []).filter(node => !node.revoked && node.git).filter(node =>
  [node.label, node.git?.branch, node.git?.headSha].join(" ").toLowerCase().includes(query.value.trim().toLowerCase())));
async function copyCommands(branch: string) {
  const quoted = "'" + branch.replace(/'/g, "''") + "'";
  try { await navigator.clipboard.writeText("git fetch --all\ngit log --oneline --decorate -10 " + quoted + "\ngit show --stat " + quoted); store.notice = "Git 检查命令已复制"; }
  catch { store.error = "无法访问剪贴板，请在终端运行 git fetch --all 和 git log 查看分支"; }
}
</script>
<template>
  <div class="view-title-line"><div><h1>Pull requests</h1><p>代码提交、比较、审查与合并使用 Git 仓库的原生流程。</p></div><div class="button-row"><ActionMenu aria-label="更多代码协作操作"><RouterLink :to="{ path: '/agents', query: { prompt: 'review' } }" role="menuitem"><Icon name="agent" :size="16" />Codex 审查建议</RouterLink></ActionMenu><a v-if="repository.compareUrl" :href="repository.compareUrl" target="_blank" rel="noopener noreferrer" class="btn primary"><Icon name="pull" :size="16" />New pull request <Icon name="external" :size="14" /></a></div></div>
  <section v-if="!repository.url" class="paper remote-connect"><Icon name="pull" :size="26" /><div><h2>打开团队的代码仓库</h2><p>在 Settings 配置 GitHub 或 GitLab 仓库地址，再打开真实代码 PR 页面。</p><RouterLink to="/settings#repository" class="btn primary">配置 Git 仓库 <Icon name="link" :size="15" /></RouterLink></div></section>
  <div v-else class="native-pr-banner"><Icon name="link" :size="18" /><span><strong>{{ repository.url.host + repository.url.pathname }}</strong><small>代码 PR 的状态、评论和合并结果由 Git 托管平台维护。</small></span><a :href="repository.pullUrl" target="_blank" rel="noopener noreferrer" class="btn">查看代码 {{ repository.gitlab ? 'Merge requests' : 'Pull requests' }} <Icon name="external" :size="14" /></a></div>
  <div class="native-pr-grid">
    <section class="paper branch-panel"><header class="list-toolbar"><div><Icon name="branch" :size="18" /><strong>已同步的成员分支</strong><span class="count">{{ branches.length }}</span></div></header>
      <article v-for="node in branches" :key="node.id" class="native-branch-row"><Icon name="branch" class="branch-icon" :size="22" /><div class="branch-details"><strong>{{ node.git!.branch }}</strong><p>{{ node.label }} <span class="muted">· {{ node.id.slice(-4) }} · {{ relativeTime(node.git!.observedAt) }}同步</span></p><small><code :title="node.git!.headSha">{{ node.git!.headSha.slice(0, 7) }}</code><span :class="{ 'dirty-git': node.git!.dirty }">{{ node.git!.dirty ? '工作区有未提交修改' : '工作区干净' }}</span></small></div><div class="branch-actions"><ActionMenu :aria-label="node.git!.branch + ' 的更多操作'"><button type="button" role="menuitem" @click="copyCommands(node.git!.branch)"><Icon name="copy" :size="14" />复制 Git 检查命令</button><RouterLink :to="{ path: '/agents', query: { prompt: 'review', node: node.id } }" role="menuitem"><Icon name="agent" :size="15" />Codex 审查建议</RouterLink></ActionMenu></div></article>
      <div v-if="!branches.length" class="empty-state"><Icon name="branch" :size="32" /><h3>暂无匹配的 Git 分支</h3><p>成员连接本机工作区后，分支与提交标识会同步到这里。</p></div>
    </section>
    <aside class="pull-sidebar"><section><h2>代码协作</h2><p>Skill 帮助提交本机 Git 改动，成员分支和提交标识同步到 Code。</p><ol class="native-git-steps"><li>提交本机改动并推送分支</li><li>在代码仓库创建 Pull request</li><li>审查 diff、解决冲突后合并</li></ol></section><section><h2>需求需要调整？</h2><p>用需求 Issue 说明变更，队长可以选择多个 Issue 统一审核。</p><RouterLink to="/issues" class="text-button"><Icon name="issue" :size="16" />前往需求 Issues</RouterLink></section></aside>
  </div>
</template>
