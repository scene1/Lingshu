# GitHub 主流 AI 工作台对标与灵枢剩余优化建议

> 日期：2026-08-14
> 目的：对照主流开源 AI 工作台在工具/Skill、参数表单、运行记录、文档产物、RAG 引用、远程运行时等位置的做法，确定灵枢下一轮优化顺序。
> 对标对象：Open WebUI、LibreChat、Dify、AnythingLLM、Flowise/LobeChat 相关公开文档与仓库资料。

## 1. 总体结论

灵枢当前已经具备“本地桌面 AI 工作台”的基础闭环：聊天、文件解析、Skill、项目、知识库、文档产物、运行实例和 Electron 打包都已经能跑。但和主流产品相比，还缺三类成熟度：

1. **工具执行的产品化边界**：主流项目会清晰区分内置工具、外部 MCP/OpenAPI 工具、用户脚本和插件，并明确安全风险。灵枢已开始区分 `prompt-only/runtime/manifest-error`，下一步要补权限、参数 schema、运行记录和 Chat 中的执行证据。
2. **可视化调试闭环**：Dify、Flowise 这类产品强调 workflow/tool run 的输入、输出、状态、耗时、错误。灵枢已有 Run History 基础，但 Skill 测试和 Chat 中的 Skill 执行还没写入统一 Run History。
3. **文档/RAG 体验深度**：Open WebUI、AnythingLLM 强调文档解析、RAG、来源引用和知识范围控制。灵枢已修复附件引用和 Obsidian 混入问题，但还缺来源跳转、片段高亮、原文/优化后对比和版本管理。

## 2. 对标观察

| 方向 | 主流做法 | 对灵枢的启发 |
|---|---|---|
| 工具分类 | Open WebUI 将 Native Features、Workspace Tools、MCP、OpenAPI 等分层，并明确 Workspace Tools 等同高权限代码执行。 | 灵枢应继续保留 `prompt-only/runtime/manifest-error`，并在 UI 上显示安全级别、权限和可执行入口。 |
| Agent 工具 | LibreChat 倾向在 Agent Builder 中选择工具；MCP 和 Actions 是部署侧推荐扩展方式。 | 灵枢的 Skill 不应只靠聊天文本触发，应进入“选择/配置/测试/运行记录”的 Agent 工具链。 |
| 参数 schema | Dify 从 OpenAPI/工具 schema 解析参数，要求 name、description、inputSchema 等字段严格有效。 | 灵枢 manifest 应支持参数 schema、必填校验、默认值、select/boolean/number/text，并在执行前校验。 |
| Workflow Run | Dify WorkflowRun 保存 inputs、outputs、status、error、elapsed_time、tokens、steps 等。 | Skill Runtime、Automation、Workflow、Agent Team 都应统一写入 Run History，字段至少包括 input/output/status/error/duration/source。 |
| 文档与 RAG | Open WebUI 区分 File Context 与 Builtin Tools；Knowledge 在 Native Function Calling 下不会自动注入，需要模型主动调用检索工具。 | 灵枢已经避免附件场景自动混入 Obsidian；下一步应把“本轮附件/知识库/项目资料”做成可控开关和可解释来源。 |
| Artifacts | LibreChat 支持 Artifacts，在独立窗口展示交互内容。 | 灵枢的右侧文档产物面板方向正确，下一步应做版本、导出历史、原文对比和章节级重生成。 |
| 本地优先桌面 | AnythingLLM 强调 Desktop、RAG、Agent、MCP、文档解析和清晰 citations。 | 灵枢应保留本地优先特色，把 Finder 粘贴、PDF/DOCX 解析、桌面应用调用做得比 Web 产品更顺手。 |
| 会话归档与记忆 | ChatGPT 类产品把“历史归档/临时聊天/记忆”拆开；Open WebUI、LibreChat、AnythingLLM 也通常把对话历史、知识库文档和长期记忆分层处理。 | 灵枢不应静默把所有对话直接混入默认 RAG；更合理的是自动保存/归档为 Markdown，并在用户明确要求历史资料、知识库或共享记忆时才检索引用。 |

## 3. 灵枢剩余优化优先级

### P0：继续收口 Skill Runtime

状态：已完成第一阶段。

已完成：

- Skill 支持 `prompt-only/runtime/manifest-error`。
- Skills 管理页显示执行模式。
- Skills 管理页支持测试执行。
- manifest 支持 `runtime.parameters`。
- 样例 `lingshu-runtime-smoke` 可返回 `mode=runtime`。

下一步：

1. 参数表单增加必填校验和 JSON/Object 输入。**本轮已落地。**
2. Skill 测试写入 Run History。**本轮已落地。**
3. Chat 中的 Skill toolCall 展示执行模式、耗时和 stdout/stderr。**本轮已接入执行模式、耗时、runId 与执行输出。**
4. manifest 增加权限声明，例如 `permissions.files/read`、`network`、`shell`。**本轮已完成读取、展示和 Run History 记录。**

### P1：Run History 统一化

主流产品会把 workflow/tool/agent run 视为一等数据。灵枢已有运行历史基础，但 Skill 测试还没接入。

建议字段：

```json
{
  "type": "skill",
  "targetId": "lingshu-runtime-smoke",
  "source": "skills-test|chat",
  "status": "completed|error",
  "input": {},
  "output": {},
  "error": "",
  "durationMs": 0,
  "createdAt": ""
}
```

### P1：文档产物工作台化

现状：右侧预览 + DOCX 导出已可用。

下一步：

1. 原文/优化后双栏对比。
2. 章节收展。
3. 版本历史。
4. 重新生成某一节。
5. 导出历史与文件路径回显。

### P1：引用来源深链

现状：来源显示已修复，不再把本轮附件误显示成 Obsidian。

下一步：

1. 附件来源点击打开片段详情。
2. 文档原文片段高亮。
3. 来源编号回链，例如 `[1] [2]`。
4. 区分“本轮附件”“当前项目”“知识库”“共享记忆”。

### P1：对话归档状态可见化

现状：灵枢后端已在会话保存时尝试归档到 Vault 的 `灵枢/Conversations/AI对话/`，并维护 `会话索引.md`。

本轮补充：

1. 会话列表返回 `obsidianArchive` 与 `obsidianArchiveError`。
2. 聊天顶部展示“已归档 / 待归档 / 归档异常 / 未归档”状态。
3. UI 文案明确：归档是保存为可读 Markdown，不等于默认注入知识库检索。

### P2：远程 Runtime

现状：展示层多于真实连接。

下一步：

1. Runtime 注册/握手。
2. 鉴权 token。
3. 心跳和状态刷新。
4. 能力发现。
5. 断线重连和调用日志。

## 4. 推荐实施顺序

1. **Skill 执行写入 Run History**
   这是接上主流产品“可调试运行”的关键一步，风险小，收益直接。

2. **Chat 中展示 Skill Runtime 执行证据**
   让用户在聊天里看出 Skill 是说明型还是实际执行了脚本。

3. **参数 schema 校验增强**
   补 required 校验、JSON 参数、文件参数占位。

4. **文档产物版本/对比**
   对齐 LibreChat Artifacts 和主流文档工作流体验。

5. **引用来源深链**
   对齐 Open WebUI/AnythingLLM 的 citation 体验。

6. **远程 Runtime 握手**
   放在后面，因为涉及协议、鉴权、安全边界，工程面更大。

## 5. 本轮落地记录

已按上面的实施顺序完成第一批代码更新：

- `server-v2.js`：Skill Runtime 返回 `startedAt`、`finishedAt`、`durationMs`、`stdout`、`stderr`、`exitCode`，并新增 Skill 运行历史记录写入。
- `server-v2.js`：Skills 页面测试入口 `/api/instances/:id/skills/:skillName/execute` 会返回 `runRecord`。
- `server-v2.js`：聊天触发 Skill 时会写入 `type=skill` 的 Run History，并把 `mode`、`durationMs`、`runId` 写入 tool call。
- `server-v2.js`：Skill Runtime 支持 `required`、`number/integer`、`boolean`、`select`、`json`、`object` 参数校验。
- `server-v2.js`：manifest 支持 `runtime.permissions`，并写入 Run History 的 `input.permissions` 与 `input.securityLevel`。
- `src/pages/Dashboard.tsx`：运行历史支持筛选 `Skill`，并可从 Skill 记录跳转到 Skills 页面。
- `src/pages/Skills.tsx`：Skill 测试结果显示耗时和 Run History 记录 ID，JSON/Object 参数使用代码输入框并在提交前解析。
- `src/pages/Skills.tsx`：Skills 列表和测试弹窗展示权限声明与风险等级。
- `server-v2.js`：会话列表返回归档路径和归档错误，便于聊天顶部展示归档状态。
- `src/pages/RealChat.tsx`：聊天顶部展示归档状态、模型切换提示和生成进度。
- `src/components/chat/MessageBubble.tsx`、`src/styles/index.css`：引用来源 chip 和来源卡片增加宽度约束，长文本不再撑出气泡。
- `deliverables/sample-skills/lingshu-runtime-smoke/lingshu.json`：样例 manifest 增加必填参数、JSON/Object 参数和权限声明。
- `deliverables/skill-runtime-manifest-example.md`：补充参数类型、校验规则和权限声明示例。

本轮验证结果：

- `npm run verify` 通过。
- 临时后端与更新后的 `/Applications/灵枢.app` 后端均验证通过。
- `/api/run-history?type=skill&limit=2` 可返回最新 Skill 运行记录。
- 合法 JSON/Object 参数会被规范化后传给脚本。
- 显式清空必填参数、非法 select、非法 JSON、非对象 Object 会被执行前拦截，并写入失败 Run History。

## 6. 参考来源

- Open WebUI Tools 文档： https://github.com/open-webui/docs/blob/main/docs/features/extensibility/plugin/tools/index.mdx
- Open WebUI RAG 文档： https://docs.openwebui.com/features/chat-conversations/rag/
- LibreChat Agents/Artifacts 文档： https://www.librechat.ai/docs/features/agents
- LibreChat Tools 文档： https://www.librechat.ai/docs/configuration/tools
- Dify Workflow API 模板： https://github.com/langgenius/dify/blob/main/web/app/components/develop/template/template_workflow.en.mdx
- Dify WorkflowRun 模型： https://github.com/langgenius/dify/blob/main/api/models/workflow.py
- Dify OpenAPI Tool Schema Parser： https://github.com/langgenius/dify/blob/main/api/core/tools/utils/parser.py
- Dify Tool Return/Output Schema 文档： https://docs.dify.ai/en/develop-plugin/features-and-specs/plugin-types/tool
- AnythingLLM 文档： https://docs.anythingllm.com/
- AnythingLLM GitHub README： https://github.com/Mintplex-Labs/anything-llm/blob/master/README.md
