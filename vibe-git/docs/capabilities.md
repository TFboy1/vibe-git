# Vibe-Git 能力状态

## 已实现并由自动化测试验证

- Host + SQLite 单机权威状态、事务、room_seq、SSE 事件记录。
- 成员权限、乐观并发、幂等基础、需求三人确认、局部失效。
- Cloudflare Quick Tunnel 本机控制路由、固定命令边界、队长/localhost/origin 防护；真实下载安装只在用户点击后发生。
- v0.10 确定性业务规则（以测试清单和 README 最终结果为准）。

## 已实现但仍需真机验证

- Cloudflare 官方二进制下载安装、Authenticode/版本验证、真实 trycloudflare URL、跨机 HTTP/SSE 稳定性。
- Relay 读取真实成员工作区分支/SHA（需要成员实际 Git 工作区）。
- Host 侧 Codex Connect CLI 探测、只读结构化审核适配器与审核记录持久化。
- Relay 长轮询命令、Codex App Server / CLI 执行适配器、真实启动/完成/失败/中断回执状态机。

## 未验证或未接入

- 个人 Agent 的真实严格 PM 审查运行与质量。
- Coordinator 的真实自主降级模型调用。
- Codex Hook/Plan 候选捕获；App Server / CLI 执行仍需三台目标设备长时间真机验证。
- 两台/三台真机的成员凭据、断线恢复、Git HTTP fetch/push。
- StartBatch、长期离线和复杂语义依赖图。

## 能力状态原则

- `available`：已完成目标环境的真实握手或运行验证。
- `unverified`：代码或入口存在，但未在目标环境完成真实验证。
- `unsupported`：当前环境未发现所需能力或明确不支持。
- `offline`：曾有设备/能力记录，但当前不可达。
- Mock/fixture 只用于开发和测试，不能作为实时 Agent、Codex、Git 或 Cloudflare 成功证据。

## M0 最小清单

1. 两台真机通过 Quick Tunnel 进入同一房间并验证 SSE 重连。
2. 两台机器使用真实成员凭据，验证远程成员不能控制队长机器的 Tunnel。
3. 两个真实 Git 工作区上报不同分支/SHA，并通过选定 remote 交换提交。
4. 对目标 Codex 客户端记录版本，实测 Plan 主动提交、受管理启动、中断与回执恢复。
5. 各运行一次真实 PM Review 与 Coordinator 修订，并将运行引用、输入/输出摘要和人工评审结果写入验收记录。

## 2026-09-22 续开发结果

- scripts/check.ps1 实际通过：四工作区类型检查、38 项 Host 测试、3 项 Relay 测试、Protocol / Host / Relay / Web 生产构建。
- 新增请求一致性回归：字段顺序无关、载荷变化冲突、跨成员/跨操作不可复用、租约唯一、失败事务不产生副作用。
- 新增 WorkUnit Git 回归：同 TaskPackage 多单元独立存储、归属及关联校验、越权心跳整体回滚、旧 Task 引用不能用于单元验收。
- Relay 在临时本机 Git 仓库中验证 clean/dirty、完整 HEAD、detached HEAD、可选 WorkUnit ID 与非仓库降级；不代表跨机 Git 同步验证。
- READY 不能通过普通状态更新产生；签发单元启动租约前再次检查当前 PlanReview。
- Web 完成编译和打包；本轮未进行浏览器、截图、视觉、响应式或交互验证。

### 当前信任边界（必须保留）

x-member-id 仍是演示身份；PM / Coordinator / Plan 的 AgentRunReference 和远端 DeviceSignal 仍可能来自请求数据。Connect 引用由 Host 适配器生成，执行状态由 Relay 回执驱动，但成员/设备还没有密码学凭据。自动化测试可验证状态机，不能代替三台目标设备的真实运行验收。

## 空白真实数据模式

默认不种入 fixtures，使用 data/workspace.db。具备项目初始化、真实成员称呼、个人提案、人工首版候选与全员确认后发布 R1 的入口。模块/任务包创建入口仍未完成；Connect 审核与 Relay 自动开工链路已经实现，不会靠演示记录绕过。当前总计 38 项 Host + 3 项 Relay 测试通过。前端只完成构建，未做浏览器验证。
