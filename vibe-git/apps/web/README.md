# Vue 超敏捷工作台

Vue 3 + TypeScript + Vite + Pinia + Vue Router。Milkdown Crepe 按需加载正文、标题、列表和表格功能，配合文档大纲、自动保存及 Markdown 导入导出。

保留 GitHub 风格的七个主导航。Code 子导航进入成员工作与个人计划；需求页统一生成分工，Projects 任务看板统一审核和派发，任务包视图查看已派发记录。邀请、个人资料、仓库配置和 Codex 登录集中到 Settings。业务页的 Codex 建议与次级操作收进“更多”，保留任务、负责人和成员分支上下文。

列表搜索统一使用顶栏：首页搜索成员与工作，Issues 搜索需求变更，Pull requests 搜索成员分支，Projects 看板及任务包搜索任务。回车提交，`/` 聚焦；搜索保留当前视图和筛选，并从详情返回列表。窄屏保留搜索框，其他页面隐藏搜索。

通过现有本机票据与 Cookie 访问 CLI 控制桥，Host 复用节点凭据。生产构建使用 `npm run build -w @vibe-git/web`，输出 `dist-agile`；运行与工作流见[超敏捷协作](../../docs/AGILE-WORKFLOW.md)。浏览器和交互由用户自行验证。

旧前端保留在 `codex/intent-workbench` 分支及提交 `6c6ccdc51e0e6ad1b830b0b055c6cd2557d2ee89` 中。
