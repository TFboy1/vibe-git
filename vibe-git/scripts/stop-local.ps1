# Stop only the process whose command line matches this workspace's entrypoint.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$StatePath = Join-Path $Root 'data/local-server.json'
if (!(Test-Path -LiteralPath $StatePath)) { Write-Host 'No local server recorded.'; exit 0 }
$State = Get-Content -LiteralPath $StatePath -Encoding UTF8 -Raw | ConvertFrom-Json
$Expected = Join-Path $Root 'scripts/preview.mjs'
$Process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$State.pid)"
if (!$Process) { Write-Host 'Server is already stopped.'; exit 0 }
if ($State.entrypoint -ne $Expected -or !$Process.CommandLine.Contains($Expected)) { throw 'Process identity mismatch; refusing to stop.' }
Stop-Process -Id $Process.ProcessId -ErrorAction Stop
Write-Host 'Local server stopped. Project data retained.'
