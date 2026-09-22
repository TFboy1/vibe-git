# Vibe-Git 0.20

Vibe-Git 是一个 **CLI 主导、网页观察** 的多人 Codex 协作控制面。队长只启动一个 Host 和 Cloudflare Quick Tunnel；每位成员从自己的 Git 工作区连接，不需要填写项目名称、成员名字或固定 A/B/C 身份。

## 安装

需要 Node.js 24+、Git、Codex CLI。

```powershell
npm install
npm run build
npm link
```

`npm link` 后可直接使用 `vibe-git`。不想全局链接时，可将下文命令中的 `vibe-git` 替换为：

```powershell
node .\apps\cli\dist\index.js
```

## 1. 队长启动

请先进入队长自己的 Git 工作区，再运行：

```powershell
vibe-git host start
```

该命令会：

1. 启动 Fastify Host（同源托管构建后的 React 页面）；
2. 创建稳定 Captain 节点并启动隐藏后台守护进程；
3. 安装/启动 Cloudflare Quick Tunnel；
4. 输出成员可复制的 `vibe-git connect <join-url>`。

常用管理命令：

```powershell
vibe-git host status
vibe-git invite show
vibe-git invite rotate
vibe-git open
vibe-git host stop
```

`invite rotate` 只让旧加入链接失效，不影响已经注册的节点。

## 2. 每位成员连接

每位成员先进入自己的 Git 工作区，再粘贴队长给出的命令：

```powershell
vibe-git connect https://xxxx.trycloudflare.com/join/xxxxx
```

连接成功后会自动得到 `Member-XXXX` 和稳定节点 ID，并启动隐藏后台进程。不会上传主机名。

```powershell
vibe-git status
vibe-git logs
vibe-git open
vibe-git disconnect
```

`vibe-git open` 创建只能使用一次的短期票据，浏览器再换取 HttpOnly 会话；网页没有身份切换器。

## 3. 绑定专用 Codex 审核池

队长和每位成员都建议执行：

```powershell
vibe-git codex bind
vibe-git codex status
```

绑定使用官方 Codex device-auth，凭据单独保存在：

```text
~/.vibe-git/audit-codex
```

它不会读取或覆盖日常 `~/.codex`。Host 只收到“可用/不可用”和脱敏的 5h/周额度百分比，不接收账号、邮箱或 OAuth Token。

专用池只执行：

- 多份 `plan.md` 的需求对齐与任务拆分；
- 多份 `change.md` 的冲突与影响范围审核。

真正的开发任务使用成员日常 Codex。默认 App Server 优先、CLI 回退：

```powershell
vibe-git config set work.transport auto
# 也可明确指定 app-server 或 cli
```

解绑专用审核账号不会影响日常 Codex：

```powershell
vibe-git codex unbind
```

## 4. 提交计划并对齐

成员只维护文件，不填写网页表单：

```powershell
vibe-git plan submit .\plan.md
```

文件必须是 UTF-8、非空、文件名严格为 `plan.md`，上限 256 KiB。重复内容是幂等的；变更内容会形成新版本。

队长决定何时冻结当前各节点最新计划并启动对齐：

```powershell
vibe-git align start
vibe-git align status
vibe-git align export <alignment-id>
```

审核池按“活动作业更少 → 额度更高 → 最久未使用”选择节点。对齐输出包括 `alignment.md`、`tasks.md` 和结构化任务。队长可以在发布前改派：

```powershell
vibe-git task assign <draft-task-id> <node-id>
vibe-git tasks publish <alignment-id>
```

## 5. 细化、开工、同步与完成

```powershell
vibe-git task list
vibe-git task pull <task-id>                 # 默认写出 task.md
vibe-git task push <task-id> .\task.md
vibe-git task start <task-id>
vibe-git task sync <task-id>
vibe-git task done <task-id>
```

- `task.md` 只能补充执行步骤、文件范围、验证命令和备注，不能覆盖正式目标、边界或验收。
- 发布任务不会自动抢跑；只有负责人执行 `task start` 才会向自己的 Codex App Server/CLI 发命令。
- 后台每 15 秒同步 Codex 阶段、Git 分支、完整 SHA 和 dirty 状态，不上传对话正文或工具记录。
- Codex 正常结束后状态为 `WAITING_CONFIRMATION`。负责人必须在结束后做一次新鲜同步，才能 `task done`。
- 离线节点的任务和消息会保留，重连后继续领取。

## 6. Vibe-Git Pull Request 与需求审核

这里的 Pull Request 是内部需求变更单，不会创建 GitHub PR：

```powershell
vibe-git pr submit .\change.md
vibe-git pr list
```

开发中可以持续提交。普通成员不能开启审核；所有任务完成后自动审核。队长若要开发中提前审核：

```powershell
vibe-git review start --force
```

审核开始会向全员写入持久消息。主控 Agent 合并分析当前批次，给出冲突、完整需求补丁、受影响节点和替代任务。只有受影响任务会暂停，旧租约立即失效。

结果不会自动应用，必须由队长确认：

```powershell
vibe-git review apply <review-id>
vibe-git review reject <review-id>
```

审核期间新提交的 `change.md` 自动进入下一批。阶段结束后获批的变更会形成下一阶段待发布草稿。

## 网页

运行 `vibe-git open`。页面只有六个区域：

1. 节点与审核池；
2. Plans；
3. 对齐稿；
4. 任务；
5. 变更与审核；
6. 持久消息。

Captain 页面显示队长按钮，成员页面只显示自己的操作。页面使用文件选择、下载、状态按钮、节点选择和确认按钮，不提供自由文本业务表单。

## 安全与数据

- 节点注册后使用独立随机凭据；旧的 `x-member-id` 信任模式已移除。
- 邀请密钥只用于首次注册，节点可由队长撤销。
- Markdown 以纯文本结构安全渲染，不执行 HTML 或脚本。
- SQLite 首次升级到 v0.20 前会自动备份到 `data/v20/backups/`。
- 旧表保留归档，但 v0.20 API 不再暴露；生产启动不会写入 demo seed。
- Quick Tunnel 是临时地址，重启后用 `vibe-git host status` 或 `invite show` 获取新地址。
- 分布式审核采用官方 Codex CLI/App Server 与隔离 `CODEX_HOME`；只借鉴 dsh-codex-connect 的本机凭据隔离、脱敏原则，不调用 ChatGPT 私有后端。

## 开发验证

```powershell
npm run typecheck
npm test
npm run build
```

Host API 健康检查：`GET /health`。运行问题优先查看：

```powershell
vibe-git logs
Get-Content "$HOME/.vibe-git/host.log" -Tail 100
```

