<#
.SYNOPSIS
  在本机安装 mcode-plugins 仓库里的三个 MiniMax 插件（Windows）。

.DESCRIPTION
  把 plugins/groundtruth、plugins/evidence-guard 与 plugins/submission-workbench 复制到
  MiniMax Code 的用户级插件目录（默认 %USERPROFILE%\.minimax\plugins），并做安装后自检。
  已存在的同名目录会先备份为 <name>.bak-<时间戳>，不覆盖你的修改。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -DataDir "D:\mcode-data"
#>
[CmdletBinding()]
param(
  # MiniMax Code 数据目录；默认取 %USERPROFILE%\.minimax
  [string]$DataDir = (Join-Path $env:USERPROFILE '.minimax'),
  # 存在同名目录时是否直接覆盖（默认备份后覆盖）
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcRoot  = Join-Path $repoRoot 'plugins'
$dstRoot  = Join-Path (Join-Path $DataDir 'plugins') ''

Write-Host "仓库目录 : $repoRoot"
Write-Host "安装目标 : $dstRoot"
Write-Host ''

$names = @('groundtruth', 'evidence-guard', 'submission-workbench')
$installed = @()

foreach ($name in $names) {
  $src = Join-Path $srcRoot $name
  if (-not (Test-Path -LiteralPath $src)) {
    Write-Warning "跳过：仓库里找不到 $src"
    continue
  }

  $dst = Join-Path $dstRoot $name
  if (Test-Path -LiteralPath $dst) {
    # 备份必须落在 plugins/ 之外: 插件扫描器会遍历该目录下的每个子目录,
    # 留在原地会被当成重复插件(清单 name 与目录名不一致), 也会污染插件列表。
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $bakRoot = Join-Path $DataDir 'plugin-backups'
    New-Item -ItemType Directory -Force -Path $bakRoot | Out-Null
    $bak  = Join-Path $bakRoot "$name.bak-$stamp"
    Write-Host "已存在，备份后覆盖 : $dst -> $bak"
    Move-Item -LiteralPath $dst -Destination $bak -Force
  }

  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  # 逐项复制，保留 .minimax-plugin 等隐藏目录
  Get-ChildItem -LiteralPath $src -Recurse -Force | ForEach-Object {
    $rel   = $_.FullName.Substring($src.Length).TrimStart('\')
    $target = Join-Path $dst $rel
    if ($_.PSIsContainer) {
      New-Item -ItemType Directory -Force -Path $target | Out-Null
    } else {
      New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
  }
  $installed += $name
  Write-Host "已安装  : $name"
}

Write-Host ''
Write-Host '=== 安装后自检 ==='

# 1) node 是否可用（groundtruth 的 Hook 依赖它）
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  Write-Host "[OK]   node: $((node --version))  ($($node.Source))"
} else {
  Write-Warning '[WARN] 没找到 node。groundtruth 的 Hook 需要 Node.js LTS，请先安装并确保在 PATH 中。'
}

# 2) manifest 与 icon 是否齐全
foreach ($name in $installed) {
  $pkg = Join-Path (Join-Path $dstRoot $name) '.minimax-plugin\plugin.json'
  if (Test-Path -LiteralPath $pkg) {
    $m = Get-Content -LiteralPath $pkg -Raw -Encoding UTF8 | ConvertFrom-Json
    $iconPath = Join-Path (Join-Path $dstRoot $name) $m.icon
    $iconState = if (Test-Path -LiteralPath $iconPath) { 'OK' } else { '缺失' }
    Write-Host "[$iconState]   $name  v$($m.version)  (icon: $($m.icon))"
  } else {
    Write-Warning "[FAIL] $name 缺少 .minimax-plugin\plugin.json"
  }
}

# 3) Hook 冒烟测试：SessionStart 应输出证据契约 JSON
$hookScript = Join-Path (Join-Path $dstRoot 'groundtruth') 'scripts\hook-session.mjs'
if ((Test-Path -LiteralPath $hookScript) -and $node) {
  try {
    $raw = '{"hook_event_name":"SessionStart"}' | & node $hookScript 2>$null
    if ($raw -and ($raw -join '') -match 'additionalContext') {
      Write-Host '[OK]   groundtruth SessionStart Hook 输出正常'
    } else {
      Write-Warning '[WARN] groundtruth SessionStart Hook 未输出预期 JSON'
    }
  } catch {
    Write-Warning "[WARN] Hook 冒烟测试异常：$($_.Exception.Message)"
  }
}

Write-Host ''
Write-Host '完成。接下来：'
Write-Host '  1) 重启 MiniMax Code（插件内容在会话启动时加载，必须重开才会生效）。'
Write-Host '  2) 在插件管理里确认两个插件都已启用。'
Write-Host '  3) 新开一个会话，开头应能看到「Groundtruth 证据契约」被注入。'
