# Vue 超敏捷工作台

Vue 3 + TypeScript + Vite + Pinia + Vue Router。Milkdown Crepe 按需加载正文、标题、列表和表格功能，配合文档大纲、自动保存及 Markdown 导入导出。

四个入口：房间与计划、需求文档、任务包、需求变更。通过现有本机票据与 Cookie 访问 CLI 控制桥，Host 复用节点凭据。生产构建使用 `npm run build -w @vibe-git/web`，输出 `dist-agile`；运行与工作流见[超敏捷协作](../../docs/AGILE-WORKFLOW.md)。浏览器和交互由用户自行验证。

旧前端保留在 `codex/intent-workbench` 分支及提交 `6c6ccdc51e0e6ad1b830b0b055c6cd2557d2ee89` 中。
