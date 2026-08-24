#!/bin/bash
# 灵枢 App 启动脚本

echo "🚀 启动灵枢 App..."
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 请先安装 Node.js"
    exit 1
fi

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
fi

echo ""
echo "🔧 启动后端 API 服务 (端口 3005)..."
PORT=3005 node server-v2.js &
API_PID=$!

# 等待 API 启动
sleep 2

echo "🌐 启动前端界面 (端口 3000)..."
npm run dev &
WEB_PID=$!

echo ""
echo "✅ 灵枢 App 已启动!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📱 访问地址:"
echo "     前端界面: http://localhost:3000"
echo "     API 服务: http://localhost:3005"
echo ""
echo "  📝 功能说明:"
echo "     • 仪表盘 - 系统状态监控"
echo "     • Skills 管理 - 安装/卸载 skills"
echo "     • 配置管理 - 编辑灵枢运行时配置（兼容 openclaw.json）"
echo "     • 日志查看 - 实时日志流"
echo "     • 通知中心 - 消息提醒"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "按 Ctrl+C 停止服务"

# 捕获退出信号
trap "echo ''; echo '正在停止服务...'; kill $API_PID $WEB_PID 2>/dev/null; echo '已停止'; exit" INT

wait
