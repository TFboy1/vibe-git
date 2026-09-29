# 前端重建交接

分支：`codex/frontend-rebuild`，基于 `codex/intent-workbench` 的 `6c6ccdc51e0e6ad1b830b0b055c6cd2557d2ee89`。

## 当前状态

- 移除 `vibe-git/apps/web` 中的旧 React 前端、构建配置、依赖声明和 Git 已跟踪产物，仅保留目录说明。
- 移除根目录 `apps/web` 的历史前端，以及 `ui-review` 中的界面演示与生成脚本。
- 保留文档站、品牌素材和历史设计文档，供后续重建参考。
- 保留 Host、CLI、Relay、共享协议、数据库与已有后端测试。后端继续使用 Node.js / TypeScript / Fastify / SQLite。
- 本次仅准备重建起点，尚未初始化新的前端项目。旧版代码可从上述原分支和提交恢复。

本地被 Git 忽略的 `dist`、依赖缓存与 `tsbuildinfo` 因自动审批拒绝删除而保留，不纳入新分支。Host 默认禁用页面托管，本机控制桥在前端 `package.json` 缺失时也不加载这些旧产物。

## 后端开发

在仓库的 `vibe-git/` 子目录执行：

```powershell
npm ci
npm run build
npm run dev
```

Host 默认监听 `8787`，健康检查为 `GET /health`。开发数据默认位于用户目录下 `.vibe-git/development-host`，可通过 `VIBE_GIT_DATA_DIR` 设置；原有仓库 `data/` 与房间数据保留。

```powershell
npm run typecheck
npm test
npm run dev:relay
```

`build` 构建 Protocol、Host、CLI 和 Relay。`test` 运行当前 Host 主线、CLI 和 Relay 测试。`scripts/check.ps1` 同样只检查后端。

根目录的历史 AgentGit 后端和插件运行时也保留，可在仓库根目录执行 `npm test` 验证。

## 新前端接入

可在 `vibe-git/apps/web/` 初始化 Vue + Vite 项目。工作区通配配置仍保留 `apps/*`，添加 `package.json` 后即可加入工作区。

| 保留入口 | 源码位置 | 作用 |
| --- | --- | --- |
| 共享类型 | `packages/protocol/src/` | 房间、需求、任务、契约与事件模型 |
| Host API | `apps/host/src/v20/routes.ts`、`coordination-routes.ts` | `/api/v1/*` 协作接口与事件流 |
| 本机控制桥 | `apps/cli/src/local-panel.ts` | `/api/local/*`、本机 Codex、工作区选择、需求梳理与 Host 代理 |
| CLI | `apps/cli/src/index.ts` | 房间启动、加入、凭据、任务执行与同步 |
| Relay | `apps/relay/src/` | 执行与 Git 探测 |

Host 默认只提供 API。若要恢复同源页面托管，向 `buildApp` 显式传入 `staticDir`；静态文件托管能力仍保留。`scripts/preview.mjs` 当前以 API 模式运行。

本机控制桥仍保留一次性票据、HttpOnly 会话、同源写入校验和 API 代理。重建前端输出到 `apps/web/dist` 后，控制桥可继续托管；独立 Vite 页不自动拥有本机控制桥会话。

新增前端后，再恢复 `dev`、`build`、发布文件列表及检查脚本中的前端入口，并执行前端生产构建。界面验证由用户自行完成。

## 本次验证

- `npm run build`、`npm run typecheck` 通过，均仅处理后端工作区。
- 当前主线测试通过：Host 34 项、CLI 11 项、Relay 3 项；根目录历史后端测试 6 项通过，共 54 项。
- 临时内存数据库下的健康检查与 Captain 认证 API 通过，默认 Host 不加载旧前端产物。
- npm 打包预检包含 Host 与 CLI，不包含旧前端文件。未进行前端界面验证。
