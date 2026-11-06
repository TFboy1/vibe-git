---
title: 维护与发布文档站
description: 在仓库外层维护 Markdown 和 Vue 首页，运行 build，自行预览，并通过 GitHub Pages 发布。
---

# 维护与发布文档站

这章面向官网维护者。官网由 VitePress 生成静态页面，产品工作台仍由内层应用独立构建。

## 步骤 1：安装官网依赖

> **操作人**：官网维护者。**前置条件**：Node.js 24+，已获取仓库。**入口**：仓库外层，包含 `docs` 和根 `package.json` 的目录。

```powershell
npm.cmd ci
```

**成功结果**：锁定依赖安装完成。**失败处理**：没有 `docs:build` 脚本时检查是否站在内层应用目录；两套 build 的目录不同。**下一步**：修改内容。

## 步骤 2：修改唯一内容源

> **操作人**：官网维护者。**前置条件**：依赖完成。**入口**：`docs/guide.md`、`docs/guide/`、`docs/.vitepress/`。

教程总入口是 `guide.md`，章节各自维护 Markdown，不编辑生成的 HTML。首页使用自定义 Vue 组件，配置与主题在 `.vitepress` 中。品牌素材继续放在 `docs/assets`，构建会保留原公开 URL。

新增章节时同步侧栏和教程入口链接。更新产品功能时，先核对实际工作台按钮和 CLI 行为，再更新步骤、模板、失败处理和版本说明。 npm 发布新版后，也要重新核实安装入口，不能仅凭版本号移除源码说明。

**成功结果**：Markdown 和导航引用一致，内容对应真实版本。**失败处理**：页面链接不确定时先使用现有章节，不添加空链接。**下一步**：构建。

## 步骤 3：构建并自行预览

> **操作人**：官网维护者。**前置条件**：内容编辑完成。**入口**：仓库外层。

```powershell
npm.cmd run docs:build
npm.cmd run docs:preview
```

构建会生成 `docs/.vitepress/dist`，处理 Markdown 链接和静态页面。预览地址以终端输出为准，访问时保留 `/vibe-git/` 基路径。预览仅在本机运行，不代表公开官网已更新。

开发时可用 `npm.cmd run docs:dev`。macOS/Linux 将 `npm.cmd` 换成 `npm`。构建产物与缓存已经忽略，不手动提交。

**成功结果**：build 通过，你可自行查看效果、导航和教程步骤。**失败处理**：断链或构建错误先修复再发布，不关闭断链检查。**下一步**：按仓库流程发布变更。

## 步骤 4：发布到 GitHub Pages

> **操作人**：有仓库发布权限的维护者。**前置条件**：build 通过，变更已按团队流程确认。**入口**：GitHub 仓库的 Actions 与 Settings → Pages。

现有 `pages.yml` 在 `master` 的官网、依赖或配置变更时触发，也支持 `workflow_dispatch`。流程使用 Node.js 24，安装依赖，运行文档 build，上传生成目录，再部署到 Pages。

确认 Pages 的 Source 使用 GitHub Actions；发布完成后访问 `https://tfboy1.github.io/vibe-git/`。构建与部署回执分开检查，只有部署成功才说明公开站点已更新。

**成功结果**：Actions 构建、部署成功，生产 URL 已更新。**失败处理**：查看失败步骤；资源路径错误先检查 `/vibe-git/` 的配置，未通过构建不发布。**下一步**：按当前版本继续维护文档。
