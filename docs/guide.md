---
title: 使用文档
description: 从源码安装开始，按队长与成员的角色完成计划提交、冲突裁决、需求编辑、任务派发、开发汇报和需求变更。
---

# 从安装，到第一轮协作

Vibe-Git 让每位成员在自己的 Git 工作区使用熟悉的 Agent，并共享团队的计划、决定、需求和任务包。这套教程面向第一次使用新版工作台的人。

::: tip 本教程的版本
截至 2026-09-30，npm `0.20.0` 尚未包含新版超敏捷工作台。请安装 `codex/frontend-rebuild` 分支的源码，并按[能力检查](./guide/install.md#capability-check)确认命令。已有历史房间请先读[兼容说明](./guide/legacy.md)。
:::

## 第一次使用，按这个顺序

| 阶段 | 队长 | 成员 | 完成后应看到 |
| --- | --- | --- | --- |
| 安装工具 | [环境与源码安装](./guide/install.md) | 同样安装新版 CLI 与 Skill | 帮助中包含超敏捷命令 |
| 建立连接 | [创建房间](./guide/captain.md)、[配置算力](./guide/compute.md) | [加入房间](./guide/member.md) | Settings 中显示本人身份与成员 |
| 提出想法 | [提交自己的计划](./guide/plans.md) | 提交各自计划 | 个人计划显示“已提交” |
| 确认需求 | [整合与裁决](./guide/alignment.md) | 查看原始计划与共同需求 | Wiki 出现需求草稿 |
| 安排任务 | [预览分工并派发](./guide/dispatch.md) | 查看自己的任务包 | 正式需求 R1 和任务包一起发布 |
| 实施任务 | 作为任务负责人时同样汇报 | [开发与汇报](./guide/execution.md) | 本人任务记录进度、阻塞或完成 |
| 调整需求 | [批量审核并重新派发](./guide/changes.md) | 提交需求变更 Issue | 新版需求与任务修订同步到成员 |

每个步骤会说明操作人、前置条件、所在页面或终端目录、具体操作、成功结果、失败处理和下一步。命令中的 `<占位符>` 需要替换，不能原样执行。

## 安装方式 {#installation}

先读[安装教程](./guide/install.md)，完成环境检查、分支下载、构建、CLI 链接和 Skill 安装。Windows 使用 PowerShell，遇到 npm 脚本执行限制时使用教程中的 `npm.cmd`、`npx.cmd`。

源码目录用于安装工具；项目工作区用于开发你的产品。启动房间时要指定自己的项目目录，例如 `D:\Projects\todo-app`。

## 选择你的身份 {#roles}

- **队长**：创建房间、邀请成员、配置团队算力、整合计划、处理冲突、编辑共同需求和派发任务。进入[队长教程](./guide/captain.md)。
- **成员**：使用邀请命令加入房间、提交自己的计划、让 Agent 读取任务包、开发汇报和提出需求变更。进入[成员教程](./guide/member.md)。

队长也可以承担开发任务。身份由连接节点决定，在网页里不能随意切换为其他成员。

## 各功能怎么用 {#features}

| 页面 | 用来做什么 | 操作教程 |
| --- | --- | --- |
| Code → 个人计划 | 编写、导入和更新自己的计划 | [提交计划](./guide/plans.md) |
| 个人计划中的整合流程 | 收集方案、选择冲突处理方式 | [整合与裁决](./guide/alignment.md) |
| Wiki | 编辑需求草稿、查看正式版本和历史 | [需求与派发](./guide/dispatch.md) |
| Projects | 审核分工、查看看板与任务包 | [任务派发](./guide/dispatch.md)、[开发汇报](./guide/execution.md) |
| Issues | 提出需求变更、选择批次并统一审核 | [需求变更](./guide/changes.md) |
| Pull requests | 打开 GitHub/GitLab 的真实代码 PR | [代码协作](./guide/git.md) |
| Agents | 进行 Codex 分析，复用草稿与审查建议 | [代码协作](./guide/git.md#agent-assistance) |
| Settings | 配置算力、连接 Codex、邀请成员、设置仓库与名字 | [算力](./guide/compute.md)、[房间](./guide/captain.md) |

## 让 Skill 帮你操作 {#skill}

Skill 是 Agent 的操作说明书，CLI 是实际提交和读取状态的工具。先让 Agent 加载 `vibe-git` Skill，再发出明确的任务。例如：

> 我已经安装新版 Vibe-Git。请使用 vibe-git Skill，先读取我的任务收件箱和当前状态，再指导我完成第一轮协作。不要猜测任务 ID 或版本号。

[完整提示词与 CLI 参考](./guide/reference.md#agent-prompts)包含队长、成员、开发汇报和需求变更的可复制示例。

## 使用时的几个边界 {#security}

- 邀请命令包含加入房间的密钥，只发给预期成员。
- 在自己的电脑执行 `vibe-git open`，才能使用本机编辑和 AI 能力；远程房间页面主要用于查看。
- API Key 填在队长本机 Settings 中，不需要贴进聊天或需求文档。
- 任务包的版本是执行依据；提交完成汇报时记录实际验证证据。
- “需求草稿已保存”“任务包已派发”“代码已合并”是不同的结果，分别检查相应回执。

## 参与讨论 {#community}

可以在 [GitHub Issues](https://github.com/TFboy1/vibe-git/issues)反馈问题，或通过项目 README 中的[讨论入口](https://github.com/TFboy1/vibe-git#readme)参与交流。微信群二维码有有效期，以项目最新发布的入口为准。

遇到问题可直接查看[问题处理](./guide/troubleshooting.md)；维护官网请阅读[文档站维护与发布](./guide/site.md)。
