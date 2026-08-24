// ============================================================
// 灵枢 v3.0 — 核心类型定义
// ============================================================

// ---- Agent 状态机 ----

/** Agent 会话状态 */
export type SessionState =
  | 'idle'
  | 'turn'
  | 'thinking'
  | 'tool-executing'
  | 'streaming'
  | 'awaiting-confirm'
  | 'error'
  | 'completed'

/** Agent 工具调用 */
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  status: 'running' | 'awaiting_approval' | 'completed' | 'denied' | 'error'
  approvalId?: string
  approvalReason?: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
}

/** 消息轮次 */
export interface Turn {
  id: string
  index: number
  userMessage: Message
  assistantMessage?: Message
  state: SessionState
  toolCalls: ToolCall[]
  reasoning?: string
  knowledgeCitations?: Citation[]
  startedAt: string
  completedAt?: string
}

// ---- 消息 & 会话 ----

/** 单条消息 */
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  model?: string
  timestamp: string
  feedback?: 'like' | 'dislike' | null
  state?: SessionState
  toolCalls?: ToolCall[]
  reasoning?: string
  citations?: Citation[]
  attachments?: ChatAttachment[]
  projectId?: string
  artifacts?: ChatArtifact[]
  steps?: ChatGenerationStep[]
  suggestions?: ChatSuggestion[]
  recovery?: ChatRecovery
  runtime?: {
    version: number
    iterations?: number
    limitReached?: boolean
    transcript?: Array<Record<string, unknown>>
  }
}

/** 本轮附加到对话的本地上下文。正文只在发送时交给模型，不写入会话列表。 */
export interface ChatAttachment {
  id: string
  kind: 'image' | 'document' | 'attachment'
  name: string
  url?: string
  mimeType?: string
  text?: string
  textLength?: number
  truncated?: boolean
  extractionError?: string
}

export interface ChatSkillSelection {
  id: string
  name?: string
  description?: string
  arguments?: Record<string, unknown>
}

export interface ChatRequestContext {
  projectId?: string
  attachments?: ChatAttachment[]
  skillIds?: string[]
  skillArguments?: Record<string, Record<string, unknown>>
  skills?: ChatSkillSelection[]
}

export interface DocumentPreviewPayload {
  messageId: string
  title: string
  content: string
  artifact?: ChatArtifactPreview
}

export type ArtifactFormat = 'docx' | 'pptx' | 'xlsx' | 'csv' | 'md' | 'html'

export interface ChatArtifactPreview {
  kind: 'document' | 'presentation' | 'spreadsheet' | 'markdown' | 'html'
  label: string
  title: string
  formats: ArtifactFormat[]
  primaryFormat: ArtifactFormat
}

export interface ChatArtifact extends ChatArtifactPreview {
  id: string
  content?: string
  status?: 'ready' | 'partial' | 'error'
}

export interface ChatGenerationStep {
  id: string
  label: string
  detail?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  startedAt?: string
  finishedAt?: string
  durationMs?: number
}

export interface ChatSuggestion {
  id: string
  label: string
  prompt: string
  action?: 'fill' | 'send'
}

export interface ChatRecovery {
  status: 'ok' | 'needs_action' | 'error'
  title: string
  message: string
  actions?: ChatSuggestion[]
}

/** 会话 */
export interface Session {
  id: string
  title: string
  model: string
  lastMessage: string
  timestamp: string
  messageCount: number
  isFavorite?: boolean
  messages?: Message[]
  projectId?: string
  obsidianArchive?: {
    relativePath?: string
    archivedAt?: string
  } | null
  obsidianArchiveError?: {
    message?: string
    at?: string
  } | null
}

// ---- Provider ——

/** Provider 模型条目 */
export interface ModelEntry {
  value: string
  label: string
  desc: string
  actualModel?: string
}

/** Provider 能力 */
export interface ProviderCapabilities {
  vision: boolean
  functionCalling: boolean
  streaming: boolean
  webSearch: boolean
  imageGeneration: boolean
}

/** Provider 协议 */
export type ProviderProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages'

/** Provider 配置 */
export interface ProviderConfig {
  id: string
  name: string
  icon: string
  baseUrl: string
  protocols: ProviderProtocol[]
  models: ModelEntry[]
  capabilities: ProviderCapabilities
  docUrl: string
  keyUrl: string
  keyPlaceholder: string
}

// ---- 知识库 ----

/** 知识库 */
export interface KnowledgeBase {
  id: string
  name: string
  description: string
  documentCount: number
  enabled: boolean
  createdAt: string
}

/** 文档引用 */
export interface Citation {
  knowledgeBase: string
  documentName: string
  chapter?: string
  relevance: number
  snippet: string
  path?: string
  source?: string
  type?: string
  metadata?: Record<string, unknown>
}

// ---- Agent ——

/** Agent 配置 */
export interface AgentConfig {
  id: string
  name: string
  description?: string
  model: string
  systemPrompt: string
  temperature: number
  maxTokens: number
  status: 'running' | 'stopped'
  role?: AgentRole
  tools?: string[]
  knowledgeBases?: string[]
}

/** Agent 角色 */
export type AgentRole = 'coordinator' | 'executor' | 'reviewer' | 'researcher'

// ---- 工具 ----

/** 工具定义 */
export interface ToolDefinition {
  id: string
  name: string
  description: string
  type: 'mcp' | 'native' | 'plugin'
  icon: string
  enabled: boolean
  schema?: Record<string, unknown>
  source?: string
  status?: 'online' | 'offline' | 'error' | 'enabled' | 'disabled'
}

/** 工具注册表条目（统一工具层） */
export interface ToolRegistryItem {
  id: string
  name: string
  description: string
  /** 工具层级：mcp / native / plugin / openapi */
  layer: 'mcp' | 'native' | 'plugin' | 'openapi'
  /** 工具来源（MCP 服务名 / 内置标识 / 插件 ID / OpenAPI 服务名） */
  source: string
  enabled: boolean
  status: string
  config?: Record<string, unknown>
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  auth?: Record<string, unknown>
  permissions?: {
    network?: boolean
    filesystem?: boolean
    shell?: boolean
    desktop?: boolean
    [key: string]: unknown
  }
  runtime?: Record<string, unknown>
  lastCheckedAt?: string
  lastTestResult?: {
    success: boolean
    message: string
    durationMs?: number
    warnings?: string[]
  }
}

// ---- 自动化 ——

/** 自动化任务配置（Phase 2 扩展版） */
export interface AutomationConfig {
  id: string
  name: string
  description: string
  /** Cron 表达式，如 "0 9 * * *" */
  cronExpression: string
  /** 动作类型：chat（AI 对话）/ workflow（工作流） */
  actionType: 'chat' | 'workflow'
  /** 关联的 Agent ID */
  agentId: string
  /** AI 对话的提示词 */
  prompt: string
  /** 关联的工作流 ID */
  workflowId: string
  /** 失败后最大重试次数 */
  maxRetries?: number
  /** 首次重试等待时间，毫秒 */
  retryDelayMs?: number
  /** 退避策略 */
  retryBackoff?: 'fixed' | 'linear' | 'exponential'
  enabled: boolean
  lastRun?: string
  nextRun?: string
  logs?: AutomationLogEntry[]
}

/** 自动化任务（旧版兼容） */
export interface AutomationTask {
  id: string
  name: string
  description: string
  schedule: string
  agentId: string
  prompt: string
  enabled: boolean
  lastRun?: string
  nextRun?: string
}

/** 自动化执行日志条目 */
export interface AutomationLogEntry {
  id: string
  timestamp: string
  status: 'success' | 'error' | 'running'
  durationMs: number
  result?: string
  error?: string
  attempts?: Array<{
    attempt: number
    status: 'success' | 'error' | 'running'
    startedAt: string
    finishedAt?: string
    durationMs?: number
    result?: string
    error?: string
    nextRetryDelayMs?: number
  }>
}

// ---- 插件 ----

/** 插件 */
export interface Plugin {
  id: string
  name: string
  description: string
  version: string
  author: string
  enabled: boolean
  tools: string[]
}

// ---- API 通用 ----

/** 分页响应 */
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

/** 通用 API 响应 */
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// ---- Phase 2 扩展类型 ----

/** Agent Team 角色配置 */
export interface TeamRoleConfig {
  agentId: string
  model: string
  role: AgentRole
  systemPrompt: string
  avatarColor: string
}

/** 任务分发模式 */
export type TaskDistributionMode = 'sequential' | 'parallel' | 'conditional'

/** Agent Team 单步运行记录 */
export interface AgentRunStep {
  id: string
  runId?: string
  agentId: string
  role?: AgentRole | string
  model?: string
  provider?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  order: number
  startedAt: string
  finishedAt?: string
  durationMs?: number
  outputPreview?: string
  error?: string
  messageId?: string
}

/** Agent Team 一次运行记录 */
export interface AgentRunRecord {
  id: string
  type: 'agent_team'
  distributionMode: TaskDistributionMode
  status: 'running' | 'success' | 'error'
  startedAt: string
  finishedAt?: string
  durationMs?: number
  steps: AgentRunStep[]
}

/** 统一运行历史记录 */
export interface RunRecord {
  id: string
  type: 'workflow' | 'automation' | 'agent_team' | 'tool' | string
  targetId: string
  targetName?: string
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled' | string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  input?: unknown
  output?: unknown
  error?: string
  steps?: Array<Record<string, unknown>>
}

/** SSE 事件 */
export interface SSEEvent {
  type: 'token' | 'reasoning' | 'tool_call' | 'tool_result' | 'approval_required' | 'approval_resolved' | 'step' | 'done' | 'error'
  data: unknown
}

/** 快速操作类型 */
export type QuickActionType = 'retry' | 'translate' | 'explain' | 'optimize' | 'summarize'
