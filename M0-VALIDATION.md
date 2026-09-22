# M0 实测状态 · 2026-09-21

总体：**插件已实际安装，原生 Plan 已生成；M0 完整验收仍未通过。** 没有进入 M1，没有用网页或三个 fixture 提案代替原生验收。

## 已完成的代码与验证

- 个人源 `agentgit@personal` 实际安装并启用，包含 Skill 和 stdio MCP。
- Codex App Server 的 inventory 读操作实际返回 `agentgit:agentgit` 和六个工具，`toolsError=null`。详情见 `evidence/codex-inventory.json`。这仅证明加载/握手，不等于模式内提交。
- 安装时将 MCP 启动命令物化为本机 Node 与持久运行目录绝对路径。初版 `${CLAUDE_PLUGIN_ROOT}` 在该环境握手失败；不再依赖该变量展开。
- 6 组自动化测试覆盖：长 UTF-8/CRLF/emoji 正文、SHA-256、幂等修订、SQLite 重开、鉴权、冻结稿、丢回执重试、真实 stdio/Relay/HTTP、WebSocket 鉴权/重连补收、后台同步后审核事件仍可读取。
- npm 依赖 ws 锁定 8.21.0，安装时 audit 为 0 vulnerabilities。

## 原生 CLI 测试（非模拟 Agent）

1. 默认 PATH 的 CLI 0.144.1 登录 ChatGPT，但模型服务返回 400：`The 'gpt-6-astra' model requires a newer version of Codex.` 没有更换模型或绕过错误。
2. 改用本机已安装的桌面内置 CLI 0.155.0-alpha.9.2，仍使用 `-s read-only`。
3. 经原生 `/plan` 进入模式，终端实际显示 `Plan mode (shift+tab to cycle)`。
4. 当前模型完成真实 `Proposed Plan`：“测试提案：三人任务追踪器”，包含目标、建议功能、实现范围、未决列表/看板取舍、验收和个人建议，明确非团队决定。
5. 原生“Implement this plan?” 确认被取消，没有把实施按钮当成提交许可。
6. 请求在当前 Plan 中加入隔离房间并冻结上述完整正文。模型遵循模式规则，拒绝 join/prepare，说明应先退出 Plan。没有生成 submission_id，也没有提交。

这里的拒绝是原生模式下的实际行为观察，**没有证明独立底层沙箱能强制拦截所有 MCP 写入**。在本次 Windows PTY 中 Shift+Tab 没有产生可确认的模式变化，因此没有伪称已切到 Default，也没有改写模式提示或权限。原生 Default 模式的 prepare/submit、真人确认、同一会话读回任务仍须继续验收。

测试终端仅收集上述明确选定的测试交互结论。没有解析 transcript 文件、采集日常对话或从其他用户会话获取 Plan。

收尾时测试 PTY 句柄已失效，未取得可交付的 resume ID。原生模式切换和提交验证需在用户可交互的终端重新完成。临时 Host/Relay 已停止；安装的插件和测试数据保留。没有冻结稿或已提交真人提案。

## 隧道实测

- 官方 cloudflared 2026.9.1 已下载至项目隔离 `.agentgit/bin/cloudflared.exe`，不安装系统服务。
- 隔离 Host 在 127.0.0.1:4409、`.agentgit/m0-host` 运行，未加载三人样例。
- 普通沙箱请求 Quick Tunnel 被本机网络权限拒绝；真实用户环境重试后，`https://api.trycloudflare.com/tunnel` 等待响应超时。
- 没有获得公网域名。因此 HTTPS/WSS 经 CF、跨设备成员连接均**未验证**。本机 WebSocket 测试不能替代这部分。
- `Start-Tunnel.ps1` 使用隔离配置，支持已安装命令或项目内二进制。隧道尚未创建，不存在遗留公网入口。

## 支持矩阵

| 运行端/能力 | 实测结论 |
|---|---|
| Windows Node 22.23.2 Host/Relay/MCP | 自动化通过 |
| Codex 完整插件安装 | 实际安装且 enabled |
| 0.155.0-alpha.9.2 Skill/MCP 加载 | 1 个 Skill、6 个工具；握手通过 |
| 原生 CLI Plan 生成 | 真实 Proposed Plan 已完成 |
| Plan 内 join/prepare | 模式行为拒绝；未调用写工具 |
| 原生 Default prepare/submit | 待模式切换后实测 |
| 真人确认冻结 hash 后提交 | 未进行，不能代替本人确认 |
| Codex 同会话读取 fixture 任务 | 尚未原生验证；stdio 测试已通过 |
| 桌面 UI 成员完整流程 | 未验证，不以 CLI 代替 |
| Hooks/空闲会话唤醒 | 未启用；同步技能为回退 |
| 本机 WS/游标重连 | 通过 |
| CF HTTPS/WSS/跨设备 | 网络超时，未验证 |

## 下一批任务顺序

1. 在真实终端完成原生模式切换，继续同一会话准备完整提案；本人确认具体冻结稿后提交、读取验证任务。
2. 网络可用后重试临时隧道，验证另一台设备的加入、提交、WSS 断线和游标补收。
3. 增加成员撤销、邀请生命周期、配对幂等、稳定房间身份检查和完整 SessionBinding。
4. M0 验收完成后才进入 M1 来源比较与共同定案。
