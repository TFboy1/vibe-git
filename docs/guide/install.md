---
title: 环境与源码安装
description: 检查环境、下载新版分支、构建并链接 CLI、安装 Skill，确认超敏捷命令可用。
---

# 环境与源码安装

::: tip 新版安装入口
本页使用 `codex/frontend-rebuild` 源码。2026-09-30 核对的 npm `0.20.0` 尚未包含新版工作台。完成源码链接后不要再用旧 npm 包覆盖它。
:::

## 步骤 1：检查运行环境

> **操作人**：队长和每位成员。**前置条件**：可打开终端并访问 GitHub、npm。**入口**：Windows PowerShell，任意目录。

```powershell
node --version
npm.cmd --version
git --version
```

Node.js 应为 **24 或更高版本**。缺少环境时从 [Node.js 官方下载页](https://nodejs.org/en/download)和 [Git 官网](https://git-scm.com/downloads)安装，再重新打开终端检查。

使用 Codex 节点池的人还要运行 `codex --version`。缺少 Codex CLI 时可安装：

```powershell
npm.cmd install -g @openai/codex
```

协作分析也可使用队长配置的自定义 API。成员使用其他 Agent 开发时仍需安装新版 Vibe-Git CLI，Codex 登录按实际需要完成。

**成功结果**：环境命令正常返回，Node.js ≥ 24。**失败处理**：命令缺失时重开终端并检查 PATH，不直接进入后续构建。**下一步**：下载源码。

## 步骤 2：下载指定分支

> **操作人**：所有使用者。**前置条件**：步骤 1 通过。**入口**：你选择的工具目录，例如已创建的 `D:\Tools`。

```powershell
git clone --branch codex/frontend-rebuild --recurse-submodules https://github.com/TFboy1/vibe-git.git
Set-Location .\vibe-git\vibe-git
```

仓库外层和内部应用目录都叫 `vibe-git`。构建 CLI 必须进入**内层目录**，该目录 `package.json` 的名称是 `@vibe-git/vibe-git`。

已有仓库时先保留改动并切到正确分支，再执行 `git submodule update --init --recursive`。目录已有同名仓库时选择其他空目录，不覆盖已有文件。

**成功结果**：当前目录包含 `apps`、`packages`，分支是 `codex/frontend-rebuild`。**失败处理**：下载失败查看 Git 错误；submodule 失败可重新初始化；“Missing script: build”通常表示进入外层目录。**下一步**：构建。

## 步骤 3：构建和链接 CLI

> **操作人**：所有使用者。**前置条件**：位于内层 `vibe-git` 目录。**入口**：同一个 PowerShell 终端。

上一条成功后，再执行下一条：

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd link
vibe-git --help
```

`ci` 安装锁定依赖；`build` 构建协议、后端、CLI、Relay 和新版工作台；`link` 注册本机 `vibe-git` 命令。

不需要全局链接时，在当前目录可运行：

```powershell
node .\apps\cli\dist\index.js --help
```

之后教程中的 `vibe-git` 可替换为 CLI 文件的**绝对路径**调用，避免进入产品工作区后相对路径失效。

**成功结果**：命令成功退出，帮助可以显示。**失败处理**：构建失败先修复第一处错误；链接后找不到命令时重开终端，执行 `Get-Command vibe-git -All` 检查来源。**下一步**：能力检查。

## 步骤 4：检查实际能力 {#capability-check}

> **操作人**：所有使用者。**前置条件**：构建与链接完成。**入口**：终端，任意目录。

```powershell
vibe-git --help
```

帮助应出现“超敏捷主线”，包含这些入口：

```text
vibe-git task inbox | report <task-id> <report.json>
vibe-git agile start | review [pr-id ...] | list | show <flow-id> | wait <flow-id> [timeout-seconds]
```

这是帮助片段，竖线表示不同子命令，**不要整行作为命令执行**。没有这些入口时，在内层源码目录重新构建、链接，检查是否调用了旧 npm 安装位置。

**成功结果**：新版命令出现在帮助中。**失败处理**：修正命令来源后再启动房间，不只凭 `0.20.0` 判断版本。**下一步**：安装 Skill。

## 步骤 5：安装与加载 Skill {#install-skill}

> **操作人**：准备让 Agent 协作的人。**前置条件**：新版 CLI 通过能力检查。**入口**：产品工作区终端，或支持终端操作的 Agent。

```powershell
npx.cmd skills add TFboy1/vibe-git-skill --skill vibe-git
```

按安装器提示选择目标 Agent 和安装范围，随后加载 `vibe-git` Skill。Codex 可使用 `$vibe-git`；其他 Agent 按自己的 Skill 加载入口操作，必要时重新打开会话。

可直接发给 Agent：

> 我已从 codex/frontend-rebuild 构建并链接新版 Vibe-Git。请安装并加载 vibe-git Skill，先检查 CLI 帮助包含超敏捷主线，再指导我选择队长或成员。当前使用源码 CLI，不要用旧 npm 包覆盖它。

**成功结果**：Agent 加载 Skill 并确认新版 CLI 可用。**失败处理**：找不到 Skill 时检查安装目标与范围，不把安装 Skill 当作已连接房间。**下一步**：[队长创建房间](./captain.md)或[成员加入房间](./member.md)。

## macOS / Linux 的差异

在你的工具目录执行：

```bash
git clone --branch codex/frontend-rebuild --recurse-submodules https://github.com/TFboy1/vibe-git.git
cd vibe-git/vibe-git
npm ci
npm run build
npm link
vibe-git --help
```

Skill 安装使用 `npx skills add TFboy1/vibe-git-skill --skill vibe-git`。工作区用绝对路径，例如 `"$HOME/Projects/todo-app"`，带空格时保留引号。全局链接权限不足时优先直接调用 CLI 的绝对路径。

## 更新源码

在外层仓库更新正确分支与 submodule，再进入内层重新安装、构建并做能力检查。已运行的 Host 不会自动切换代码；当前作业结束后再安排重启，详见[日常维护](./git.md#maintenance)。
