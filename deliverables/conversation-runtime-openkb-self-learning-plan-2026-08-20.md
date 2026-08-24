# 灵枢对话运行时、OpenKB 与自主学习升级方案

> 版本：v1.0
> 日期：2026-08-20
> 范围：AI 对话、工具与 Skill、上下文、知识库、记忆、自主学习、评测、运行观测
> 目标：把灵枢从“一次模型请求 + 回复后包装”升级为“可执行、可学习、可评测、可回滚”的本地 AI 工作台。

## 0. MVP 实施状态（2026-08-20）

本轮已开始实施 Phase 1，并完成可回退的 `Conversation Runtime v2` 最小闭环。当前状态如下：

| 分类 | 本轮结果 | 说明 |
|---|---|---|
| 保留 | RealChat、`chatStore`、SSE Parser、Tool/Skill Registry、Run History、旧 Chat API | UI 与原有数据结构继续使用；`runtimeVersion: 1` 仍可回退 |
| 更新 | Chat API、Provider Adapter、消息回放、真实步骤事件 | 默认进入 v2；OpenAI-compatible 与 Anthropic 均支持 canonical tool call/result 转换 |
| 新增 | 后端 Agent Loop、工具参数校验、超时与循环上限、上下文压缩 | 默认最多 6 轮；工具结果会回填模型后继续生成最终答案 |
| 新增 | Knowledge/Vault 查询工具、可执行 Skill 暴露、OpenAPI 只读工具 | 高风险 Skill 必须显式选择；OpenAPI 仅允许显式开启自动运行的 GET 接口 |
| 新增 | OpenKB 可选客户端与状态/查询/导入 API | Sidecar 未启用时自动降级，不影响普通聊天 |
| 新增 | Promptfoo MVP 回归集 | 覆盖简洁回答、不伪造资料、方案完整度和高风险边界 |
| 暂缓 | 自主写入正式 Memory/Skill/Prompt/代码 | 继续坚持“候选 -> 评测 -> 审批 -> 发布 -> 回滚”，本轮不开放自动发布 |
| 暂缓 | OpenKB 自动安装、进程托管和完整 Knowledge Inbox 编译 | 当前先提供 API 适配层，避免把 Python Sidecar 变成主聊天的强依赖 |

本轮验证结果：TypeScript/Vite 构建通过，Node 运行时单元测试 4/4 通过，服务端 bundle 通过，OpenKB 禁用降级接口通过。Promptfoo 配置已完成，但本机 Node.js `22.16` 低于当前 Promptfoo 所需版本，因此完整模型评测待 Node.js 24 环境执行。

本轮辅助能力安装来源：

- `codex-security` 插件：OpenAI curated plugin marketplace，标识 `codex-security@openai-curated-remote`。
- `playwright` Skill：OpenAI 官方 [`openai/skills`](https://github.com/openai/skills) 仓库的 `skills/.curated/playwright`。
- `security-best-practices` Skill：OpenAI 官方 [`openai/skills`](https://github.com/openai/skills) 仓库的 `skills/.curated/security-best-practices`。
- `security-threat-model` Skill：OpenAI 官方 [`openai/skills`](https://github.com/openai/skills) 仓库的 `skills/.curated/security-threat-model`。
- `openkb` Skill：[`VectifyAI/OpenKB`](https://github.com/VectifyAI/OpenKB) 仓库的 `skills/openkb`。

## 1. 结论与决策

本方案不推翻灵枢现有产品结构。RealChat、Knowledge Inbox、Obsidian Vault、Skill Registry、Tool Registry、Feedback、Model Evaluation、Workflow、Automation 和 Run History 都有保留价值。

需要改变的是它们之间的关系：目前这些能力大多各自存在于页面或接口中，还没有组成一条统一运行链路。下一阶段以 `Conversation Runtime v2` 为核心，将工具执行、知识检索、上下文管理、产物生成、反馈和学习串成闭环。

核心决策如下：

1. 对话内核采用真实 Agent Loop，不再把模型调用等同于任务完成。
2. OpenKB 作为可选的本地知识编译 Sidecar，不替代灵枢主对话运行时。
3. 现有 Obsidian/Markdown Vault 继续作为用户可读、可编辑、可迁移的知识资产层。
4. 自主学习采用“候选提案 -> 评测 -> 审批 -> 发布 -> 回滚”，不允许未经验证直接修改正式记忆、Skill、Prompt 或代码。
5. 普通对话保持轻量；只有复杂任务才进入规划、工具循环和质量复核，控制延迟与成本。
6. 先完成对话运行时，再接 OpenKB，再开放自主学习。顺序不可倒置。

## 2. 当前问题判断

灵枢当前对话链路的核心形态是：

```text
用户输入
  -> 拼接系统提示、附件和少量知识上下文
  -> 调用一次模型
  -> 清洗回复
  -> 推断 artifacts / steps / suggestions / recovery
  -> 保存并展示
```

主要问题：

- Skill Runtime 的输出会写入运行证据，但没有稳定回填给模型继续生成。
- 模型返回 `tool_calls` 后，系统主要负责展示，没有完整的执行、结果回填和再次推理循环。
- 历史消息回放主要保留 `role + content`，工具消息、调用关系、任务状态和来源关系会损失。
- 没有统一 token 预算、上下文压缩和长期任务状态。
- Knowledge、Memory、Project、Attachment 的召回策略分散且以关键词规则为主。
- `steps` 中部分状态是回复完成后推断出来的，不是实际执行事件。
- 产物生成仍以一段模型文本为主，导出、预览和质量检查属于后置加工。
- Feedback 和 Model Evaluation 已记录数据，但没有驱动 Prompt、模型路由、Skill 和检索策略的迭代。

## 3. 目标架构

```text
┌─────────────────────────────────────────────────────────────┐
│                         RealChat UI                         │
│  会话 / 消息 / 真实步骤 / 工具状态 / 引用 / 产物 / 审批       │
└───────────────────────────┬─────────────────────────────────┘
                            │ SSE / Commands
┌───────────────────────────▼─────────────────────────────────┐
│                  Conversation Runtime v2                    │
│ Intent Router -> Context Manager -> Agent Loop -> Finalizer │
│                       │              │                      │
│                       │              ├─ Tool Runtime        │
│                       │              ├─ Skill Runtime       │
│                       │              ├─ Artifact Runtime    │
│                       │              └─ Knowledge Runtime   │
└───────────────────────┬─────────────────────────┬───────────┘
                        │                         │
              ┌─────────▼──────────┐    ┌────────▼───────────┐
              │ Context / Memory   │    │ OpenKB Sidecar     │
              │ Session / Project  │    │ Compile / Query    │
              │ Vault / Episode    │    │ PageIndex / Wiki   │
              └─────────┬──────────┘    └────────┬───────────┘
                        │                         │
                        └────────────┬────────────┘
                                     │
                         ┌───────────▼────────────┐
                         │ Learning & Eval Engine │
                         │ Proposal / Eval / Gate │
                         │ Publish / Rollback     │
                         └────────────────────────┘
```

### 3.1 核心模块职责

| 模块 | 职责 | 不负责 |
|---|---|---|
| Conversation Runtime | 驱动一次用户任务直至完成、失败或等待确认 | 长期知识编译 |
| Context Manager | 组装当轮上下文、预算 token、压缩历史、保护近期任务 | 直接生成最终回答 |
| Tool Runtime | 工具发现、schema、权限、执行、审计和结果标准化 | 决定最终答案 |
| Skill Runtime | 加载流程说明、执行 Skill runtime、返回结构化结果 | 充当普通文档列表 |
| Knowledge Runtime | 统一查询附件、项目、Vault、OpenKB 和历史会话 | 永久保存所有原始事件 |
| Artifact Runtime | 结构化生成、渲染、验证、修订和导出产物 | 普通闲聊 |
| Episode Store | 保存完整任务轨迹、工具结果、反馈和质量数据 | 作为系统提示全文注入 |
| Learning Engine | 从证据中生成 Memory/Skill/Policy 候选提案 | 未经门禁直接发布 |
| Eval Engine | 固定测试集、评分、回归比较和晋级判断 | 代替用户最终决策 |
| OpenKB Sidecar | 文档编译、长文档索引、概念与实体沉淀、深度查询 | 替代主 Agent Loop |

## 4. 保留、更新、新增、合并与下线清单

### 4.1 保留

以下能力保留产品入口和核心定位，只做必要适配：

| 现有能力 | 处理决定 | 保留原因 |
|---|---|---|
| RealChat 页面 | 保留 | 继续作为主对话入口 |
| `chatStore` | 保留 | 作为前端会话和消息单一事实源 |
| SSE Parser | 保留 | 扩展新事件即可 |
| MessageBubble | 保留 | 已具备 Markdown、Reasoning、Tool、Citation、Artifact 展示基础 |
| 会话分支、撤销、重试、多模型对比 | 保留 | 属于成熟对话产品的必要能力 |
| 项目上下文 | 保留 | 是灵枢工作台的重要差异化能力 |
| 本轮附件与图片输入 | 保留 | 是对话输入层基础能力 |
| Knowledge Inbox | 保留 | 作为知识进入系统的审核入口 |
| Obsidian/Markdown Vault | 保留 | 用户可读、可编辑、可迁移，适合作为长期知识资产层 |
| 会话归档 | 保留 | 为检索、审计和学习提供原始材料 |
| Tool Registry | 保留 | 作为统一工具目录和权限入口 |
| Skill Registry 与 runtime manifest | 保留 | 作为程序性知识和本地执行能力 |
| Feedback 日志 | 保留 | 作为用户质量信号 |
| Model Evaluation 与 A/B 采用记录 | 保留 | 作为评测系统第一批数据源 |
| Run History | 保留 | 作为统一可观测和审计底座 |
| Workflow / Automation | 保留 | 用于后台编译、复盘、评测和定时任务 |
| GroupChat / Agent Team | 保留 | 后续可复用统一 Agent Runtime |

### 4.2 更新

以下模块继续使用，但内部职责或数据协议需要升级：

| 模块 | 当前状态 | 更新内容 | 目标状态 |
|---|---|---|---|
| Chat API | 单次模型调用为主 | 改为调用 `ConversationRuntime.runTurn()` | 一个请求可包含多轮工具循环 |
| Message | 主要支持 user/assistant/system | 增加 tool、调用关系、provider payload、状态与证据 | 可无损回放完整对话轨迹 |
| AgentRuntime | 偏前端流式状态机 | 拆分 UI runtime 与后端 execution runtime | 前端只消费真实事件 |
| Provider 调用 | 统一传 messages/maxTokens/temperature | 增加 Provider Adapter、能力协商、模型参数策略 | DeepSeek/Anthropic/OpenAI 等独立适配 |
| Skill 自动匹配 | 正则与说明注入 | 改为索引检索、按需加载、真实执行、结果回填 | Skill 成为 Agent 可调用能力 |
| Tool Calls | 解析和展示为主 | 执行、权限判断、结果回填、循环继续 | 完整 Tool Loop |
| Context 构建 | 拼接整段系统提示和历史 | token 预算、分层上下文、滚动压缩、任务状态 | 长对话稳定连续 |
| Knowledge 检索 | 关键词开关与 Vault 文本匹配 | 统一 Retrieval Router、查询改写、混合召回、重排 | 自动判断何时检索及检索范围 |
| Memory | 简单 key/value | 来源、类型、置信度、验证时间、过期时间、作用域 | 可治理的长期记忆 |
| Steps | 部分为事后推断 | 全部来自 runtime 真实事件 | UI 与执行事实一致 |
| Citations | 回复后附带来源卡片 | 增加正文引用编号、原文定位和 provenance | 可核验来源闭环 |
| Artifact | 从正文正则推断类型 | 模型/运行时返回 ArtifactSpec，独立生成与验证 | 产物成为一等对象 |
| Feedback | 只记录点赞/点踩 | 增加原因标签、修正内容、任务类型和采用行为 | 可用于学习和评测 |
| Model Evaluation | 模型维度聚合 | 增加任务集、trial、grader、版本与成本 | 可比较模型、Prompt、Skill 和策略 |
| Automation | 执行普通动作 | 增加知识编译、夜间复盘、评测、候选过期任务 | 学习系统后台调度器 |

### 4.3 新增

| 新模块 | 优先级 | 说明 |
|---|---|---|
| Conversation Runtime v2 | P0 | 后端真实 Agent Loop |
| Canonical Message Protocol | P0 | 跨 Provider 的完整消息协议 |
| Provider Adapter Layer | P0 | Provider 特性、消息转换和流式聚合 |
| Context Manager | P0 | token 预算、滚动压缩、任务状态和上下文选择 |
| Tool Dispatcher | P0 | schema、权限、执行、超时、并发和结果回填 |
| Runtime Event Bus | P0 | 真实 step/tool/token/artifact/approval 事件 |
| Task Intent Router | P1 | 区分 chat/research/create/code/operate |
| Retrieval Router | P1 | 选择附件、项目、Vault、OpenKB、历史会话或 Web |
| OpenKB Manager | P1 | Sidecar 安装、启动、健康检查、配置和 API 客户端 |
| Knowledge Compile Job | P1 | Inbox 到 OpenKB 的后台编译任务 |
| Episode Store | P1 | 完整任务轨迹和学习证据 |
| Learning Proposal Queue | P1 | Memory/Skill/Policy/Code 候选管理 |
| Memory Manager v2 | P1 | 记忆提取、去重、冲突、过期和审批 |
| Skill Learner | P1 | 从成功轨迹和用户纠正生成 Skill 候选 |
| Eval Suite / Grader | P1 | 固定任务、规则评分、模型评分和人工评分 |
| Prompt/Policy Registry | P2 | Prompt 和路由策略版本管理 |
| Sandbox Evolution Runner | P2 | 在隔离分支/目录中生成并验证代码改进 |
| Artifact Runtime v2 | P2 | 文档、幻灯片、表格等结构化生成与视觉 QA |

### 4.4 合并

| 当前分散能力 | 合并目标 | 说明 |
|---|---|---|
| RealChat 本地状态 + chatStore 状态 | `chatStore` | 页面不再手工同步同一批消息和会话状态 |
| Skill 执行记录 + Tool 执行记录 + Workflow 节点记录 | Run History | 统一 `RunRecord` 与 `RunStep` |
| Obsidian 搜索 + Memory 搜索 + Project Context + OpenKB Query | Knowledge Runtime | 由 Retrieval Router 统一选择 |
| 回复后的 steps 推断 + SSE step 事件 | Runtime Event Bus | 只保留真实事件，推断仅作为旧记录兼容 |
| 多模型对比 + Model Evaluation | Eval Engine | 用户采用结果进入正式评测数据 |
| Knowledge Automation + 普通 Automation 调度 | Automation Engine | 保留不同 actionType，统一调度和运行记录 |
| Agent Team 执行器 + 普通 Agent 执行器 | Conversation Runtime | 共享 Provider、Tool、Context 和 Event 协议 |

### 4.5 兼容后下线

以下能力先保留兼容，不立即删除；新链路稳定并完成数据迁移后再下线：

| 旧能力 | 下线条件 | 替代方案 |
|---|---|---|
| 对话路由内直接 `callProviderAI()` | Runtime v2 全量通过验收 | `ConversationRuntime.runTurn()` |
| 仅保存 `role + content` 的 Provider 历史转换 | Canonical Message 可迁移旧会话 | Provider Adapter |
| 全量 Skill 列表注入系统提示 | Skill 索引和按需加载稳定 | Skill Router + deferred loading |
| 从正文正则推断 Artifact | 新回复 100% 返回 ArtifactSpec | Artifact Runtime |
| 回复后推断“已完成步骤” | 新 Runtime 事件覆盖所有步骤 | Runtime Event Bus |
| `memory.json` 无 schema 的自由 key/value 写入 | Memory v2 迁移完成 | Memory Manager v2 |
| PPT 等场景硬编码 fallback 正文 | Artifact 生成与恢复通过验收 | Artifact repair / retry |
| OpenKB 自带 Chat 作为灵枢主聊天 | 不进入主链路 | 只作为知识工具和独立诊断入口 |

## 5. Conversation Runtime v2 方案

### 5.1 单轮生命周期

```text
1. 接收用户输入并创建 turnId
2. Intent Router 判断任务类型、风险和建议模式
3. Context Manager 选择上下文并执行 token 预算
4. Tool/Skill Router 暴露本轮需要的工具 schema
5. 调用模型
6. 若返回 tool_calls：
   a. 校验工具、参数和权限
   b. 必要时请求用户确认
   c. 执行工具并保存 RunStep
   d. 追加 assistant(tool_calls) 和 tool(result)
   e. 回到步骤 5
7. 若返回最终文本或 ArtifactSpec：执行质量检查
8. 必要时进入一次修订循环
9. 保存完整消息、Episode、使用量和真实事件
10. 返回最终结果，并异步触发学习候选分析
```

### 5.2 运行限制

- 默认最大工具循环：8 次。
- 普通问答最大工具循环：0-2 次。
- 深度研究最大工具循环：12 次，可由用户取消。
- 单工具默认超时：60 秒，工具可声明覆盖值。
- 并行工具必须无交互确认且无顺序依赖。
- 达到循环、token 或时间预算后，必须返回当前成果、缺口和可恢复动作。
- 中断后的部分回复不写入正式历史；已完成工具记录保留在 Run History。

### 5.3 任务模式

| 模式 | 触发 | 默认策略 |
|---|---|---|
| chat | 闲聊、解释、短问答 | 单次生成，最少上下文 |
| analyze | 比较、诊断、复杂判断 | 计划 + 必要检索 + 一次复核 |
| research | 最新信息、资料综合、长文档 | 多步检索 + 来源检查 + 引用 |
| create | 文档、PPT、表格、网页 | ArtifactSpec + 生成 + 验证 + 修订 |
| code | 代码分析、修改、测试 | 文件/终端工具 + 测试证据 |
| operate | 桌面、消息、日历、审批等动作 | 权限和确认优先，返回执行凭证 |

### 5.4 Provider Adapter

每个 Provider Adapter 负责：

- 模型能力：vision、tools、reasoning、stream、contextWindow、maxOutput。
- 内部消息到供应商协议的转换。
- `reasoning_content`、tool calls、tool results 的回放规则。
- 流式 tool arguments 按 index/id 聚合。
- 错误分类、可重试判断和退避。
- token、延迟、成本和 finish reason 采集。
- 模型专属参数，例如 thinking、reasoning effort 或 temperature 限制。

## 6. OpenKB 接入方案

### 6.1 定位

OpenKB 用于将原始文档编译成持续积累的结构化 Wiki，包括：

- 文档摘要。
- 概念页和跨文档综合。
- 人物、组织、地点、产品等实体页。
- 来源全文转换和交叉链接。
- 长 PDF 的 PageIndex 树索引。
- Knowledge Lint、查询、探索记录和 Skill Factory。

OpenKB 不负责：

- 灵枢普通对话。
- 灵枢所有工具编排。
- 用户偏好和短期会话状态。
- 自动修改灵枢正式 Skill、Prompt 或代码。

### 6.2 部署方式

第一阶段采用本地 Sidecar：

```text
Electron Main
  -> 检查 Python/OpenKB 环境
  -> 启动 openkb-web --host 127.0.0.1 --port <dynamic>
  -> 注入 OPENKB_KB_ROOT 和 OPENKB_API_TOKEN
  -> 记录 PID、端口、版本和健康状态
  -> 应用退出时优雅停止
```

建议数据路径：

```text
~/Lingshu/workspace/openkb/
  runtime/                  # Sidecar 状态，不进入 Vault
  kbs/
    <kb-id>/
      .openkb/
      raw/
      wiki/
      output/
```

Obsidian 集成方式：

- 将 `wiki/` 作为 Vault 的外部知识目录或受控同步目录。
- 默认不让 OpenKB 重写用户手工维护的普通 Vault 文档。
- OpenKB 生成目录明确标注为机器维护，手工修改需走“锁定页面”或提案机制。

### 6.3 知识导入流程

```text
Knowledge Inbox captured
  -> 用户/规则确认 ready
  -> 创建 knowledge_compile RunRecord
  -> 调用 OpenKB /api/v1/add
  -> 接收 SSE 进度
  -> 更新文档、摘要、概念和实体索引
  -> 执行结构 Lint
  -> 标记 indexed / partial / error
  -> 将来源、hash、版本和编译时间写回 Inbox
```

不建议每条聊天自动进入 OpenKB。适合自动沉淀的内容：

- 用户明确保存的研究结果。
- 被采纳的正式报告和项目决策。
- 稳定的产品、项目和业务资料。
- 经过确认的会议纪要和 SOP。
- 多次使用且来源清晰的领域知识。

### 6.4 查询策略

提供两类知识工具：

| 工具 | 适用场景 | 实现 |
|---|---|---|
| `knowledge.search` | 普通事实、已知概念、短文档 | 搜索编译后的 Wiki、FTS 和现有 Vault |
| `knowledge.deep_query` | 长 PDF、跨文档综合、多跳问题 | 调用 OpenKB Query/PageIndex |

查询结果必须统一转换为：

```ts
interface KnowledgeEvidence {
  id: string
  kbId: string
  sourceId: string
  title: string
  path?: string
  page?: number
  section?: string
  snippet: string
  score?: number
  retrievedAt: string
  retrievalMode: 'vault' | 'openkb-wiki' | 'openkb-deep' | 'attachment' | 'project'
}
```

### 6.5 OpenKB 风险与控制

- OpenKB 是 Python 技术栈，桌面打包和安装体积需要单独评估。
- Sidecar 只监听 `127.0.0.1`，强制随机 Token，不允许默认暴露到局域网。
- 文档编译可能产生额外模型成本，必须展示模型、耗时和估算成本。
- 一份文档可能更新多个 Wiki 页面，删除和重编译必须支持 dry-run 与回滚。
- 本地小模型的 tool calling 兼容性需要单独验收，不能假定全部模型可用。
- OpenKB `/query` 返回的是已综合答案，主对话使用时要避免重复生成和来源丢失。

## 7. 自主学习与自主进化方案

### 7.1 基本原则

系统只能从可验证证据中学习。一次失败、一次模型幻觉或一次用户未明确接受的输出，不能直接变成长期规则。

学习对象分为四层：

| 层级 | 学习内容 | 默认发布权限 |
|---|---|---|
| L1 Memory | 用户偏好、稳定事实、项目约定 | 低风险可自动；敏感内容需审批 |
| L2 Skill | 可复用流程、工具顺序、验证方法 | 必须形成候选并通过评测 |
| L3 Policy | Prompt、路由、检索、模型选择策略 | 必须 A/B 和人工审批 |
| L4 Code | 灵枢源代码、依赖、迁移和配置 | 仅沙箱分支，禁止自动部署 |

### 7.2 学习信号

正向信号：

- 用户点赞、采纳、导出或继续基于结果工作。
- 工具任务成功，并通过明确验收步骤。
- 相同任务多次使用同一路径成功。
- 多模型对比中某候选被采用。
- Artifact 通过格式、内容和视觉检查。

负向信号：

- 用户点踩、拒绝、重新描述或手工大幅修改。
- 工具调用失败、重复循环、超时或被取消。
- 引用无法打开或内容与来源矛盾。
- 回归评测下降。
- Skill 在新环境中失效。

上下文信号：

- Provider、模型和版本。
- 操作系统、工具版本和工作区。
- 任务类型、输入规模、附件类型和知识范围。
- 是否存在临时网络、权限或依赖故障。

### 7.3 学习流水线

```text
Episode 完成
  -> Candidate Detector 判断是否值得学习
  -> Reflector 提取成功路径、失败原因和适用边界
  -> 生成 Memory / Skill / Policy Proposal
  -> 去重、冲突检测、敏感信息扫描
  -> Eval Suite 回放和对比
  -> Approval Gate
  -> 发布新版本
  -> 灰度使用
  -> 监控反馈
  -> 保留或自动回滚
```

### 7.4 Memory v2

```ts
interface MemoryEntryV2 {
  id: string
  type: 'user_preference' | 'project_fact' | 'environment' | 'lesson' | 'constraint'
  scope: 'global' | 'project' | 'agent'
  scopeId?: string
  content: string
  sourceEpisodeIds: string[]
  confidence: number
  sensitivity: 'normal' | 'private' | 'secret'
  status: 'candidate' | 'active' | 'rejected' | 'expired' | 'superseded'
  createdAt: string
  lastVerifiedAt?: string
  expiresAt?: string
  supersedes?: string
}
```

规则：

- 用户明确说“记住”时可以直接创建候选，并在 UI 告知保存内容。
- 自动提取的偏好默认进入候选，达到重复证据阈值后才激活。
- 环境故障类经验必须有过期时间，且需要区分临时故障与永久限制。
- 新记忆与旧记忆冲突时不得静默覆盖，必须建立 supersede 关系。
- Secret 不进入模型上下文和 OpenKB，只保存引用或受控密钥标识。

### 7.5 Skill 学习

Skill 候选来源：

- 成功完成包含 5 次以上工具调用的复杂任务。
- 同类任务至少成功两次。
- 用户纠正后形成稳定的新路径。
- OpenKB 从领域资料中蒸馏出专家流程。
- 现有 Skill 失败后发现了可复现修复。

每个 Skill Proposal 必须包含：

- 触发条件与不适用条件。
- 输入、输出和权限。
- 完整步骤与失败恢复。
- 证据 Episode。
- 验收命令或评分规则。
- 与现有 Skill 的差异。
- 版本、变更 Diff 和回滚点。

默认流程：

```text
draft -> validating -> pending_review -> approved -> canary -> active
                                             \-> rejected
active -> degraded -> rolled_back
```

### 7.6 Prompt 与策略进化

允许优化的策略：

- 任务模式分类。
- Skill/Tool 选择。
- 知识检索范围和 topK。
- 上下文压缩阈值。
- 模型、温度、思考模式和输出预算。
- Artifact 的生成与检查流程。

每次策略修改必须绑定：

- 基线版本。
- 固定 Eval Suite。
- 至少一个质量指标和一个成本/延迟指标。
- 最小样本量。
- 晋级阈值。
- 自动回滚阈值。

### 7.7 代码自主进化边界

允许系统自动做：

- 创建独立 `codex/` 前缀分支或临时工作区。
- 生成代码修改候选。
- 运行 lint、build、unit、integration 和固定对话评测。
- 生成 Diff、风险说明和验证报告。

禁止系统自动做：

- 向默认分支提交或合并。
- 自动推送远端。
- 自动发布桌面安装包。
- 自动修改密钥、生产数据和权限策略。
- 绕过失败测试或审批门禁。

## 8. 核心数据模型

### 8.1 CanonicalMessage

```ts
interface CanonicalMessage {
  id: string
  sessionId: string
  turnId: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
  toolCalls?: ProviderToolCall[]
  toolCallId?: string
  reasoning?: string
  providerPayload?: Record<string, unknown>
  attachments?: ChatAttachment[]
  citations?: KnowledgeEvidence[]
  artifacts?: ArtifactRef[]
  status: 'pending' | 'streaming' | 'completed' | 'error' | 'cancelled'
  createdAt: string
}
```

### 8.2 ConversationTurn

```ts
interface ConversationTurn {
  id: string
  sessionId: string
  userMessageId: string
  taskMode: 'chat' | 'analyze' | 'research' | 'create' | 'code' | 'operate'
  status: 'queued' | 'running' | 'awaiting_approval' | 'success' | 'error' | 'cancelled'
  contextSnapshotId: string
  runId: string
  outputMessageId?: string
  startedAt: string
  finishedAt?: string
}
```

### 8.3 Episode

```ts
interface Episode {
  id: string
  sessionId: string
  turnId: string
  taskMode: string
  objective: string
  messageIds: string[]
  runId: string
  toolsUsed: string[]
  skillsUsed: string[]
  knowledgeEvidenceIds: string[]
  outcome: 'success' | 'partial' | 'failure' | 'cancelled'
  feedback?: Array<{ value: string; note?: string }>
  metrics: Record<string, number>
  createdAt: string
}
```

### 8.4 LearningProposal

```ts
interface LearningProposal {
  id: string
  type: 'memory' | 'skill' | 'policy' | 'code'
  title: string
  sourceEpisodeIds: string[]
  status: 'draft' | 'evaluating' | 'pending_review' | 'approved' | 'rejected' | 'active' | 'rolled_back'
  before?: unknown
  after: unknown
  rationale: string
  risks: string[]
  evalRunIds: string[]
  version: number
  createdAt: string
  reviewedAt?: string
}
```

### 8.5 EvalTask 与 EvalRun

```ts
interface EvalTask {
  id: string
  category: string
  input: unknown
  expected?: unknown
  graders: Array<'rule' | 'model' | 'human'>
  successCriteria: string[]
}

interface EvalRun {
  id: string
  suiteId: string
  candidateVersion: string
  baselineVersion: string
  taskResults: Array<Record<string, unknown>>
  qualityScore: number
  latencyMs: number
  tokenUsage: number
  estimatedCost: number
  passed: boolean
  createdAt: string
}
```

## 9. 建议文件与代码边界

目标不是一次性重写，而是逐步把 `server-v2.js` 的职责迁出。

```text
server/
  chat/
    conversation-runtime.js
    context-manager.js
    intent-router.js
    event-bus.js
    finalizer.js
  providers/
    provider-registry.js
    openai-adapter.js
    anthropic-adapter.js
    deepseek-adapter.js
  tools/
    tool-dispatcher.js
    tool-policy.js
    tool-result.js
  knowledge/
    knowledge-runtime.js
    retrieval-router.js
    openkb-client.js
    openkb-manager.js
    compile-jobs.js
  memory/
    memory-manager.js
    memory-repository.js
    memory-proposals.js
  learning/
    episode-store.js
    candidate-detector.js
    reflector.js
    proposal-service.js
    promotion-gate.js
  eval/
    eval-runner.js
    graders.js
    suites/
  artifacts/
    artifact-runtime.js
    validators/

src/
  types/
    chat.ts
    runtime.ts
    knowledge.ts
    learning.ts
    eval.ts
  stores/
    chatStore.ts
    learningStore.ts
  pages/
    RealChat.tsx
    KnowledgeInbox.tsx
    LearningCenter.tsx
  components/chat/
    RuntimeTimeline.tsx
    ApprovalCard.tsx
    CitationList.tsx
    ArtifactPanel.tsx
```

## 10. 分阶段实施计划

### Phase 0：基线与防回归

目标：在重构前建立可比较基线。

任务：

- 固化 30-50 条对话评测集。
- 覆盖问答、分析、附件、知识检索、长对话、工具调用、PPT/Word/表格。
- 记录当前模型、Prompt、延迟、token、错误率、点赞率和产物通过率。
- 给当前 Provider 消息转换和 SSE 增加契约测试。

退出标准：

- 每次对话内核变更都能自动跑固定评测。
- 有可查看的 baseline 报告。

### Phase 1：Conversation Runtime v2

目标：解决回答质量最核心的执行链路问题。

任务：

- 新建 Canonical Message Protocol。
- 新建 Provider Adapter。
- 实现真实 Tool Loop 和 Skill 结果回填。
- 实现 Runtime Event Bus。
- `chatStore` 成为前端单一事实源。
- 保存完整 tool call / tool result / reasoning / usage。

退出标准：

- 模型可连续调用至少两个工具并基于结果生成最终回答。
- 刷新后可完整回放工具链。
- UI 显示的每个步骤都能在 Run History 找到对应记录。
- 取消任务不会把空 assistant 消息写入正式历史。

### Phase 2：Context 与 Retrieval

目标：改善长对话连贯性和知识可靠性。

任务：

- 实现 token 预算和滚动压缩。
- 保存 Active Task、已完成事项、开放问题和关键证据。
- 实现 Retrieval Router。
- 统一 Attachment、Project、Vault、Memory 和历史会话证据格式。
- 增加正文引用编号和来源深链。

退出标准：

- 50 轮对话后仍能保持当前任务和关键约束。
- 压缩前后固定问题准确率下降不超过设定阈值。
- 引用可打开并定位到来源。

### Phase 3：OpenKB MVP

目标：让知识从“文档集合”升级为“持续编译的领域 Wiki”。

任务：

- 实现 OpenKB Sidecar Manager 和健康检查。
- Knowledge Inbox 接入 `/init`、`/add`、`/status`、`/lint`。
- 实现 `knowledge.search` 与 `knowledge.deep_query`。
- 将 OpenKB Wiki 接入 Vault 浏览和知识图谱。
- 增加编译 Run History、模型和成本展示。

退出标准：

- PDF、DOCX、PPTX、XLSX、Markdown 可导入并形成 Wiki。
- 长 PDF 问答可返回可核验来源。
- Sidecar 未安装或故障时，灵枢普通聊天仍可正常使用。

### Phase 4：Memory 与 Skill Learning

目标：形成受控的跨会话学习闭环。

任务：

- 建立 Episode Store。
- 实现 Memory v2、候选、冲突和过期机制。
- 实现 Skill Proposal、Diff、验证、审批、版本和回滚。
- 接入 OpenKB Skill Factory 作为候选 Skill 来源之一。
- 增加 Learning Center 页面。

退出标准：

- 用户能查看系统从哪次任务学到了什么。
- 未审批 Skill 不会进入正式运行时。
- 临时故障类经验会过期，不会永久禁用工具。
- Skill 升级失败可一键回滚。

### Phase 5：策略与代码自主进化

目标：让系统能验证性地优化 Prompt、路由和代码。

任务：

- Prompt/Policy Registry 版本化。
- 自动生成候选策略并运行离线评测。
- 支持 canary 和自动回滚。
- 建立代码 Sandbox Evolution Runner。
- 生成代码 Diff、测试和风险报告，等待人工批准。

退出标准：

- 所有正式策略变更有 baseline、评测和回滚点。
- 系统无法绕过审批修改默认分支或发布版本。

### Phase 6：Artifact Runtime v2

目标：把“生成东西”从 Markdown 导出升级为可交付产物生产。

任务：

- 建立 ArtifactSpec。
- 文档、幻灯片、表格采用独立生成器。
- 增加模板、内容校验、渲染检查和自动修订。
- 增加产物版本、局部重生成和导出历史。

退出标准：

- PPT、DOCX、XLSX 不是简单包装聊天正文。
- 固定测试产物全部可打开，并通过内容与视觉 QA。

## 11. 优先级与依赖

```text
Phase 0 基线
   ↓
Phase 1 Runtime v2
   ↓
Phase 2 Context/Retrieval
   ├──────────────┐
   ↓              ↓
Phase 3 OpenKB   Phase 6 Artifact v2
   ↓
Phase 4 Memory/Skill Learning
   ↓
Phase 5 Policy/Code Evolution
```

不可提前的依赖：

- OpenKB 可以先做技术验证，但不能在 Runtime v2 前成为主对话入口。
- 自主学习不能在 Episode、Eval 和 Proposal Gate 前自动发布。
- 代码进化不能在测试基线和隔离运行环境前开放。
- Artifact v2 可与 OpenKB 并行，但依赖 Runtime v2 的事件和工具协议。

## 12. 固定验收场景

| 编号 | 场景 | 通过条件 |
|---|---|---|
| C1 | 普通知识问答 | 快速回答，不启动不必要的工具循环 |
| C2 | 连续使用两个工具 | 工具结果回填后形成最终回答，步骤可审计 |
| C3 | Skill Runtime | Skill 输出真实影响最终答案，不只显示“已使用” |
| C4 | DeepSeek Tool Call | reasoning/tool call/tool result 可正确回放 |
| C5 | 50 轮长对话 | 保留当前任务、关键约束和近期证据 |
| C6 | 上传短文档提问 | 优先使用附件并给出可打开引用 |
| C7 | OpenKB 长 PDF | 使用 deep query，返回章节/页码或来源路径 |
| C8 | 普通聊天不需要知识 | 不启动 OpenKB，不混入无关 Vault 内容 |
| C9 | 复杂任务成功 | 生成 Skill Proposal，但不会直接生效 |
| C10 | 临时工具失败 | 经验带环境与过期信息，不形成永久禁用规则 |
| C11 | Skill 候选升级 | 新版本通过评测、审批、灰度并可回滚 |
| C12 | Prompt 候选下降 | 评测不通过，不能晋级 |
| C13 | 代码进化 | 仅在隔离分支产生 Diff 和测试报告 |
| C14 | PPT 生成 | 产生 ArtifactSpec、渲染检查和可打开文件 |
| C15 | 用户取消 | 停止运行，不保存空回复，保留执行审计 |

## 13. 成功指标

产品质量：

- 用户有用率和采用率。
- 首次回答完成率。
- 复杂任务无需用户重复描述的比例。
- 引用可验证率。
- Artifact 验收通过率。

运行质量：

- 工具调用成功率。
- Agent Loop 平均循环数和异常循环率。
- 长对话压缩后任务连续性。
- Provider 错误率和恢复率。
- P50/P95 首 token 与完整任务延迟。

学习质量：

- 候选提案通过率。
- 发布后质量提升幅度。
- 回滚率和错误学习率。
- 记忆冲突率、过期率和用户删除率。
- Skill 复用次数及成功率。

成本指标：

- 每类任务平均 token 与估算成本。
- OpenKB 每份文档编译成本。
- 深度查询相对快速检索的增量成本。
- 复核循环带来的质量收益与成本比。

## 14. 主要风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| Agent Loop 失控 | 成本、延迟、重复操作 | 次数/时间/token 三重预算，幂等工具和取消 |
| 错误经验持久化 | 长期回答变差 | 来源、置信度、过期、冲突检测、审批和回滚 |
| OpenKB 编译污染用户 Vault | 用户知识被覆盖 | 独立机器维护目录、锁定和提案机制 |
| Python Sidecar 打包复杂 | 安装失败、体积变大 | 可选安装、健康检查、版本锁定和普通聊天降级 |
| 双层 Agent 重复调用 | 成本高、引用丢失 | 快速 search 与 deep query 分离，统一证据格式 |
| Prompt/Skill 越积越多 | 上下文膨胀、冲突 | 索引检索、按需加载、版本和淘汰机制 |
| 学习包含敏感信息 | 数据泄露 | 敏感分类、Secret 禁止入模、写入审批 |
| 评测被单一模型偏见影响 | 错误晋级 | 规则、模型、人工多类 grader，加盲测与回归集 |
| 重构影响现有功能 | 回归 | 旧链路兼容、feature flag、固定评测和灰度切换 |

## 15. 本期明确不做

- 不直接复制 Hermes、OpenKB、Dify 或 Open WebUI 的完整产品结构。
- 不让 OpenKB 替代 RealChat 和灵枢 Agent Runtime。
- 不把每一条对话自动写入长期知识库。
- 不把全部历史、全部 Skill 或全部知识页塞进系统提示。
- 不默认开启无人审批的 Skill、Prompt 或代码写入。
- 不在 Runtime v2 完成前继续用更多回复后正则补丁掩盖核心链路问题。
- 不在第一阶段同时支持多个知识引擎；先稳定 OpenKB + Vault 双层方案。

## 16. 最终产品形态

升级完成后，用户看到的仍然是一个简洁的灵枢对话入口，但后台行为会发生根本变化：

```text
用户提出目标
  -> 灵枢理解任务和上下文
  -> 选择必要的模型、知识、Skill 和工具
  -> 执行并核验真实结果
  -> 生成可直接使用的回答或产物
  -> 保存来源和运行证据
  -> 从结果和反馈中形成候选经验
  -> 通过评测与审批后，在未来任务中复用
```

这套架构的核心不是“让灵枢无限自主修改自己”，而是让它能够稳定执行、持续积累，并且每一次变化都可解释、可评测、可撤销。

## 17. 参考依据

外部项目：

- [Hermes Agent Loop Internals](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/agent-loop.md)：Agent Loop、工具结果回填、上下文压缩、Provider 模式和中断机制。
- [Hermes Agent Skills](https://github.com/openax-reference/nousresearch-hermes-agent/blob/main/website/docs/user-guide/features/skills.md)：从任务经验生成程序性 Skill、候选写入和审批机制。
- [Hermes 错误经验持久化问题](https://github.com/NousResearch/hermes-agent/issues/6051)：临时环境故障被学习为永久规则的风险案例。
- [VectifyAI/OpenKB](https://github.com/VectifyAI/OpenKB)：文档到结构化 Wiki、PageIndex、Obsidian、Skill Factory 和 Apache 2.0 许可。
- [OpenKB REST API](https://github.com/VectifyAI/OpenKB/blob/main/examples/rest-api/README.md)：Sidecar 可使用的初始化、导入、查询、聊天、状态、Lint、重编译和 SSE 接口。
- [OpenKB 本地模型 Tool Loop 兼容问题](https://github.com/VectifyAI/OpenKB/issues/205)：本地模型接入需单独进行工具调用契约验证。

灵枢现有文档：

- `deliverables/ai-chat-mainstream-gap-acceptance-2026-08-14.md`
- `deliverables/open-source-benchmark-and-optimization.md`
- `deliverables/HANDOFF-2026-08-13.md`
- `deliverables/phase2-architecture.md`
- `TODO-remaining.md`
