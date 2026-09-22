param([int]$Port = 4399)
$ErrorActionPreference = 'Stop'
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
$root = Split-Path $PSScriptRoot -Parent
$binary = if ($cloudflared) { $cloudflared.Source } else { Join-Path $root '.agentgit/bin/cloudflared.exe' }
if (-not (Test-Path $binary)) { throw '缺少 cloudflared。请按 Cloudflare 官方安装说明安装后重试；本脚本不自动下载或覆盖已有配置。' }
$isolated = Join-Path $root '.agentgit/tunnel'
New-Item -ItemType Directory -Force -Path $isolated | Out-Null
$config = Join-Path $isolated 'quick-tunnel.yml'
if (-not (Test-Path $config)) { Set-Content -Path $config -Value '{}' -Encoding utf8 }
# Explicit isolated config; no named tunnels, credentials, ingress, or existing user config modified.
& $binary tunnel --config $config --url "http://127.0.0.1:$Port" --no-autoupdate
