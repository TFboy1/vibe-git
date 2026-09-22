# AgentGit v0.4 / M0

产品入口是 **Codex 原生插件**。网页不是 M0 操作入口，不需要上传、下载或复制计划。`DEVELOPMENT_PLAN.md` 与原始中文策划文档字节一致。

## 队长启动

```powershell
cd C:/path/AgentGit
npm ci
npm start
```

Node.js 22.13+；Host 的唯一 npm 依赖是锁定的 ws 8.21.0。默认本机 4399，状态保存在 `.agentgit/host`。可设置 PORT 和 AGENTGIT_HOST_DATA 隔离测试房间。Host 不暴露任意 shell、Codex RPC 或目录浏览。

Host 启动后，本机 `.agentgit/host/access.json` 包含接入资料。只向队友提供 base、room_id 和 invite，不发送 admin 或整个文件。默认不注入任何三人提案。之前网页演示的数据仍保留在旧目录，正式验证应使用新目录。

跨设备运行 `./scripts/Start-Tunnel.ps1`，使用它显示的 HTTPS 地址替换邀请里的 base。该脚本只使用隔离配置 `.agentgit/tunnel/quick-tunnel.yml`，不修改用户已有 cloudflared 配置。若未安装 cloudflared，可使用项目隔离目录 `.agentgit/bin/cloudflared.exe`。官方发布：[cloudflare/cloudflared](https://github.com/cloudflare/cloudflared/releases)。临时隧道关闭后公网入口失效。

## 每位成员安装完整插件

```powershell
.\scripts\Install-AgentGit.ps1
.\scripts\Start-Relay.ps1
```

要求本机已有 Codex、Node.js、Python 3 和 PowerShell 7。安装器使用随附的 plugin-creator 辅助脚本维护个人插件源，然后调用 `codex plugin add`；包含 Skill、stdio MCP Bridge 和 Relay 代码。不是只执行 `codex mcp add`。它按本机实际 Node 和运行目录生成绝对路径，不依赖未经证实的 MCP 环境变量展开。保留 `~/plugins/agentgit` 运行目录。重装后新会话生效。

Relay 是后台协作进程，先保持此终端运行。默认绑定 127.0.0.1:4400，数据在 `~/.agentgit/relay`。本地 IPC 要求密钥，浏览器跨源访问被拒绝。成员凭据不出现在工具结果里。同一 Relay 只能绑定一个成员、一个仓库和房间；其他项目需要独立数据目录、端口，并配置对应 Bridge 环境变量。

新 Codex 会话选用 AgentGit Skill，按自然语言操作：

1. “用 AgentGit 加入这个房间”，提供邀请、自己的名字和当前仓库。
2. 使用原生 `/plan`，整理本人选定的项目提案。
3. “准备这份项目提案的提交预览”。工具冻结完整 UTF-8 正文，返回 submission_id、content_hash、字节数和全文。
4. 本人看过这一冻结版本后说“确认提交这个版本”。不能把“实施此计划”按钮当作提交授权。
5. 收到 Host 的 submitted 回执后，再报告提案版本；pending_confirmation 只表示结果未知，后台按相同键补发。
6. “读取我的验证任务”。返回 fixture=true、execution_allowed=false 的完整任务包，不允许据此改项目代码。

prepare、submit、join、sync 和 read_tasks 都不是 read-only。Plan 若不允许这些写入，用原生模式切换后再执行；沙箱权限保持原样，不借模式切换扩大权限。

## 通信与恢复

- 业务正文由短 HTTP 请求发送；远程 Host 要求 HTTPS。
- WebSocket 首条消息认证，连接只推送持久化游标提示，无凭据 query string。经隧道时使用 WSS。
- Relay 使用 HTTP 补收事件，event_id 去重，心跳和断线重连；后台同步不等于 Codex 已读。
- sync 返回本地持久化收件箱最近 100 条本人相关事件，避免后台补收后消息从下一次工具调用中消失。
- 任务单独记录送达与工具读取。没有空闲会话自动唤醒或强制中断承诺。
- SQLite WAL/短事务保存权威状态、回执、冻结稿和本地游标；只处理已明确准备/提交的内容。

## 边界

当前没有 Coordinator、共同定案、正式任务派发、TaskPlan 审核或执行许可。每位成员加入时取得的任务都是 M0 fixture。不采集聊天、录音、转写或历史 transcript。Hooks 尚未启用，用“同步团队状态”读取，不自动信任 Hook。

临时隧道跨设备、域名更换恢复、身份撤销/邀请过期、SessionBinding 多会话多项目路由仍需后续增强。现有仓库绑定与本机单身份隔离不能冒充完整 SessionBinding。现有请求大小上限为 250KB，提案 UTF-8 正文上限为 200KB；超限明确拒绝，不截断。

## 下一批任务

先完成支持矩阵中的 M0 未验证项，再进入 M1：三份真人提案、固定 ProposalSet、来源比较、同版团队确认。不能用预置样例替代真实提案。

完整安装、模式实测和环境失败记录以 `M0-VALIDATION.md` 为准。旧网页技术 Demo 的历史说明不在本导出包中。
