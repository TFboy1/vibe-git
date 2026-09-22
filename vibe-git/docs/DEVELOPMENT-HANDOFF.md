# v0.10 续开发交接

更新日期：2026-09-22。

## 恢复来源与边界

开发进度由外层 codex-imports 中的对话记录恢复。上次停在 Web v0.10 迁移后补样式与编译检查。本轮沿用内层工作区 React + Fastify + SQLite，没有迁移技术栈、清空数据库、启动 Tunnel 或执行前端浏览器验证。

## 本轮完成

1. 统一新旧服务请求指纹：成员 + 操作 + 递归规范化 JSON 载荷。对象键顺序无关，数组顺序保留；候选/正文 contentHash 算法不变。
2. 幂等缓存升级为 v2，跨成员或不同内容不能复用回执；旧指纹保守冲突。先核对服务端历史状态，不能通过盲目换 requestId 重复操作。
3. Relay 增加可选 WORK_UNIT_ID；Host 校验 WorkUnit 归属与 TaskPackage 绑定；错误心跳回滚设备、Git、事件及幂等写入。
4. WorkUnit 验收只使用精确单元 Git HEAD，禁止回退到旧 Task 记录。多人共享同一 TaskPackage 的 Git 引用独立保存。
5. 普通 status 接口禁止直接设置 READY；start 再次核对当前契约的 Plan PASS 及 real/available 标记。
6. 控制台修正 Issue 提交失败清空、启动能力与重复启动禁用状态、初始连接失败重试；增加 Issue 列表和证据步骤/预期/实际结果详情。写入成功但快照刷新失败会明确提示不要重复提交。
7. 增加统一检查脚本 scripts/check.ps1，不依赖 npm 命令在 PATH 中，也不安装依赖、不做前端测试。

## 实际验证

执行 scripts/check.ps1 并正常退出：

| 项目 | 结果 |
|---|---|
| Protocol / Host / Relay / Web 类型检查 | 通过 |
| Host 自动化测试 | 31/31，通过 |
| Relay 本机 Git 测试 | 3/3，通过 |
| Protocol / Host / Relay 构建 | 通过 |
| Web TypeScript + Vite 生产构建 | 通过 |
| 浏览器、视觉、响应式、交互验证 | 未执行，按用户要求由用户自行验证 |

Web 构建产物：apps/web/dist。测试运行使用内存 SQLite 与临时 Git 仓库，没有向业务数据库注入测试 Agent 记录。

## 下次继续的明确入口

优先完成真实接入信任边界，而不是把合成记录当作上线证明：

1. 成员/设备凭据与可信 AgentRun 登记，避免仅凭请求中的 real/available 字段获得放行资格。
2. PM / Coordinator / Plan Review 的真实适配器与运行引用核验，区分状态机测试和真机证据。
3. Relay 对启动租约及暂停命令的执行与回执；不能把 ISSUED / STARTING 当作 RUNNING。
4. 按使用需要补齐网页中的模块认领、证据提交、冻结例外和模块集成表单；目前已有后端入口，但不是完整网页闭环。
5. 两台/三台真机的 Cloudflare、SSE 重连、Git 交换及长期恢复验证。

重要：尚未实现生产认证与可信 Agent 运行核验；本轮不声称完整 v0.10 或 M0 真机验收完成。

## 2026-09-22：用户要求启动且不再使用演示数据

- 默认种子逻辑改为空白初始化；fixtures 只能由测试显式 seedDemo: true 开启。
- 当前真实数据路径为 data/workspace.db，与旧演示数据库 data/vibe-git.db 隔离。旧库原样保留，并通过 SQLite backup API 创建包含 WAL 已提交内容的一致性快照，保存到 data/backups。
- 新增本地项目创建页（项目名、三位真实成员称呼），项目元数据持久化且不能覆盖已有项目。
- 新增个人提案与首版候选录入。没有预置正文；必须三人分别提交并确认同一候选，才创建首条正式 REQ-ROOT / R1。
- 修正首次提交提案时随机 ID 在幂等操作键中导致重试冲突的问题。
- 前端明确提示空模块状态，不伪称已完成模块/任务创建及真实 Agent 自动执行。
- 新增 scripts/start-local.ps1 / stop-local.ps1：后台隐藏窗口、固定本机端口、启动阻塞等待后端健康与监听端口，停止前校验记录进程对应本工作区入口；不注册系统服务或开机自启。
- 完整检查通过：36 项 Host + 3 项 Relay，四工作区类型检查与全量构建。未做前端浏览器验证。
- 服务已在 http://localhost:4173 启动，Host 为 http://127.0.0.1:8787。启动后的只读 API 核验显示 initialized=false、demo=false、R0、所有业务数组为空；没有创建样例项目或提案。

## 2026-09-22：Codex Connect 与自动开工职责拆分

- `ConflictReview` 是独立审核对象。Host 可对共识候选、变更和已有冲突发起只读 Codex 审核，输出受 JSON Schema 约束，包含分类、证据、严重度与多个解决方案；结果不会自动批准或应用。
- `ExecutionCommand` 是独立执行对象。WorkUnit start 同一事务创建 lease + command，WorkUnit 先保持 READY/STARTING；Relay 领取并回报 STARTED 后才进入 IN_PROGRESS/RUNNING。
- Relay 使用 `/api/relay/commands/next` 阻塞长轮询。`auto` 默认优先 App Server，也可选 `app-server` 或 `cli`；客户端路径使用 initialize → thread/start → turn/start，CLI 路径使用 `codex exec --json --sandbox workspace-write`。
- 队长暂停会在存在活动运行时排队 INTERRUPT 命令；Relay 调用 turn/interrupt 或终止 CLI 进程后回执。Codex COMPLETED 只产生 FINISHED，WorkUnit 仍需 Git 证据和人工复核才能 DONE。
- 新增 `scripts/start-relay.ps1`。工作区路径仅由成员本机配置，Host 不下发任意 Shell 命令。
- 新增 2 项 Host 集成状态机测试；`scripts/check.ps1` 已通过，累计 38 项 Host + 3 项 Relay，四工作区类型检查与全量生产构建通过；未做浏览器验证。
