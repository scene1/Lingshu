// ============================================================
// 灵枢 v3.0 — 会话状态管理 (Zustand)
// 替代 RealChat.tsx 中 15+ 个 useState
// Phase 2: SSE 流式解析 + 分支 + 多模型对比 + 快速操作
// ============================================================

import { create } from 'zustand'
import { AgentRuntime, createAgentRuntime } from '../core/agent-runtime'
import { SSEParser } from '../core/sse-parser'
import type { ChatRequestContext, Message, Session, ToolCall, QuickActionType } from '../types'
import { sanitizeAssistantContent } from '../utils/messageSanitizer'

// ---- 快速操作 System Prompt 模板 ----

const QUICK_ACTION_PROMPTS: Record<Exclude<QuickActionType, 'retry'>, (content: string) => string> = {
  translate: (c) => `将以下内容翻译为英文，仅输出翻译结果：\n\n${c}`,
  explain:   (c) => `请详细解释以下内容：\n\n${c}`,
  optimize:  (c) => `请优化以下内容的表达，使其更清晰、简洁、专业：\n\n${c}`,
  summarize: (c) => `请用 3-5 个要点总结以下内容：\n\n${c}`,
}

let activeChatRequest: { controller: AbortController; requestId: string; sessionId: string } | null = null

interface ChatState {
  // ---- 会话 ----
  sessions: Session[]
  currentSessionId: string | null
  messages: Message[]
  isLoadingSessions: boolean

  // ---- Agent 运行时 ----
  runtime: AgentRuntime | null
  selectedModel: string
  isStreaming: boolean
  streamContent: string

  // ---- 知识库 ----
  activeKnowledgeBases: string[]

  // ---- 多模型对比 ----
  compareMode: boolean
  compareModels: string[]
  compareLoading: boolean

  // ---- 快速操作 ----
  loadingAction: QuickActionType | null

  // ---- 操作 ----
  setSessions: (sessions: Session[] | ((sessions: Session[]) => Session[])) => void
  setCurrentSession: (sessionId: string | null) => void
  createSession: () => Session
  deleteSession: (sessionId: string) => void
  toggleFavorite: (sessionId: string) => void

  setMessages: (messages: Message[] | ((messages: Message[]) => Message[])) => void
  addMessage: (message: Message) => void
  updateLastMessage: (content: string) => void
  updateLastMessagePartial: (updater: (msg: Message) => Message) => void
  clearMessages: () => void

  initRuntime: (sessionId: string, model: string) => void
  sendMessage: (content: string, kbIds?: string[], context?: ChatRequestContext) => Promise<void>
  respondToApproval: (approvalId: string, approved: boolean) => Promise<void>
  stopStreaming: () => void
  retryLast: () => Promise<void>
  undoToTurn: (index: number) => void
  branchFromMessage: (messageId: string) => string

  setSelectedModel: (model: string) => void
  setStreamContent: (content: string) => void
  toggleKnowledgeBase: (kbId: string) => void

  setFeedback: (messageId: string, feedback: 'helpful' | 'not_helpful') => void

  // ---- 多模型对比 ----
  setCompareMode: (enabled: boolean) => void
  setCompareModels: (models: string[]) => void
  sendCompareMessage: (content: string, models: string[]) => Promise<void>

  // ---- 快速操作 ----
  executeQuickAction: (messageId: string, action: QuickActionType) => Promise<void>
}

function generateId(): string {
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function mergeMessageSteps(
  current: Message['steps'] = [],
  incoming: Message['steps'] = []
): Message['steps'] {
  const next = [...current]
  for (const step of incoming) {
    if (!step?.id) continue
    const index = next.findIndex(item => item.id === step.id)
    if (index >= 0) {
      next[index] = { ...next[index], ...step }
    } else {
      next.push(step)
    }
  }
  return next
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  isLoadingSessions: false,
  runtime: null,
  selectedModel: (() => {
    try {
      return localStorage.getItem('openclaw-selected-model') || 'step-3.7-flash'
    } catch { return 'step-3.7-flash' }
  })(),
  isStreaming: false,
  streamContent: '',
  activeKnowledgeBases: [],
  compareMode: false,
  compareModels: [],
  compareLoading: false,
  loadingAction: null,

  setSessions: (sessions) => set(state => ({
    sessions: typeof sessions === 'function' ? sessions(state.sessions) : sessions,
  })),
  setCurrentSession: (sessionId) => {
    if (activeChatRequest && activeChatRequest.sessionId !== sessionId) {
      activeChatRequest.controller.abort()
      activeChatRequest = null
    }
    set({ currentSessionId: sessionId, isStreaming: false, streamContent: '' })
  },
  createSession: () => {
    const session: Session = {
      id: generateId(),
      title: '新对话',
      model: get().selectedModel,
      lastMessage: '',
      timestamp: new Date().toISOString(),
      messageCount: 0,
      isFavorite: false,
      messages: [],
    }
    set(state => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
      messages: [],
    }))
    return session
  },
  deleteSession: (sessionId) =>
    set(state => {
      const sessions = state.sessions.filter(s => s.id !== sessionId)
      const currentSessionId = state.currentSessionId === sessionId
        ? (sessions[0]?.id || null)
        : state.currentSessionId
      return { sessions, currentSessionId, messages: [] }
    }),
  toggleFavorite: (sessionId) =>
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, isFavorite: !s.isFavorite } : s
      ),
    })),

  setMessages: (messages) => set(state => ({
    messages: typeof messages === 'function' ? messages(state.messages) : messages,
  })),
  addMessage: (message) =>
    set(state => {
      const messages = [...state.messages, message]
      const session = state.sessions.find(s => s.id === state.currentSessionId)
      if (session) {
        session.lastMessage = message.content.slice(0, 50)
        session.messageCount = messages.length
        session.timestamp = new Date().toISOString()
      }
      return { messages }
    }),
  updateLastMessage: (content) =>
    set(state => {
      const messages = [...state.messages]
      if (messages.length > 0) {
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          content,
        }
      }
      return { messages }
    }),
  updateLastMessagePartial: (updater) =>
    set(state => {
      const messages = [...state.messages]
      if (messages.length > 0) {
        messages[messages.length - 1] = updater(messages[messages.length - 1])
      }
      return { messages }
    }),
  clearMessages: () => set({ messages: [], streamContent: '' }),

  initRuntime: (sessionId, model) => {
    get().runtime?.abort()
    const runtime = createAgentRuntime({
      sessionId,
      model,
      onStateChange: (state) => {
        if (state === 'completed' || state === 'error') {
          set({ isStreaming: false })
        }
        if (state === 'streaming') {
          set({ isStreaming: true })
        }
      },
      onStreamToken: (token) => {
        set(state => ({
          streamContent: state.streamContent + token,
          isStreaming: true,
        }))
      },
      onReasoning: (content) => {
        // 将 reasoning 追加到最后一条 assistant 消息
        set(state => {
          const messages = [...state.messages]
          if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
            const lastMsg = messages[messages.length - 1]
            messages[messages.length - 1] = {
              ...lastMsg,
              reasoning: (lastMsg.reasoning || '') + content,
            }
          }
          return { messages }
        })
      },
      onToolCall: (toolCall) => {
        // 将 toolCall 追加到最后一条 assistant 消息
        set(state => {
          const messages = [...state.messages]
          if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
            const lastMsg = messages[messages.length - 1]
            messages[messages.length - 1] = {
              ...lastMsg,
              toolCalls: [...(lastMsg.toolCalls || []), toolCall],
            }
          }
          return { messages }
        })
      },
      onError: (error) => {
        console.error('[ChatStore] Agent error:', error)
      },
    })
    set({ runtime })
  },

  sendMessage: async (content, kbIds, context = {}) => {
    const { runtime, selectedModel, currentSessionId, isStreaming } = get()
    if (!runtime || !currentSessionId || isStreaming || !String(content || '').trim()) return
    set({ isStreaming: true, streamContent: '' })

    // 添加用户消息
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      model: selectedModel,
      ...(context.projectId ? { projectId: context.projectId } : {}),
      ...(context.attachments?.length ? { attachments: context.attachments } : {}),
      ...(context.skills?.length ? {
        toolCalls: context.skills.map((skill, index) => ({
          id: `skill-load-${skill.id}-${Date.now()}-${index}`,
          name: `Skill: ${skill.name || skill.id}`,
          args: {
            skillId: skill.id,
            ...(skill.arguments ? { arguments: skill.arguments } : {}),
          },
          result: '已作为本轮上下文加载，等待模型按说明处理。',
          status: 'completed' as const,
        })),
      } : {}),
    }
    get().addMessage(userMessage)

    // 添加占位 assistant 消息
    const assistantMessage: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      model: selectedModel,
      state: 'thinking',
    }
    get().addMessage(assistantMessage)

    const requestId = assistantMessage.id
    const controller = new AbortController()
    activeChatRequest = { controller, requestId, sessionId: currentSessionId }
    runtime.setAbortController(controller)

    try {
      await runtime.sendMessage(content, kbIds, undefined, context)
      runtime.startThinking()
      const response = await fetch(`/api/instances/local/sessions/${currentSessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
        signal: controller.signal,
        body: JSON.stringify({
          requestId,
          message: content,
          model: selectedModel,
          stream: true,
          knowledgeBases: kbIds || [],
          projectId: context.projectId,
          attachments: context.attachments || [],
          skillIds: context.skillIds || context.skills?.map(skill => skill.id) || [],
          skillArguments: context.skillArguments || Object.fromEntries(
            (context.skills || [])
              .filter(skill => skill.arguments)
              .map(skill => [skill.id, skill.arguments || {}])
          ),
          runtimeVersion: 2,
        }),
      })

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`)
      }

      // 检查是否为 SSE 流式响应
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('text/event-stream')) {
        // SSE 流式模式 — 先尝试读取流
        const reader = response.body?.getReader?.()
        if (!reader || typeof reader.read !== 'function') {
          // 流不可用（Vite 代理可能缓冲了响应），回退为非流式解析
          const text = await response.text()
          const lines = text.split('\n')
          let fullContent = ''
          for (const line of lines) {
            if (line.startsWith('data:')) {
              try {
                const data = JSON.parse(line.slice(5).trim())
                if (data?.content) {
                  fullContent += data.content
                  runtime.appendStreamToken(data.content)
                  get().updateLastMessage(sanitizeAssistantContent(fullContent))
                }
              } catch { /* 忽略解析失败的行 */ }
            }
          }
          runtime.complete()
          set({ isStreaming: false })
          return
        }

        const decoder = new TextDecoder()
        const sseParser = new SSEParser()
        let fullContent = ''

        while (true) {
          if (get().currentSessionId !== currentSessionId) {
            controller.abort()
            throw new DOMException('会话已切换', 'AbortError')
          }
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const events = sseParser.feed(chunk)

          for (const event of events) {
            switch (event.type) {
              case 'token': {
                const data = event.data as { content?: string }
                if (data?.content) {
                  fullContent += data.content
                  runtime.appendStreamToken(data.content)
                  get().updateLastMessage(sanitizeAssistantContent(fullContent))
                }
                break
              }
              case 'reasoning': {
                const data = event.data as { content?: string }
                if (data?.content) {
                  runtime.appendReasoning(data.content)
                }
                break
              }
              case 'tool_call': {
                const data = event.data as ToolCall
                if (data) {
                  runtime.recordToolCall(data)
                }
                break
              }
              case 'tool_result': {
                const data = event.data as { id?: string; result?: unknown; status?: string }
                if (data?.id) {
                  runtime.updateToolResult(data.id, data.result, data.status === 'error' || data.status === 'denied')
                  // 更新消息中的 toolCall 结果
                  set(state => {
                    const messages = [...state.messages]
                    if (messages.length > 0) {
                      const lastMsg = messages[messages.length - 1]
                      if (lastMsg.toolCalls) {
                        const updatedToolCalls = lastMsg.toolCalls.map(tc =>
                          tc.id === data.id
                            ? { ...tc, result: data.result, status: (data.status as ToolCall['status']) || 'completed' as const }
                            : tc
                        )
                        messages[messages.length - 1] = { ...lastMsg, toolCalls: updatedToolCalls }
                      }
                    }
                    return { messages }
                  })
                }
                break
              }
              case 'approval_required': {
                const data = event.data as {
                  id?: string
                  callId?: string
                  reason?: string
                }
                if (data?.id && data.callId) {
                  runtime.requestConfirmation(data.reason || '工具需要确认')
                  set(state => {
                    const messages = [...state.messages]
                    const lastMsg = messages[messages.length - 1]
                    if (lastMsg?.toolCalls) {
                      messages[messages.length - 1] = {
                        ...lastMsg,
                        state: 'awaiting-confirm',
                        toolCalls: lastMsg.toolCalls.map(tc => tc.id === data.callId
                          ? {
                              ...tc,
                              status: 'awaiting_approval' as const,
                              approvalId: data.id,
                              approvalReason: data.reason,
                            }
                          : tc),
                      }
                    }
                    return { messages }
                  })
                }
                break
              }
              case 'approval_resolved': {
                const data = event.data as {
                  callId?: string
                  approved?: boolean
                  reason?: string
                }
                if (data?.callId) {
                  runtime.resume()
                  set(state => {
                    const messages = [...state.messages]
                    const lastMsg = messages[messages.length - 1]
                    if (lastMsg?.toolCalls) {
                      messages[messages.length - 1] = {
                        ...lastMsg,
                        state: 'tool-executing',
                        toolCalls: lastMsg.toolCalls.map(tc => tc.id === data.callId
                          ? {
                              ...tc,
                              status: data.approved ? 'running' as const : 'denied' as const,
                              result: data.approved ? tc.result : { error: data.reason || '用户拒绝执行' },
                            }
                          : tc),
                      }
                    }
                    return { messages }
                  })
                }
                break
              }
              case 'step': {
                const data = event.data as { step?: NonNullable<Message['steps']>[number]; steps?: Message['steps'] }
                const incomingSteps = Array.isArray(data?.steps) && data.steps.length > 0
                  ? data.steps
                  : data?.step
                    ? [data.step]
                    : []
                if (incomingSteps.length > 0) {
                  set(state => {
                    const messages = [...state.messages]
                    if (messages.length > 0) {
                      const lastMsg = messages[messages.length - 1]
                      messages[messages.length - 1] = {
                        ...lastMsg,
                        steps: mergeMessageSteps(lastMsg.steps || [], incomingSteps),
                      }
                    }
                    return { messages }
                  })
                }
                break
              }
              case 'done': {
                const data = event.data as {
                  model?: string
                  usage?: { totalTokens?: number }
                  reasoning?: string
                  toolCalls?: ToolCall[]
                  citations?: Message['citations']
                  artifacts?: Message['artifacts']
                  steps?: Message['steps']
                  suggestions?: Message['suggestions']
                  recovery?: Message['recovery']
                }
                if (data?.model || data?.reasoning || data?.toolCalls || data?.citations || data?.artifacts || data?.steps || data?.suggestions || data?.recovery) {
                  set(state => {
                    const messages = [...state.messages]
                    if (messages.length > 0) {
                      messages[messages.length - 1] = {
                        ...messages[messages.length - 1],
                        ...(data.model ? { model: data.model } : {}),
                        ...(data.reasoning ? { reasoning: data.reasoning } : {}),
                        ...(Array.isArray(data.toolCalls) && data.toolCalls.length > 0 ? { toolCalls: data.toolCalls } : {}),
                        ...(Array.isArray(data.citations) && data.citations.length > 0 ? { citations: data.citations } : {}),
                        ...(Array.isArray(data.artifacts) && data.artifacts.length > 0 ? { artifacts: data.artifacts } : {}),
                        ...(Array.isArray(data.steps) && data.steps.length > 0 ? { steps: mergeMessageSteps(messages[messages.length - 1].steps || [], data.steps) } : {}),
                        ...(Array.isArray(data.suggestions) && data.suggestions.length > 0 ? { suggestions: data.suggestions } : {}),
                        ...(data.recovery ? { recovery: data.recovery } : {}),
                      }
                    }
                    return { messages }
                  })
                }
                break
              }
              case 'error': {
                const data = event.data as { message?: string }
                throw new Error(data?.message || 'SSE 流错误')
              }
            }
          }
        }

        // 解析剩余 buffer
        const remainingEvents = sseParser.parse()
        for (const event of remainingEvents) {
          if (event.type === 'token') {
            const data = event.data as { content?: string }
            if (data?.content) {
              fullContent += data.content
              get().updateLastMessage(sanitizeAssistantContent(fullContent))
            }
          }
        }

        runtime.complete()
      } else {
        // 非流式 JSON 模式
        const data = await response.json()
        const reply = data.reply || '无回复'
        const toolCalls = data.toolCalls || []
        const reasoning = data.reasoning || ''
        const citations = data.citations || []
        const artifacts = data.artifacts || []
        const steps = data.steps || []
        const suggestions = data.suggestions || []
        const recovery = data.recovery

        if (reasoning) {
          runtime.appendReasoning(reasoning)
        }
        for (const tc of toolCalls) {
          runtime.recordToolCall(tc)
        }
        runtime.appendStreamToken(reply)
        get().updateLastMessagePartial(msg => ({
          ...msg,
          content: sanitizeAssistantContent(reply),
          ...(citations.length > 0 ? { citations } : {}),
          ...(artifacts.length > 0 ? { artifacts } : {}),
          ...(steps.length > 0 ? { steps } : {}),
          ...(suggestions.length > 0 ? { suggestions } : {}),
          ...(recovery ? { recovery } : {}),
        }))
        runtime.complete()
      }

      set({
        streamContent: '',
        isStreaming: false,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        runtime.abort()
        if (get().currentSessionId === currentSessionId) {
          get().updateLastMessagePartial(msg => ({
            ...msg,
            content: msg.content || '已停止生成',
            state: 'completed',
          }))
        }
        return
      }
      console.error('[ChatStore] sendMessage error:', error)
      runtime.fail(error instanceof Error ? error : new Error(String(error)))
      // 更新最后一条消息显示错误
      get().updateLastMessagePartial(msg => ({
        ...msg,
        content: msg.content || `❌ 发送失败: ${error instanceof Error ? error.message : String(error)}`,
        state: 'error',
      }))
      set({ isStreaming: false, streamContent: '' })
    } finally {
      if (activeChatRequest?.requestId === requestId) {
        activeChatRequest = null
        runtime.setAbortController(null)
        set({ isStreaming: false, streamContent: '' })
      }
    }
  },

  respondToApproval: async (approvalId, approved) => {
    const response = await fetch(`/api/chat/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(detail || `审批请求失败: ${response.status}`)
    }
  },

  stopStreaming: () => {
    activeChatRequest?.controller.abort()
    activeChatRequest = null
    get().runtime?.abort()
    set({ isStreaming: false, streamContent: '' })
  },

  retryLast: async () => {
    const { messages, currentSessionId } = get()
    const assistantIndex = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') return i
      }
      return -1
    })()
    if (assistantIndex === -1 || !currentSessionId) return

    const userIndex = (() => {
      for (let i = assistantIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') return i
      }
      return -1
    })()
    if (userIndex === -1) return

    const userContent = messages[userIndex].content
    const truncatedMessages = messages.slice(0, userIndex)
    set({ messages: truncatedMessages })

    try {
      await fetch(`/api/instances/local/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: truncatedMessages }),
      })
    } catch {
      // 后端截断失败时仍允许前端重试，最终发送会再次刷新会话。
    }

    await get().sendMessage(userContent)
  },

  undoToTurn: (index) => {
    const runtime = get().runtime
    if (runtime) {
      runtime.undoTo(index)
      const truncatedMessages = get().messages.slice(0, index + 1)
      set({ messages: truncatedMessages })

      // 持久化到后端
      const sessionId = get().currentSessionId
      if (sessionId) {
        fetch(`/api/instances/local/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: truncatedMessages }),
        }).catch(() => { /* 静默失败 */ })
      }
    }
  },

  branchFromMessage: (messageId) => {
    const { messages, currentSessionId, selectedModel } = get()
    const branchIndex = messages.findIndex(m => m.id === messageId)
    if (branchIndex === -1) return currentSessionId || ''

    // 复制 messageId 及之前的消息
    const copiedMessages = messages.slice(0, branchIndex + 1).map(m => ({
      ...m,
      id: generateId(),
    }))

    // 创建新会话
    const newSession: Session = {
      id: generateId(),
      title: `分支: ${get().sessions.find(s => s.id === currentSessionId)?.title || '对话'}`,
      model: selectedModel,
      lastMessage: copiedMessages.length > 0 ? copiedMessages[copiedMessages.length - 1].content.slice(0, 50) : '',
      timestamp: new Date().toISOString(),
      messageCount: copiedMessages.length,
      isFavorite: false,
      messages: copiedMessages,
    }

    set(state => ({
      sessions: [newSession, ...state.sessions],
      currentSessionId: newSession.id,
      messages: copiedMessages,
    }))

    // 初始化新的 runtime
    get().initRuntime(newSession.id, selectedModel)

    // 持久化新会话到后端
    fetch('/api/instances/local/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newSession.title,
        id: newSession.id,
        messages: copiedMessages,
      }),
    }).catch(() => { /* 静默失败 */ })

    return newSession.id
  },

  setSelectedModel: (model) => {
    try { localStorage.setItem('openclaw-selected-model', model) } catch { /* ignore */ }
    set({ selectedModel: model })
  },

  setStreamContent: (content) => set({ streamContent: content }),

  toggleKnowledgeBase: (kbId) =>
    set(state => ({
      activeKnowledgeBases: state.activeKnowledgeBases.includes(kbId)
        ? state.activeKnowledgeBases.filter(id => id !== kbId)
        : [...state.activeKnowledgeBases, kbId],
    })),

  setFeedback: (messageId, feedback) =>
    set(state => ({
      messages: state.messages.map(m =>
        m.id === messageId ? { ...m, feedback: feedback as 'like' | 'dislike' | null } : m
      ),
    })),

  // ---- 多模型对比 ----
  setCompareMode: (enabled) => set({ compareMode: enabled, compareModels: [] }),
  setCompareModels: (models) => set({ compareModels: models }),

  sendCompareMessage: async (content, models) => {
    const { currentSessionId } = get()
    if (!currentSessionId || models.length === 0) return

    set({ compareLoading: true })

    // 并行调用所有模型
	    const promises = models.map(async (model) => {
	      try {
	        const response = await fetch(`/api/instances/local/sessions/${currentSessionId}/chat`, {
	          method: 'POST',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify({ message: content, model, stream: false, persist: false }),
	        })
        if (!response.ok) throw new Error(`请求失败: ${response.status}`)
        const data = await response.json()
        return {
          model,
          content: data.reply || '（无回复）',
          timestamp: new Date().toISOString(),
        }
      } catch (error) {
        return {
          model,
          content: `❌ 调用失败: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date().toISOString(),
        }
      }
    })

    const results = await Promise.all(promises)

	    get().addMessage({
	      id: generateId(),
	      role: 'user',
	      content,
	      timestamp: new Date().toISOString(),
	    })

	    // 将所有结果作为候选 assistant 消息追加，最终采用由页面负责持久化。
	    for (const result of results) {
      const msg: Message = {
        id: generateId(),
        role: 'assistant',
        content: result.content,
        timestamp: result.timestamp,
        model: result.model,
      }
      get().addMessage(msg)
    }

    set({ compareLoading: false })
  },

  // ---- 快速操作 ----
  executeQuickAction: async (messageId, action) => {
    const { messages, currentSessionId, selectedModel } = get()
    const targetMessage = messages.find(m => m.id === messageId)
    if (!targetMessage || !currentSessionId) return

    if (action === 'retry') {
      await get().retryLast()
      return
    }

    set({ loadingAction: action })

    const prompt = QUICK_ACTION_PROMPTS[action](targetMessage.content)

    try {
      const response = await fetch(`/api/instances/local/sessions/${currentSessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          model: selectedModel,
          stream: false,
        }),
      })

      if (!response.ok) throw new Error(`请求失败: ${response.status}`)

      const data = await response.json()
      const reply = data.reply || '（无回复）'

      // 将结果作为新的 assistant 消息追加
      const resultMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
        model: selectedModel,
      }
      get().addMessage(resultMessage)
    } catch (error) {
      console.error('[ChatStore] Quick action error:', error)
      const errorMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: `❌ ${action} 操作失败: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date().toISOString(),
        model: 'error',
      }
      get().addMessage(errorMessage)
    } finally {
      set({ loadingAction: null })
    }
  },
}))
