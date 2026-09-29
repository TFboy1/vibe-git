<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 });
const paths: Record<string, string> = {
  room: "M3 21V7l9-4 9 4v14M8 21v-7h8v7M7 8h.01M17 8h.01",
  code: "M8 5 1 12l7 7M16 5l7 7-7 7M14 3l-4 18",
  issue: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 8h.01M12 12v4",
  pull: "M6 6v12M3 4a3 3 0 1 0 6 0 3 3 0 0 0-6 0M3 20a3 3 0 1 0 6 0 3 3 0 0 0-6 0M18 17V9a4 4 0 0 0-4-4h-1M16 2l-3 3 3 3M15 20a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  agent: "M7 17H5a4 4 0 1 1 .5-8A7 7 0 0 1 19 8a5 5 0 0 1 0 10h-2M10 14l-2 3 2 3M14 14l2 3-2 3",
  project: "M3 3h18v18H3ZM9 3v18M15 3v18M5 7h2M11 7h2M17 7h2M5 11h2M11 11h2",
  book: "M12 5c-4-3-8-2-10-1v15c3-1 7-2 10 1 3-3 7-2 10-1V4c-2-1-6-2-10 1ZM12 5v15",
  branch: "M6 3v12a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V9M3 3a3 3 0 1 0 6 0 3 3 0 0 0-6 0M15 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0M3 18a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  search: "M19 19l4 4M19 10A9 9 0 1 1 1 10a9 9 0 0 1 18 0",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M5 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M18 8a3 3 0 0 0 0-6M22 21v-2a4 4 0 0 0-3-4",
  external: "M14 3h7v7M21 3 10 14M10 3H3v18h18v-7",
  send: "M22 2 9 15M22 2l-8 20-5-7-7-5Z",
  folder: "M3 5h6l2 2h10v13H3Z",
  activity: "M2 12h4l4-9 4 18 4-9h4",
  shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6ZM8 12l3 3 5-6",
  document: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h6",
  tasks: "M9 5h12M9 12h12M9 19h12M2 5l1 1 2-2M2 12l1 1 2-2M2 19l1 1 2-2",
  changes: "M6 3v12a6 6 0 0 0 6 6M18 3v7a6 6 0 0 1-6 6M3 6l3-3 3 3M15 6l3-3 3 3",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  arrow: "M4 12h16M14 6l6 6-6 6", check: "M4 12l5 5L20 6",
  close: "M6 6l12 12M6 18 18 6", plus: "M12 5v14M5 12h14",
  download: "M12 3v12M7 10l5 5 5-5M5 16v5h14v-5",
  upload: "M12 15V3M7 8l5-5 5 5M5 16v5h14v-5",
  copy: "M9 9h12v12H9ZM15 9V3H3v12h6",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 2h6l1 4 4 1 2 5-3 3 1 4-5 3-3-3-4 1-3-5 3-3-1-4 5-3Z",
  chevron: "M9 5l7 7-7 7", menu: "M4 6h16M4 12h16M4 18h16",
  link: "M9 15l6-6M7 13l-2 2a4 4 0 0 0 6 6l2-2M11 5l2-2a4 4 0 0 1 6 6l-2 2",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  pause: "M8 5v14M16 5v14"
};
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] ?? paths.document" /></svg></template>
