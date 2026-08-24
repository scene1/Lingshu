#!/bin/bash

# OpenClaw Web UI 启动脚本
# 同时启动前端和后端服务

echo "🚀 启动 OpenClaw Web UI..."

# 设置环境变量
export OPENCLAW_STATE_DIR="$HOME/Lingshu"
export PATH="$HOME/Lingshu/bin:$PATH"

# 项目目录
PROJECT_DIR="$HOME/Lingshu/workspace/projects/openclaw-web-ui"

# 启动后端
echo "📡 启动后端服务..."
cd "$PROJECT_DIR"
PORT=3005 node server-v2.js &
BACKEND_PID=$!

# 等待后端启动
sleep 2

# 启动前端
echo "🎨 启动前端服务..."
npm run dev &
FRONTEND_PID=$!

# 等待前端启动
sleep 3

# 打开浏览器
echo "🌐 打开浏览器..."
open "http://localhost:3000"

echo ""
echo "✅ 服务已启动:"
echo "   前端: http://localhost:3000"
echo "   后端: http://localhost:3005"
echo ""
echo "按 Ctrl+C 停止服务"

# 等待用户中断
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT
wait
