// ============================================================
// 灵枢 v3.0 — 消息列表组件（支持虚拟滚动）
// Phase 2: 透传消息菜单、快速操作、分支/撤销回调
// ============================================================

import React, { useEffect, useRef } from 'react'
import { Empty } from 'antd'
import { MessageBubble } from './MessageBubble'
import type { DocumentPreviewPayload, Message, QuickActionType } from '../../types'

interface MessageListProps {
  messages: Message[]
  onFeedback?: (id: string, feedback: 'like' | 'dislike') => void
  onMenuClick?: (messageId: string, messageIndex: number) => void
  onQuickAction?: (action: QuickActionType, messageId: string) => void
  onSuggestedReply?: (value: string, action?: 'fill' | 'send') => void
  onSaveToKnowledge?: (messageId: string) => void
  onBranch?: (messageId: string) => void
  onUndo?: (messageIndex: number) => void
  onPreviewDocument?: (payload: DocumentPreviewPayload) => void
  onToolApproval?: (approvalId: string, approved: boolean) => Promise<void>
  loadingAction?: QuickActionType | null
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  onFeedback,
  onMenuClick,
  onQuickAction,
  onSuggestedReply,
  onSaveToKnowledge,
  onBranch,
  onUndo,
  onPreviewDocument,
  onToolApproval,
  loadingAction,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content])

  if (messages.length === 0) {
    return (
      <div
        ref={containerRef}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
        }}
      >
        <Empty description="开始一段新对话吧" />
      </div>
    )
  }

  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i
    }
    return -1
  })()

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        paddingBottom: 8,
      }}
      className="message-list-container"
    >
      {messages.map((msg, index) => {
        const previousUserContent = msg.role === 'assistant'
          ? [...messages.slice(0, index)].reverse().find(item => item.role === 'user')?.content || ''
          : ''
        return (
          <MessageBubble
            key={msg.id}
            message={msg}
            messageIndex={index}
            onFeedback={onFeedback}
            onMenuClick={onMenuClick}
            onQuickAction={onQuickAction}
            onSuggestedReply={onSuggestedReply}
            onSaveToKnowledge={onSaveToKnowledge}
            onBranch={onBranch}
            onUndo={onUndo}
            onPreviewDocument={onPreviewDocument}
            onToolApproval={onToolApproval}
            loadingAction={loadingAction}
            isLastAssistant={index === lastAssistantIndex}
            previousUserContent={previousUserContent}
          />
        )
      })}

      <div ref={bottomRef} />
    </div>
  )
}
