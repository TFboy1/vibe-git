import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

// Shared lifecycle for the homepage demos. Nothing runs while hidden or offscreen.
export function useShowcaseMotion(root: Ref<HTMLElement | undefined>) {
  const inView = ref(false)
  const foreground = ref(false)
  const reducedMotion = ref(true)
  const desktop = ref(false)
  let observer: IntersectionObserver | undefined
  let preference: MediaQueryList | undefined
  let pointer: MediaQueryList | undefined

  function sync() {
    foreground.value = !document.hidden
    reducedMotion.value = preference?.matches ?? true
    desktop.value = pointer?.matches ?? false
  }

  onMounted(() => {
    preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    pointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    sync()
    preference.addEventListener('change', sync)
    pointer.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(([entry]) => { inView.value = entry.isIntersecting }, { threshold: 0 })
      if (root.value) observer.observe(root.value)
    } else {
      inView.value = true
    }
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    preference?.removeEventListener('change', sync)
    pointer?.removeEventListener('change', sync)
    document.removeEventListener('visibilitychange', sync)
  })

  return { reducedMotion, desktop, available: computed(() => inView.value && foreground.value && !reducedMotion.value) }
}
