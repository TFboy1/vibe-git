# UTF-8. Run backend tests and production builds; no browser/frontend tests.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Node = (Get-Command node -ErrorAction Stop).Source
$Tsc = Join-Path $Root 'node_modules/typescript/bin/tsc'
$Vitest = Join-Path $Root 'node_modules/vitest/vitest.mjs'
$Vite = Join-Path $Root 'node_modules/vite/bin/vite.js'

function Invoke-NodeStep {
    param([string[]]$CliArgs)
    & $Node @CliArgs
    if ($LASTEXITCODE -ne 0) { throw "Node step failed (exit $LASTEXITCODE): $CliArgs" }
}

Push-Location $Root
try {
    Invoke-NodeStep -CliArgs @($Tsc, '-p', 'packages/protocol/tsconfig.build.json')
    foreach ($Project in @('packages/protocol', 'apps/host', 'apps/relay', 'apps/cli', 'apps/web')) {
        Write-Host "Typecheck: $Project"
        Invoke-NodeStep -CliArgs @($Tsc, '-p', "$Project/tsconfig.json", '--noEmit')
    }
    Invoke-NodeStep -CliArgs @($Vitest, 'run', 'apps/host/test/v20.test.ts', 'apps/cli/test/config.test.ts')
    Invoke-NodeStep -CliArgs @($Tsc, '-p', 'apps/host/tsconfig.build.json')
    Invoke-NodeStep -CliArgs @($Tsc, '-p', 'apps/relay/tsconfig.build.json')
    Invoke-NodeStep -CliArgs @($Tsc, '-p', 'apps/cli/tsconfig.build.json')
    Invoke-NodeStep -CliArgs @($Tsc, '-b', 'apps/web')
    Push-Location (Join-Path $Root 'apps/web')
    try { Invoke-NodeStep -CliArgs @($Vite, 'build') }
    finally { Pop-Location }
    Write-Host 'PASS: typecheck, backend tests, production builds. Browser verification was not run.'
}
finally { Pop-Location }
