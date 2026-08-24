#!/bin/bash
# 灵枢 Electron 开发模式启动脚本
# 解决 ELECTRON_RUN_AS_NODE / NODE_OPTIONS 环境变量污染问题

set -e

# 获取脚本所在目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---- 环境变量清理 ----
# ELECTRON_RUN_AS_NODE=1 会让 Electron 以纯 Node.js 模式运行，
# 导致 require('electron') 返回路径字符串而非 API 模块
unset ELECTRON_RUN_AS_NODE

# NODE_OPTIONS 中的 --use-system-ca 被 Electron 拒绝
# 清空 NODE_OPTIONS，Electron 不需要这些 Node.js 特定标志
unset NODE_OPTIONS

# 设置开发环境
export NODE_ENV=development

# 灵枢后端端口（与 main.cjs 默认值一致）
export LINGSHU_BACKEND_PORT="${LINGSHU_BACKEND_PORT:-3005}"
export LINGSHU_FRONTEND_URL="${LINGSHU_FRONTEND_URL:-http://127.0.0.1:3000}"

# 可选：开启 DevTools
# export LINGSHU_DEVTOOLS=1

# ---- 路径检测 ----
# 优先使用项目内 electron-dist 的 Electron 二进制
ELECTRON_BIN="./electron-dist/Electron.app/Contents/MacOS/Electron"

if [ ! -x "$ELECTRON_BIN" ]; then
  echo "ERROR: Electron 二进制不存在: $ELECTRON_BIN"
  echo ""
  echo "请先安装 Electron 二进制："
  echo "  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install electron --save-dev"
  echo "  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npx electron install"
  echo ""
  echo "或手动下载 Electron 30.x 放到 electron-dist/ 目录"
  exit 1
fi

# ---- Chromium Sandbox ----
# 某些环境（容器/沙箱/CI）无法初始化 Chromium sandbox，需要禁用
# 独立运行的 macOS app 不需要此标志，加了也不影响功能
export ELECTRON_DISABLE_SANDBOX=1
SANDBOX_FLAG="--no-sandbox"

# ---- 启动 Vite 前端 ----
echo "============================================"
echo "  灵枢 Electron 开发模式"
echo "============================================"
echo "  二进制: $ELECTRON_BIN"
echo "  主进程: electron/main.cjs"
echo "  后端端口: $LINGSHU_BACKEND_PORT"
echo "  前端地址: $LINGSHU_FRONTEND_URL"
echo "  ELECTRON_RUN_AS_NODE: (已清除)"
echo "  NODE_OPTIONS: (已清除)"
echo "  Chromium Sandbox: (已禁用)"
echo "============================================"
echo ""

# 启动 Vite 开发服务器（后台）
echo ">> 启动 Vite 前端..."
npm run dev &
VITE_PID=$!

# 等待 Vite 就绪
echo ">> 等待 Vite 就绪..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:3000 > /dev/null 2>&1; then
    echo ">> Vite 已就绪 ✓"
    break
  fi
  sleep 1
  if [ $i -eq 30 ]; then
    echo ">> Vite 启动超时，继续启动 Electron（可能需要手动刷新）"
  fi
done

# 清理函数：退出时杀掉 Vite
cleanup() {
  echo ""
  echo ">> 正在关闭..."
  kill $VITE_PID 2>/dev/null
  wait $VITE_PID 2>/dev/null
}
trap cleanup EXIT INT TERM

# ---- 启动 Electron ----
echo ">> 启动 Electron 桌面应用..."
"$ELECTRON_BIN" $SANDBOX_FLAG electron/main.cjs &
ELECTRON_PID=$!

wait $ELECTRON_PID
