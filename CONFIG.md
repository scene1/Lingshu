# OpenClaw Web UI 应用配置

## ✅ 配置完成

### 🚀 启动方式

#### 方式 1: 命令行启动
```bash
~/Lingshu/workspace/projects/openclaw-web-ui/launch.sh
```

#### 方式 2: 双击应用图标
```
~/Applications/OpenClaw Web UI.app
```

### 🌐 访问地址

| 服务 | 地址 |
|------|------|
| 前端界面 | http://localhost:3000 |
| 后端 API | http://localhost:3005 |

### 📊 功能配置

| 功能 | 状态 | 说明 |
|------|------|------|
| AI 对话 | ✅ | step-alpha 模型（通过阶跃桌面端代理） |
| 多实例管理 | ✅ | 本地 OpenClaw + 小跃你 |
| 模型配置 | ✅ | 17 家提供商，100+ 模型 |
| Skills 管理 | ✅ | 37 个 skills |
| 系统状态 | ✅ | 记忆和上下文展示 |
| 聊天历史 | ✅ | 文件存储在 ~/Lingshu/workspace/chat-history/ |

### 🔧 模型配置

当前使用 **阶跃桌面端代理模式**：
- 无需配置 API Key
- 自动通过 `http://127.0.0.1:3199` 调用 step-alpha
- 需要阶跃桌面端保持运行

如需配置其他模型（OpenAI、Claude 等）：
1. 访问 http://localhost:3000/model-config
2. 选择提供商
3. 填入 API Key

### 📝 日志位置

```
~/Lingshu/workspace/projects/openclaw-web-ui/
├── backend.log   # 后端日志
└── frontend.log  # 前端日志
```

### ⏹️ 停止服务

```bash
lsof -ti :3000 :3005 | xargs kill -9
```

### 🔄 自动启动（可选）

添加到 ~/.zshrc：
```bash
# OpenClaw Web UI 自动启动
if ! curl -s http://localhost:3000 > /dev/null; then
    nohup ~/Lingshu/workspace/projects/openclaw-web-ui/launch.sh > /dev/null 2>&1 &
fi
```

### 📁 应用文件

```
~/Lingshu/workspace/projects/openclaw-web-ui/
├── launch.sh              # 启动脚本
├── start-app.sh           # 简化启动脚本
├── server-v2.js           # 后端服务
├── electron/              # Electron 配置（待完善）
│   ├── main.js
│   └── preload.js
└── src/
    ├── pages/             # 页面组件
    │   ├── RealChat.tsx
    │   ├── InstanceManager.tsx
    │   ├── ModelConfig.tsx
    │   ├── SystemStatus.tsx
    │   └── ...
    └── utils/
        └── electron.ts    # Electron API 工具

~/Applications/
└── OpenClaw Web UI.app    # macOS 应用快捷方式
```

---

## 🎯 使用说明

1. **启动应用**: 双击 `OpenClaw Web UI.app` 或运行 `launch.sh`
2. **AI 对话**: 访问 http://localhost:3000，发送消息与 step-alpha 对话
3. **模型配置**: 访问 http://localhost:3000/model-config
4. **实例管理**: 访问 http://localhost:3000/instances
5. **系统状态**: 访问 http://localhost:3000/system-status

---

配置时间: 2026-05-22
