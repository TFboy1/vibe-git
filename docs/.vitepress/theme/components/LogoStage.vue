<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'

const root = ref<HTMLElement>()
const motion = ref(false), visible = ref(true), activePage = ref(true)
const x = ref(0), y = ref(0)
const enabled = computed(() => motion.value && visible.value && activePage.value)
const tilt = computed(() => ({ '--tilt-x': `${y.value * -4}deg`, '--tilt-y': `${x.value * 5}deg`, '--light-x': `${50 + x.value * 22}%`, '--light-y': `${50 + y.value * 22}%` }))
let media: MediaQueryList | undefined, observer: IntersectionObserver | undefined
let frame = 0, pending = { x: 0, y: 0 }
function reset() { cancelAnimationFrame(frame); frame = 0; x.value = 0; y.value = 0 }
function sync() {
  motion.value = media?.matches ?? false
  activePage.value = !document.hidden
  if (!enabled.value) reset()
}
function move(event: PointerEvent) {
  if (!enabled.value || event.pointerType !== 'mouse' || !root.value) return
  const rect = root.value.getBoundingClientRect()
  pending = { x: Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1)), y: Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1)) }
  if (!frame) frame = requestAnimationFrame(() => { x.value = pending.x; y.value = pending.y; frame = 0 })
}
onMounted(() => {
  media = window.matchMedia('(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)')
  sync()
  media.addEventListener('change', sync)
  document.addEventListener('visibilitychange', sync)
  observer = new IntersectionObserver(([entry]) => { visible.value = entry.isIntersecting; if (!enabled.value) reset() })
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => {
  reset()
  observer?.disconnect()
  media?.removeEventListener('change', sync)
  document.removeEventListener('visibilitychange', sync)
})
</script>

<template>
  <figure ref="root" class="logo-scene" :class="{ 'motion-enabled': enabled }" :style="tilt" @pointermove="move" @pointerleave="reset">
    <div class="scene-halo" aria-hidden="true"></div>
    <div class="scene-ring scene-ring-one" aria-hidden="true"></div><div class="scene-ring scene-ring-two" aria-hidden="true"></div>
    <div class="glass-sheet glass-sheet-back" aria-hidden="true"></div>
    <div class="glass-sheet glass-sheet-front">
      <span class="stage-label stage-label-top" aria-hidden="true"><i></i> ONE SHARED INTENT</span>
      <img class="cat-logo" :src="withBase('/assets/vibe-git-logo-vector.svg')" width="560" height="560" alt="Vibe-Git 猫头终端标志" fetchpriority="high" />
      <span class="stage-label stage-label-bottom" aria-hidden="true">ONE REPO <span>·</span> MANY AGENTS</span>
      <span class="glass-reflection" aria-hidden="true"></span><span class="edge-sweep" aria-hidden="true"></span>
    </div>
    <figcaption>让每一份想法，成为共同的方向。</figcaption>
  </figure>
</template>
