$ErrorActionPreference = 'Stop'
$runtime = Join-Path $env:USERPROFILE 'plugins/agentgit/runtime/relay.mjs'
if (-not (Test-Path $runtime)) { throw '请先运行 Install-AgentGit.ps1 安装完整插件。' }
& (Get-Command node).Source $runtime
