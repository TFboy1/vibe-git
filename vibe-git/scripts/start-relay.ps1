# UTF-8. 在成员电脑前台运行 Relay；Ctrl+C 停止。
[CmdletBinding()]
param(
    [ValidateSet('A', 'B', 'C')]
    [string]$MemberId = 'A',
    [Parameter(Mandatory = $true)]
    [string]$Workspace,
    [string]$HostUrl = 'http://localhost:8787',
    [ValidateSet('auto', 'app-server', 'cli')]
    [string]$Transport = 'auto',
    [string]$DeviceId = '',
    [string]$TaskId = '',
    [string]$WorkUnitId = '',
    [switch]$Once
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$RelayEntry = Join-Path $Root 'apps/relay/dist/index.js'
$WorkspacePath = (Resolve-Path -LiteralPath $Workspace).Path
if (-not (Test-Path -LiteralPath $WorkspacePath -PathType Container)) { throw "工作区目录不存在：$WorkspacePath" }
if (-not (Test-Path -LiteralPath $RelayEntry -PathType Leaf)) { throw "Relay 尚未构建，请先运行 scripts/check.ps1" }
$Node = (Get-Command node -ErrorAction Stop).Source

$previous = @{
    MEMBER_ID = $env:MEMBER_ID
    VIBE_WORKSPACE = $env:VIBE_WORKSPACE
    VIBE_HOST_URL = $env:VIBE_HOST_URL
    CODEX_TRANSPORT = $env:CODEX_TRANSPORT
    DEVICE_ID = $env:DEVICE_ID
    TASK_ID = $env:TASK_ID
    WORK_UNIT_ID = $env:WORK_UNIT_ID
}

try {
    $env:MEMBER_ID = $MemberId
    $env:VIBE_WORKSPACE = $WorkspacePath
    $env:VIBE_HOST_URL = $HostUrl.TrimEnd('/')
    $env:CODEX_TRANSPORT = $Transport
    if ($DeviceId) { $env:DEVICE_ID = $DeviceId } else { Remove-Item Env:DEVICE_ID -ErrorAction SilentlyContinue }
    if ($TaskId) { $env:TASK_ID = $TaskId } else { Remove-Item Env:TASK_ID -ErrorAction SilentlyContinue }
    if ($WorkUnitId) { $env:WORK_UNIT_ID = $WorkUnitId } else { Remove-Item Env:WORK_UNIT_ID -ErrorAction SilentlyContinue }

    Write-Host "Vibe-Git Relay：成员 $MemberId"
    Write-Host "Host：$($env:VIBE_HOST_URL)"
    Write-Host "本地工作区：$WorkspacePath"
    Write-Host "Codex 执行方式：$Transport"
    if (-not $Once) { Write-Host 'Relay 正在前台长轮询命令；按 Ctrl+C 停止。' }
    $arguments = @($RelayEntry)
    if ($Once) { $arguments += '--once' }
    & $Node @arguments
    if ($LASTEXITCODE -ne 0) { throw "Relay 退出码：$LASTEXITCODE" }
}
finally {
    foreach ($name in $previous.Keys) {
        $value = $previous[$name]
        if ($null -eq $value) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
        else { Set-Item "Env:$name" $value }
    }
}
