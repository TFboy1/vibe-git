#requires -Version 7.0
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$helpers = Join-Path $PSScriptRoot 'plugin-tools'
$marketplacePath = Join-Path $env:USERPROFILE '.agents/plugins/marketplace.json'
$destination = Join-Path $env:USERPROFILE 'plugins/agentgit'
if ($Remove) {
    $installedMarketplace = python -X utf8 (Join-Path $helpers 'read_marketplace_name.py')
    if ($LASTEXITCODE -ne 0) { throw '无法验证个人插件源，停止卸载。' }
    codex plugin remove "agentgit@$installedMarketplace"
    exit $LASTEXITCODE
}
if (-not (Test-Path $marketplacePath)) {
    python -X utf8 (Join-Path $helpers 'create_basic_plugin.py') agentgit --with-marketplace --with-skills --with-mcp
    if ($LASTEXITCODE -ne 0) { throw '创建个人插件源失败' }
} else {
    $catalog = Get-Content -Raw $marketplacePath | ConvertFrom-Json
    $entry = @($catalog.plugins | Where-Object { $_.name -eq 'agentgit' })
    if ($entry.Count -eq 0) {
        if (Test-Path $destination) { throw '目标目录已存在但未登记，请先核对目录归属。' }
        python -X utf8 (Join-Path $helpers 'create_basic_plugin.py') agentgit --with-marketplace --with-skills --with-mcp
        if ($LASTEXITCODE -ne 0) { throw '新增插件源失败' }
    } elseif ($entry[0].source.path -ne './plugins/agentgit') { throw '现有同名插件来源不同，停止覆盖。' }
}
$marketplaceName = python -X utf8 (Join-Path $helpers 'read_marketplace_name.py')
if ($LASTEXITCODE -ne 0) { throw '个人插件源验证失败' }
Copy-Item -Path (Join-Path $root 'plugins/agentgit/*') -Destination $destination -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'plugins/agentgit/.mcp.json') -Destination (Join-Path $destination '.mcp.json') -Force
# Materialize paths on this computer; do not depend on MCP variable expansion.
$server = @{ command = (Get-Command node).Source; args = @((Join-Path $destination 'runtime/bridge.mjs')) }
$compat = @{ mcpServers = @{ agentgit = $server } }
$compat | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $destination '.mcp.json')
$server.type = 'stdio'
$compat | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $destination 'mcp.json')
python -X utf8 (Join-Path $helpers 'update_plugin_cachebuster.py') $destination
if ($LASTEXITCODE -ne 0) { throw '插件版本更新失败' }
$overlay = Get-Content -Raw (Join-Path $destination '.codex-plugin/plugin.json') | ConvertFrom-Json
$portable = Get-Content -Raw (Join-Path $destination 'plugin.json') | ConvertFrom-Json
$portable.version = $overlay.version
$portable | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 (Join-Path $destination 'plugin.json')
codex plugin add "agentgit@$marketplaceName" --json
if ($LASTEXITCODE -ne 0) { throw '完整插件安装失败' }
Write-Host 'AgentGit Skills + MCP 已安装。保留用户 plugins/agentgit 运行目录。启动 Relay 后，新会话加载插件。'
