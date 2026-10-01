<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })
// The same line glyphs used by the current workbench, kept independent of its runtime.
const paths: Record<string, string> = {
  code: 'M8 5 1 12l7 7M16 5l7 7-7 7M14 3l-4 18',
  issue: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 8h.01M12 12v4',
  pull: 'M6 6v12M3 4a3 3 0 1 0 6 0 3 3 0 0 0-6 0M3 20a3 3 0 1 0 6 0 3 3 0 0 0-6 0M18 17V9a4 4 0 0 0-4-4h-1M16 2l-3 3 3 3M15 20a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  agent: 'M7 17H5a4 4 0 1 1 .5-8A7 7 0 0 1 19 8a5 5 0 0 1 0 10h-2M10 14l-2 3 2 3M14 14l2 3-2 3',
  project: 'M3 3h18v18H3ZM9 3v18M15 3v18M5 7h2M11 7h2M17 7h2M5 11h2M11 11h2',
  book: 'M12 5c-4-3-8-2-10-1v15c3-1 7-2 10 1 3-3 7-2 10-1V4c-2-1-6-2-10 1ZM12 5v15',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M5 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M18 8a3 3 0 0 0 0-6M22 21v-2a4 4 0 0 0-3-4',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 2h6l1 4 4 1 2 5-3 3 1 4-5 3-3-3-4 1-3-5 3-3-1-4Z',
  check: 'M5 12l4 4L19 6',
  arrow: 'M4 12h16M14 6l6 6-6 6',
  chevron: 'm8 5 7 7-7 7',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  search: 'M19 19l4 4M19 10A9 9 0 1 1 1 10a9 9 0 0 1 18 0',
  branch: 'M6 3v12a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V9M3 3a3 3 0 1 0 6 0 3 3 0 0 0-6 0M15 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  play: 'm8 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  replay: 'M3 11a9 9 0 1 1 2 7M3 4v7h7',
}
</script>

<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.code" /></svg></template>
