# UTF-8. Backend regression tests and production builds; no frontend interaction checks.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Node = (Get-Command node -ErrorAction Stop).Source
$Tsc = Join-Path $Root 'node_modules/typescript/bin/tsc'
$Vitest = Join-Path $Root 'node_modules/vitest/vitest.mjs'

function Invoke-NodeStep {
    param([string[]]$CliArgs)
    & $Node @CliArgs
    if ($LASTEXITCODE -ne 0) { throw "Node step failed (exit $LASTEXITCODE): $CliArgs" }
}

Push-Location $Root
try {
    Invoke-NodeStep -CliArgs @($Tsc, '-p', 'packages/protocol/tsconfig.build.json')
    foreach ($Project in @('packages/protocol', 'apps/host', 'apps/relay', 'apps/cli')) {
        Write-Host "Typecheck: $Project"
        Invoke-NodeStep -CliArgs @($Tsc, '-p', "$Project/tsconfig.json", '--noEmit')
    }
    Invoke-NodeStep -CliArgs @($Vitest, 'run', 'apps/host/test/v20.test.ts', 'apps/host/test/v21-contract.test.ts', 'apps/host/test/coordination.test.ts', 'apps/host/test/agile.test.ts', 'apps/cli/test', 'apps/relay/test')
    Invoke-NodeStep -CliArgs @($Tsc, '-p', 'apps/host/tsconfig.build.json')
    Invoke-NodeStep -CliArgs @($Tsc, '-p', 'apps/relay/tsconfig.build.json')
    Invoke-NodeStep -CliArgs @($Tsc, '-p', 'apps/cli/tsconfig.build.json')
    Invoke-NodeStep -CliArgs @('node_modules/vue-tsc/bin/vue-tsc.js', '-p', 'apps/web/tsconfig.json', '--noEmit')
    Invoke-NodeStep -CliArgs @('node_modules/vite/bin/vite.js', 'build', 'apps/web')
    Write-Host 'PASS: backend typecheck and regression tests, backend and Vue production builds.'
}
finally { Pop-Location }
