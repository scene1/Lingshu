// ============================================================
// 灵枢 v3.0 — 会话管理 Hook
// 封装 useChatStore，提供组件友好的 API
// ============================================================

import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import type { Message } from '../types'

export function useChatSession() {
  const store = useChatStore()
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 初始化或切换会话时创建 Agent 运行时
  useEffect(() => {
    if (store.currentSessionId) {
      store.initRuntime(store.currentSessionId, store.selectedModel)
    }
    return () => {
      if (streamTimerRef.current) {
        clearInterval(streamTimerRef.current)
      }
    }
  }, [store.currentSessionId])

  const handleSend = useCallback(async (content: string) => {
    if (!content.trim() || store.isStreaming) return

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      model: store.selectedModel,
      timestamp: new Date().toISOString(),
    }
    store.addMessage(userMsg)

    const assistantMsg: Message = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: '',
      model: store.selectedModel,
      timestamp: new Date().toISOString(),
      state: 'thinking',
    }
    store.addMessage(assistantMsg)

    await store.sendMessage(content, store.activeKnowledgeBases)
  }, [store.isStreaming, store.selectedModel, store.activeKnowledgeBases])

  const handleStop = useCallback(() => {
    store.stopStreaming()
  }, [])

  const handleRetry = useCallback(() => {
    store.retryLast()
  }, [])

  const handleFeedback = useCallback(async (
    messageId: string,
    feedback: 'helpful' | 'not_helpful',
  ) => {
    store.setFeedback(messageId, feedback)
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, feedback }),
      })
    } catch { /* 静默处理 */ }
  }, [])

  const handleNewSession = useCallback(() => {
    store.createSession()
  }, [])

  const handleSelectSession = useCallback((sessionId: string) => {
    store.setCurrentSession(sessionId)
  }, [])

  const handleDeleteSession = useCallback((sessionId: string) => {
    store.deleteSession(sessionId)
  }, [])

  const handleToggleFavorite = useCallback((sessionId: string) => {
    store.toggleFavorite(sessionId)
  }, [])

  const handleModelChange = useCallback((model: string) => {
    store.setSelectedModel(model)
  }, [])

  const handleToggleKnowledgeBase = useCallback((kbId: string) => {
    store.toggleKnowledgeBase(kbId)
  }, [])

  return {
    // 状态
    sessions: store.sessions,
    currentSessionId: store.currentSessionId,
    messages: store.messages,
    selectedModel: store.selectedModel,
    isStreaming: store.isStreaming,
    streamContent: store.streamContent,
    activeKnowledgeBases: store.activeKnowledgeBases,

    // 操作
    handleSend,
    handleStop,
    handleRetry,
    handleFeedback,
    handleNewSession,
    handleSelectSession,
    handleDeleteSession,
    handleToggleFavorite,
    handleModelChange,
    handleToggleKnowledgeBase,
  }
}
