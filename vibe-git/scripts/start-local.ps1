# Start this project only. No browser tests, no demo data, no startup registration.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Node = (Get-Command node -ErrorAction Stop).Source
$Preview = Join-Path $Root 'scripts/preview.mjs'
$Data = Join-Path $Root 'data'
New-Item -ItemType Directory -Path $Data -Force | Out-Null
foreach ($Port in @(8787)) {
    $Listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($Listener) { throw "Port $Port is already in use. Existing processes were not stopped." }
}
$Child = Start-Process -FilePath $Node -ArgumentList @($Preview) -WorkingDirectory $Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Data 'local-server.stdout.log') -RedirectStandardError (Join-Path $Data 'local-server.stderr.log')
@{ pid = $Child.Id; entrypoint = $Preview; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Data 'local-server.json') -Encoding UTF8
$Deadline = (Get-Date).AddSeconds(30)
do {
    $Child.Refresh()
    if ($Child.HasExited) { throw "Server exited. Read data/local-server.stderr.log." }
    try {
        $Health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
        if ($Health.ok -and $Health.version -eq '0.20') {
            Write-Host "Started PID $($Child.Id): http://localhost:8787"
            exit 0
        }
    } catch {}
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $Deadline)
throw 'Startup timed out. Inspect data/local-server.stdout.log and data/local-server.stderr.log.'
