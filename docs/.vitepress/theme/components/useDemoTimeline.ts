import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { beats, duration, sceneAt, scenes } from './demoScenario'
import type { useShowcaseMotion } from './useShowcaseMotion'

export function useDemoTimeline(motion: ReturnType<typeof useShowcaseMotion>) {
  const time = ref(0)
  const intent = ref<'auto' | 'play' | 'pause'>('auto')
  const running = computed(() => motion.available.value && (intent.value === 'play' || (intent.value === 'auto' && motion.desktop.value)))
  let timer: ReturnType<typeof setTimeout> | undefined
  let origin = 0
  let offset = 0
  let manualScene: number | undefined

  function clear() { clearTimeout(timer); timer = undefined }
  function clock() { return Math.min(duration, offset + performance.now() - origin) }

  function advance() {
    clear()
    if (!running.value) return
    let current = clock()
    if (current >= duration) {
      if (!motion.desktop.value) {
        time.value = duration
        intent.value = 'pause'
        return
      }
      offset = 0
      origin = performance.now()
      current = 0
    }
    time.value = current
    const next = beats.find(beat => beat.at > current)?.at ?? duration
    // A single deadline per change, rather than polling the animation every frame.
    timer = setTimeout(advance, Math.max(1, Math.ceil(next - current)))
  }

  watch(running, active => {
    if (active) {
      offset = time.value
      origin = performance.now()
      advance()
    } else {
      clear()
      time.value = clock()
    }
  }, { flush: 'sync' })

  watch([motion.reducedMotion, motion.desktop], ([reduced, desktop]) => {
    if (reduced) {
      intent.value = 'pause'
      manualScene = sceneAt(time.value)
      time.value = scenes[manualScene].poster
    } else if (intent.value === 'auto') {
      manualScene = desktop ? undefined : sceneAt(time.value)
      time.value = desktop ? 0 : scenes[manualScene!].poster
    }
  })

  function toggle() {
    if (motion.reducedMotion.value) return
    if (running.value) intent.value = 'pause'
    else {
      if (manualScene !== undefined) {
        time.value = scenes[manualScene].start
        manualScene = undefined
      } else if (time.value >= duration) time.value = 0
      intent.value = 'play'
    }
  }

  function seek(index: number) {
    intent.value = 'pause'
    manualScene = index
    time.value = scenes[index].poster
  }

  function replay() {
    intent.value = 'pause'
    manualScene = undefined
    time.value = motion.reducedMotion.value ? scenes[0].poster : 0
    if (!motion.reducedMotion.value) intent.value = 'play'
  }

  onBeforeUnmount(clear)
  return { time, running, toggle, seek, replay }
}
