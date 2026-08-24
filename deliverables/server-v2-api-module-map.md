# server-v2 API 模块拆分清单

更新时间：2026-08-11

目标：在不改变现有接口路径的前提下，把 `server-v2.js` 从单文件后端逐步拆成可维护的路由模块。拆分时优先保持行为一致，先搬迁代码，再做内部重构。

## 当前问题

- `server-v2.js` 同时承载启动、配置、聊天、文档、知识库、工具、自动化、通知等职责，单文件维护成本高。
- 多个领域共享文件系统读写、路径校验、设置读取等工具函数，但边界不够清晰。
- 接口数量多，缺少模块级测试入口；后续任何改动都容易扩大回归范围。

## 建议目录

```text
server/
  app.js
  routes/
    system.js
    config.js
    instances.js
    chat.js
    skills.js
    desktop.js
    dashboard.js
    memory.js
    knowledge-inbox.js
    documents.js
    meetings.js
    workflows.js
    tools.js
    automations.js
    notifications.js
  services/
    settings-service.js
    storage-service.js
    vault-service.js
    provider-service.js
    skill-service.js
  middleware/
    local-origin-guard.js
    upload-policy.js
```

## API 分组

| 模块 | 现有接口前缀 | 建议文件 | 拆分优先级 |
| --- | --- | --- | --- |
| System | `/api/health`, `/api/system/self-check`, `/api/logs` | `routes/system.js` | P1 |
| Config | `/api/config`, `/api/settings`, `/api/security/isolation`, `/api/models` | `routes/config.js` | P1 |
| Instances | `/api/instances`, `/api/local-agent-apps`, `/api/agents`, `/api/sessions/active` | `routes/instances.js` | P1 |
| Chat | `/api/instances/:id/sessions`, `/api/instances/:id/sessions/:sessionId/chat`, `/api/group-chat` | `routes/chat.js` | P2 |
| Skills | `/api/skills`, `/api/instances/:id/skills` | `routes/skills.js` | P1 |
| Desktop | `/api/instances/:id/apps/:appName/open`, `/api/instances/:id/agent-desktop/invoke`, file upload | `routes/desktop.js` | P2 |
| Overview | `/api/dashboard/stats`, `/api/dashboard/activity`, `/api/global-search` | `routes/dashboard.js` | P2 |
| Memory | `/api/memory`, `/api/obsidian`, `/api/conversations/archive-to-obsidian` | `routes/memory.js` | P2 |
| Knowledge Inbox | `/api/knowledge-inbox`, `/api/knowledge-automation`, `/api/webhooks/knowledge` | `routes/knowledge-inbox.js` | P2 |
| Documents | `/api/documents/*` | `routes/documents.js` | P1 |
| Meetings | `/api/meetings/*`, `/api/transcription/settings` | `routes/meetings.js` | P3 |
| Workflows | `/api/workflows`, `/api/run-history` | `routes/workflows.js` | P2 |
| Tools | `/api/tools`, `/api/tool-runtime/*` | `routes/tools.js` | P1 |
| Automations | `/api/automations/*` | `routes/automations.js` | P2 |
| Notifications | `/api/notifications/*`, `/api/feedback`, `/api/model-evaluations` | `routes/notifications.js` | P3 |

## 拆分顺序

1. **先抽 middleware**
   - `local-origin-guard.js`：当前 Origin / `Sec-Fetch-Site` 本机来源守卫。
   - `upload-policy.js`：上传策略检查和 `multer` 绑定。

2. **先拆低耦合路由**
   - `system.js`
   - `notifications.js`
   - `automations.js`
   - `workflows.js`

3. **再拆核心但边界清楚的路由**
   - `skills.js`
   - `tools.js`
   - `documents.js`
   - `config.js`

4. **最后拆聊天和知识上下文**
   - `chat.js`
   - `memory.js`
   - `knowledge-inbox.js`
   - 这几块共享模型调用、知识检索、会话持久化，最后拆风险更低。

## 验收标准

- 每次拆一个模块，接口路径和响应结构保持不变。
- 每次拆分后运行 `npm run verify`。
- 打包后运行 `/api/health` 与 `/api/system/self-check`。
- 对写入型模块至少手测一条读接口和一条写接口。
- 拆分完成前不重命名公开 API，例如 `/api/dashboard/*` 可以继续保留，前端路由已经统一为 `/system-overview`。

## 注意事项

- `electron/server.cjs` 是旧服务文件，不应继续承载新逻辑。
- `server-bundle.cjs` 是打包产物，不作为源代码修改入口。
- 文件路径相关逻辑优先沉淀到 `vault-service.js` / `storage-service.js`，不要在路由里重复手写路径校验。
- 工具执行、桌面 App 调用、上传写入都属于高风险接口，拆分时保留现有安全校验并补充回归测试。
