<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData, withBase } from 'vitepress'
import HomePage from './components/HomePage.vue'

const { frontmatter } = useData()
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-before><HomePage /></template>
    <template #doc-before>
      <div class="doc-edition">
        <span>{{ frontmatter.legacy ? '历史房间兼容' : '新版工作台 · 源码试用' }}</span>
        <a :href="withBase('/guide/install.html#capability-check')">检查安装版本 <span aria-hidden="true">↗</span></a>
      </div>
    </template>
  </DefaultTheme.Layout>
</template>
