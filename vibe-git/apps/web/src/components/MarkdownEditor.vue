<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { CrepeBuilder } from "@milkdown/crepe/builder";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
import { toolbar } from "@milkdown/crepe/feature/toolbar";
import { cursor } from "@milkdown/crepe/feature/cursor";
import { placeholder } from "@milkdown/crepe/feature/placeholder";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { table } from "@milkdown/crepe/feature/table";
import { replaceAll } from "@milkdown/utils";
import Icon from "./Icon.vue";
const props = withDefaults(defineProps<{ modelValue: string; readonly?: boolean; filename?: string; outline?: boolean; compact?: boolean }>(),
  { readonly: false, filename: "requirements.md", outline: true, compact: false });
const emit = defineEmits<{ "update:modelValue": [value: string]; error: [value: string] }>();
const root = ref<HTMLElement>(), file = ref<HTMLInputElement>(), loading = ref(true);
const headings = ref<Array<{ title: string; level: number; id: string }>>([]);
const prefix = "heading-" + Math.random().toString(36).slice(2);
let crepe: CrepeBuilder | null = null, observer: MutationObserver | null = null, destroyed = false, syncing = false, mounted = false;
function refreshOutline() {
  headings.value = [...(root.value?.querySelectorAll<HTMLElement>(".ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4") ?? [])].map((heading, index) => {
    const id = prefix + "-" + index; heading.id = id;
    return { title: heading.textContent ?? "", level: Number(heading.tagName.slice(1)), id };
  });
}
onMounted(async () => {
  try {
    crepe = new CrepeBuilder({ root: root.value!, defaultValue: props.modelValue });
    crepe.addFeature(blockEdit, { textGroup: { label: "正文与标题", text: { label: "正文" }, h1: { label: "一级标题" }, h2: { label: "二级标题" }, h3: { label: "三级标题" } } });
    crepe.addFeature(toolbar, { boldLabel: "加粗", italicLabel: "斜体", codeLabel: "代码", linkLabel: "链接", strikethroughLabel: "删除线" });
    crepe.addFeature(cursor); crepe.addFeature(placeholder, { text: "写下你的目标、范围与验收…", mode: "doc" });
    crepe.addFeature(listItem); crepe.addFeature(linkTooltip); crepe.addFeature(table);
    crepe.setReadonly(props.readonly);
    crepe.on(listener => listener.markdownUpdated((_ctx, markdown, previous) => {
      if (!syncing && mounted && markdown !== previous) emit("update:modelValue", markdown);
    }));
    await crepe.create();
    if (destroyed) { await crepe.destroy(); return; }
    mounted = true; loading.value = false; refreshOutline();
    observer = new MutationObserver(refreshOutline); observer.observe(root.value!, { childList: true, subtree: true, characterData: true });
    if (crepe.getMarkdown() !== props.modelValue) { syncing = true; crepe.editor.action(replaceAll(props.modelValue)); syncing = false; }
  } catch (e) { loading.value = false; emit("error", e instanceof Error ? e.message : String(e)); }
});
watch(() => props.modelValue, async value => {
  if (!crepe || !mounted || value === crepe.getMarkdown()) return;
  syncing = true; crepe.editor.action(replaceAll(value)); await nextTick(); syncing = false; refreshOutline();
});
watch(() => props.readonly, value => crepe?.setReadonly(value));
onBeforeUnmount(() => { destroyed = true; observer?.disconnect(); if (mounted) void crepe?.destroy(); });
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement, selected = input.files?.[0];
  try {
    if (!selected) return;
    if (!/\.md$/i.test(selected.name) || selected.size > 256 * 1024) throw new Error("请选择不超过 256 KiB 的 UTF-8 Markdown 文件");
    const markdown = new TextDecoder("utf-8", { fatal: true }).decode(await selected.arrayBuffer());
    emit("update:modelValue", markdown);
  } catch (e) { emit("error", e instanceof Error ? e.message : String(e)); }
  finally { input.value = ""; }
}
function download() {
  const blob = new Blob([props.modelValue], { type: "text/markdown;charset=utf-8" }), url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = props.filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 100);
}
function jump(id: string) { root.value?.querySelector("#" + id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }
</script>
<template>
  <div class="markdown-workspace" :class="{ compact, 'without-outline': !outline }">
    <div class="markdown-main">
      <div class="editor-tools"><span class="muted small-text">{{ readonly ? 'Markdown 文档' : '直接编辑正文 · 支持 Markdown 快捷输入' }}</span><div>
        <button v-if="!readonly" class="btn quiet small" @click="file?.click()"><Icon name="upload" :size="15" /> 导入 MD</button>
        <button class="btn quiet small" @click="download"><Icon name="download" :size="15" /> 导出 MD</button>
        <input ref="file" type="file" accept=".md,text/markdown" class="sr-only" aria-label="导入 Markdown" @change="importFile" />
      </div></div>
      <div v-if="loading" class="editor-loading"><span class="working-dot"></span> 正在打开文档…</div>
      <div ref="root" class="markdown-root" :class="{ 'is-readonly': readonly }"></div>
      <div v-if="!loading && readonly && !modelValue" class="empty-document">文档尚未生成。</div>
    </div>
    <aside v-if="outline" class="document-outline"><span class="eyebrow">ON THIS PAGE</span><h3>文档大纲</h3><nav aria-label="文档大纲"><button v-for="heading in headings" :key="heading.id" :style="{ paddingLeft: (heading.level - 1) * 12 + 'px' }" @click="jump(heading.id)">{{ heading.title || '未命名章节' }}</button><p v-if="!headings.length" class="muted small-text">写下标题后，章节会出现在这里。</p></nav></aside>
  </div>
</template>
