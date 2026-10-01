---
title: CLI 与 Agent 提示词
description: 新版 CLI 的身份、计划、流程、任务汇报与需求变更参考，以及可以直接发给 Agent 的提示词。
---

# CLI 与 Agent 提示词

主教程以工作台为入口，这里用于查阅终端操作。所有 Markdown 和 JSON 使用 UTF-8；命令里的 `<...>` 必须换成真实数据。

## 先确认身份与 ID

> **操作人**：CLI 使用者。**前置条件**：新版安装，已连接房间。**入口**：自己的产品工作区终端。

先运行 `vibe-git status` 查看 `node.id`、`node.role` 和房间；需要任务时运行 `task inbox`，需要流程时运行 `agile list`。

| 数据 | 从哪里取得 | 用在哪里 |
| --- | --- | --- |
| 加入 URL | 队长启动回执、Settings 邀请、`invite show` | `connect` |
| task-id | 本人 `task inbox` 的 `package.taskId`，或任务列表 | `task package/report` |
| 任务包版本 | 实际读取的 `package.taskRevision` | 报告 `taskRevision` |
| 需求版本 | 实际执行包的 `package.requirementRevision` | 报告 `requirementRevision` |
| flow-id | 启动回执或 `agile list` 的真实流程 ID | `agile show/wait/...` |
| pr-id | `pr list` 的内部需求变更记录 ID | 指定审核批次 |
| issueId / optionId | `agile show` 的当前未回答问题及其选项 | 裁决回答 JSON |

**成功结果**：命令使用正确身份和真实数据。**失败处理**：查不到 ID 时先检查所处房间和权限，不根据示例编造。**下一步**：执行对应阶段的操作。

## 房间、身份与计划

| 命令 | 操作人 | 作用 |
| --- | --- | --- |
| `vibe-git host start "<产品绝对路径>"` | 队长 | 启动房间 |
| `vibe-git host status` / `host stop` | 队长 | 查看／停止本机服务 |
| `vibe-git invite show` / `invite rotate` | 队长 | 查看／更新加入链接 |
| `vibe-git connect "<join-url>" "<产品绝对路径>"` | 成员 | 连接自己的工作区 |
| `vibe-git status` / `logs` / `open` | 本人 | 查看状态／日志／打开本机页面 |
| `vibe-git disconnect` | 成员 | 断开本机连接 |
| `vibe-git profile set "我的名字"` | 本人 | 修改显示名字 |
| `vibe-git plan submit .\plan.md` | 本人 | 提交或更新自己的计划 |
| `vibe-git codex status` / `codex bind` | 本人 | 查询／连接本机 Codex |

## 队长超敏捷流程 {#agile-cli}

> **操作人**：队长。**前置条件**：计划收齐、算力可用，或已有需要审核的正式需求。**入口**：产品工作区；操作与网页共用同一流程。

1. `vibe-git agile start` 启动首轮，或 `vibe-git agile review <pr-id-1> <pr-id-2>` 启动选定审核。
2. 通过 `agile list` 获取 ID，执行 `agile wait <flow-id> 600` 和 `agile show <flow-id>`。
3. 需要裁决时保存回答 JSON，再 `agile answer <flow-id> .\answer.json`。
4. 审核批次核对所有采纳／退回结论，网页可直接调整；高级 CLI 可用 `agile decisions <flow-id> .\decisions.json`，字段从真实流程结论读取。
5. `agile requirement <flow-id>` 生成审核后的完整需求；首轮无冲突会自动生成。通过 `agile draft <flow-id> .\requirements.md` 保存已确认的完整正文。
6. `agile allocate <flow-id>` 生成分工，阻塞等待后 `show` 核对；网页调整字段，或 `agile allocation <flow-id> .\allocation.json` 保存分工。
7. 核对后 `agile publish <flow-id>` 正式派发。

选择现有方案的回答示例：

```json
{
  "issueId": "从当前未回答问题复制的真实ID",
  "answer": { "kind": "option", "optionId": "从该题复制的真实选项ID" }
}
```

自定义回答示例：

```json
{
  "issueId": "从当前未回答问题复制的真实ID",
  "answer": { "kind": "custom", "text": "本轮只实现新增与完成，删除留到下一轮。页面和接口均按这个范围验收。" }
}
```

分工 JSON 使用 `tasks` 和 `removedTaskIds`；任务字段、来源 ID 从真实 `agile show` 结果取得，不自行构造。修改需求会使分工失效，修改审核结论会使草稿和分工失效。

**成功结果**：每条命令返回对应真实流程状态，最终发布需求和任务包。**失败处理**：状态为 `FAILED` 时修复后 `agile retry <flow-id>`；需要结束本批时选择 `cancel` 或 `reject`，不要把三个操作都执行。**下一步**：负责人同步任务。

## 任务与需求变更

| 命令 | 作用 |
| --- | --- |
| `vibe-git task inbox` | 读取本人任务包和消息，每次 Skill 调用先执行 |
| `vibe-git task package <task-id>` | 打印结构化任务包 |
| `vibe-git task package <task-id> .\task-v1.md` | 导出任务包，不覆盖同名文件 |
| `vibe-git task report <task-id> .\report.json` | 汇报本人开工、进度、阻塞或完成 |
| `vibe-git pr submit .\change.md` | 提交内部需求变更，界面位于 Issues |
| `vibe-git pr list` | 查阅内部需求变更 ID 和状态 |

报告完整 JSON 见[开发汇报](./execution.md)。使用实际执行版本，完成附非空验证证据；不把 Agent 正常退出当作完成。

## 可直接发给 Agent 的话 {#agent-prompts}

### 安装与能力检查

> 请使用 vibe-git Skill。我要体验 codex/frontend-rebuild 的新版源码，请先检查 Node.js 24+、Git 与当前 CLI。缺少新版时按官网源码教程安装和构建，检查帮助包含 agile 和 task inbox，再指导我选择队长或成员。保留已有文件，不用旧 npm 包覆盖源码安装。

### 队长开始协作

> 我是队长。请使用 vibe-git Skill，先读取当前状态和 task inbox，在我指定的产品工作区启动房间。确认队长身份，指导我配置算力和邀请成员，再整理我的计划，展示给我确认后提交。

### 成员提交计划

> 我是成员，已经连接房间。请先用 vibe-git Skill 同步状态，阅读项目，按目标、现状、方案、范围、验收与风险起草我的计划，确认后保存 UTF-8 Markdown 并提交。

### 开发与汇报

> 请用 vibe-git Skill 同步我的任务包，记录真实 taskId、taskRevision、requirementRevision。处理暂停、修订和依赖后，按我本次要求实施，汇报实际开工、进度与阻塞。完成时执行适合本次任务的验证并附证据，版本过期时保留报告，不给旧结果补填最新版本。

### 提出变更

> 我想调整当前正式需求。请先读最新需求与相关任务，整理原需求、修改内容、原因、影响和验收，展示给我确认，再提交 Vibe-Git 内部需求变更。不要创建 GitHub 代码 PR 来代替需求 Issue。

### 等待耗时分析

> 请取得真实 flow-id，用 agile wait 阻塞等待需要处理的状态，再读取结果。超时保留流程与草稿，不频繁轮询；需要我裁决时说明当前问题。
