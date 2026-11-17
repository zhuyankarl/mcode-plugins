#!/usr/bin/env bash
# 在本机安装 mcode-plugins 仓库里的两个 MiniMax 插件（macOS / Linux）。
#
# 用法：
#   bash install.sh
#   bash install.sh --data-dir "$HOME/.minimax"
#
# 已存在的同名目录会先备份为 <name>.bak-<时间戳>，不覆盖你的修改。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$REPO_ROOT/plugins"
DATA_DIR="${HOME}/.minimax"

while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,9p' "$0"
      exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

DST_ROOT="$DATA_DIR/plugins"

echo "仓库目录 : $REPO_ROOT"
echo "安装目标 : $DST_ROOT"
echo

install_one() {
  local name="$1"
  local src="$SRC_ROOT/$name"
  local dst="$DST_ROOT/$name"

  if [ ! -d "$src" ]; then
    echo "跳过：仓库里找不到 $src" >&2
    return 0
  fi

  if [ -e "$dst" ]; then
    local stamp bak
    stamp="$(date +%Y%m%d-%H%M%S)"
    bak="$dst.bak-$stamp"
    echo "已存在，备份后覆盖 : $dst -> $bak"
    mv "$dst" "$bak"
  fi

  mkdir -p "$dst"
  # 逐项复制，保留 .minimax-plugin 等隐藏目录
  ( cd "$src" && tar cf - . ) | ( cd "$dst" && tar xf - )
  echo "已安装  : $name"
}

mkdir -p "$DST_ROOT"
install_one groundtruth
install_one submission-workbench

echo
echo "=== 安装后自检 ==="

if command -v node >/dev/null 2>&1; then
  echo "[OK]   node: $(node --version)  ($(command -v node))"
else
  echo "[WARN] 没找到 node。groundtruth 的 Hook 需要 Node.js LTS，请先安装并确保在 PATH 中。" >&2
fi

for name in groundtruth submission-workbench; do
  pkg="$DST_ROOT/$name/.minimax-plugin/plugin.json"
  if [ -f "$pkg" ]; then
    icon=$(node -e "const m=require('$pkg');console.log(m.icon||'')" 2>/dev/null || echo "")
    if [ -n "$icon" ] && [ -f "$DST_ROOT/$name/$icon" ]; then
      echo "[OK]   $name  (icon: $icon)"
    else
      echo "[WARN] $name 的 icon 缺失：$icon" >&2
    fi
  else
    echo "[FAIL] $name 缺少 .minimax-plugin/plugin.json" >&2
  fi
done

hook="$DST_ROOT/groundtruth/scripts/hook-session.mjs"
if [ -f "$hook" ] && command -v node >/dev/null 2>&1; then
  if printf '{"hook_event_name":"SessionStart"}' | node "$hook" 2>/dev/null | grep -q additionalContext; then
    echo "[OK]   groundtruth SessionStart Hook 输出正常"
  else
    echo "[WARN] groundtruth SessionStart Hook 未输出预期 JSON" >&2
  fi
fi

echo
echo "完成。接下来："
echo "  1) 重启 MiniMax Code（插件内容在会话启动时加载，必须重开才会生效）。"
echo "  2) 在插件管理里确认两个插件都已启用。"
echo "  3) 新开一个会话，开头应能看到「Groundtruth 证据契约」被注入。"
