$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$nodePath = (Get-Command node).Source
$dataDir = Join-Path $PSScriptRoot '.agentgit'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
try { $health = Invoke-RestMethod 'http://127.0.0.1:4399/api/health' -TimeoutSec 2 } catch { $health = $null }
if (-not $health) {
    Start-Process -FilePath $nodePath -ArgumentList 'apps/host/server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataDir 'host.log') -RedirectStandardError (Join-Path $dataDir 'host.err') | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 200
        try { $health = Invoke-RestMethod 'http://127.0.0.1:4399/api/health' -TimeoutSec 1; break } catch {}
    }
}
if (-not $health.ok -or $health.version -ne '0.1.0') { throw '端口 4399 未就绪或被其他服务占用。' }
Write-Host 'Host 已启动。通过 AgentGit 插件加入，不需要网页。'
Write-Host '接入资料位于 .agentgit/host/access.json；仅向成员提供 base、room_id 和 invite。'
Write-Host '成员启动 npm run relay，再在已安装插件的新 Codex 会话中加入房间。'
