<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useRoute } from "vue-router";
import Icon from "./Icon.vue";

withDefaults(defineProps<{ label?: string; ariaLabel?: string; disabled?: boolean }>(), { label: "更多", disabled: false });
const route = useRoute(), root = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>(), menu = ref<HTMLElement>(), open = ref(false);
const menuId = "action-menu-" + useId();
const items = () => [...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled):not([aria-disabled="true"])') ?? [])];

function close(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) trigger.value?.focus();
}
async function show(last = false) {
  open.value = true;
  await nextTick();
  const available = items();
  (last ? available.at(-1) : available[0])?.focus();
}
function toggle() { if (open.value) close(true); else void show(); }
function triggerKeys(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault(); void show(event.key === "ArrowUp");
  }
}
function menuKeys(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const available = items();
  if (!available.length) return;
  const current = available.indexOf(document.activeElement as HTMLElement);
  const index = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 :
    (current + (event.key === "ArrowDown" ? 1 : -1) + available.length) % available.length;
  available[index]?.focus();
}
function select(event: MouseEvent) {
  const item = (event.target as Element).closest<HTMLElement>('[role="menuitem"]');
  if (item && !item.matches(':disabled, [aria-disabled="true"]')) close(true);
}
function outside(event: PointerEvent) { if (!root.value?.contains(event.target as Node)) close(); }
function focusOut(event: FocusEvent) { if (event.relatedTarget && !root.value?.contains(event.relatedTarget as Node)) close(); }
watch(() => route.fullPath, () => close());
onMounted(() => document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", outside));
</script>
<template>
  <div ref="root" class="action-menu" @focusout="focusOut">
    <button ref="trigger" type="button" class="btn small action-menu-trigger" :disabled="disabled" :aria-label="ariaLabel ?? label" aria-haspopup="menu" :aria-expanded="open" :aria-controls="menuId" @click="toggle" @keydown="triggerKeys"><Icon name="more" :size="16" /><span>{{ label }}</span></button>
    <div v-if="open" :id="menuId" ref="menu" class="action-menu-panel" role="menu" :aria-label="ariaLabel ?? label" @keydown="menuKeys" @click="select"><slot /></div>
  </div>
</template>
