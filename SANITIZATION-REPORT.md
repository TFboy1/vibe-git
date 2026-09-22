# 去敏检查

- 导出方式：文件白名单，未修改原始文件或本机运行状态。
- 包含：Host、Relay、MCP 插件、Skills、安装脚本、测试、锁定依赖清单、v0.4 设计及 M0 交付文档。
- 排除：apikey.txt、EvoMap 配置与调用脚本、.env、.agentgit、node_modules、数据库/WAL、日志、邀请与身份凭据、可执行文件、Python 缓存、原始聊天或 transcript、Git 历史。
- 文档中的本机项目路径改为 C:/path/AgentGit；用户目录改为 <USER_HOME>。替换次数：1。
- Codex 能力证据按字段重新生成，移除本机安装路径和 user-agent 机器信息；保留工具/Skill 清单与验证边界。
- 检查：对导出文本扫描常见密钥/JWT/私钥字面量、真实本机 API 密钥和房间凭据，以及个人绝对路径，均无匹配。
- 保留源码中正常的 token、Authorization、invite 等变量名与协议定义；它们不包含实际凭据。
- 保留 M0 未完成、模式限制和 CF 超时等事实，没有将去敏包装成验收通过。

导出不包含原始证据路径；SHA-256 对应的是去敏后的文件。
