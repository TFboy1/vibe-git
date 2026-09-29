<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 });
const paths: Record<string, string> = {
  room: "M3 21V7l9-4 9 4v14M8 21v-7h8v7M7 8h.01M17 8h.01",
  document: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h6",
  tasks: "M9 5h12M9 12h12M9 19h12M2 5l1 1 2-2M2 12l1 1 2-2M2 19l1 1 2-2",
  changes: "M6 3v12a6 6 0 0 0 6 6M18 3v7a6 6 0 0 1-6 6M3 6l3-3 3 3M15 6l3-3 3 3",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  arrow: "M4 12h16M14 6l6 6-6 6", check: "M4 12l5 5L20 6",
  close: "M6 6l12 12M6 18 18 6", plus: "M12 5v14M5 12h14",
  download: "M12 3v12M7 10l5 5 5-5M5 16v5h14v-5",
  upload: "M12 15V3M7 8l5-5 5 5M5 16v5h14v-5",
  copy: "M9 9h12v12H9ZM15 9V3H3v12h6",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  chevron: "M9 5l7 7-7 7", menu: "M4 6h16M4 12h16M4 18h16",
  link: "M9 15l6-6M7 13l-2 2a4 4 0 0 0 6 6l2-2M11 5l2-2a4 4 0 0 1 6 6l-2 2",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  pause: "M8 5v14M16 5v14"
};
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] ?? paths.document" /></svg></template>
