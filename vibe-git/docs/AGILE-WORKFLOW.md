# Vibe-Git 超敏捷协作

分支：`codex/frontend-rebuild`。前端使用 Vue 3、TypeScript、Vite、Pinia、Vue Router 和 Milkdown Crepe；后端保留 Fastify、SQLite、CLI、Relay 及原节点作业系统。

## 从源码运行

在仓库的 `vibe-git/` 子目录：

```powershell
npm ci
npm run build
# 使用你自己的独立项目目录；不要选 Vibe-Git 安装目录。
node apps/cli/dist/index.js host start "<新项目绝对路径>"
node apps/cli/dist/index.js open
```

成员运行队长在 Settings → 团队成员生成并复制的邀请命令连接自己的工作区，再运行 `vibe-git open`。可以 `npm link` 后直接使用 `vibe-git` 命令。首次配置算力：Settings → 算力与 API → Codex 节点池或自定义 API；本机登录与设备授权统一在 Codex 连接与额度中管理。

新项目对应的新房间默认使用超敏捷流程。已有数据库保留原有模式，不会转换旧流程，也不会清库。已有 Host/守护进程要使用本次构建的新代码；停止和重启应在当前作业结束后由你选择时机操作。

历史房间也可以在本机工作台创建、更新个人计划；需求变更页同时显示原有变更提案、旧版 PR 和新版 PR。队长可以勾选同一需求阶段的多条待审记录，点击“统一审核 N 个 Issues”进入一次统一分析；三态复选框用于全选、部分选择与清空待审批次。历史记录及原首轮流程保留，只有明确启动的审核批次使用新流程。通知保留发送时的文字，同时显示关联记录的当前状态，并可以打开对应的变更或任务。未读消息数量包含任务和历史事件，与待审核变更数量分别计算。

## 工作台入口

保留 Code、Issues、Pull requests、Agents、Projects、Wiki 和 Settings 七个主导航。Code 内切换成员工作与个人计划；列表搜索统一放在顶栏，支持回车提交与 `/` 聚焦。搜索保留任务视图和当前筛选，从详情提交搜索时返回结果列表。Codex 分析、分工和审查建议收进各页面或成员分支的“更多”，继续传递所选对象。Agents 提供只读分析与草稿复用，正式操作在相应业务页面执行。

| 页面 | 队长 | 成员 |
| --- | --- | --- |
| 个人计划 | 提交计划，收齐或明确跳过后整合 | 编写或导入并提交自己的计划 |
| Wiki · 需求文档 | 渲染式编辑、标题大纲、自动保存、导入导出、历史版本；文档底部生成分工或进入分工审核 | 查看草稿和正式版本 |
| Projects · 任务看板 | 统一预览分工，调整目标、负责人、边界、验收和依赖，再保存或派发；选中任务后批量分配或提交改派 Issue | 查看本人任务状态 |
| Projects · 任务包 | 查看已派发、完成与归档记录，分工草稿从看板进入 | 查看本人任务与修订，通过 Skill 传达开工和进度 |
| Issues · 需求变更 | 自选时机批量审核，逐项裁决，确认采纳/退回并生成 R2；取消与整批退回从审核“更多”进入 | 提交需求变更 Issue |
| Settings | 邀请和移除成员、管理算力与 API、配置仓库、修改个人资料与连接本机 Codex | 配置仓库、修改个人资料与连接本机 Codex |

Plan 模式每题恰好三个方案和一个自定义入口，必要时继续追问。无冲突时首轮直接生成需求草稿。正式需求与整批任务包在同一事务中发布。

## 开发期间的变更

审核冻结选中的 PR、需求版本和任务内容；未选中的和新提交的 PR 留到下一批。Codex/API 一次联合分析 PR 之间、PR 与需求及任务包的冲突，不逐 PR 发布。CLI 可用 `vibe-git agile review <pr-id> <pr-id>` 指定批次，不传 ID 时纳入本阶段全部待审记录。只按需求 MD 与任务包分析影响，不要求代码取证或全员在线。受影响的未完成任务暂停，其他任务可继续报告进度。

队长编辑新版正文后，分工阶段会重新核对影响范围；新增受影响任务在预览前暂停。预览展示任务目标、边界和验收的真实前后差异；照搬原任务、仅换草稿标识或需求引用的结果会被拒绝，可保留需求草稿并重试生成。任务包向所有成员重新发布；未受影响任务保留负责人和进度，已完成任务通过关联后续任务返工，撤销任务归档。

取消审核把 PR 放回队列并恢复任务；整批退回不产生空版本。失败可重试，保留答案和草稿。需求修改会使旧分工失效，迟到 AI 结果不能覆盖新草稿。

## Skill 与 CLI

每次 Skill 调用先 `task inbox`，成员无需领取、开工或修订确认。暂停消息在下一次 Skill 调用时由当前开发 AI 处理，不运行常驻协作 Agent。

```powershell
vibe-git profile set "我的名字"
vibe-git plan submit <计划.md>
vibe-git task inbox
vibe-git task package <task-id> [output.md]
vibe-git task report <task-id> <report.json>
vibe-git pr submit <变更.md>
vibe-git agile wait <flow-id> 600
```

报告动作 `started/progress/blocked/completed`；携带实际读取的任务包版本及需求版本。完成必须附非空验证证据。报告用唯一 `reportId` 支持重试，不能给旧结果补填最新版本号。详细格式见仓库 Skill 的 `references/agile.md`。

## 自定义 API

Base URL 只追加 `/responses`，不自动补 `/v1`。配置模型名和 Key 后，连接测试同时检查原生 Responses 与严格 JSON Schema 输出。整合、追问、需求和分工都支持 Codex / API。

Key 只保存在队长本机配置，Host 保存的只有算力类型及执行节点 ID，查询不会回显 Key。API 请求由队长配置所在的守护进程执行。

## 开发与打包

`npm run dev` 同时启动 Host 与 Vite；本机会话开发优先先启动 CLI 守护进程，再设置 `VIBE_GIT_PANEL_URL` 为它的本机地址并执行 `npm run dev:web`。Vite 代理本机 API，保留票据和 Cookie 身份，不把节点凭据写入前端。打开由 `vibe-git open` 建立的会话后，在相同 `127.0.0.1` 主机访问开发端口。

生产构建输出 `apps/web/dist-agile`。Host 显式托管此目录，本机控制桥使用同一产物；旧 `dist` 缓存不会被加载。npm 包包含前端产物和当前共享协议，避免安装到旧版协议导出。

验收命令：`npm run typecheck`、`npm test`、根目录历史后端 `node --test tests/*.test.mjs`、`npm run build` 和 `npm pack --dry-run`。前端只做类型编译与 build，浏览器交互由你验证。全部文件读写采用 UTF-8。
