# 队友接手：先看这一页

交接日期：2026-10-31。后续内容整合、修改、视频重剪和正式参赛提交由接手队友负责。本包没有提交问卷，也没有提交成功回执。

## 当前版本与重要状态

- 本次接手分支：[TFboy1/vibe-git · CityuAI4S](https://github.com/TFboy1/vibe-git/tree/CityuAI4S)。按用户本次指示发布到源仓库的新分支，原有分支保留；旧团队分享仓库的 `codex/research-team-share` 作为历史材料入口。
- 先看[最新 SciencePal 接手指南](docs/submission/sciencepal-handoff/README.md)：含实际 Agent 配置、190/192 项实跑核验、原字节交付包、连接修复与提交续办。
- 冻结功能基线：`dda48233f57ee20e9c8be2d6b21c782b46ece7ba`。
- 现有视频/PDF 材料提交：`94c8ab2a1a5bff6cae4c7b6cf18423350c961974`；公网核验记录：`4c5f20636a160db67b79de00851a6c7c17b935bf`。
- **视频未获使用者认可**：现有 4:38 版本能播放，但操作页面太小、文字卡片过多，未达到讲解操作的要求。重录只采集到 Agent 选择与提案输入两张图，完整新视频尚不存在。
- PDF 为五页可编辑来源生成的技术说明，主案例数字已核对；请队友最终审定、补身份分工与提交。文件中的 final-20261031-v1 是制作版本名，不表示用户已认可或正式提交。
- 先读 [AGENTS.md](AGENTS.md)：保留原版功能、界面与权限，不覆盖历史科研证据。

## 各类内容在哪里

| 你要处理什么 | 文件/入口 | 当前用途 |
|---|---|---|
| 看项目与原版区别 | [原版对照](docs/research/COMPARISON.md)、[原功能保留](docs/research/ORIGINAL-FUNCTION-PRESERVATION.md) | 继承能力、扩展和未完全等同的边界 |
| 队友原适配器贡献 | [整合说明](docs/research/MULTI-AGENT-INTEGRATION.md)、[贡献声明](docs/submission/CONTRIBUTION-STATEMENT.md) | 不把接口、注册表、执行器等继承代码算成个人从零原创 |
| 科研防偏移 | [机制与反例](docs/research/RESEARCH-ANTI-DRIFT-20261031.md) | 原文覆盖、方法约束、评审范围、变更影响与复用 |
| 最主要的真实证据 | [1CRN 两轮记录](docs/research/LATEST-GOVERNANCE-LIVE-20261031.md)、[原始清单](docs/research/latest-governance-live/manifest.json) | 原字节、回执、批准及复用身份；不要改写 |
| 最新功能代码 | [vibe-git](vibe-git) | Host 科研状态机、Relay 通用适配器、Web 原拓扑整合 |
| 现有成品 | [播放页](https://weihanchen000.github.io/vibe-git-research/submission/watch.html)、[更新后的五页 PDF](docs/submission/sciencepal-handoff/project-brief-updated.pdf) | 视频待队友处理；PDF 已更新本次 SciencePal 核验与访问条件 |
| 剪辑/制作源文件 | [制作工具与素材](tools/submission/README.md) | 双语场景 JSON、24 段英文音频、PDF 五页正文、生成脚本、截图 |
| 未完成重录 | [操作视频草稿](tools/submission/operations-draft/README.md) | 只有两张新截图；模拟启动器不是已完整验收的新案例 |
| 填表和来源 | [提交清单](docs/submission/README.md)、[历史填表文本](docs/submission/FORM-COPY.md)、[资源声明](docs/submission/ORIGINALITY-RESOURCES.md) | 身份已填入草稿；实际分工核对、评审权限、视频与最终声明仍待完成 |
| 观看/运行/恢复 | [简明指南](docs/submission/RUN-AND-RECOVER.md) | 明确只读、模拟、真实重跑的差异 |
| 全部研究文档 | [目录](docs/research/INDEX.md) | 历史实验、校验、对照及局限 |

## 获取代码，先做不花模型额度的检查

```powershell
git clone --recurse-submodules --branch CityuAI4S https://github.com/TFboy1/vibe-git.git vibe-git-cityuai4s
cd vibe-git-cityuai4s/vibe-git
npm run test:latest-live
```

原 Skill 在 Git 子模块中；下载 ZIP 不会包含该子模块正文。建议用上述 clone 命令；已有克隆可运行 `git submodule update --init --recursive`。队友有读取权限不等于有推送权限；若不能 push，可建自己的分支/仓库发 PR，或由仓库所有者另外授权，不要共享个人令牌。

准备运行界面（Node.js 24+）：
```powershell
npm ci
npm run build
npm run research:experiment -- calibration
```
这是已有完整验收记录的模拟路径，不用真实模型。真实账号接入、终端入口和恢复步骤见上表指南。不要把公开 GitHub Pages 回放当成新建任务的在线服务。

## 统一口径，别混用历史数字

主项目 `85455c15-1857-4c5f-a876-85ca8b6cf7fa`：单操作者、单机、一个 SciencePAL 账号。共 **31 份附件、34 条输入回执、11 次作业**：
计算 1 + 上游评审 2 + 报告执行 2 + 报告评审 3 + 对齐 2 + 变更评审 1。

SciencePAL Biology 实际计算 1CRN SASA，结果 **2967.6165 Å²**；与预先独立 NumPy 5000 点参考 2973.1627706139175 Å² 相差约 **0.1865%**，在约定 2% 内。原代码/版本缺失后有人工补证，评审格式失败有重试。补证与报告变更未重跑上游，但不代表评审无成本或整体更省钱。

旧 23/29、12/20 是其他历史包；此前误配置尝试也另有计算。“只算一次”只指上述成功项目。本轮未重新计算 SASA；新增 SciencePal 交接核验首轮 190 项、追问 192 项通过，与历史 11 次科研作业分别计数。真人跨电脑、双账号与节时效果未验证。原软件流程有些执行中选择性暂停行为不等同于科研阶段边界复用。

## 建议接手顺序

1. 阅读当前证据和贡献边界，先独立运行离线核验。
2. 重剪视频：让实际操作页面占主体；每段只解释一个动作，展示按钮、点击前后状态、失败原因和恢复结果。界面骨架保持原版。模拟操作始终标明，不能把模拟计算说成真实 SciencePAL 运行。
3. 对齐最终讲稿、视频、PDF、播放页与填表文案；更新材料版本、时长、页数和哈希。改变功能后自行运行受影响测试，并保留所用代码 commit。
4. 核对[本次 SciencePal 实跑回放](https://sciencepal.ai/share/026c4e92-32d3-462a-8f6d-6b54d48aeca6)及[接手步骤](docs/submission/sciencepal-handoff/README.md)。公开回放只读；新任务需要本人账号和 Agent 授权。评审邮箱尚未提供，不能把只读链接称为可运行入口。
5. 队长/接手人核对已填写的报名信息、拟定分工、赛前/赛期划分和资源说明，完成视频与评审权限，确认最终声明后提交并保存回执。

[官网](https://sciencepal.ai/hackathon) · [正式表单](https://wj.qq.com/s2/28257934/cce2/)。已核对的截止为 **2026-10-31 23:59（北京时间/香港时间）**，以问卷系统为准。浏览器草稿已填写至最终声明页，并上传现有视频、更新 PDF 和补充包；最终声明及协议未勾选，尚未提交。不要假定未提交草稿已由平台持久保存。

## 交接检查及未上传内容

原功能冻结检查包括 59 项相关测试、前端构建、公开回放构建和真实证据离线核验。随后本轮修复通过科研 310、兼容 40、前端 59 项测试和 20 项混合协作模拟，构建与隔离安装包检查通过；各组有重叠，不相加为独立总数。现有视频完整解码、实际公网播放/章节跳转、五页 PDF 渲染及线上原字节核验通过；这不代表视频讲解质量已获认可。

新增制作脚本去除了个人目录，默认生成到忽略目录 `output/submission-rebuild`，不自动覆盖公开成品。具体交接复验结果见制作目录 README。操作重录模拟脚本仅保留草稿状态，不能当作完整验收证据。

不上传：SciencePAL Key、认证文件、成员令牌/邀请、私有数据库、浏览器会话、临时启动链接、node_modules、未脱敏完整日志。已公开科研证据原件不改写；生成中间帧可由素材重建，不重复提交。新增文件清单与校验见 [制作源清单](tools/submission/SOURCE-MANIFEST.json)。
