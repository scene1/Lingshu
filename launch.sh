#!/bin/bash

# OpenClaw Web UI 应用启动器
# 配置和启动脚本

set -e

echo "🚀 OpenClaw Web UI 启动器"
echo "=========================="

# 配置
PROJECT_DIR="$HOME/.stepclaw/workspace/projects/openclaw-web-ui"
BACKEND_PORT=3005
FRONTEND_PORT=3000

# 检查环境
check_environment() {
    echo ""
    echo "📋 检查环境..."
    
    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js 未安装"
        exit 1
    fi
    echo "✅ Node.js: $(node --version)"
    
    # 检查 npm
    if ! command -v npm &> /dev/null; then
        echo "❌ npm 未安装"
        exit 1
    fi
    echo "✅ npm: $(npm --version)"
    
    # 检查项目目录
    if [ ! -d "$PROJECT_DIR" ]; then
        echo "❌ 项目目录不存在: $PROJECT_DIR"
        exit 1
    fi
    echo "✅ 项目目录: $PROJECT_DIR"
    
    # 检查 OpenClaw
    if [ ! -d "$HOME/.stepclaw" ]; then
        echo "⚠️  OpenClaw 配置目录不存在"
    else
        echo "✅ OpenClaw 配置目录"
    fi
}

# 检查端口
check_ports() {
    echo ""
    echo "🔌 检查端口..."
    
    # 检查后端端口
    if lsof -Pi :$BACKEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "⚠️  端口 $BACKEND_PORT 已被占用"
        echo "   尝试停止现有进程..."
        lsof -ti :$BACKEND_PORT | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
    
    # 检查前端端口
    if lsof -Pi :$FRONTEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "⚠️  端口 $FRONTEND_PORT 已被占用"
        echo "   尝试停止现有进程..."
        lsof -ti :$FRONTEND_PORT | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
    
    echo "✅ 端口检查完成"
}

# 启动后端
start_backend() {
    echo ""
    echo "📡 启动后端服务..."
    
    cd "$PROJECT_DIR"
    
    # 设置环境变量
    export OPENCLAW_STATE_DIR="$HOME/.stepclaw"
    export PATH="$HOME/.stepclaw/bin:$PATH"
    export PORT=$BACKEND_PORT
    
    # 启动后端
    nohup node server-v2.js > "$PROJECT_DIR/backend.log" 2>&1 &
    BACKEND_PID=$!
    
    # 等待后端启动
    echo "   等待后端启动..."
    for i in {1..10}; do
        if curl -s http://localhost:$BACKEND_PORT/api/instances > /dev/null 2>&1; then
            echo "✅ 后端已启动 (PID: $BACKEND_PID)"
            echo "   日志: $PROJECT_DIR/backend.log"
            return 0
        fi
        sleep 1
    done
    
    echo "❌ 后端启动失败"
    echo "   日志: $PROJECT_DIR/backend.log"
    return 1
}

# 启动前端
start_frontend() {
    echo ""
    echo "🎨 启动前端服务..."
    
    cd "$PROJECT_DIR"
    
    # 启动前端
    nohup npm run dev > "$PROJECT_DIR/frontend.log" 2>&1 &
    FRONTEND_PID=$!
    
    # 等待前端启动
    echo "   等待前端启动..."
    for i in {1..15}; do
        if curl -s http://localhost:$FRONTEND_PORT > /dev/null 2>&1; then
            echo "✅ 前端已启动 (PID: $FRONTEND_PID)"
            echo "   日志: $PROJECT_DIR/frontend.log"
            return 0
        fi
        sleep 1
    done
    
    echo "❌ 前端启动失败"
    echo "   日志: $PROJECT_DIR/frontend.log"
    return 1
}

# 打开浏览器
open_browser() {
    echo ""
    echo "🌐 打开浏览器..."
    
    URL="http://localhost:$FRONTEND_PORT"
    
    if command -v open &> /dev/null; then
        open "$URL"
    elif command -v xdg-open &> /dev/null; then
        xdg-open "$URL"
    else
        echo "   请手动打开: $URL"
    fi
    
    echo "✅ 浏览器已打开"
}

# 显示状态
show_status() {
    echo ""
    echo "✨ 应用已启动!"
    echo "================"
    echo ""
    echo "🌐 访问地址:"
    echo "   前端界面: http://localhost:$FRONTEND_PORT"
    echo "   后端 API: http://localhost:$BACKEND_PORT"
    echo ""
    echo "📊 功能:"
    echo "   • AI 对话 (step-alpha)"
    echo "   • 多实例管理"
    echo "   • 模型配置 (17家提供商)"
    echo "   • Skills 管理"
    echo "   • 系统状态"
    echo ""
    echo "📝 日志文件:"
    echo "   后端: $PROJECT_DIR/backend.log"
    echo "   前端: $PROJECT_DIR/frontend.log"
    echo ""
    echo "⏹️  停止服务:"
    echo "   lsof -ti :$FRONTEND_PORT :$BACKEND_PORT | xargs kill -9"
    echo ""
}

# 主流程
main() {
    check_environment
    check_ports
    start_backend
    start_frontend
    open_browser
    show_status
    
    # 保持运行
    echo "按 Ctrl+C 停止服务..."
    wait
}

# 捕获中断信号
trap 'echo ""; echo "🛑 停止服务..."; lsof -ti :$FRONTEND_PORT :$BACKEND_PORT 2>/dev/null | xargs kill -9 2>/dev/null; exit 0' INT

# 运行
main
