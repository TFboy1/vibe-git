# Vibe-Git 仓库

当前 Vibe-Git CLI 与 Host 位于 [`vibe-git/`](vibe-git/README.md)，安装需在该子目录执行。给 Codex 使用的 [Vibe-Git Skill](https://github.com/TFboy1/vibe-git-skill) 独立发布，包含安装步骤和队长、成员的 CLI 工作流；本项目通过 Git submodule 绑定它。

## 历史 AgentGit M0 导出说明

这是 Codex 原生协作插件的 M0 开发快照，**不是完整 M0 验收通过版**。

入口：M0-HANDOFF.md（安装和操作）、M0-VALIDATION.md（实测、限制和下一批任务）、DEVELOPMENT_PLAN.md（v0.4 规格）。

要求 Node.js 22.13+、Python 3、PowerShell 7 和已登录的 Codex。解压到任意工作目录后：

```powershell
npm ci
npm test
npm start
# 另一终端：安装完整插件并启动成员 Relay
.\scripts\Install-AgentGit.ps1
.\scripts\Start-Relay.ps1
```

安装器会在目标电脑创建/更新个人 AgentGit 插件并生成本机路径。新开 Codex 会话加载。不要直接复制本包 MCP 模板到全局配置：安装器负责物化路径。

成员通过 Codex 完成加入、Plan、冻结预览、确认提交和任务读取。apps/web 是上一轮的辅助查看界面，不是 M0 操作入口。scripts/demo.mjs 仅用于明确标记的网页 fixture 演示。

本包不含真实房间、成员凭据、冻结稿、数据库、私钥、API 密钥、聊天记录、依赖缓存或 cloudflared 可执行文件。首次运行会生成新的本机状态；公网验证需自行安装官方 cloudflared。

历史文档 README-AGENTGIT.md、VALIDATION.md 未导出；有关旧文档的引用只说明来源，不是缺失的当前操作步骤。

文件校验见 EXPORT-MANIFEST.json，去敏范围见 SANITIZATION-REPORT.md。
