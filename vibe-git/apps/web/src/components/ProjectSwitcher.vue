<script setup lang="ts">
import { ref } from "vue";
import type { LocalProjects } from "@vibe-git/protocol";
import { request } from "../api";
import { useWorkspace } from "../store";
import { useRepository } from "../repository";
import Icon from "./Icon.vue";
const store = useWorkspace(), repository = useRepository();
const dialog = ref<HTMLDialogElement>(), projects = ref<LocalProjects | null>(null), path = ref(""), loading = ref(false), error = ref("");
async function show() {
  dialog.value?.showModal(); error.value = ""; loading.value = true;
  try { projects.value = await request<LocalProjects>("/api/local/projects"); path.value = ""; }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { loading.value = false; }
}
async function chooseFolder() {
  loading.value = true;
  try { const result = await request<{ path: string | null }>("/api/local/projects/pick", {}, undefined, { timeoutMs: 180000 }); if (result.path) path.value = result.path; }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { loading.value = false; }
}
async function change() {
  error.value = "";
  if (!path.value.trim()) return;
  loading.value = true;
  try {
    if (!(await store.saveProjectDrafts())) { error.value = store.error || "草稿尚未保存，请先完成当前操作"; return; }
    store.projectSwitching = true; store.stop();
    await request("/api/local/projects/switch", { path: path.value.trim(), expectedRoomId: store.data?.room.id }, undefined, { timeoutMs: 240000 });
    window.location.replace("/");
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); store.projectSwitching = false; await store.start(); }
  finally { loading.value = false; }
}
</script>
<template>
  <button class="project-name-button" type="button" aria-haspopup="dialog" aria-label="切换项目" @click="show">{{ repository.name }}<Icon name="chevron" :size="13" /></button>
  <dialog ref="dialog" class="project-switch-dialog" aria-labelledby="project-switch-title" @cancel="store.projectSwitching && $event.preventDefault()">
    <header class="section-head"><div><span class="eyebrow">PROJECT</span><h2 id="project-switch-title">切换项目</h2></div><button class="icon-btn" :disabled="loading" aria-label="关闭项目选择" @click="dialog?.close()"><Icon name="close" /></button></header>
    <p class="muted">每个项目独立保存需求、任务与成员。切换后旧房间暂时离线，历史记录保留。</p>
    <div class="project-choice-list"><button v-for="project in projects?.projects ?? []" :key="project.roomId" type="button" :disabled="loading || project.current" :class="{ selected: path === project.path }" @click="path = project.path"><Icon name="folder" :size="19" /><span><strong>{{ project.name }}</strong><small>{{ project.path }}</small></span><span class="tag">{{ project.current ? '当前' : project.role === 'captain' ? '队长' : '成员' }}</span></button></div>
    <form @submit.prevent="change"><label class="field">项目目录<input v-model="path" class="input" :readonly="!store.captain" :disabled="loading" placeholder="选择上面的项目，或填写新项目的绝对路径" /></label><button v-if="store.captain" type="button" class="text-button" :disabled="loading" @click="chooseFolder"><Icon name="folder" :size="15" />选择其他文件夹</button><p class="muted small-text">{{ store.captain ? '已有项目恢复原房间；新目录创建独立房间，不会把现有源码提交到 Git。' : '成员可切换已经连接的项目，新项目请先使用队长的邀请命令连接。' }}</p><p v-if="error" class="inline-error" role="alert">{{ error }}</p><footer class="modal-footer"><span v-if="loading" role="status">{{ store.projectSwitching ? '正在保存连接、切换服务并恢复项目…' : '正在读取…' }}</span><button type="button" class="btn" :disabled="loading" @click="dialog?.close()">取消</button><button class="btn primary" :disabled="loading || !path.trim()">确认切换</button></footer></form>
  </dialog>
</template>
