<script setup lang="ts">
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import { useShowcaseMotion } from './useShowcaseMotion'
import WorkbenchIcon from './WorkbenchIcon.vue'

const root = ref<HTMLElement>()
const motion = useShowcaseMotion(root)
const paused = ref(false), hovered = ref(false), focused = ref(false)
const animated = computed(() => motion.desktop.value && !motion.reducedMotion.value)
const running = computed(() => animated.value && motion.available.value && !paused.value && !hovered.value && !focused.value)
const copies = computed(() => animated.value ? 2 : 1)

// Original homepage glyphs, without global SVG IDs or a separate icon dependency.
const agents = [
  { name: 'Codex', path: 'm24 5 13 7 6 12-6 12-13 7-13-7-6-12 6-12 13-7Zm0 9 9 5v10l-9 5-9-5V19l9-5Zm-13-2 4 7m22-7-4 7M11 36l4-7m22 7-4-7' },
  { name: 'Claude Code', path: 'M24 5v38M8 13l32 22M40 13 8 35M7 24h34M15 7l18 34M33 7 15 41' },
  { name: 'Cursor', path: 'M9 6v34l9-9 7 12 6-3-7-12 14-2L9 6Z' },
  { name: 'Trae', path: 'M8 10h32L24 39 8 10Zm4 0 12 17 12-17M24 27v12' },
  { name: 'OpenCode', path: 'M17 8c-6 0-6 5-6 9v3c0 3-2 4-5 4 3 0 5 1 5 4v3c0 4 0 9 6 9m14-32c6 0 6 5 6 9v3c0 3 2 4 5 4-3 0-5 1-5 4v3c0 4 0 9-6 9M21 29l6-10' },
  { name: 'Windsurf', path: 'M4 15c8-8 12 8 20 0s12 8 20 0M4 25c8-8 12 8 20 0s12 8 20 0M4 35c8-8 12 8 20 0s12 8 20 0' },
  { name: 'Cline', path: 'M35 13a17 17 0 1 0 0 22M33 9h7v7M33 32h7v7' },
  { name: 'WorkBuddy', path: 'M6 10h28v20H18l-8 7v-7H6V10Zm14 26h14l6 5V21h-6M13 17h14m-14 6h10' },
  { name: 'Coder', path: 'm17 14-10 10 10 10m14-20 10 10-10 10m-4-24-6 28' },
  { name: 'Antigravity', path: 'M24 4c2 12 8 18 20 20-12 2-18 8-20 20-2-12-8-18-20-20 12-2 18-8 20-20Z' },
]

function blur(event: FocusEvent) {
  focused.value = !!event.relatedTarget && !!root.value?.contains(event.relatedTarget as Node)
}
</script>

<template>
  <section id="agents" ref="root" class="agent-showcase" :class="{ 'is-animated': animated, 'is-static': !animated }" :style="{ '--agent-animation': running ? 'running' : 'paused' }" aria-labelledby="agents-title" @pointerenter="hovered = $event.pointerType === 'mouse'" @pointerleave="hovered = false" @focusin="focused = true" @focusout="blur">
    <div class="agent-heading site-shell"><div><h2 id="agents-title">带上你熟悉的 Agent。</h2><p>支持 Skill、读取工作区和执行终端命令，即可通过 CLI 接入。<a :href="withBase('/guide/intro.html')">兼容条件 ↗</a></p></div><button v-if="animated" type="button" class="agent-toggle" :aria-label="paused ? '播放 AI 工具蛇形滚动' : '暂停 AI 工具蛇形滚动'" :aria-pressed="paused" @click="paused = !paused"><WorkbenchIcon :name="paused ? 'play' : 'pause'" :size="14" />{{ paused ? '播放' : '暂停' }}</button></div>
    <div class="agent-marquee" tabindex="0" aria-label="AI 工具列表；触屏或减少动态效果时可横向滚动"><div class="agent-track"><ul v-for="copy in copies" :key="copy" class="agent-group" :aria-hidden="copy === 2 ? true : undefined"><li v-for="(agent, index) in agents" :key="agent.name" class="agent-node" :style="{ '--wave-delay': `${index * -.49}s`, '--glow-delay': `${index * -1.9}s` }"><span class="agent-glow" aria-hidden="true"></span><span class="agent-glyph"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="agent.path" /></svg></span><strong>{{ agent.name }}</strong></li></ul></div></div>
  </section>
</template>

<style scoped>
.agent-showcase { position: relative; padding-block: 24px 54px; }
.agent-heading { display: flex; justify-content: space-between; align-items: end; gap: 20px; }
.agent-heading h2 { font-size: clamp(24px, 3vw, 32px); line-height: 1.5; font-weight: 500; letter-spacing: -.035em; }
.agent-heading p { margin-top: 10px; color: var(--site-muted); font-size: 13px; line-height: 1.9; }
.agent-heading a { display: inline-block; margin-left: 14px; color: var(--site-mint); white-space: nowrap; }
.agent-toggle { display: inline-flex; align-items: center; gap: 5px; padding-block: 5px; color: #99aea2; font-size: 12px; flex-shrink: 0; cursor: pointer; }
.agent-toggle:hover { color: var(--site-mint); }
.agent-marquee { overflow: hidden; width: 100%; padding: 37px 0 30px; margin-top: 12px; mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent); }
.agent-track { display: flex; width: max-content; }
.agent-group { display: flex; gap: 22px; margin: 0; padding: 0 22px 0 0; list-style: none; }
.agent-node { position: relative; isolation: isolate; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 13px; flex: 0 0 152px; width: 152px; height: 152px; border: 1px solid rgba(193, 223, 211, .2); border-radius: 50%; background: radial-gradient(circle at 50% 30%, rgba(163, 219, 195, .11), rgba(16, 28, 33, .72) 70%); box-shadow: inset 0 1px 0 rgba(230, 255, 242, .08), inset 0 0 26px rgba(164, 229, 211, .03); }
.agent-node::before { content: ''; position: absolute; inset: 9px; border: 1px dashed rgba(193, 223, 211, .1); border-radius: 50%; pointer-events: none; }
.agent-glow { position: absolute; inset: -1px; z-index: -1; border: 1px solid rgba(179, 240, 208, .6); border-radius: 50%; background: radial-gradient(circle, rgba(164, 229, 211, .14), transparent 72%); box-shadow: 0 0 28px rgba(164, 229, 211, .18), inset 0 0 30px rgba(164, 229, 211, .06); opacity: 0; }
.agent-glyph { display: grid; place-items: center; width: 62px; height: 62px; border: 1px solid rgba(164, 229, 211, .37); border-radius: 50%; background: rgba(164, 229, 211, .06); color: var(--site-mint); box-shadow: 0 0 23px rgba(164, 229, 211, .1); }
.agent-glyph svg { width: 38px; height: 38px; }
.agent-node strong { color: #c1d2c8; font-size: 12px; font-weight: 500; }
.is-animated .agent-track { animation: agent-drift 42s linear infinite; animation-play-state: var(--agent-animation); }
.is-animated .agent-node { animation: agent-sway 4.9s ease-in-out infinite; animation-delay: var(--wave-delay); animation-play-state: var(--agent-animation); }
.is-animated .agent-glow { animation: agent-light 19s ease-in-out infinite; animation-delay: var(--glow-delay); animation-play-state: var(--agent-animation); }
.is-static .agent-marquee { overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; mask-image: none; padding-inline: max(20px, calc((100vw - 1220px) / 2)); }
@keyframes agent-drift { to { transform: translateX(-50%); } }
@keyframes agent-sway { 0%, 100% { transform: translateY(12px) rotate(-2deg); } 50% { transform: translateY(-12px) rotate(2deg); } }
@keyframes agent-light { 0%, 16%, 100% { opacity: 0; } 6%, 10% { opacity: 1; } }
@media (max-width: 767px) {
  .agent-showcase { padding-block: 24px 35px; }
  .agent-heading { align-items: start; gap: 12px; }
  .agent-heading h2 { font-size: 24px; }
  .agent-heading p { font-size: 12px; }
  .agent-heading a { margin-left: 8px; }
  .agent-marquee { margin-top: 6px; padding-block: 27px 25px; }
  .agent-node { width: 130px; height: 130px; flex-basis: 130px; gap: 10px; }
  .agent-group { gap: 17px; padding-right: 17px; }
  .agent-glyph { width: 54px; height: 54px; }
  .agent-glyph svg { width: 33px; height: 33px; }
  .agent-node strong { font-size: 12px; }
  .agent-toggle { font-size: 11px; }
}
@media (prefers-reduced-motion: reduce) {
  .agent-showcase *, .agent-showcase *::before { animation: none !important; transition: none !important; }
}
</style>
