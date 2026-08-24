#!/bin/bash
# 灵枢 Electron 生产模式启动脚本
# 直接加载后端 serve 的 dist 静态文件，不需要 Vite dev server
# 使用前需先执行：npm run build（或 ./node_modules/.bin/vite build）

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---- 环境变量清理 ----
unset ELECTRON_RUN_AS_NODE
unset NODE_OPTIONS
unset NODE_ENV  # 不设 development，走生产模式加载后端 URL

# ---- Chromium Sandbox ----
export ELECTRON_DISABLE_SANDBOX=1
SANDBOX_FLAG="--no-sandbox"

ELECTRON_BIN="./electron-dist/Electron.app/Contents/MacOS/Electron"

if [ ! -x "$ELECTRON_BIN" ]; then
  echo "ERROR: Electron 二进制不存在: $ELECTRON_BIN"
  exit 1
fi

if [ ! -f "dist/index.html" ]; then
  echo "ERROR: 前端未构建，请先执行：npm run build"
  exit 1
fi

echo "============================================"
echo "  灵枢 Electron 生产模式"
echo "============================================"
echo "  二进制: $ELECTRON_BIN"
echo "  前端: dist/ (后端 serve)"
echo "  后端端口: 3105"
echo "  ELECTRON_RUN_AS_NODE: (已清除)"
echo "  NODE_OPTIONS: (已清除)"
echo "  Chromium Sandbox: (已禁用)"
echo "============================================"
echo ""

exec "$ELECTRON_BIN" $SANDBOX_FLAG electron/main.cjs
