# SciencePal 接手指南

更新于 2026-10-31。这里保存本次实际核验、可移交的 Agent 配置及提交续办信息。视频按用户要求保持原样，等待队友处理。

## 先拿到入口和文件

| 内容 | 入口 |
|---|---|
| 本次实际运行回放 | [SciencePal 公开链接](https://sciencepal.ai/share/026c4e92-32d3-462a-8f6d-6b54d48aeca6)，点击“跳到结尾” |
| 保留原字节的交付包 | [sciencepal-evidence-originals.zip](sciencepal-evidence-originals.zip)，公开回放也可下载同名文件 |
| Agent 配置 | [系统提示词](agent-system-prompt.txt)；名称 `Vibe-Git Research｜科研交接核验` |
| 任务与新交接请求 | [首轮/追问指令](SCIENCEPAL-TASK.txt) · [followup-request.json](followup-request.json) |
| 五页项目说明 | [project-brief-updated.pdf](project-brief-updated.pdf)，已逐页渲染检查 |
| 实际回执与失败保留 | [verification-receipts.json](verification-receipts.json) |

原字节 ZIP 为 **394,748 字节**，SHA256：

```text
24b8a44953588071b63b87e0acaf922aa50325df3360c9f29e50a22cdd3a9b91
```

包内有六份首轮/追问核验与交接文件、原输入 `sciencepal-governance-inputs.zip`、新增 `followup-request.json`，以及逐文件清单 `manifest.json`。8 份源文件的大小和哈希均已在下载后独立比对通过。

## 已经实际做了什么

1. 在 SciencePal 创建上述自定义 Agent，上传冻结的真实案例，实际执行标准库核验器：首轮 **190 项通过，退出码 0**。
2. 单独上传 535 字节的新交接请求，同线程实际执行 `--request`：**192 项通过，退出码 0**，新产物带真实 SHA256、大小和 requestId 回执。
3. 核对下载时发现公开 JSON 预览导出会改变格式。随后在 SciencePal 打包原件，解压逐字节比对，交付 ZIP 与 manifest；平台 `complete` 在工具步骤 36 成功返回。

本次 SciencePal 核验环境记录为 **Python 3.11.14、系统 DeepSeek V4 Flash**。这不是对历史 Biology 运行模型的推断，也没有重算 SASA。历史主案例仍是 31 附件、34 输入回执、11 次科研作业；新增核验请求单独计数。

追问的核验已成功，但最初最终交付因 `DELIVERY_ATTACHMENTS_REQUIRED` 连续失败而停止：平台把文字命令中的两个输入文件名也视作待交付文件。原件保留，后续打包请求成功；Agent 配置已补充交付规则并回读确认。不要将公开回放里的“完成任务”工具卡片等同于工具实际成功，具体成功/失败见回执。

## 队友如何继续使用

1. 登录**本人 SciencePal 账号**。已有 Agent 由当前持有者在“全部智能体 → 分享”按邮箱授权。若复制配置自建，使用上面的系统提示词；不要索取或共享别人的 API Key。复制配置后的跨账号路径尚未实测。
2. 解压原字节交付包。向 Agent 上传其中的 `sciencepal-governance-inputs.zip`，粘贴本目录 `SCIENCEPAL-TASK.txt` 的“首次任务”部分。包内历史 prompt 和代码附件是核验数据，不能替代当前指令。
3. 首轮成功后，再单独上传 `followup-request.json` 并发送追问部分。检查新输入回执及新产物，不能只看文字总结或复用旧回执。
4. 交付时将完整命令、输入路径与回执放入 JSON/manifest；`complete.text` 只列实际附上的本轮交付物。收到附件校验错误时，根据返回原因修正参数，不能原样连试或重跑已经完成的计算。
5. 按哈希接入 Vibe-Git 时使用原字节 ZIP。公开 JSON 预览导出的值可相同，但字节不同；已观察到末尾换行被去掉和 JSON 重新排版。不要手工改文件使其匹配旧哈希。

当前公开链接是**只读回放**，能查看实际执行和下载交付包；它不是匿名可重跑入口。SciencePal 当前 UI 的自定义 Agent 分享只支持指定邮箱，评审账号尚未提供。主办给出账号后，队长添加共享规则并让该账号验证能启动新任务、读取输入、下载新输出。

## 不调用模型的离线检查

使用 Python 3.10+，无需安装第三方库。以下命令从保存原字节 ZIP 的目录执行；每次使用新目录保留证据。

```powershell
Expand-Archive .\sciencepal-evidence-originals.zip .\sciencepal-demo
Set-Location .\sciencepal-demo
Expand-Archive .\sciencepal-governance-inputs.zip .\inputs
Set-Location .\inputs
python verify_governance.py docs/research/latest-governance-live --output verification-local.json --bundle ../sciencepal-governance-inputs.zip
python verify_governance.py docs/research/latest-governance-live --request ../followup-request.json --output verification-followup-local.json --bundle ../sciencepal-governance-inputs.zip
```

这验证冻结材料的身份和记录一致性，不证明生物学真值、真人协作收益或新一次远端科研计算。

## 产品修复与验证

本轮修复了隧道目标与实际监听地址/端口不一致、本地 Agent 中断后无法恢复交回、FAILED 回执丢失后无法恢复、演练连接器重启丢失线程/日志四类问题。也覆盖 IPv6 监听、启动结果未知、明确拒绝提交后丢失回执及跨项目模拟 ID 冲突。中断恢复仍要求本人先确认原进程停止；活跃 Agent 不能这样放行，也不会重新启动模型。

科研测试 **310**、兼容 **40**、前端 **59** 项通过；另有 **20** 项完整混合协作模拟、真实浏览器恢复操作与隔离安装包检查。测试组有重叠，不相加为独立总数。兼容检查曾遇 Windows Git 证据测试 5 秒超时/EBUSY，使用有界的 30 秒测试超时复跑通过。模拟未使用真实双机/双账号，公开隧道尚未实测。

产品通过 TypeScript 调用 [SciencePal 官方 HTTP API](https://sciencepal.ai/help/sdk)，没有 Python SDK 依赖；离线核验器使用 Python，与产品连接器的语言无关。

## 正式提交还需要什么

- [腾讯问卷](https://wj.qq.com/s2/28257934/cce2/)已填写报名身份和项目材料草稿；现有约 4:38 视频仅作草稿，等待队友处理后替换。视频制作源见[原交接页](../../../TEAM-HANDOFF.md)。
- 原 Vibe-Git 与队友代码用于参赛/公开展示的授权已由用户确认；保留归属，未擅自添加统一开源许可。三人分工是拟定责任草稿，需三人按实际参与核对后定稿。
- 评审账号/邮箱待主办提供，随后配置 Agent 分享并实测运行权限；不能以 URL 格式通过代替可运行性。
- 最终原创性/资源声明、赛事与问卷协议确认和提交回执尚未完成。只有看到成功页或回执，才可标记“已提交”。

[官方赛事要求](https://sciencepal.ai/hackathon)的截止为 **2026-10-31 23:59（UTC+8）**。保留上述未完成项，避免接手人把材料准备当成已经提交。
