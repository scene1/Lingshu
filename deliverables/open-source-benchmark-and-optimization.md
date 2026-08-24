# 灵枢开源同类产品比对与优化建议

> 生成日期：2026-08-10
> 对比范围：GitHub 上与灵枢相关的开源 AI 聊天客户端、AI 工作台、Agent 编排、RAG/Workflow 平台。
> 当前项目参照：`lingshuproject` Phase 2 已实现内容与待优化点。

---

## 1. 结论先行

灵枢当前已经具备一个「本地 AI 工作台」的雏形：多 Provider、RealChat、GroupChat、工具注册表、自动化、Workflow、Dashboard、Electron 桌面壳都已经在代码里出现。但和成熟开源项目相比，差距不在于单点功能数量，而在于三件事：

1. **核心闭环还不够稳**：RealChat、chatStore、后端会话保存之间仍有重复状态与重复持久化风险；Agent Team 的角色配置还没有真正传到执行链路。
2. **平台化能力偏薄**：工具、知识库、Agent、Workflow、Automation 现在是几个页面，而不是可组合的统一运行时。
3. **产品体验还缺少“高频效率件”**：全局搜索、消息编辑重发、会话组织、Prompt/Assistant 市场、RAG 来源引用、工具执行可观测性、运行日志追踪等成熟产品都在做。

建议下一阶段不要继续堆新页面，而是围绕「稳定聊天闭环 + 可组合 Agent/工具/知识/工作流 + 桌面效率体验」推进。

---

## 2. 选取的开源参照物

| 项目 | 定位 | 对灵枢最有参考价值的地方 |
|---|---|---|
| Open WebUI | 自托管 AI 平台 | Workspace 模型：Models、Knowledge、Prompts、Skills、Tools 可组合；RAG、MCP/OpenAPI、Automations、RBAC、Analytics 都形成平台闭环。 |
| LibreChat | 增强版 ChatGPT Clone / 多模型聊天平台 | Agents、MCP、Code Interpreter、Artifacts、消息分支、Presets、文件能力做得完整，适合作为 RealChat 体验标杆。 |
| Cherry Studio | 桌面端 AI 生产力客户端 | 与灵枢桌面定位最接近：跨平台、多 Provider、300+ 助手、多模型同时对话、MCP、主题、文件处理、WebDAV。 |
| LobeHub / Lobe Chat | 现代设计 AI Chat / Agent 协作产品 | 设计系统、Agent Market、MCP Marketplace、分支对话、Artifacts、知识库、PWA/桌面生态值得参考。 |
| Dify | 生产级 LLM App / Agentic Workflow 平台 | Workflow、RAG Pipeline、Agent、模型管理、LLMOps、API 化，是灵枢 Workflow 与 Automation 的上限参考。 |
| Flowise | 可视化 AI Agent / Workflow Builder | 低代码节点编排、AgentFlow、第三方节点组件、Swagger API 文档，对灵枢工作流画布和执行引擎有直接启发。 |

---

## 3. 横向能力矩阵

| 能力 | 灵枢当前 | Open WebUI | LibreChat | Cherry Studio | LobeHub | Dify | Flowise |
|---|---|---|---|---|---|---|---|
| 多 Provider | 已有 | 强 | 强 | 强 | 强 | 强 | 强 |
| SSE/流式聊天 | 已有 | 强 | 强 | 强 | 强 | 应用级 | 节点级 |
| 消息分支/回退 | 部分完成 | 有类似上下文管理 | 明确支持分支/编辑/重发 | 有话题管理 | 支持分支对话 | 非核心 | 非核心 |
| 多模型对比 | 部分完成 | 支持多模型并行 | 支持模型切换/对比 | 支持多模型同时对话 | 支持多模型 | Prompt IDE 对比 | 可通过 Flow 编排 |
| Agent Builder | 初步 | 模型+工具+知识封装 | Agent Builder 很完整 | 助手体系成熟 | Agent 为核心 | Agent 应用 | AgentFlow |
| Multi-Agent | 初步且未闭环 | Channels / 模型协作 | Agent Chain / Subagents | Autonomous Agents | Agent Team 方向强 | Workflow/Agent | Multi-agent systems |
| MCP/工具 | 工具注册表初步 | MCP/OpenAPI/Python Tools | MCP 深度接 Agent/Chat | MCP Server | MCP Marketplace | 工具丰富 | 第三方节点 |
| RAG/知识库 | 已有 Knowledge Inbox、聊天上下文和来源引用，增强方向是索引生命周期 | 很强，混合检索、多向量库 | File Search/File Context | 文件处理较强 | Knowledge Base | RAG Pipeline 强 | RAG 节点丰富 |
| Workflow | 页面存在，执行较弱 | Pipelines/Automations | Agents + Actions | 暂非核心 | Agent 运维方向 | 强项 | 强项 |
| Automations | Cron 初步 | 调度 prompt 并关联日历/聊天 | 可通过 Agents/API 扩展 | 暂非核心 | 调度 Agent 是主线 | 工作流生产化 | Workflow 自动化 |
| Observability | 系统概览初步（代码文件仍为 Dashboard） | Analytics/Evals/OTel | Langfuse/部署辅助 | 较轻 | 发展中 | LLMOps 强 | Metrics/API |
| 桌面体验 | Electron 已有 | 有桌面 companion | Web/self-host 为主 | 强 | 有桌面方向 | Web 平台 | Web 平台 |

---

## 4. 关键差距分析

### 4.1 RealChat：应该先从“能聊”变成“可信赖的聊天内核”

灵枢已经做了 SSE、快速操作、分支、撤销、多模型对比，但当前状态管理还比较混合：

- 页面仍保留大量本地 `useState`，再与 `chatStore` 手动同步。
- 后端 chat 接口会保存消息，前端又会调用 events 追加消息，存在重复写入风险。
- 多模型对比有 `ModelCompare` 组件和 `chatStore.sendCompareMessage` 两套逻辑，采用结果的持久化不稳。

对比：

- LibreChat 将消息编辑、重发、分支、Presets、Artifacts 放在同一套对话体验里，用户能围绕一次对话不断修正上下文。
- Open WebUI 进一步支持消息队列、工具调用、文件、RAG、记忆、Web Search 在同一聊天内运行。

优化建议：

1. **统一会话写入权责**：后端 chat 端点负责生成与保存，前端只订阅最终 session；或前端负责本地 optimistic update，后端只接收事件流，二者选一个。
2. **RealChat 彻底迁入 `chatStore`**：`sessions/messages/currentSessionId/isLoading/isStreaming` 不再在页面重复维护。
3. **补齐消息编辑重发**：这是 LibreChat、LobeChat 一类产品的高频能力，优先级应高于继续新增页面。
4. **把 reasoning/toolCalls 持久化到 message**：不要只在流式 runtime 中显示，刷新后也应可回看。
5. **多模型对比改为“一个用户问题 + N 个候选回复 + 采用记录”数据模型**，而不是 N 条普通 assistant 消息。

---

### 4.2 Tool Registry：从“列表”升级成“可执行工具运行时”

灵枢已经有 MCP/Native/Plugin 三层工具注册表，但目前更像配置列表：

- Native 硬编码工具基本永远 enabled，启禁用不完整。
- 工具能力、参数 schema、权限、安全策略、执行审计没有形成统一模型。
- 发现工具后还缺少一键导入、测试连接、工具级日志、工具级权限。

对比：

- Open WebUI 将 Tools、Functions、Pipelines、MCP、OpenAPI、Skills 作为平台扩展层，工具可以直接进入模型运行时。
- LibreChat 的 MCP 能同时进入普通 Chat 和 Agent Builder，并支持 Agent 内细粒度选择工具。

优化建议：

1. **工具注册项增加 schema 字段**：`inputSchema/outputSchema/auth/permissions/runtime/status/lastCheckedAt`。
2. **新增工具测试按钮**：执行 dry-run 或 health check，结果写入 audit。
3. **工具选择进入聊天输入区和 Agent Builder**：不是只在 ToolRegistry 页面管理。
4. **支持工具分组和 deferred loading**：Agent 拥有很多 MCP 工具时，不要一次性塞进模型上下文。
5. **OpenAPI 工具导入**：参考 Open WebUI / LibreChat，将 OpenAPI spec 自动转工具。

---

### 4.3 Agent Team：当前是 UI 雏形，还不是执行模型

灵枢 Phase 2 创建了 `TeamRoleSelector`、`TaskDistributor`、`AgentReplyTimeline`，后端也接受 `distributionMode`。但有几个硬伤：

- 前端 Team 面板维护 `teamRoles`，发送请求时仍传普通 `participants`。
- 后端 `normalizeGroupParticipant` 丢掉 `role`，导致 conditional 分发无法按角色工作。
- 串行模式只是依次调用 Agent，没有把前一个 Agent 的输出作为后一个 Agent 的输入。
- `AgentReplyTimeline` 创建了但未在 GroupChat 中渲染。

对比：

- LibreChat 的 Agent Chain 明确让后续 agent 读取前面 agent 输出。
- LobeHub 的定位已经转向 Agent Operator：hire、schedule、report，强调 Agent 作为工作单元。
- Dify/Flowise 把复杂协作抽象为节点图、运行记录和可调试执行轨迹。

优化建议：

1. **统一 TeamRoleConfig 与 Participant**：发送请求时如果 `mode === 'team'`，应由 `teamRoles` 生成 participants。
2. **后端保留 role/systemPrompt/avatarColor**：`normalizeGroupParticipant` 不应丢失这些字段。
3. **串行执行改为显式上下文传递**：每一步输出追加到 scratchpad，再传入下一个 Agent。
4. **并行执行增加汇总器**：并行回复完成后由 coordinator 或 summary agent 生成最终结论。
5. **条件分发从关键词升级为规则表**：`role.routingRules` 或可视化规则配置。
6. **渲染 AgentReplyTimeline**：用于展示每个 Agent 的开始、结束、耗时、工具调用、输出摘要。

---

### 4.4 Workflow 与 Automation：应合并成“可观察的任务运行时”

灵枢的 Cron 引擎、自动化页面、Workflow 页面都已经存在，但当前 Workflow Cron 的执行器仍是占位摘要，没有调用真实 workflow 引擎。

对比：

- Dify 的核心价值是 Workflow、RAG Pipeline、Agent、模型、Observability、API 的生产化闭环。
- Flowise 的优势是低代码节点画布、第三方节点组件、API 文档和部署方式清晰。
- Open WebUI 的 Automations 会把调度运行结果连接回聊天/日历，用户能追踪“自动运行产生了什么”。

优化建议：

1. **Automation actionType 应统一为 `chat | workflow | agent_team | tool`**。
2. **Workflow Cron 必须调用真实 `executeWorkflow(workflow)`**，并保存每个节点的运行结果。
3. **新增 Run History 数据模型**：`runId/status/startTime/endTime/input/output/nodeRuns/error`。
4. **Workflow 节点级日志**：每个节点的输入、输出、耗时、错误可展开查看。
5. **自动化结果反写到会话或报告**：类似 Open WebUI，调度完成后生成一条可打开的 chat/report。
6. **失败重试与通知**：支持最大重试次数、退避策略、失败提示。

---

### 4.5 RAG/知识库：基础已落地，下一阶段做深索引与引用闭环

灵枢已有 Knowledge Inbox、聊天知识上下文、Vault 写入和来源引用能力；与成熟产品相比，后续差距主要在索引生命周期和引用深链：

- 文档导入、解析、chunk、embedding、索引、混合检索、rerank 还可以形成更统一的任务闭环。
- 系统概览还不能展示知识库索引状态、失败文件、最近更新。
- Chat 中已有来源引用，后续可增加原文跳转、片段高亮和引用编号回链。

对比：

- Open WebUI 的 RAG 能力非常强：多向量库、混合检索、重排、多解析引擎、full context。
- Dify 把 RAG 做成 Pipeline，可编排文档处理流程。
- LibreChat 支持 File Search/File Context，把文件能力挂到 Agent。

优化建议：

1. **继续深化轻量本地 RAG**：在现有本地优先基础上，把导入、索引、检索、引用做成稳定闭环，不要一开始支持 9 个向量库。
2. **支持两种上下文模式**：小文档 full context，大文档 RAG chunk。
3. **Chat 消息显示引用来源**：文档名、页码/段落、score、引用片段。
4. **文档处理任务化**：导入是后台 run，可重试、可查看错误。
5. **知识库进入 Agent/Workflow**：Agent 可绑定知识库，Workflow 节点可查询知识库。

---

### 4.6 系统概览：从指标面板变成“工作运营台”

灵枢当前应用菜单里叫“系统概览”（代码文件仍是 `Dashboard.tsx`），已经从系统指标升级成工作台，但目前统计字段仍有占位性质，例如 `todayTokens = 0`、`todayChats = activeSessions`。

对比：

- Open WebUI 有 usage analytics、model evaluation、A/B test、ELO leaderboard。
- Dify 强调 LLMOps，可以用生产数据和标注持续改进提示词、数据集、模型。

优化建议：

1. **建立 usage event 表/文件**：记录 message、token、model、provider、latency、tool calls、cost estimate。
2. **系统概览卡片改用真实聚合**：今日对话、今日 token、失败率、平均延迟、自动化成功率。
3. **加入模型表现对比**：响应耗时、错误率、平均 token、人工点赞率。
4. **加入任务中心**：最近自动化、Workflow run、知识库索引、Agent Team run 都汇总到这里。
5. **把系统状态降级**：CPU/内存只作为调试 Tab，不应占主心智。

---

## 5. 推荐路线图

### P0：先修闭环，避免功能越多越不稳

| 优先级 | 任务 | 预期收益 |
|---|---|---|
| P0-1 | RealChat 单一状态源：彻底迁到 `chatStore` | 消除消息/会话状态漂移 |
| P0-2 | 修复 chat 保存重复写入 | 避免历史污染，是所有对话能力的地基 |
| P0-3 | TeamRoleConfig 真正接入 GroupChat 请求与后端 | Agent Team 从 UI 变成可执行 |
| P0-4 | Workflow Cron 调用真实 Workflow 引擎 | 自动化从占位变成可用 |
| P0-5 | reasoning/toolCalls/source 持久化 | 刷新后仍可审计 AI 行为 |

### P1：做出灵枢自己的产品味道

| 优先级 | 任务 | 参考对象 |
|---|---|---|
| P1-1 | 全局搜索：会话、Agent、工具、文档、Workflow | Cherry Studio / Open WebUI |
| P1-2 | Assistant/Agent 模板库 | Cherry Studio / LobeHub |
| P1-3 | 工具测试、导入、schema、审计日志 | LibreChat / Open WebUI |
| P1-4 | Agent Team timeline + 汇总输出 | LibreChat Agent Chain / LobeHub |
| P1-5 | Run History：Automation/Workflow/AgentTeam 统一运行记录 | Dify / Flowise |
| P1-6 | Chat 中的文件/RAG 来源引用 | Open WebUI / Dify |

### P2：平台化与生产化

| 优先级 | 任务 | 参考对象 |
|---|---|---|
| P2-1 | 可视化 Workflow 节点运行调试 | Flowise / Dify |
| P2-2 | OpenAPI 工具导入与 MCP Marketplace | Open WebUI / LobeHub |
| P2-3 | 模型评测与 A/B 对比 | Open WebUI / Dify |
| P2-4 | 权限、空间、数据隔离 | Open WebUI / LibreChat |
| P2-5 | 桌面增强：全局快捷入口、截图提问、多窗口 | Cherry Studio / Open WebUI Desktop |

---

## 6. 对灵枢定位的建议

不建议灵枢直接复制 Dify 或 Open WebUI 的全平台路线。它们已经很重，灵枢当前更适合走这条线：

> **本地优先的 AI 工作台：以桌面效率入口为核心，把聊天、工具、知识、Agent Team、自动化串成个人/小团队的可执行工作流。**

这个定位下，灵枢的差异化应该是：

1. **桌面原生能力**：打开本地应用、处理本地文件、剪贴板/截图/快捷键、系统通知。
2. **轻量但可组合**：不像 Dify 那么重，但比 Cherry Studio 更强调工具、Workflow、Agent Team 的组合。
3. **中文本地工作流友好**：飞书、会议纪要、文档、审批、日历、知识库这些工作场景可以成为独特优势。
4. **可观察的 AI 执行**：每次 Agent/Workflow/Automation 做了什么、用了什么工具、结果在哪里，都能追踪。

---

## 7. 建议新增/调整的数据模型

### 7.1 ChatCandidate

用于多模型对比，不再把候选回复直接混入普通消息。

```ts
interface ChatCandidate {
  id: string
  questionMessageId: string
  model: string
  provider: string
  content: string
  reasoning?: string
  toolCalls?: ToolCall[]
  status: 'running' | 'completed' | 'error'
  adopted: boolean
  createdAt: string
}
```

### 7.2 RunRecord

统一 Workflow、Automation、Agent Team 的运行历史。

```ts
interface RunRecord {
  id: string
  type: 'workflow' | 'automation' | 'agent_team' | 'tool'
  targetId: string
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled'
  input: unknown
  output?: unknown
  error?: string
  startedAt: string
  finishedAt?: string
  steps: RunStep[]
}
```

### 7.3 ToolRegistryItem v2

```ts
interface ToolRegistryItemV2 {
  id: string
  name: string
  layer: 'mcp' | 'native' | 'plugin' | 'openapi'
  source: string
  enabled: boolean
  inputSchema?: unknown
  outputSchema?: unknown
  auth?: unknown
  permissions: string[]
  status: 'enabled' | 'disabled' | 'offline' | 'error'
  lastCheckedAt?: string
}
```

### 7.4 灵枢 Vault 目录约定

灵枢运行时原始数据继续保存在 `~/Lingshu/workspace/lingshu-app-data/`，例如会话 JSON、运行历史、记忆 JSON、索引数据库、上传文件等。这些是应用内部事实源，不建议直接混入知识库。

当需要把内容变成可阅读、可检索、可同步的知识资产时，统一写入用户配置的 Markdown Vault 下的 `灵枢/` 目录：

```text
灵枢/
  Inbox/知识流/                # Knowledge Inbox 处理后的知识条目
  Memory/Facts/                # 从灵枢记忆同步出的长期事实
  Conversations/AI对话/        # AI 对话 Markdown 归档与会话索引
```

`.lingshu/` 继续作为 Vault 内的轻量运行时元数据目录，默认排除检索；`Codex/对话存档` 仅作为旧归档路径兼容读取，新归档不再写入该目录。

---

## 8. 当前落地进度（2026-08-10）

| 路线图项 | 状态 | 已完成内容 | 后续优化 |
|---|---|---|---|
| P0-2 chat 保存重复写入 | 已完成基础修复 | 后端 chat 支持 `persist:false`，多模型对比采用回复时避免重复持久化。 | 继续把会话写入权责收敛到单一状态源。 |
| P0-3 TeamRoleConfig 接入 | 已完成基础修复 | GroupChat 发送 team roles，后端保留 `role/systemPrompt/avatarColor`。 | 条件分发规则仍需从关键词升级为可配置规则表。 |
| P0-4 Workflow Cron 真实执行 | 已完成增强版 | Automation 触发 workflow 时调用真实 `executeWorkflow(workflow)`；自动化任务新增失败重试配置（最大重试次数、初始等待、固定/线性/指数退避），Cron 与手动执行共用同一套策略；执行日志和 Run History steps 会记录每次尝试、耗时、错误和下次等待；最终失败会写入真实通知中心；App 顶部和侧边栏显示未读角标，并对新的错误/警告通知触发 Electron 原生桌面通知。 | 后续可增加失败告警渠道、按错误类型选择是否重试、通知规则静默时段。 |
| P0-5 reasoning/toolCalls/source 持久化 | 已完成基础版 | chat/events 保存接口保留 `reasoning/toolCalls/citations`；流式与非流式回复都会把模型推理、工具调用、知识来源写入 assistant message，前端接收后可立即展示并支持刷新回看。 | 后续可增加来源片段详情抽屉、工具调用结果重放、token/latency/cost usage 事件。 |
| P1-1 全局搜索 | 已完成基础版 | 新增 `/api/global-search` 聚合搜索普通会话、多 Agent 群聊、Agent、工具、文档、Workflow、Automation；顶部栏新增全局搜索入口与 `⌘K / Ctrl+K` 快捷键，点击结果跳转对应模块。 | 后续可增加会话/文档深链定位、搜索高亮、最近搜索和命令面板动作。 |
| P1-2 Assistant/Agent 模板库 | 已完成基础版 | Agent 角色库新增常用角色模板，可一键套用产品策略师、研究分析员、质量审查员、文档编辑、自动化执行员、工具专家等配置，自动填充名称、描述、参数、Skills 和 System Prompt。 | 后续可增加模板导入导出、用户自定义模板、模板市场、按场景筛选和团队共享。 |
| P1-4 Agent Team timeline + 汇总输出 | 已完成 | GroupChat 渲染 Agent 执行轨迹，展示状态、耗时、输出和错误；并行/条件分发多回复时追加 `团队汇总` 结论消息，并作为 timeline 最后一步记录。 | 后续可增加人工选择汇总模型、汇总重试、只采纳汇总到报告。 |
| P1-5 Run History | 已完成增强版 | Workflow、Automation、Agent Team、Tool Test/OpenAPI Execute 统一写入 `run-history.jsonl`；系统概览（`/dashboard`）支持最近运行历史、类型筛选、详情抽屉、输入/输出/步骤查看、JSON 导出，并可从列表或详情一键打开来源模块（Workflow、Automation、Tool Registry、Group Chat、AI 对话等）。 | 后续可增加失败重试、按具体 targetId 深链定位到单条工作流/自动化/工具记录。 |
| P1-6 Chat 中的文件/RAG 来源引用 | 已完成基础版 | 对话消息已展示可折叠参考来源区，按来源卡片展示知识库、文档、路径/章节、相关性、片段，并支持复制片段；后端已持久化 `citations`，刷新后可回看。 | 后续可增加点击跳转文档原文、片段高亮定位、引用编号回链和上传文件级来源追踪。 |
| P1-3 Tool Registry v2 | 已完成基础版 | 工具注册项增加 `inputSchema/outputSchema/auth/permissions/runtime/status/lastCheckedAt`，新增工具测试按钮，测试结果写审计和 Run History。 | 继续做真实 MCP handshake、工具级权限策略、Agent 内细粒度工具选择。 |
| 存储目录约定 | 已完成基础版 | 明确 `~/Lingshu/workspace/lingshu-app-data` 作为运行时事实源，Markdown Vault 下统一使用 `灵枢/Inbox/知识流`、`灵枢/Memory/Facts`、`灵枢/Conversations/AI对话`；旧 `Codex/对话存档` 继续兼容读取。 | 后续可增加历史归档迁移工具和设置页中的目录健康检查。 |
| AI 对话 Skill 调用 | 已完成基础版 | AI 对话闪电菜单加载真实 `/api/skills` 列表，选择后插入标准 Skill 调用语句；后端识别“使用/调用 xxx Skill”并把对应 `SKILL.md` 注入本轮系统提示，同时记录为工具调用证据。 | 后续可增加 `@skill` 自动补全、Skill 参数表单、执行日志和多 Skill 编排。 |
| P2-1 Workflow 节点运行调试 | 已完成基础版 | `/api/workflows/:id/run` 返回节点级运行结果并写入 Run History；Workflow 页面支持运行中状态、最近一次节点状态标记、调试抽屉、节点时间线、输入配置、输出与耗时查看。 | 后续可增加实时 SSE 日志、单节点重试/跳过、断点运行、真实 Agent/Skill 节点执行器和运行队列。 |
| P2-2 OpenAPI 工具导入与 MCP Marketplace | 已完成增强版 | Tool Registry 新增 `OpenAPI` 工具层与“导入 OpenAPI”入口，支持粘贴 JSON 格式 OpenAPI 3.x / Swagger 2.0，把每个 operation 转成带 `inputSchema/outputSchema/auth/permissions/runtime` 的工具项；新增 OpenAPI 真实执行器，支持 path/query/header/body 参数、临时 Bearer/API Key/Header 鉴权、请求超时、响应查看，并把导入/测试/执行写入审计和 Run History。 | 后续可增加 YAML 解析、URL 拉取、可视化参数表单、MCP Marketplace 远程索引与一键安装、Agent 自动选择 OpenAPI 工具执行。 |
| P2-3 模型评测与 A/B 对比 | 已完成基础版 | 新增 `/api/model-evaluations` 聚合模型调用、会话回复、点赞/点踩和 A/B 采用记录；AI 对话采用对比回复时写入 `model_eval` Run History；系统概览工作台新增“模型评测与 A/B”卡片，展示综合分、调用/回复数、有用反馈、A/B 采用率、延迟和错误率。 | 后续可增加离线评测集、固定 prompt suite、人工标注队列、成本估算、按任务场景分组和自动 A/B 实验配置。 |
| P2-4 权限、空间、数据隔离 | 已完成基础版 | 新增 `settings.security.isolation` 本地空间隔离策略与 `/api/security/isolation`；设置页新增“权限与隔离”页签，可查看运行数据、上传、Agent 工作区、Skills、Vault 等受控根目录，并控制工具路径边界、Vault 写入、记忆同步、会话归档、上传写入；CLI 工具执行会固定工作目录并拦截受控空间外绝对路径。 | 后续可增加多用户/团队空间、角色权限、密钥级权限、工具按 Agent 授权、Vault 只读模式细化和敏感数据脱敏扫描。 |
| P2-5 桌面增强：全局快捷入口、截图提问、多窗口 | 已完成基础版 | Electron 主进程新增全局快捷键：`CommandOrControl+Shift+L` 唤起主窗口、`CommandOrControl+Shift+S` 截图提问、`CommandOrControl+Shift+N` 新开 AI 对话窗口；截图保存到 `~/Lingshu/workspace/uploads/screenshots` 并以 Markdown 图片引用插入 AI 对话输入框；AI 对话工具栏新增截图提问和新窗口按钮；设置页“快捷键”展示桌面快捷键和截图目录。 | 后续可增加可配置快捷键、区域截图、OCR、截图标注、跨窗口会话同步、菜单栏常驻入口和系统通知中心。 |

---

## 9. 参考来源

- Open WebUI GitHub README: https://github.com/open-webui/open-webui
- Open WebUI Features: https://docs.openwebui.com/features/
- Open WebUI Workspace: https://docs.openwebui.com/features/workspace/
- Open WebUI Tools: https://docs.openwebui.com/features/extensibility/plugin/tools/
- LibreChat GitHub README: https://github.com/danny-avila/LibreChat
- LibreChat Features: https://www.librechat.ai/docs/features
- LibreChat Agents: https://www.librechat.ai/docs/features/agents
- LibreChat MCP: https://www.librechat.ai/docs/features/mcp
- Cherry Studio GitHub README: https://github.com/CherryHQ/cherry-studio
- LobeHub GitHub README: https://github.com/lobehub/lobe-chat
- Dify GitHub README: https://github.com/langgenius/dify
- Flowise GitHub README: https://github.com/FlowiseAI/Flowise
