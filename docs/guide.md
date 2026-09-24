# Vibe-Git 使用文档

> 让多个 Agent 在同一个项目里共享提案、决策、任务和需求变更。

[返回官网](index.html) · [打开网页文档](guide.html) · [GitHub 仓库](https://github.com/TFboy1/vibe-git)

## 你先要知道的两件事

Vibe-Git 有两个部分：

- **Skill**：告诉 Agent 如何理解 Vibe-Git，如何区分队长和队员，以及什么时候应该上传提案、提交需求变更或连接 Codex 审核池。
- **CLI**：真正创建房间、连接节点、上传 Markdown、发布任务和读取状态的命令行工具。

普通用户只需要先安装 Skill。之后可以让 Agent 自动检查 CLI；CLI 不存在时，Agent 会执行：

```powershell
npm install -g @vibe-git/vibe-git
```

## 安装方式

### Agent 自动安装（推荐）

在项目工作区或你平时使用 Agent 的目录执行：

```powershell
npx skills add TFboy1/vibe-git-skill --skill vibe-git
```

然后把这句话直接发给 Agent：

> 请自动安装并配置 Vibe-Git：先检查 Node.js、Git、Codex CLI 和 vibe-git CLI；如果 CLI 没安装就执行 `npm install -g @vibe-git/vibe-git`，安装成功后先问我是队长还是队员，再带我完成第一步。

Agent 会检查环境、安装 CLI、运行 `vibe-git --help`，然后询问你的身份。用户明确要求自动安装时，Skill 不要求你再手动复制 npm 命令。

### 手动安装

如果你的 Agent 不允许执行终端命令，或者你想自己控制安装过程：

```powershell
npm install -g @vibe-git/vibe-git
vibe-git --help
```

手动安装 CLI 后，仍然建议安装 Skill：

```powershell
npx skills add TFboy1/vibe-git-skill --skill vibe-git
```

### 源码安装

只有需要修改 Vibe-Git 源码或测试本地版本时，才使用源码安装：

```powershell
git clone https://github.com/TFboy1/vibe-git.git
Set-Location .\vibe-git\vibe-git
npm.cmd ci
npm.cmd run build
npm.cmd link
vibe-git --help
```

### 可以使用哪些 Agent

只要智能体支持 Agent Skill、读取工作区和执行终端命令，就可以使用 Vibe-Git。当前教程面向：

- Trae
- Codex
- WorkBuddy
- Coder
- Claude Code
- Antigravity
- Cursor
- Cline
- OpenCode
- Windsurf

不同 Agent 的入口名称可能不同，但核心提示词相同：先安装或加载 `vibe-git` Skill，再让 Skill 检查并安装 CLI。

## 安装后先选择身份

不要一上来复制所有命令。先判断自己是谁：

- 你要创建房间、邀请队友、收集提案、裁决分歧和发布任务：你是**队长**。
- 你要加入别人创建的房间、提交自己的方案、领取任务和开发：你是**队员**。

### 队长：创建房间

在队长自己的项目 Git 工作区运行：

```powershell
vibe-git host start
vibe-git open
```

`host start` 成功回执中的完整加入命令才是给队员使用的邀请入口。只把它发给预期队员，不要放进仓库、Issue 或公开聊天。`open` 只是打开网页面板，不是加入命令。

队长的下一步：

1. 等至少一位队员连接并上传提案。
2. 运行 `vibe-git status` 查看房间和提案状态。
3. 运行 `vibe-git align start` 发起对齐。
4. 用 `vibe-git align show <alignment-id>` 阅读共同稿和冲突。
5. 用真实的 `issue-id` 和 `option-id` 执行 `vibe-git align resolve <alignment-id> <issue-id> <option-id>`。
6. 冲突处理完后按需 `vibe-git task assign <task-id> <node-id>`，再运行 `vibe-git tasks publish <alignment-id>`。

### 队员：加入房间

在队员自己的项目 Git 工作区运行队长发来的完整 URL：

```powershell
vibe-git connect "<队长给你的完整加入 URL>"
vibe-git status
vibe-git open
```

连接成功后，告诉 Agent：

> 我是队员，请阅读当前项目，按目标、现状、方案、验收标准和风险起草一份提案；先展示给我确认，确认后保存为 UTF-8 Markdown 并执行 `vibe-git plan submit`。

## 每个功能怎么用

### 提案：PLAN

提案是每个成员自己的方案。它不是任务执行细节，也不是需求变更单。

```powershell
vibe-git plan submit proposal.md
```

文件必须是非空 UTF-8 Markdown，大小不超过 256 KiB。重复提交相同内容是幂等的；修改内容会生成新版本。Skill 可以帮你阅读项目、整理提案、保存文件，然后在你确认后上传。

### 对齐：ALIGN

对齐由队长发起。它会冻结启动时各节点的最新提案，生成共同稿和需要裁决的问题。没有解决的实质冲突不能发布任务。

```powershell
vibe-git align start
vibe-git align status
vibe-git align show <alignment-id>
vibe-git align resolve <alignment-id> <issue-id> <option-id>
vibe-git align export <alignment-id>
```

### 任务：BUILD

发布任务不等于所有 Agent 自动开工。负责人必须主动拉取、确认、开始和完成：

```powershell
vibe-git task list
vibe-git task pull <task-id>
vibe-git task push <task-id> execution.md
vibe-git task start <task-id>
vibe-git task sync <task-id>
vibe-git task done <task-id>
```

Codex 退出不等于任务完成。先 `task sync`，确认状态新鲜，再由负责人执行 `task done`。需要把本地改动接入任务时，根据真实状态使用 `task integrate <task-id>`。

### Codex 审核池

每个节点可以绑定一个独立的专用 Codex 审核账号，用于检查需求变更可能影响哪些代码。它不替换你的日常 Codex 配置。

```powershell
vibe-git codex bind
vibe-git codex status
```

出现 device-auth 页面时由用户完成授权。不要读取、复制或公开 `~/.vibe-git/audit-codex` 中的凭据。

### 需求变更：CHANGE

开发中发现需求要改变时，队员可以让 Skill 整理变更单：

```powershell
vibe-git pr submit change.md
vibe-git pr list
```

这里的 PR 是 **Vibe-Git 内部需求变更单**，不会创建 GitHub Pull Request。它应包含原需求、修改内容、影响任务、兼容性和验收标准。

队长审核变更：

```powershell
vibe-git review start --force
vibe-git review status
vibe-git review apply <review-id>
# 或者
vibe-git review reject <review-id>
```

如果审核状态是 `NEEDS_EVIDENCE`，先让受影响节点补充证据，不要强行应用。

### 高级能力：阶段、契约和工作流

普通项目可以暂时不用这些命令。复杂项目需要阶段和确认点时，再使用：

```powershell
vibe-git stage activate <alignment-id>
vibe-git stage replan <stage-id>
vibe-git contract list
vibe-git contract show <contract-id>
vibe-git contract ack <contract-id>
vibe-git contract publish <contract-id>
vibe-git work list
vibe-git work pull <workstream-id>
```

不确定是否需要高级能力时，先让 Skill 读取 `vibe-git status` 和面板状态，不要猜 ID。

## 直接复制给 Agent 的话

- “我是队长，检查当前项目工作区，帮我启动 Vibe-Git 房间。”
- “我是队员，这是队长的加入命令，帮我连接并确认状态。”
- “阅读这个项目，生成提案，先展示给我确认，确认后自动上传。”
- “我想修改登录流程，生成需求变更单，确认后提交 Vibe-Git 内部 PR。”
- “帮我连接 Vibe-Git 专用 Codex 审核池。”
- “读取当前状态，告诉我下一步应该执行哪个命令，不要猜 ID。”

## 安全边界

- 加入命令包含注册密钥，只发给预期队员。
- 不要公开 `~/.vibe-git/client.json`、`data/v20/captain.json` 或 `~/.vibe-git/audit-codex`。
- Skill 只在 CLI 成功回执后报告“已上传”“已连接”或“已完成”。
- GitHub 管理代码提交；Vibe-Git 管理团队意图、任务和需求变更。

## 加入群聊

使用手机微信扫描[群聊二维码](assets/vibe-git-wechat-qr.jpg)。图片标注二维码 7 天内有效（9 月 30 日前）；如果扫码失效，请等待项目重新发布新的二维码。
