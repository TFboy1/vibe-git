<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { withBase } from 'vitepress'
import WorkbenchIcon from './WorkbenchIcon.vue'
import { beatAt, duration, members, options, sceneAt, scenes, tasks, taskState } from './demoScenario'
import { useShowcaseMotion } from './useShowcaseMotion'
import { useDemoTimeline } from './useDemoTimeline'

const root = ref<HTMLElement>(), screen = ref<HTMLElement>(), pointer = ref<HTMLElement>(), progress = ref<HTMLElement>()
const motion = useShowcaseMotion(root)
const { time, running, toggle, seek, replay } = useDemoTimeline(motion)
const sceneIndex = computed(() => sceneAt(time.value))
const scene = computed(() => scenes[sceneIndex.value])
const beat = computed(() => beatAt(time.value))
const currentView = computed(() => sceneIndex.value < 2 ? 'Code' : sceneIndex.value === 2 ? 'Wiki' : 'Projects')
const submitted = computed(() => time.value >= 4_000 ? 3 : time.value >= 3_400 ? 2 : time.value >= 2_500 ? 1 : 0)
const decisionReady = computed(() => time.value >= 6_800)
const chosen = computed(() => time.value >= 8_600)
const edited = computed(() => time.value >= 13_800)
const assigned = computed(() => time.value >= 20_200)
const saved = computed(() => time.value >= 21_700)
const published = computed(() => time.value >= 23_400)
const expandedTask = tasks[1]
const owner = (id: string) => members.find(member => member.id === id)!
const nav = [{ label: 'Code', icon: 'code' }, { label: 'Issues', icon: 'issue' }, { label: 'Pull requests', icon: 'pull' }, { label: 'Agents', icon: 'agent' }, { label: 'Projects', icon: 'project' }, { label: 'Wiki', icon: 'book' }, { label: 'Settings', icon: 'settings' }]
const columns = [{ key: 'todo', title: 'Todo', label: '待开始' }, { key: 'doing', title: 'In progress', label: '进行中' }, { key: 'blocked', title: 'Blocked', label: '暂停与阻塞' }, { key: 'done', title: 'Done', label: '已完成' }] as const
const taskColumn = (id: string) => columns.findIndex(column => column.key === taskState(id, time.value))
const taskRow = (id: string) => tasks.filter(task => taskState(task.id, time.value) === taskState(id, time.value)).findIndex(task => task.id === id) + 2
const columnCount = (key: string) => tasks.filter(task => taskState(task.id, time.value) === key).length
const finished = computed(() => tasks.filter(task => taskState(task.id, time.value) === 'done'))
const latestEvidence = computed(() => time.value >= 28_300 ? tasks[1] : time.value >= 27_200 ? tasks[2] : finished.value[0])
const labelFor = (id: string) => ({ todo: '待开始', doing: '进行中', blocked: '暂停与阻塞', done: '已完成' }[taskState(id, time.value)])
const summaryFor = (id: string) => taskState(id, time.value) === 'done' ? '验证通过，完成证据已同步。' : taskState(id, time.value) === 'doing' ? 'Agent 正在执行，进度已同步。' : id === 'contract' ? '先确认共享接口，再开始实现。' : '等待接口契约完成后开工。'
const pressed = (target: string) => running.value && beat.value.target === target && !!beat.value.click
let barAnimation: Animation | undefined, cursorAnimation: Animation | undefined
let disposed = false

function syncBar() {
  if (!barAnimation) return
  barAnimation.currentTime = time.value
  if (running.value) barAnimation.play()
  else barAnimation.pause()
}

async function movePointer() {
  await nextTick()
  if (disposed || !pointer.value || !screen.value) return
  const target = beat.value.target ? screen.value.querySelector<HTMLElement>(`[data-demo-target="${beat.value.target}"]`) : null
  if (!target) {
    pointer.value.style.opacity = '0'
    cursorAnimation?.cancel()
    return
  }
  const frame = screen.value.getBoundingClientRect(), rect = target.getBoundingClientRect()
  const from = getComputedStyle(pointer.value).transform
  const to = `translate3d(${rect.left - frame.left + rect.width * .62}px, ${rect.top - frame.top + rect.height * .56}px, 0)`
  cursorAnimation?.cancel()
  pointer.value.style.transform = to
  pointer.value.style.opacity = running.value ? '1' : '0'
  if (running.value && typeof pointer.value.animate === 'function') {
    cursorAnimation = pointer.value.animate([{ transform: from === 'none' ? to : from }, { transform: to }], { duration: 550, easing: 'cubic-bezier(.22,1,.36,1)' })
  }
}

watch([time, running], () => { syncBar() })
watch(beat, movePointer)
watch(running, active => {
  if (pointer.value) pointer.value.style.opacity = active && !!beat.value.target ? '1' : '0'
  if (!active) cursorAnimation?.pause()
  else void movePointer()
})

onMounted(() => {
  if (progress.value && typeof progress.value.animate === 'function') {
    barAnimation = progress.value.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration, fill: 'both' })
    barAnimation.pause()
    syncBar()
  }
  if (motion.reducedMotion.value) seek(0)
  window.addEventListener('resize', movePointer, { passive: true })
})
onBeforeUnmount(() => {
  disposed = true
  barAnimation?.cancel()
  cursorAnimation?.cancel()
  window.removeEventListener('resize', movePointer)
})
</script>

<template>
  <section id="workbench" ref="root" class="workbench-demo site-shell" :class="{ 'demo-running': running, 'demo-reduced': motion.reducedMotion.value }" aria-labelledby="demo-title">
    <div class="showcase-heading">
      <div><h2 id="demo-title">让团队的 Agent，一起开工。</h2><p>人确定方向，AI 协调与执行。</p></div>
      <a :href="withBase('/guide.html')">了解如何使用 <span aria-hidden="true">↗</span></a>
    </div>

    <div class="demo-frame">
      <div class="demo-player-bar">
        <span class="demo-mark"><i></i> 工作台演示 <span class="demo-sample">· 示例数据</span></span>
        <div class="demo-controls">
          <button v-if="!motion.reducedMotion.value" type="button" :aria-label="running ? '暂停工作台演示' : '播放工作台演示'" @click="toggle"><WorkbenchIcon :name="running ? 'pause' : 'play'" :size="15" />{{ running ? '暂停' : '播放' }}</button>
          <button type="button" aria-label="重播工作台演示" @click="replay"><WorkbenchIcon name="replay" :size="15" />重播</button>
          <span class="demo-length">30s</span>
        </div>
      </div>

      <div id="demo-screen" ref="screen" class="demo-screen" role="tabpanel" :aria-labelledby="'demo-tab-' + scene.id">
        <header class="demo-repository-header">
          <div class="demo-global-bar">
            <div class="demo-identity"><span class="demo-vg">vg<i></i></span><span class="demo-breadcrumb">team <span>/</span> <strong>todo-board</strong></span></div>
            <div v-if="currentView === 'Projects'" class="demo-search"><WorkbenchIcon name="search" :size="15" /><span>搜索任务</span><kbd>/</kbd></div>
            <div class="demo-tools"><WorkbenchIcon name="bell" :size="18" /><span class="demo-avatar captain">林</span></div>
          </div>
          <div class="demo-repository-nav" aria-label="演示中的仓库导航"><span v-for="entry in nav" :key="entry.label" :class="{ active: currentView === entry.label }"><WorkbenchIcon :name="entry.icon" :size="17" />{{ entry.label }}</span></div>
        </header>

        <div class="demo-main">
          <div class="demo-repository-title"><div><WorkbenchIcon name="book" :size="21" /><strong>todo-board</strong><span class="demo-tag">Team</span></div><div class="demo-repository-stats"><span><i class="demo-presence"></i>实时同步</span><span><WorkbenchIcon name="people" :size="14" />3 位成员</span><span>{{ published ? '需求 R1' : '首轮计划' }}</span></div></div>

          <Transition name="demo-page" mode="out-in">
            <div v-if="scene.id === 'plans'" key="plans" class="demo-view">
              <div class="demo-subnav"><span>成员工作</span><span class="active">个人计划</span></div>
              <div class="demo-plan-grid">
                <section class="demo-paper">
                  <header class="demo-paper-head"><div><small>PERSONAL PLAN / 个人计划</small><h3>你的第一轮计划</h3></div><span class="demo-tag" :class="{ green: submitted > 0 }">{{ submitted > 0 ? '已提交 · v1' : '待提交' }}</span></header>
                  <div class="demo-document-tabs"><span class="active">我的计划</span><span v-if="submitted >= 2">陈晨</span><span v-if="submitted >= 3">周宁</span></div>
                  <div data-demo-target="plan-editor" class="demo-document demo-plan-document"><h4>待办板 · 第一轮计划</h4><p>做一个团队共用的待办板，先把核心体验跑通。</p><h5>目标</h5><ul><li>新增待办，切换完成状态。</li><li>按全部、未完成和已完成筛选。</li><li :class="{ 'demo-edited-line': time >= 800 }">{{ time >= 800 ? '使用 Vue + FastAPI，先确认共享接口。' : '确认团队使用的界面与接口技术。' }}</li></ul><h5>验收</h5><p>新增和筛选可用；接口与前端使用同一份契约。</p></div>
                  <footer class="demo-paper-footer"><span>{{ submitted > 0 ? '计划已同步到房间。' : '草稿保存在本机，提交后队友才能看到。' }}</span><span data-demo-target="submit-plan" class="demo-btn primary" :class="{ pressed: pressed('submit-plan'), muted: submitted > 0 }">{{ submitted > 0 ? '更新计划' : '提交计划' }}<WorkbenchIcon name="arrow" :size="14" /></span></footer>
                </section>
                <aside class="demo-team-panel">
                  <small>THE TEAM</small><h3>一起开工的人</h3>
                  <div v-for="(member, index) in members" :key="member.id" class="demo-member"><span class="demo-avatar" :class="{ captain: member.role === '队长' }">{{ member.name[0] }}</span><div><strong>{{ member.name }} <small>{{ member.role }}</small></strong><span><i class="demo-presence"></i>在线 · {{ submitted > index ? '计划已提交' : '等待计划' }}</span></div><WorkbenchIcon v-if="submitted > index" name="check" :size="16" class="demo-check" /></div>
                  <div class="demo-round-action"><h4>{{ submitted === 3 ? '开始找出共同方向。' : '等想法到齐。' }}</h4><p>AI 整理所有计划，只为真实冲突提问，由队长统一确认。</p><span data-demo-target="integrate" class="demo-btn primary" :class="{ muted: submitted < 3, pressed: pressed('integrate') }">整合本轮计划 <WorkbenchIcon name="arrow" :size="14" /></span></div>
                </aside>
              </div>
            </div>

            <div v-else-if="scene.id === 'decision'" key="decision" class="demo-view">
              <div class="demo-subnav"><span>成员工作</span><span class="active">个人计划</span></div>
              <div v-if="!decisionReady" class="demo-analysis"><span class="demo-thinking"></span><h3>正在整合本轮计划…</h3><p>分析三份个人计划，查找目标与边界上的分歧。</p><span class="demo-analysis-source">林悦的计划 · 陈晨的计划 · 周宁的计划</span></div>
              <section v-else class="demo-paper demo-wizard"><header class="demo-paper-head"><small>PLAN MODE / 冲突裁决</small><span>已处理 {{ time >= 11_400 ? 1 : 0 }} / 1</span></header><div class="demo-wizard-body"><h3>第一版是否包含实时通知？</h3><p class="demo-muted">两份计划对首轮范围的理解不同，需要确定共同验收边界。</p><div class="demo-evidence"><blockquote><span>林悦的计划</span><p>先交付新增、完成与筛选，保持第一轮范围可控。</p></blockquote><blockquote><span>陈晨的计划</span><p>希望成员能实时收到队友新增的待办。</p></blockquote></div><div class="demo-choices"><div v-for="option in options" :key="option.letter" :data-demo-target="option.letter === 'B' ? 'choice-b' : undefined" class="demo-choice" :class="{ selected: option.letter === 'B' && chosen, pressed: option.letter === 'B' && pressed('choice-b') }"><i class="demo-radio"></i><b>{{ option.letter }}</b><div><strong>{{ option.title }}</strong><small>{{ option.impact }}</small></div><WorkbenchIcon v-if="option.letter === 'B' && chosen" name="check" :size="17" /></div><div class="demo-choice custom"><i class="demo-radio"></i><b>＋</b><div><strong>我有自己的方案</strong><small>写下你的决定，AI 会结合这条回答继续整合。</small></div></div></div></div><footer class="demo-paper-footer"><span>{{ time >= 11_400 ? '正在依据队长裁决生成需求草稿…' : '每次处理一项，必要时会继续追问。' }}</span><span data-demo-target="confirm-decision" class="demo-btn primary" :class="{ muted: !chosen, pressed: pressed('confirm-decision') }">确认并继续 <WorkbenchIcon name="arrow" :size="14" /></span></footer></section>
            </div>

            <div v-else-if="scene.id === 'requirement'" key="requirement" class="demo-view">
              <p class="demo-intro">一份所有人遵循的需求。<span> 队长直接修改正文，确认无误后生成分工。</span></p>
              <section class="demo-paper"><header class="demo-paper-head"><div><small>WORKING DRAFT / 需求草稿</small><h3>共同需求 · R1</h3><p>点击正文即可编辑，改动自动保存。</p></div><span class="demo-version-picker">当前需求草稿 <WorkbenchIcon name="chevron" :size="13" /></span></header><div class="demo-save-status"><span><i class="demo-presence" :class="{ saving: edited && time < 15_000 }"></i>{{ edited && time < 15_000 ? '保存中…' : '已保存 · 草稿 v' + (edited ? 2 : 1) }}</span><small>修改需求后，已有分工草稿需要重新生成。</small></div><div class="demo-document"><h4>团队待办板</h4><p>Vue 前端与 FastAPI 服务，围绕同一份接口契约协作。</p><h5>首轮范围</h5><ul><li>新增待办，查看列表与完成状态。</li><li>按状态筛选，首轮暂不包含实时通知。</li></ul><h5>验收要求</h5><p data-demo-target="acceptance" :class="{ 'demo-edited-line': edited }">{{ edited ? '新增后列表立即更新，切换状态后筛选结果保持一致。' : '新增与完成状态切换可以正常使用。' }}</p><p>接口字段符合共同契约，前后端分别提供验证证据。</p><h5>职责边界</h5><p>共享契约：林悦 · Vue 界面：陈晨 · FastAPI 接口：周宁</p></div><footer class="demo-paper-footer"><span>{{ time >= 17_400 ? 'AI 正在生成任务分工…' : '确认正文后生成分工，最后由队长统一派发任务。' }}</span><span data-demo-target="generate" class="demo-btn primary" :class="{ pressed: pressed('generate') }">生成分工 <WorkbenchIcon name="arrow" :size="14" /></span></footer></section>
            </div>

            <div v-else-if="scene.id === 'allocation'" key="allocation" class="demo-view">
              <div class="demo-project-heading"><h3>Projects</h3><span class="demo-muted">需求 R1 · {{ published ? '已派发' : '待发布分工草稿' }}</span></div>
              <section class="demo-paper demo-allocation"><header class="demo-paper-head"><div><small>TASK ALLOCATION / 任务分工</small><h3>确认负责人、目标与验收。</h3></div><span class="demo-tag">3 项任务</span></header><div class="demo-allocation-summary"><span>01</span><strong>{{ tasks[0].title }}</strong><small>林悦 · 1 项验收</small><WorkbenchIcon name="chevron" :size="14" /></div><div class="demo-allocation-summary expanded"><span>02</span><strong>{{ expandedTask.title }}</strong><small>{{ assigned ? '陈晨' : '林悦' }} · 1 项验收</small><WorkbenchIcon name="chevron" :size="14" /></div><div class="demo-allocation-fields"><div class="demo-form-grid"><div class="demo-field"><span>任务标题</span><div>{{ expandedTask.title }}</div></div><div class="demo-field"><span>负责人</span><div data-demo-target="owner" :class="{ 'demo-field-changed': assigned }">{{ assigned ? '陈晨 · Claude Code' : '林悦 · Codex' }}<WorkbenchIcon name="chevron" :size="13" /></div><div v-if="time >= 19_600 && time < 20_200" class="demo-owner-menu"><span>林悦 · Codex</span><span class="selected">陈晨 · Claude Code <WorkbenchIcon name="check" :size="14" /></span><span>周宁 · Cursor</span></div></div></div><div class="demo-form-grid"><div class="demo-field"><span>具体目标</span><div>{{ expandedTask.goal }}</div></div><div class="demo-field"><span>职责边界</span><div>{{ expandedTask.boundary }}</div></div></div><div class="demo-field"><span>验收要求</span><div>{{ expandedTask.acceptance }}</div></div><div class="demo-dependency"><WorkbenchIcon name="branch" :size="14" /><span>前置依赖：定义待办 API 契约</span><code>{{ expandedTask.path }}</code></div></div><div class="demo-allocation-summary"><span>03</span><strong>{{ tasks[2].title }}</strong><small>周宁 · 1 项验收</small><WorkbenchIcon name="chevron" :size="14" /></div><footer class="demo-paper-footer"><span>{{ published ? '需求 R1 与任务包 v1 已同时发布。' : assigned && !saved ? '负责人已调整，保存分工后统一派发。' : '需求 R1 与整批任务包同时发布。成员无需领取或确认。' }}</span><div class="demo-button-row"><span data-demo-target="save-allocation" class="demo-btn" :class="{ pressed: pressed('save-allocation'), muted: !assigned || saved }">保存调整</span><span data-demo-target="publish" class="demo-btn primary" :class="{ pressed: pressed('publish') }">派发任务包 <WorkbenchIcon name="arrow" :size="14" /></span></div></footer></section>
            </div>

            <div v-else key="execution" class="demo-view">
              <div class="demo-project-heading"><h3>Projects <span class="demo-project-subtitle">任务看板</span></h3><span class="demo-tag green">需求 R1 · 任务包 v1</span></div>
              <TransitionGroup tag="div" name="demo-task" class="demo-board-grid">
                <div v-for="(column, index) in columns" :key="'column-' + column.key" class="demo-board-column" :class="column.key" :style="{ gridColumn: index + 1, gridRow: '1 / 5' }"><header><i></i><strong>{{ column.title }}</strong><span>{{ columnCount(column.key) }}</span><small>{{ column.label }}</small></header><p v-if="!columnCount(column.key)">暂无任务</p></div>
                <article v-for="task in tasks" :key="task.id" class="demo-board-task" :class="taskState(task.id, time)" :style="{ gridColumn: taskColumn(task.id) + 1, gridRow: taskRow(task.id) }"><div class="demo-task-meta"><WorkbenchIcon name="issue" :size="12" />{{ task.code }}<span class="demo-mobile-state">{{ labelFor(task.id) }}</span></div><strong>{{ task.title }}</strong><p>{{ summaryFor(task.id) }}</p><div class="demo-task-tags"><span>{{ labelFor(task.id) }}</span><span>v1</span></div><footer><span class="demo-avatar tiny">{{ owner(task.owner).name[0] }}</span><span>{{ owner(task.owner).name }}</span><small>{{ owner(task.owner).agent }}</small><WorkbenchIcon v-if="task.dependencies.length" name="branch" :size="12" /></footer></article>
              </TransitionGroup>
              <div class="demo-report"><div><WorkbenchIcon :name="latestEvidence ? 'check' : 'code'" :size="16" /><strong>{{ latestEvidence ? '完成证据' : 'Skill 同步' }}</strong><span>v1 / R1</span></div><p v-if="latestEvidence">{{ latestEvidence.title }} · {{ latestEvidence.evidence }}</p><p v-else-if="time >= 25_500">Claude Code / Cursor：已读取任务包，提交 started 与 progress 汇报。</p><p v-else><code>vibe-git task inbox</code> · 各自的 Agent 读取任务包；依赖完成后开始开发。</p></div>
            </div>
          </Transition>
        </div>
        <div ref="pointer" class="demo-pointer" :class="{ clicking: running && beat.click }" aria-hidden="true"><svg width="24" height="30" viewBox="0 0 24 30"><path d="M3 2v23l6-6 5 10 4-2-5-10 8-1L3 2Z" fill="#1f2328" stroke="white" stroke-width="1.5" /></svg><span>{{ sceneIndex < 4 ? '队长' : 'Agent' }}</span></div>
      </div>

      <div class="demo-progress" aria-hidden="true"><div ref="progress" :style="{ transform: `scaleX(${time / duration})` }"></div></div>
      <div class="demo-scene-tabs" role="tablist" aria-label="选择工作台演示场景"><button v-for="(item, index) in scenes" :id="'demo-tab-' + item.id" :key="item.id" type="button" role="tab" aria-controls="demo-screen" :aria-selected="sceneIndex === index" :class="{ active: sceneIndex === index }" @click="seek(index)"><span>{{ String(index + 1).padStart(2, '0') }}</span>{{ item.label }}</button></div>
    </div>
    <p class="demo-caption">{{ scene.description }}</p>
  </section>
</template>

<style scoped>
.workbench-demo { padding-block: 58px 70px; }
.showcase-heading { display: flex; justify-content: space-between; align-items: end; gap: 24px; margin-bottom: 28px; }
.showcase-heading h2 { font-size: clamp(25px, 3vw, 34px); line-height: 1.4; letter-spacing: -.035em; font-weight: 500; }
.showcase-heading p { margin-top: 9px; color: var(--site-muted); font-size: 14px; }
.showcase-heading a { flex-shrink: 0; color: var(--site-mint); font-size: 13px; }
.showcase-heading a span { margin-left: 12px; }
.demo-frame { position: relative; padding: 0 12px; border: 1px solid rgba(193, 232, 220, .22); border-radius: 22px; background: linear-gradient(145deg, rgba(156, 218, 195, .09), rgba(20, 32, 37, .64) 50%); box-shadow: 0 0 65px rgba(124, 202, 169, .065), 0 32px 70px rgba(2, 9, 13, .32), inset 0 1px 0 rgba(225, 255, 241, .2); }
.demo-frame::before { content: ''; position: absolute; left: 13%; right: 13%; top: -1px; height: 1px; background: linear-gradient(90deg, transparent, #bddfd1, transparent); pointer-events: none; }
.demo-player-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 17px 9px; color: #becdc7; font-size: 12px; }
.demo-mark { display: inline-flex; gap: 9px; align-items: center; }
.demo-mark > i { width: 5px; height: 5px; border-radius: 50%; background: var(--site-mint); box-shadow: 0 0 12px #a4e5d366; }
.demo-sample { color: #849b90; }
.demo-controls { display: flex; align-items: center; gap: 17px; }
.demo-controls button { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer; }
.demo-controls button:hover { color: var(--site-mint); }
.demo-length { color: #839a8e; font: 11px var(--vp-font-family-mono); }
.demo-screen { --demo-ink: #1f2328; --demo-muted: #656d76; --demo-line: #d0d7de; --demo-subtle: #f6f8fa; --demo-green: #1f883d; color-scheme: light; position: relative; overflow: hidden; color: var(--demo-ink); background: #fff; border: 1px solid #cbd4d7; border-radius: 11px; font-size: 13px; line-height: 1.6; text-align: left; }
.demo-screen svg { flex-shrink: 0; }
.demo-repository-header { background: var(--demo-subtle); border-bottom: 1px solid var(--demo-line); }
.demo-global-bar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 15px 23px 12px; }
.demo-identity, .demo-tools { display: flex; align-items: center; gap: 13px; }
.demo-vg { position: relative; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--demo-ink); color: #fff; font-size: 17px; font-weight: 600; letter-spacing: -1px; }
.demo-vg i { position: absolute; right: 4px; bottom: 3px; width: 4px; height: 4px; background: #a4e5d3; border-radius: 50%; }
.demo-breadcrumb { font-size: 14px; }
.demo-breadcrumb > span { margin-inline: 9px; color: var(--demo-muted); }
.demo-search { display: flex; align-items: center; gap: 8px; width: 245px; padding: 5px 9px; margin-left: auto; border: 1px solid var(--demo-line); border-radius: 5px; color: var(--demo-muted); font-size: 11px; }
.demo-search kbd { margin-left: auto; border: 1px solid var(--demo-line); padding-inline: 4px; border-radius: 3px; }
.demo-repository-nav { display: flex; gap: 5px; padding-inline: 16px; overflow-x: auto; }
.demo-repository-nav > span { position: relative; display: flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 10px 10px 12px; font-size: 12px; white-space: nowrap; }
.demo-repository-nav > span svg { color: var(--demo-muted); }
.demo-repository-nav > span.active { font-weight: 600; }
.demo-repository-nav > span.active::after { content: ''; position: absolute; bottom: 0; left: 5px; right: 5px; height: 2px; background: #fd8c73; }
.demo-main { padding: 0 26px 25px; }
.demo-repository-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-block: 19px; margin-bottom: 18px; border-bottom: 1px solid var(--demo-line); }
.demo-repository-title > div { display: flex; align-items: center; gap: 9px; }
.demo-repository-title strong { font-size: 22px; font-weight: 600; letter-spacing: -.4px; }
.demo-repository-stats { color: var(--demo-muted); font-size: 11px; }
.demo-repository-stats > span { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.demo-tag { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 20px; border: 1px solid var(--demo-line); font-size: 10px; font-weight: 500; white-space: nowrap; color: var(--demo-muted); }
.demo-tag.green { background: #dafbe1; border-color: #aceebb; color: #116329; }
.demo-view { min-height: 520px; }
.demo-subnav { display: flex; gap: 18px; border-bottom: 1px solid var(--demo-line); margin-bottom: 18px; }
.demo-subnav span { padding-bottom: 10px; color: var(--demo-muted); font-size: 12px; }
.demo-subnav .active { color: var(--demo-ink); border-bottom: 2px solid #fd8c73; font-weight: 600; }
.demo-plan-grid { display: grid; grid-template-columns: minmax(0, 1fr) 252px; gap: 26px; }
.demo-paper { border: 1px solid var(--demo-line); border-radius: 6px; background: #fff; overflow: hidden; }
.demo-paper-head { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 17px 22px; border-bottom: 1px solid var(--demo-line); }
.demo-paper-head small, .demo-team-panel > small { color: var(--demo-muted); font: 9px/1.8 var(--vp-font-family-mono); letter-spacing: .7px; }
.demo-paper-head h3 { font-size: 19px; font-weight: 600; letter-spacing: -.3px; margin-top: 3px; }
.demo-paper-head p { color: var(--demo-muted); font-size: 11px; margin-top: 3px; }
.demo-paper-head > span:not(.demo-tag) { color: var(--demo-muted); font-size: 11px; }
.demo-document-tabs { display: flex; gap: 22px; border-bottom: 1px solid var(--demo-line); padding: 9px 22px; color: var(--demo-muted); font-size: 12px; }
.demo-document-tabs .active { font-weight: 600; color: var(--demo-ink); }
.demo-document { padding: 22px 26px; font-size: 13px; line-height: 1.85; }
.demo-document h4 { margin: 0 0 12px; font-size: 21px; font-weight: 600; border-bottom: 1px solid #d8dee4; padding-bottom: 8px; }
.demo-document h5 { margin: 16px 0 6px; font-size: 15px; font-weight: 600; }
.demo-document ul { margin: 4px 0; padding-left: 20px; }
.demo-document p + p { margin-top: 5px; }
.demo-edited-line { background: #dafbe1; box-shadow: 0 0 0 3px #dafbe1; border-radius: 2px; transition: background .3s ease; }
.demo-paper-footer { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 14px 20px; border-top: 1px solid var(--demo-line); background: #f6f8fa; }
.demo-paper-footer > span:not(.demo-btn) { font-size: 11px; color: var(--demo-muted); }
.demo-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; flex-shrink: 0; padding: 5px 11px; border: 1px solid #d0d7de; border-radius: 5px; color: var(--demo-ink); font-size: 12px; background: #f6f8fa; box-shadow: 0 1px 0 #1f23280a; transition: transform .2s ease, box-shadow .2s ease; }
.demo-btn.primary { background: var(--demo-green); color: #fff; border-color: #1f232826; }
.demo-btn.muted { opacity: .5; }
.demo-btn.pressed { transform: scale(.96); box-shadow: 0 0 0 4px #1f883d25; }
.demo-avatar { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: #e8edf4; color: #3b5070; font-size: 12px; font-weight: 600; flex-shrink: 0; }
.demo-avatar.captain { background: #ddf4ff; color: #0550ae; }
.demo-avatar.tiny { width: 19px; height: 19px; font-size: 9px; }
.demo-presence { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--demo-green); flex-shrink: 0; }
.demo-presence.saving { background: #bf8700; }
.demo-team-panel { padding-top: 6px; }
.demo-team-panel h3 { margin: 5px 0 15px; font-size: 18px; font-weight: 600; }
.demo-member { display: flex; align-items: center; gap: 10px; padding-block: 12px; border-bottom: 1px solid #eaeef2; }
.demo-member > div { flex: 1; }
.demo-member strong { display: block; font-size: 13px; font-weight: 600; }
.demo-member strong small { margin-left: 6px; color: var(--demo-muted); font-size: 10px; font-weight: 400; }
.demo-member div > span { display: flex; align-items: center; gap: 5px; color: var(--demo-muted); font-size: 11px; }
.demo-check { color: var(--demo-green); }
.demo-round-action { margin-top: 19px; padding: 15px; border: 1px solid var(--demo-line); border-radius: 6px; background: #f6f8fa; }
.demo-round-action h4 { margin: 0; font-size: 14px; font-weight: 600; }
.demo-round-action p { margin-block: 8px 13px; color: var(--demo-muted); font-size: 12px; }
.demo-round-action .demo-btn { width: 100%; }
.demo-muted { color: var(--demo-muted); }
.demo-analysis { display: flex; min-height: 430px; flex-direction: column; align-items: center; justify-content: center; gap: 13px; }
.demo-analysis h3 { font-size: 21px; }
.demo-analysis p { color: var(--demo-muted); }
.demo-thinking { width: 9px; height: 9px; border-radius: 50%; background: var(--demo-green); box-shadow: 0 0 0 7px #dafbe1; }
.demo-running .demo-thinking { animation: demo-think 1.2s ease-in-out infinite; }
.demo-analysis-source { color: var(--demo-muted); font-size: 11px; margin-top: 9px; }
.demo-wizard-body { padding: 19px 22px 16px; }
.demo-wizard-body h3 { font-size: 20px; font-weight: 600; margin-bottom: 5px; }
.demo-evidence { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-block: 15px; }
.demo-evidence blockquote { margin: 0; padding: 9px 13px; border-left: 2px solid #d0d7de; background: #f6f8fa; font-size: 12px; }
.demo-evidence blockquote > span { display: block; margin-bottom: 3px; color: var(--demo-muted); font-size: 10px; }
.demo-choices { display: grid; gap: 7px; }
.demo-choice { display: flex; align-items: center; gap: 12px; padding: 10px 13px; border: 1px solid var(--demo-line); border-radius: 6px; transition: background .2s ease, border-color .2s ease; }
.demo-choice b { font-size: 12px; color: var(--demo-muted); }
.demo-choice > div { flex: 1; }
.demo-choice strong { display: block; font-size: 12px; font-weight: 600; }
.demo-choice small { display: block; color: var(--demo-muted); font-size: 10px; margin-top: 2px; }
.demo-radio { width: 12px; height: 12px; border: 1px solid #8c959f; border-radius: 50%; flex-shrink: 0; }
.demo-choice.selected { border-color: #2da44e; background: #f0fff4; }
.demo-choice.selected .demo-radio { border: 4px solid #1f883d; }
.demo-choice.selected > svg { color: #1f883d; }
.demo-choice.pressed { box-shadow: 0 0 0 3px #1f883d15; }
.demo-choice.custom { background: #f6f8fa; }
.demo-intro { font-size: 13px; margin-bottom: 15px; }
.demo-intro span { color: var(--demo-muted); }
.demo-version-picker { display: flex; align-items: center; gap: 12px; padding: 6px 10px; border: 1px solid var(--demo-line); border-radius: 5px; font-size: 11px; white-space: nowrap; }
.demo-save-status { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 9px 22px; border-bottom: 1px solid #eaeef2; color: var(--demo-muted); font-size: 11px; }
.demo-save-status > span { display: flex; gap: 6px; align-items: center; }
.demo-save-status small { font-size: 10px; }
.demo-project-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.demo-project-heading h3 { font-size: 22px; font-weight: 600; }
.demo-project-heading > span { font-size: 11px; }
.demo-project-subtitle { margin-left: 12px; color: var(--demo-muted); font-size: 12px; font-weight: 400; }
.demo-allocation-summary { display: flex; gap: 12px; align-items: center; padding: 11px 22px; border-bottom: 1px solid #d8dee4; }
.demo-allocation-summary > span { color: var(--demo-muted); font: 10px var(--vp-font-family-mono); }
.demo-allocation-summary strong { flex: 1; font-size: 12px; font-weight: 600; }
.demo-allocation-summary small { color: var(--demo-muted); font-size: 10px; }
.demo-allocation-summary.expanded { background: #f6f8fa; }
.demo-allocation-summary.expanded > svg { transform: rotate(90deg); }
.demo-allocation-fields { padding: 13px 22px 15px; border-bottom: 1px solid #d8dee4; }
.demo-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 10px; }
.demo-field { position: relative; min-width: 0; }
.demo-field > span { display: block; font-size: 11px; font-weight: 600; margin-bottom: 5px; }
.demo-field > div:not(.demo-owner-menu) { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; padding: 6px 10px; border: 1px solid var(--demo-line); border-radius: 5px; background: #fff; font-size: 12px; line-height: 1.7; }
.demo-field > div.demo-field-changed { border-color: #2da44e; box-shadow: 0 0 0 2px #dafbe1; }
.demo-owner-menu { position: absolute; z-index: 2; left: 0; right: 0; top: 100%; padding: 5px; border: 1px solid #d0d7de; border-radius: 5px; background: white; box-shadow: 0 8px 24px #1f232824; }
.demo-owner-menu > span { display: flex; justify-content: space-between; padding: 5px 9px; font-size: 12px; border-radius: 3px; }
.demo-owner-menu > span.selected { background: #ddf4ff; color: #0550ae; }
.demo-dependency { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--demo-muted); font-size: 10px; margin-top: 10px; }
.demo-dependency code { margin-left: auto; padding: 1px 5px; border-radius: 3px; background: #f6f8fa; font-size: 10px; }
.demo-button-row { display: flex; gap: 8px; }
.demo-board-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-template-rows: 39px repeat(3, 133px); gap: 9px 12px; position: relative; }
.demo-board-column { border: 1px solid var(--demo-line); background: #f6f8fa; border-radius: 7px; position: relative; }
.demo-board-column header { display: flex; align-items: center; gap: 5px; padding: 12px 10px 7px; font-size: 11px; }
.demo-board-column header > i { width: 8px; height: 8px; border-radius: 50%; border: 2px solid #6e7781; }
.demo-board-column.doing header > i { border-color: #bf8700; background: #fff8c5; }
.demo-board-column.done header > i { border-color: #1f883d; background: #dafbe1; }
.demo-board-column.blocked header > i { border-color: #cf222e; }
.demo-board-column header > strong { font-weight: 600; }
.demo-board-column header > span { padding: 0 5px; border-radius: 10px; font-size: 10px; background: #afb8c133; }
.demo-board-column header > small { margin-left: auto; color: var(--demo-muted); font-size: 9px; }
.demo-board-column > p { padding: 32px 12px; text-align: center; color: #8c959f; font-size: 11px; }
.demo-board-task { z-index: 1; align-self: stretch; min-width: 0; margin-inline: 7px; padding: 9px 11px; display: flex; flex-direction: column; border: 1px solid var(--demo-line); border-radius: 6px; background: #fff; box-shadow: 0 1px 2px #1f232808; }
.demo-task-meta { display: flex; align-items: center; gap: 4px; font: 9px var(--vp-font-family-mono); color: var(--demo-muted); }
.demo-board-task > strong { font-size: 12px; line-height: 1.65; font-weight: 600; margin-top: 4px; color: #0969da; }
.demo-board-task > p { font-size: 10px; line-height: 1.7; margin-top: 3px; color: var(--demo-muted); }
.demo-task-tags { display: flex; gap: 5px; margin-top: auto; padding-top: 5px; }
.demo-task-tags > span { padding: 0 5px; border: 1px solid #d0d7de; border-radius: 10px; font-size: 9px; line-height: 15px; color: var(--demo-muted); background: #f6f8fa; }
.demo-board-task.done .demo-task-tags > span:first-child { border-color: #aceebb; color: #116329; background: #dafbe1; }
.demo-board-task footer { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 10px; }
.demo-board-task footer > small { margin-left: auto; color: var(--demo-muted); font-size: 9px; }
.demo-mobile-state { display: none; }
.demo-report { padding: 10px 13px; margin-top: 12px; border: 1px solid #aceebb; border-radius: 6px; background: #f0fff4; }
.demo-report > div { display: flex; align-items: center; gap: 7px; color: #116329; font-size: 11px; }
.demo-report > div > span { margin-left: auto; color: #656d76; font: 10px var(--vp-font-family-mono); }
.demo-report > p { margin-top: 4px; color: #3f5a47; font-size: 11px; }
.demo-report code { font-size: 10px; }
.demo-pointer { position: absolute; top: 0; left: 0; z-index: 3; opacity: 0; pointer-events: none; filter: drop-shadow(0 2px 2px #1f232822); }
.demo-pointer > span { position: absolute; left: 17px; top: 26px; padding: 1px 6px; border-radius: 4px; background: #1f2328; color: white; font-size: 9px; white-space: nowrap; }
.demo-pointer.clicking::before { position: absolute; left: -13px; top: -13px; content: ''; width: 30px; height: 30px; border: 2px solid #2da44e; border-radius: 50%; animation: demo-click .6s ease-out both; }
.demo-progress { height: 2px; margin-top: 11px; background: #afcdbc12; overflow: hidden; }
.demo-progress > div { height: 100%; background: #a4e5d3; transform-origin: left; }
.demo-scene-tabs { display: grid; grid-template-columns: repeat(5, 1fr); }
.demo-scene-tabs > button { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 17px 8px; font-size: 12px; color: #96aaa0; cursor: pointer; transition: color .2s ease, background .2s ease; }
.demo-scene-tabs > button > span { font: 10px var(--vp-font-family-mono); opacity: .6; }
.demo-scene-tabs > button:hover, .demo-scene-tabs > button.active { color: #d6eee2; background: #a4e5d305; }
.demo-caption { margin-top: 17px !important; text-align: center; color: #94aa9e; font-size: 12px; }
.demo-page-enter-active, .demo-page-leave-active { transition: opacity .18s ease, transform .18s ease; }
.demo-page-enter-from { opacity: 0; transform: translateY(6px); }
.demo-page-leave-to { opacity: 0; transform: translateY(-4px); }
.demo-task-move { transition: transform .75s cubic-bezier(.22,1,.36,1); }
.workbench-demo:not(.demo-running) .demo-task-move, .workbench-demo:not(.demo-running) .demo-page-enter-active, .workbench-demo:not(.demo-running) .demo-page-leave-active { transition: none; }
@keyframes demo-think { 50% { box-shadow: 0 0 0 13px #dafbe100; } }
@keyframes demo-click { from { opacity: .9; transform: scale(.4); } to { opacity: 0; transform: scale(1.8); } }
@media (max-width: 1100px) {
  .demo-plan-grid { grid-template-columns: minmax(0, 1fr) 220px; gap: 18px; }
  .demo-main { padding-inline: 20px; }
  .demo-board-column header > small { display: none; }
  .demo-board-grid { gap: 9px 8px; }
  .demo-board-task { margin-inline: 5px; padding-inline: 8px; }
  .demo-board-task footer > small { display: none; }
}
@media (max-width: 767px) {
  .workbench-demo { padding-block: 25px 44px; }
  .showcase-heading { align-items: start; flex-direction: column; gap: 13px; margin-bottom: 20px; }
  .showcase-heading h2 { font-size: 25px; }
  .showcase-heading p { font-size: 13px; }
  .showcase-heading a { font-size: 12px; }
  .demo-frame { padding-inline: 7px; border-radius: 15px; }
  .demo-player-bar { padding: 14px 4px; font-size: 11px; }
  .demo-mark { gap: 5px; }
  .demo-sample { font-size: 9px; }
  .demo-controls { gap: 10px; }
  .demo-controls button { font-size: 11px; }
  .demo-controls button svg { width: 13px; }
  .demo-length { display: none; }
  .demo-global-bar { padding: 12px; gap: 8px; }
  .demo-search { display: none; }
  .demo-identity { gap: 8px; }
  .demo-breadcrumb { font-size: 12px; }
  .demo-tools { gap: 10px; }
  .demo-repository-nav { padding-inline: 5px; gap: 0; }
  .demo-repository-nav > span { gap: 5px; padding: 9px 8px 11px; font-size: 12px; }
  .demo-main { padding: 0 12px 16px; }
  .demo-repository-title { flex-wrap: wrap; gap: 8px; padding-block: 15px; margin-bottom: 16px; }
  .demo-repository-title strong { font-size: 20px; }
  .demo-repository-stats { width: 100%; gap: 13px !important; font-size: 11px; }
  .demo-view { min-height: 0; }
  .demo-plan-grid { grid-template-columns: 1fr; gap: 19px; }
  .demo-paper-head { padding: 14px; gap: 9px; align-items: start; flex-wrap: wrap; }
  .demo-paper-head h3 { font-size: 18px; }
  .demo-paper-head small { font-size: 9px; }
  .demo-document-tabs { padding-inline: 14px; }
  .demo-document { padding: 19px 16px; font-size: 14px; }
  .demo-document h4 { font-size: 19px; }
  .demo-document h5 { font-size: 15px; }
  .demo-paper-footer { padding: 13px 14px; flex-wrap: wrap; gap: 11px; }
  .demo-paper-footer > span:not(.demo-btn) { font-size: 12px; }
  .demo-btn { font-size: 12px; }
  .demo-team-panel { padding-top: 0; }
  .demo-member { padding-block: 10px; }
  .demo-member strong { font-size: 14px; }
  .demo-member div > span { font-size: 12px; }
  .demo-round-action { margin-top: 15px; }
  .demo-round-action p { font-size: 13px; }
  .demo-analysis { min-height: 320px; text-align: center; padding-inline: 12px; }
  .demo-analysis h3 { font-size: 18px; }
  .demo-analysis p { font-size: 13px; }
  .demo-wizard-body { padding: 16px 14px; }
  .demo-wizard-body h3 { font-size: 19px; }
  .demo-evidence { grid-template-columns: 1fr; gap: 7px; }
  .demo-evidence blockquote { font-size: 13px; }
  .demo-choice { padding: 11px 9px; gap: 8px; }
  .demo-choice strong { font-size: 13px; }
  .demo-choice small { font-size: 11px; line-height: 1.7; }
  .demo-save-status { flex-wrap: wrap; gap: 6px; padding-inline: 14px; font-size: 12px; }
  .demo-save-status small { font-size: 11px; }
  .demo-version-picker { font-size: 12px; }
  .demo-project-heading { flex-wrap: wrap; }
  .demo-allocation-summary { padding-inline: 14px; gap: 8px; flex-wrap: wrap; }
  .demo-allocation-summary strong { font-size: 13px; }
  .demo-allocation-summary small { font-size: 10px; }
  .demo-allocation-fields { padding-inline: 14px; }
  .demo-form-grid { grid-template-columns: 1fr; gap: 10px; }
  .demo-field > span { font-size: 12px; }
  .demo-field > div:not(.demo-owner-menu) { font-size: 13px; }
  .demo-dependency { font-size: 11px; }
  .demo-dependency code { margin-left: 0; }
  .demo-board-grid { display: flex; flex-direction: column; gap: 11px; }
  .demo-board-column { display: none; }
  .demo-board-task { margin: 0; padding: 14px; background: #f6f8fa; }
  .demo-board-task > strong { font-size: 15px; }
  .demo-board-task > p { font-size: 13px; margin-top: 5px; }
  .demo-task-meta { font-size: 11px; }
  .demo-mobile-state { display: inline; margin-left: auto; font-family: var(--vp-font-family-base); font-size: 12px; }
  .demo-task-tags { padding-top: 8px; }
  .demo-task-tags > span { font-size: 11px; line-height: 19px; }
  .demo-board-task footer { font-size: 12px; margin-top: 9px; }
  .demo-board-task footer > small { display: inline; font-size: 11px; }
  .demo-report { padding: 12px; }
  .demo-report > div { font-size: 12px; }
  .demo-report > p { font-size: 12px; line-height: 1.8; }
  .demo-scene-tabs { display: flex; overflow-x: auto; scrollbar-width: thin; }
  .demo-scene-tabs > button { flex-shrink: 0; padding: 15px 12px; font-size: 12px; }
  .demo-caption { font-size: 12px; line-height: 1.8; padding-inline: 6px; }
}
@media (prefers-reduced-motion: reduce) {
  .workbench-demo *, .workbench-demo *::before { animation: none !important; transition: none !important; }
}
</style>
