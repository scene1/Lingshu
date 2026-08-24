// ============================================================
// 灵枢 v3.0 — Agent 运行时状态机
// 对标 Cherry Studio 的状态机驱动架构
// ============================================================

import type { SessionState, Turn, ToolCall, Citation, ChatRequestContext } from '../types'

// ---- 状态机核心 ----

const VALID_TRANSITIONS: Record<SessionState, SessionState[]> = {
  idle:              ['turn'],
  turn:              ['thinking', 'error'],
  thinking:          ['tool-executing', 'streaming', 'error'],
  'tool-executing':  ['thinking', 'streaming', 'awaiting-confirm', 'error'],
  streaming:         ['completed', 'error'],
  'awaiting-confirm': ['tool-executing', 'error', 'idle'],
  error:             ['idle', 'turn'],
  completed:         ['idle', 'turn'],
}

export function isValidTransition(from: SessionState, to: SessionState): boolean {
  const allowed = VALID_TRANSITIONS[from]
  return allowed ? allowed.includes(to) : false
}

// ---- Agent 运行时 ----

export interface AgentRuntimeOptions {
  sessionId: string
  model: string
  onStateChange?: (state: SessionState) => void
  onStreamToken?: (token: string) => void
  onToolCall?: (toolCall: ToolCall) => void
  onReasoning?: (reasoning: string) => void
  onError?: (error: Error) => void
}

export class AgentRuntime {
  readonly sessionId: string
  readonly model: string
  state: SessionState = 'idle'
  turns: Turn[] = []
  turnIndex = 0
  private abortController: AbortController | null = null
  private options: AgentRuntimeOptions

  constructor(options: AgentRuntimeOptions) {
    this.sessionId = options.sessionId
    this.model = options.model
    this.options = options
  }

  /** 状态转换 */
  transition(to: SessionState): boolean {
    if (!isValidTransition(this.state, to)) {
      console.warn(
        `[AgentRuntime] 非法状态转换: ${this.state} → ${to}`
      )
      return false
    }
    this.state = to
    this.options.onStateChange?.(to)

    if (to === 'completed' || to === 'error') {
      const currentTurn = this.turns[this.turns.length - 1]
      if (currentTurn) {
        currentTurn.state = to
        currentTurn.completedAt = new Date().toISOString()
      }
    }
    return true
  }

  /** 发送用户消息 */
  async sendMessage(
    content: string,
    _knowledgeBaseIds?: string[],
    _toolIds?: string[],
    _context?: ChatRequestContext,
  ): Promise<Turn> {
    if (this.state !== 'idle' && this.state !== 'completed') {
      throw new Error(`Agent 正在处理中，当前状态: ${this.state}`)
    }

    this.transition('turn')

    const turn: Turn = {
      id: `turn-${Date.now()}-${this.turnIndex++}`,
      index: this.turnIndex,
      userMessage: {
        id: `msg-${Date.now()}`,
        role: 'user',
        content,
        model: this.model,
        timestamp: new Date().toISOString(),
      },
      state: 'turn',
      toolCalls: [],
      startedAt: new Date().toISOString(),
    }
    this.turns.push(turn)

    return turn
  }

  /** 进入思考状态 */
  startThinking(): Turn | null {
    if (!this.transition('thinking')) return null
    return this.currentTurn()
  }

  /** 记录工具调用 */
  recordToolCall(toolCall: ToolCall): void {
    const turn = this.currentTurn()
    if (turn) {
      turn.toolCalls.push(toolCall)
      turn.state = 'tool-executing'
      this.options.onToolCall?.(toolCall)
    }
  }

  /** 更新工具调用结果 */
  updateToolResult(toolCallId: string, result: unknown, isError = false): void {
    const turn = this.currentTurn()
    if (turn) {
      const tc = turn.toolCalls.find(t => t.id === toolCallId)
      if (tc) {
        tc.result = result
        tc.status = isError ? 'error' : 'completed'
      }
    }
  }

  /** 追加流式 token */
  appendStreamToken(token: string): void {
    this.options.onStreamToken?.(token)
    const turn = this.currentTurn()
    if (turn && turn.state !== 'streaming') {
      this.transition('streaming')
    }
  }

  /** 追加思维链（reasoning）内容 */
  appendReasoning(content: string): void {
    const turn = this.currentTurn()
    if (turn) {
      turn.reasoning = (turn.reasoning || '') + content
    }
    this.options.onReasoning?.(content)
  }

  /** 完成当前轮次 */
  complete(reasoning?: string, citations?: Citation[]): void {
    const turn = this.currentTurn()
    if (turn) {
      turn.reasoning = reasoning
      turn.knowledgeCitations = citations
    }
    this.transition('completed')
  }

  /** 出错 */
  fail(error: Error): void {
    this.transition('error')
    this.options.onError?.(error)
  }

  /** 请求用户确认（工具执行前） */
  requestConfirmation(_message: string): void {
    this.transition('awaiting-confirm')
  }

  /** 用户确认后恢复 */
  resume(): void {
    if (this.state === 'awaiting-confirm') {
      this.transition('tool-executing')
    }
  }

  /** 终止当前操作 */
  abort(): void {
    this.abortController?.abort()
    this.abortController = null
    this.transition('idle')
  }

  /** 绑定当前网络请求，确保停止操作能传播到 fetch。 */
  setAbortController(controller: AbortController | null): void {
    this.abortController = controller
  }

  /** 重试最后失败的轮次 */
  retryLastTurn(): Turn | undefined {
    const lastTurn = this.turns[this.turns.length - 1]
    if (lastTurn && lastTurn.state === 'error') {
      const retryTurn: Turn = {
        ...lastTurn,
        id: `retry-${Date.now()}`,
        state: 'turn',
        toolCalls: [],
        startedAt: new Date().toISOString(),
        completedAt: undefined,
      }
      this.turns.push(retryTurn)
      this.transition('turn')
      return retryTurn
    }
    return undefined
  }

  /** 撤销到指定轮次 */
  undoTo(index: number): Turn[] {
    const removed = this.turns.splice(index + 1)
    this.turnIndex = index + 1
    this.transition('idle')
    return removed
  }

  /** 获取当前轮次 */
  currentTurn(): Turn | null {
    return this.turns.length > 0 ? this.turns[this.turns.length - 1] : null
  }

  /** 重置 */
  reset(): void {
    this.turns = []
    this.turnIndex = 0
    this.state = 'idle'
  }
}

/** 创建 Agent 运行时的工厂函数 */
export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  return new AgentRuntime(options)
}
