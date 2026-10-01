<script setup lang="ts">
import { withBase } from 'vitepress'
import LogoStage from './LogoStage.vue'
import WorkbenchDemo from './WorkbenchDemo.vue'
import AgentMarquee from './AgentMarquee.vue'
</script>

<template>
  <div class="landing">
    <section class="landing-hero site-shell" aria-labelledby="brand-title">
      <div class="hero-copy">
        <a class="release-link" :href="withBase('/guide/install.html')"><span class="release-dot"></span> 新版源码试用 <span aria-hidden="true">↗</span></a>
        <h1 id="brand-title">vibe<span>-git</span></h1>
        <p class="hero-tagline"><span>AI-NATIVE</span><br />的团队协作范式。</p>
        <p class="hero-description">每个人带上自己的 Agent，共享需求、协同开发，让团队决定跟上代码。</p>
        <div class="hero-actions">
          <a id="install" class="site-button primary" :href="withBase('/guide/install.html')">快速开始 <span aria-hidden="true">↗</span></a>
          <a class="site-button secondary" href="https://github.com/TFboy1/vibe-git" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 .8a11.2 11.2 0 0 0-3.54 21.82c.56.1.76-.24.76-.54v-2.1c-3.1.68-3.76-1.32-3.76-1.32-.51-1.3-1.25-1.64-1.25-1.64-1.02-.7.08-.68.08-.68 1.12.08 1.72 1.15 1.72 1.15 1 1.71 2.62 1.22 3.26.93.1-.72.4-1.22.71-1.5-2.48-.28-5.1-1.25-5.1-5.54 0-1.23.44-2.23 1.15-3.02-.11-.28-.5-1.43.11-2.98 0 0 .94-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.13-1.45 3.07-1.15 3.07-1.15.61 1.55.22 2.7.11 2.98.72.79 1.15 1.79 1.15 3.02 0 4.3-2.62 5.25-5.11 5.53.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z" /></svg>GitHub 仓库 <span aria-hidden="true">↗</span></a>
        </div>
        <p class="hero-note">Version the intent, not just the code.</p>
      </div>
      <LogoStage />
      <a class="hero-scroll" href="#workbench"><span>看看工作台如何协作</span><span aria-hidden="true">↓</span></a>
    </section>

    <WorkbenchDemo />
    <AgentMarquee />

    <footer class="landing-footer site-shell">
      <a class="footer-wordmark" :href="withBase('/')">vibe-git</a>
      <p>Version the intent, not just the code.</p>
      <nav aria-label="项目链接"><a :href="withBase('/guide.html')">使用文档 →</a><a href="https://github.com/TFboy1/vibe-git" target="_blank" rel="noopener noreferrer">GitHub ↗</a></nav>
    </footer>
  </div>
</template>
