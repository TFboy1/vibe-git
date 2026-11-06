# 本次修复的运行交接脚本。保留原房间，不创建新房间，不执行任何 PR 审核。
$ErrorActionPreference = 'Stop'
$batchIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$batchPrincipal = [Security.Principal.WindowsPrincipal]::new($batchIdentity)
if (-not $batchPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Windows 拒绝结束旧 Host。请在管理员 PowerShell 中运行这份脚本。'
}

$batchRoot = 'D:\pycharmProject\vibe-git\vibe-git'
$batchDataRoot = 'C:\Users\86150\Vibe-Git Projects\my-project\.vibe-git\host'
$batchExpectedRoomId = 'e7fbcfe4-1573-4f31-bc2b-4e1f5b7c2cb2'
$batchHostPid = 38312
$batchNode = (Get-Command node -ErrorAction Stop).Source
$batchEntry = Join-Path $batchRoot 'apps\host\dist\index.js'
if (-not (Test-Path -LiteralPath $batchEntry)) { throw '缺少已构建的 Host，请先运行 npm run build。' }
$batchListeners = @(Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction Stop)
if ($batchListeners.Count -eq 0 -or @($batchListeners | Where-Object OwningProcess -ne $batchHostPid).Count -gt 0) {
    throw '8787 的 Host 进程已经变化。脚本停止，没有结束任何其他进程。'
}
$batchOldProcess = Get-Process -Id $batchHostPid -ErrorAction Stop
if ($batchOldProcess.ProcessName -ne 'node' -or $batchOldProcess.StartTime.ToString('yyyy-MM-dd HH:mm:ss') -ne '2026-09-29 09:48:18') {
    throw '旧 Host 的进程标识已变化，脚本停止。'
}

$batchBackupScript = @'
import { backup, DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const [root, expectedRoom] = process.argv.slice(2);
const db = new DatabaseSync(root + '/workspace.db', { readOnly: true });
const roomId = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='v20_room'").get().value).id;
const revision = Number(db.prepare("SELECT value FROM meta WHERE key='v20_requirement_revision'").get().value);
const jobs = db.prepare("SELECT COUNT(*) AS count FROM v20_agent_jobs WHERE json_extract(data,'$.status') IN ('QUEUED','LEASED','RUNNING')").get().count;
if (roomId !== expectedRoom || jobs !== 0) throw new Error('房间标识不匹配或仍有作业，请等待作业结束后再重启');
const digest = rows => createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
const state = { roomId, revision,
  requirements: digest(db.prepare('SELECT data FROM v20_requirement_versions ORDER BY revision').all()),
  tasks: digest(db.prepare('SELECT data FROM v20_stage_tasks ORDER BY id').all()),
  changes: digest(db.prepare("SELECT value FROM meta WHERE key='coordination_changes'").all()),
  pullRequests: digest(db.prepare('SELECT data FROM v20_pull_requests ORDER BY id').all()) };
const path = root + '/workspace.before-batch-review-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db';
await backup(db, path);
await writeFile(root + '/batch-review-reload-check.json', JSON.stringify(state), 'utf8');
db.close();
console.log('已备份原房间 R' + revision + '：' + path);
'@
$batchBackupScript | & $batchNode --input-type=module - $batchDataRoot $batchExpectedRoomId
if ($LASTEXITCODE -ne 0) { throw '原房间备份或校验失败，未停止 Host。' }

Stop-Process -Id $batchHostPid -ErrorAction Stop
$batchOldProcess.WaitForExit(10000) | Out-Null
if (Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue) {
    throw '端口被其他进程重新占用，脚本没有结束新进程。'
}

$batchPreviousDataDir = $env:VIBE_GIT_DATA_DIR
$batchPreviousPort = $env:PORT
$batchPreviousHost = $env:HOST
$batchStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
try {
    $env:VIBE_GIT_DATA_DIR = $batchDataRoot
    $env:PORT = '8787'
    $env:HOST = '0.0.0.0'
    $batchNewProcess = Start-Process -FilePath $batchNode -ArgumentList @($batchEntry) -WorkingDirectory $batchRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $batchDataRoot "host-batch-$batchStamp.stdout.log") -RedirectStandardError (Join-Path $batchDataRoot "host-batch-$batchStamp.stderr.log")
} finally {
    $env:VIBE_GIT_DATA_DIR = $batchPreviousDataDir
    $env:PORT = $batchPreviousPort
    $env:HOST = $batchPreviousHost
}

# 在脚本内阻塞等待启动，调用方不需要频繁轮询。
$batchDeadline = (Get-Date).AddSeconds(30)
$batchReady = $false
do {
    $batchNewProcess.Refresh()
    if ($batchNewProcess.HasExited) { throw "新版 Host 启动失败，请查看 $batchDataRoot\host-batch-$batchStamp.stderr.log" }
    try {
        $batchHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
        if ($batchHealth.ok -and $batchHealth.version -eq '0.20') {
            $batchOwner = @(Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue)
            $batchReady = $batchOwner.Count -gt 0 -and @($batchOwner | Where-Object OwningProcess -ne $batchNewProcess.Id).Count -eq 0
        }
    } catch {}
    if (-not $batchReady) { Start-Sleep -Milliseconds 500 }
} while (-not $batchReady -and (Get-Date) -lt $batchDeadline)
if (-not $batchReady) { throw '新版 Host 启动超时，原数据与备份保留。' }

$batchVerifyScript = @'
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const root = process.argv[2];
const before = JSON.parse(await readFile(root + '/batch-review-reload-check.json', 'utf8'));
const db = new DatabaseSync(root + '/workspace.db', { readOnly: true });
const digest = rows => createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
const after = {
  roomId: JSON.parse(db.prepare("SELECT value FROM meta WHERE key='v20_room'").get().value).id,
  revision: Number(db.prepare("SELECT value FROM meta WHERE key='v20_requirement_revision'").get().value),
  requirements: digest(db.prepare('SELECT data FROM v20_requirement_versions ORDER BY revision').all()),
  tasks: digest(db.prepare('SELECT data FROM v20_stage_tasks ORDER BY id').all()),
  changes: digest(db.prepare("SELECT value FROM meta WHERE key='coordination_changes'").all()),
  pullRequests: digest(db.prepare('SELECT data FROM v20_pull_requests ORDER BY id').all()) };
db.close();
for (const key of Object.keys(before)) if (after[key] !== before[key]) throw new Error('重启后的房间校验不一致：' + key);
console.log('原房间 R' + after.revision + '、需求历史、任务与 PR 记录保持一致。');
'@
$batchVerifyScript | & $batchNode --input-type=module - $batchDataRoot
if ($LASTEXITCODE -ne 0) { throw '新版 Host 已启动，但原数据核对失败，请检查日志与备份。' }

$batchRegistry = 'C:\Users\86150\.vibe-git\host-process.json'
@{
    pid = $batchNewProcess.Id
    hostUrl = 'http://localhost:8787'
    startedAt = (Get-Date).ToString('o')
    root = $batchRoot
    workspace = 'C:\Users\86150\Vibe-Git Projects\my-project'
    dataRoot = $batchDataRoot
} | ConvertTo-Json | Set-Content -LiteralPath $batchRegistry -Encoding utf8
Write-Output "新版 Host 已启动，PID $($batchNewProcess.Id)。刷新本机工作台即可选择多个 PR 统一审核。"
