// ============================================================
// 灵枢 v3.0 — 消息气泡组件（带 Agent 状态可视化）
// ============================================================

import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Collapse, Divider, message as antMessage, Progress, Space, Tag, Typography } from 'antd'
import {
  BookOutlined,
  CopyOutlined,
  EyeOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  DownloadOutlined,
  PictureOutlined,
  RobotOutlined,
  UserOutlined,
  ToolOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DownOutlined,
  ExclamationCircleOutlined,
  UpOutlined,
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ArtifactFormat, Citation, DocumentPreviewPayload, Message, QuickActionType } from '../../types'
import { QuickActions } from './QuickActions'
import { MessageMenu } from './MessageMenu'
import { sanitizeAssistantContent } from '../../utils/messageSanitizer'
import { artifactFormatLabel, detectChatArtifact } from '../../utils/chatArtifacts'
import { openExportedFile } from '../../utils/electron'
import { writeClipboardText } from '../../utils/clipboard'

const { Text } = Typography

interface MessageBubbleProps {
  message: Message
  messageIndex?: number
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
  isLastAssistant?: boolean
  previousUserContent?: string
}

interface SuggestedReply {
  id: string
  label: string
  prompt: string
  action?: 'fill' | 'send'
}

function compactSuggestionLabel(value: string, maxLength = 36) {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, maxLength - 3).trimEnd()}...`
}

function formatStepDuration(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const durationMs = Math.max(0, Number(value || 0))
  if (durationMs < 1000) return durationMs < 100 ? '<0.1秒' : `${(durationMs / 1000).toFixed(1)}秒`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}秒`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1000)
  return `${minutes}分${seconds}秒`
}

function cleanSuggestionText(value: string) {
  return String(value || '')
    .replace(/^[\s>*-]+/, '')
    .replace(/^\[[ x]\]\s*/i, '')
    .replace(/^方案\s*[A-D一二三四]?\s*[：:、.\-\)]?\s*/i, '')
    .replace(/^(?:选项|路线|方向)\s*[A-D一二三四0-9]?\s*[：:、.\-\)]?\s*/i, '')
    .replace(/^\d{1,2}\s*[.、\)]\s*/, '')
    .replace(/^[A-D]\s*[.、:\)]\s*/i, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()
}

function extractSuggestedReplies(content: string): SuggestedReply[] {
  const rawSource = String(content || '').replace(/```[\s\S]*?```/g, '')
  const markerMatches = [...rawSource.matchAll(/可选下一步[：:]?/g)]
  const hasExplicitSuggestionMarker = markerMatches.length > 0
  const source = markerMatches.length > 0
    ? rawSource.slice((markerMatches[markerMatches.length - 1].index || 0) + markerMatches[markerMatches.length - 1][0].length)
    : rawSource
  if (!hasExplicitSuggestionMarker && !/(请选择|选择一个|你可以选择|建议选择|下一步建议|下一步|选项|方案|路线|方向|是否|要不要|需要你确认)/.test(source)) {
    return []
  }

  const lines = source.split(/\r?\n/)
  const candidates: SuggestedReply[] = []
  const seen = new Set<string>()

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || /^#{1,6}\s+/.test(line) || /^[-*_]{3,}$/.test(line)) continue
    if (/^(可选下一步|下一步建议|选项|方案)[：:]?\s*$/.test(line)) continue

    const isChoiceLine = /^\s*(?:[-*+]\s+(?:\[[ x]\]\s*)?|\d{1,2}\s*[.、\)]\s*|[A-D]\s*[.、:\)]\s*|方案\s*[A-D一二三四]?\s*[：:、.\-\)]\s*|(?:选项|路线|方向)\s*[A-D一二三四0-9]?\s*[：:、.\-\)]\s*)/i.test(line)
    if (!isChoiceLine) continue

    const cleaned = cleanSuggestionText(line)
    if (!cleaned || cleaned.length < 2 || cleaned.length > 90) continue
    if (/^(视觉建议|导出说明|参考来源|推理过程|主要优化点|优化后的文档)/.test(cleaned)) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      id: `suggestion-${candidates.length}`,
      label: compactSuggestionLabel(cleaned),
      prompt: `我选择：${cleaned}`,
      action: 'send',
    })
    if (candidates.length >= 4) break
  }

  return candidates.length >= 2 ? candidates : []
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  messageIndex = 0,
  onFeedback,
  onMenuClick,
  onQuickAction,
  onSuggestedReply,
  onSaveToKnowledge,
  onBranch,
  onUndo,
  onPreviewDocument,
  onToolApproval,
  loadingAction = null,
  isLastAssistant,
  previousUserContent = '',
}) => {
  const isAssistant = message.role === 'assistant'
  const isThinking = message.state === 'thinking' || message.state === 'turn'
  const isToolExecuting = message.state === 'tool-executing'
  const isStreaming = message.state === 'streaming'
  const isError = message.state === 'error'
  const displayContent = isAssistant ? sanitizeAssistantContent(message.content) : message.content
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [exportingFormat, setExportingFormat] = useState<ArtifactFormat | null>(null)
  const [approvalSubmitting, setApprovalSubmitting] = useState<string | null>(null)
  const isLongAssistantContent = isAssistant && (displayContent.length > 1200 || displayContent.split(/\r?\n/).length > 28)
  const hasActiveStep = Boolean(message.steps?.some(step => step.status === 'running' || step.status === 'pending'))
  useEffect(() => {
    if (!hasActiveStep && !isThinking && !isStreaming && !isToolExecuting) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [hasActiveStep, isStreaming, isThinking, isToolExecuting])
  const structuredArtifact = Array.isArray(message.artifacts) && message.artifacts.length > 0 ? message.artifacts[0] : null
  const artifact = useMemo(() => {
    if (!isAssistant) return null
    if (structuredArtifact) {
      return detectChatArtifact(displayContent, structuredArtifact.formats, previousUserContent) || structuredArtifact
    }
    return detectChatArtifact(displayContent, undefined, previousUserContent)
  }, [displayContent, isAssistant, previousUserContent, structuredArtifact])
  const documentTitle = artifact?.title || '生成的内容'
  const suggestedReplies = useMemo(() => (
    isLastAssistant && isAssistant && !isThinking && !isStreaming && !isError
      ? (Array.isArray(message.suggestions) && message.suggestions.length > 0
        ? message.suggestions.slice(0, 4)
        : extractSuggestedReplies(displayContent))
      : []
  ), [displayContent, isAssistant, isError, isLastAssistant, isStreaming, isThinking, message.suggestions])
  const usedSkills = useMemo(() => {
    if (!isAssistant || !Array.isArray(message.toolCalls)) return []
    const names = message.toolCalls
      .filter(tc => /^Skill:/i.test(String(tc.name || '')))
      .map(tc => String(tc.name || '').replace(/^Skill:\s*/i, '').trim())
      .filter(Boolean)
    return Array.from(new Set(names)).slice(0, 4)
  }, [isAssistant, message.toolCalls])
  const citationLabel = (citation: Citation) => {
    const base = String(citation.knowledgeBase || citation.source || '来源')
    const name = String(citation.documentName || '').trim()
    if (base === 'Obsidian' && name) return name
    if (base === '本轮附件' && name) return name
    return base
  }

  const exportArtifact = async (format: ArtifactFormat) => {
    if (!displayContent.trim()) return
    setExportingFormat(format)
    try {
      const response = await fetch('/api/chat/export-artifact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: documentTitle, content: displayContent, format }),
      })
      const result = await response.json()
      if (!response.ok || !result?.url) throw new Error(result?.message || result?.error || '导出失败')
      await openExportedFile(result.path, result.url)
      antMessage.success(`已生成 ${String(format).toUpperCase()} 文件`)
    } catch (error: any) {
      antMessage.error(error.message || '导出失败')
    } finally {
      setExportingFormat(null)
    }
  }

  const previewDocument = () => {
    onPreviewDocument?.({
      messageId: message.id,
      title: documentTitle,
      content: displayContent,
      artifact: artifact || undefined,
    })
  }

  const renderStateIndicator = () => {
    if (!isAssistant) return null
    if (Array.isArray(message.steps) && message.steps.length > 0) return null

    return (
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        {isThinking && (
          <Tag icon={<ClockCircleOutlined />} color="processing">
            准备中 · {formatStepDuration(now - new Date(message.timestamp).getTime())}
          </Tag>
        )}
        {isToolExecuting && (
          <Tag icon={<ToolOutlined />} color="orange">
            工具执行中
          </Tag>
        )}
        {isStreaming && (
          <Tag icon={<ThunderboltOutlined />} color="green">
            生成中
          </Tag>
        )}
        {isError && (
          <Tag icon={<CloseCircleOutlined />} color="error">
            出错了
          </Tag>
        )}
      </div>
    )
  }

  const renderToolCalls = () => {
    if (!message.toolCalls || message.toolCalls.length === 0) return null

    return (
      <Collapse
        ghost
        size="small"
        style={{ marginTop: 8 }}
        items={message.toolCalls.map(tc => ({
          key: tc.id,
          label: (
            <Space>
              <ToolOutlined />
              <Text type="secondary">{tc.name}</Text>
              {tc.status === 'running' && <ClockCircleOutlined />}
              {tc.status === 'awaiting_approval' && <ExclamationCircleOutlined style={{ color: '#fa8c16' }} />}
              {tc.status === 'completed' && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
              {tc.status === 'denied' && <CloseCircleOutlined style={{ color: '#8c8c8c' }} />}
              {tc.status === 'error' && <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
            </Space>
          ),
          children: tc.status === 'awaiting_approval' && tc.approvalId ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Text>{tc.approvalReason || '此工具可能产生外部影响，请确认是否执行。'}</Text>
              <Space>
                <Button
                  type="primary"
                  size="small"
                  loading={approvalSubmitting === tc.approvalId}
                  onClick={async () => {
                    setApprovalSubmitting(tc.approvalId || null)
                    try {
                      await onToolApproval?.(tc.approvalId!, true)
                    } catch (error: any) {
                      antMessage.error(error?.message || '批准失败')
                    } finally {
                      setApprovalSubmitting(null)
                    }
                  }}
                >
                  批准执行
                </Button>
                <Button
                  size="small"
                  disabled={approvalSubmitting === tc.approvalId}
                  onClick={async () => {
                    setApprovalSubmitting(tc.approvalId || null)
                    try {
                      await onToolApproval?.(tc.approvalId!, false)
                    } catch (error: any) {
                      antMessage.error(error?.message || '拒绝失败')
                    } finally {
                      setApprovalSubmitting(null)
                    }
                  }}
                >
                  拒绝
                </Button>
              </Space>
            </Space>
          ) : tc.result ? (
            <pre style={{
              fontSize: 12,
              maxHeight: 200,
              overflow: 'auto',
              background: '#f5f5f5',
              padding: 8,
              borderRadius: 4,
            }}>
              {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)}
            </pre>
          ) : (
            <Text type="secondary">等待结果...</Text>
          ),
        }))}
      />
    )
  }

  const renderReasoning = () => {
    if (!message.reasoning) return null

    return (
      <Collapse
        ghost
        size="small"
        style={{ marginTop: 8 }}
        items={[{
          key: 'reasoning',
          label: (
            <Text type="secondary" style={{ fontSize: 12 }}>
              💭 推理过程
            </Text>
          ),
          children: (
            <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
              {message.reasoning}
            </Text>
          ),
        }]}
      />
    )
  }

  const renderSteps = () => {
    if (!isAssistant || !Array.isArray(message.steps) || message.steps.length === 0) return null
    const stepDuration = (step: NonNullable<Message['steps']>[number]) => {
      if (typeof step.durationMs === 'number') return step.durationMs
      if (!step.startedAt) return null
      const end = step.finishedAt ? new Date(step.finishedAt).getTime() : now
      return Math.max(0, end - new Date(step.startedAt).getTime())
    }
    const started = message.steps.map(step => step.startedAt ? new Date(step.startedAt).getTime() : NaN).filter(Number.isFinite)
    const finished = message.steps.map(step => step.finishedAt ? new Date(step.finishedAt).getTime() : NaN).filter(Number.isFinite)
    const totalFinishedAt = hasActiveStep ? now : (finished.length > 0 ? Math.max(...finished) : now)
    const explicitDurations = message.steps.map(stepDuration).filter((value): value is number => typeof value === 'number')
    const totalDuration = started.length > 0
      ? Math.max(0, totalFinishedAt - Math.min(...started))
      : explicitDurations.length > 0
        ? explicitDurations.reduce((sum, value) => sum + value, 0)
        : null
    const settledCount = message.steps.filter(step => step.status === 'completed' || step.status === 'error').length
    return (
      <div className="message-step-timeline">
        <div className="message-step-summary">
          <span>执行轨迹</span>
          <Text type="secondary">{settledCount}/{message.steps.length} 完成 · {formatStepDuration(totalDuration)}</Text>
        </div>
        {message.steps.map(step => (
          <div key={step.id} className={`message-step-row message-step-${step.status}`} title={step.detail || step.label}>
            <span className="message-step-icon">
              {step.status === 'running' || step.status === 'pending' ? <ClockCircleOutlined /> : step.status === 'error' ? <CloseCircleOutlined /> : <CheckCircleOutlined />}
            </span>
            <span className="message-step-main">
              <span className="message-step-label">{step.label}</span>
              {step.detail && <span className="message-step-detail">{step.detail}</span>}
            </span>
            <span className="message-step-duration">{formatStepDuration(stepDuration(step))}</span>
          </div>
        ))}
      </div>
    )
  }

  const renderRecovery = () => {
    if (!isAssistant || !message.recovery || message.recovery.status === 'ok') return null
    return (
      <div className={`message-recovery-card message-recovery-${message.recovery.status}`}>
        <div className="message-recovery-title">{message.recovery.title}</div>
        <div className="message-recovery-message">{message.recovery.message}</div>
        {Array.isArray(message.recovery.actions) && message.recovery.actions.length > 0 && onSuggestedReply && (
          <div className="message-suggestion-list">
            {message.recovery.actions.map(action => (
              <Button key={action.id} size="small" onClick={() => onSuggestedReply(action.prompt, action.action || 'send')}>
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderCitations = () => {
    if (!message.citations || message.citations.length === 0) return null

    const copySnippet = async (snippet: string) => {
      if (!snippet) return
      try {
        await writeClipboardText(snippet)
        antMessage.success('已复制来源片段')
      } catch (error: any) {
        antMessage.error(error?.message || '复制失败')
      }
    }

    return (
      <Collapse
        size="small"
        ghost
        style={{ marginTop: 10 }}
        items={[{
          key: 'citations',
          label: (
            <div className="message-citation-collapse-label">
              <BookOutlined style={{ color: '#1677ff' }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                参考来源 · {message.citations.length}
              </Text>
              <div className="message-citation-tag-list">
                {message.citations.slice(0, 3).map((citation, index) => (
                  <Tag
                    key={`${citation.documentName}-${index}`}
                    color="geekblue"
                    className="message-citation-tag"
                    style={{ marginInlineEnd: 0 }}
                    title={citationLabel(citation)}
                  >
                    {citationLabel(citation)}
                  </Tag>
                ))}
              </div>
            </div>
          ),
          children: (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {message.citations.map((citation, index) => {
                const relevance = Math.round((citation.relevance || 0) * 100)
                const location = citation.path || citation.chapter || ''
                return (
                  <Card
                    key={`${citation.knowledgeBase}-${citation.documentName}-${index}`}
                    size="small"
                    style={{
                      borderColor: '#d6e4ff',
                      background: '#fbfdff',
                    }}
                    bodyStyle={{ padding: 10 }}
                  >
                    <div className="message-citation-card">
                      <div className="message-citation-header">
                        <div className="message-citation-source">
                          <FileSearchOutlined style={{ color: '#1677ff', marginTop: 3 }} />
                          <div className="message-citation-source-main">
                            <div className="message-citation-title-row">
                              <Text strong className="message-citation-title" title={citation.documentName || '未命名文档'}>
                                {citation.documentName || '未命名文档'}
                              </Text>
                              <Tag color="blue" className="message-citation-meta-tag" title={citationLabel(citation)}>
                                {citationLabel(citation)}
                              </Tag>
                              {citation.type && <Tag className="message-citation-meta-tag">{citation.type}</Tag>}
                            </div>
                            {location && (
                              <div className="message-citation-location">
                                <Text type="secondary" title={location}>
                                  {location}
                                </Text>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="message-citation-score">
                          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                            相关性
                          </Text>
                          <Progress
                            type="circle"
                            percent={relevance}
                            size={34}
                            strokeWidth={10}
                            format={(value) => `${value}%`}
                          />
                        </div>
                      </div>

                      {citation.snippet && (
                        <>
                          <Divider style={{ margin: '2px 0' }} />
                          <div
                            className="message-citation-snippet"
                            style={{
                              color: '#4b5563',
                              fontSize: 13,
                              lineHeight: 1.7,
                              whiteSpace: 'pre-wrap',
                              maxHeight: 128,
                              overflow: 'auto',
                            }}
                          >
                            {citation.snippet}
                          </div>
                          <Button
                            size="small"
                            type="text"
                            icon={<CopyOutlined />}
                            onClick={() => copySnippet(citation.snippet)}
                            style={{ alignSelf: 'flex-start', paddingInline: 0 }}
                          >
                            复制片段
                          </Button>
                        </>
                      )}
                    </div>
                  </Card>
                )
              })}
            </Space>
          ),
        }]}
      />
    )
  }

  return (
    <div
      className={`message-row ${isAssistant ? 'message-row-assistant' : 'message-row-user'}`}
    >
      <div className={`message-avatar ${isAssistant ? 'message-avatar-assistant' : 'message-avatar-user'}`}>
        {isAssistant ? (
          <RobotOutlined />
        ) : (
          <UserOutlined />
        )}
      </div>

      <div className="message-stack">
        <div className={`message-bubble ${isAssistant ? 'message-bubble-assistant' : 'message-bubble-user'}`}>
          {!isAssistant && message.attachments && message.attachments.length > 0 && (
            <div className="message-attachments">
              {message.attachments.map(attachment => (
                <div className="message-attachment-card" key={attachment.id}>
                  {attachment.kind === 'image' && attachment.url
                    ? <img className="message-attachment-thumbnail" src={attachment.url} alt="" />
                    : attachment.kind === 'image' ? <PictureOutlined /> : <FileTextOutlined />}
                  <div className="message-attachment-card-content">
                    <div className="message-attachment-card-name" title={attachment.name}>{attachment.name}</div>
                    <div className="message-attachment-card-meta">
                      {attachment.kind === 'image'
                        ? '图片'
                        : attachment.text
                          ? `${attachment.textLength || attachment.text.length} 字已读取`
                          : attachment.extractionError
                            ? '解析失败'
                            : '仅上传未解析'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* 消息内容 */}
          {usedSkills.length > 0 && (
            <div className="message-skill-strip">
              <ThunderboltOutlined />
              <span>已使用能力</span>
              {usedSkills.map(skillName => (
                <Tag key={skillName} color="blue" className="message-skill-tag">
                  {skillName}
                </Tag>
              ))}
            </div>
          )}

          {renderSteps()}

          {isAssistant ? (
            <div className={`markdown-content${isLongAssistantContent && !expanded ? ' markdown-content-collapsed' : ''}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayContent || (isThinking ? '...' : '')}
              </ReactMarkdown>
            </div>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</div>
          )}

          {suggestedReplies.length > 0 && onSuggestedReply && (
            <div className="message-suggestion-panel">
              <div className="message-suggestion-title">可选下一步</div>
              <div className="message-suggestion-list">
                {suggestedReplies.map(option => (
                  <Button
                    key={option.id}
                    size="small"
                    className="message-suggestion-chip"
                    onClick={() => onSuggestedReply(option.prompt, option.action || 'send')}
                    title={`点击继续发送：${option.prompt}`}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {isAssistant && !isThinking && (isLongAssistantContent || artifact) && (
            <div className="message-document-actions">
              {artifact && (
                <div className="message-document-card">
                  <div className="message-document-card-icon">
                    <FileTextOutlined />
                  </div>
                  <div className="message-document-card-main">
                    <div className="message-document-card-title">{artifact.label}</div>
                    <div className="message-document-card-subtitle">{documentTitle}</div>
                  </div>
                  <Space size={6} wrap>
                    {onPreviewDocument && (
                      <Button size="small" icon={<EyeOutlined />} onClick={previewDocument}>
                        预览
                      </Button>
                    )}
                    {artifact.formats.map(format => (
                      <Button
                        key={format}
                        size="small"
                        type={format === artifact.primaryFormat ? 'primary' : 'default'}
                        icon={<DownloadOutlined />}
                        loading={exportingFormat === format}
                        onClick={() => exportArtifact(format)}
                      >
                        {artifactFormatLabel(format)}
                      </Button>
                    ))}
                  </Space>
                </div>
              )}
              {isLongAssistantContent && (
                <Button
                  size="small"
                  type="link"
                  icon={expanded ? <UpOutlined /> : <DownOutlined />}
                  onClick={() => setExpanded(prev => !prev)}
                >
                  {expanded ? '收起全文' : `展开全文 · ${displayContent.length.toLocaleString()}字`}
                </Button>
              )}
            </div>
          )}

          {/* 思维链 */}
          {renderReasoning()}

          {/* 工具调用 */}
          {renderToolCalls()}

          {/* 知识库引用 */}
          {renderCitations()}

          {renderRecovery()}

          {/* 状态指示 */}
          {renderStateIndicator()}

          {/* 消息时间 */}
          {isAssistant && (
            <div className="message-time">
              <Text type="secondary" style={{ fontSize: 11 }}>
                {new Date(message.timestamp).toLocaleTimeString()}
              </Text>
              {message.model && (
                <Tag style={{ marginLeft: 8, fontSize: 10 }}>{message.model}</Tag>
              )}
            </div>
          )}

          {/* 消息菜单 */}
          {isAssistant && !isThinking && (onMenuClick || onBranch || onUndo) && (
            <div className="message-menu">
              <MessageMenu
                content={displayContent}
                messageIndex={messageIndex}
                messageId={message.id}
                onBranch={onBranch}
                onUndo={onUndo}
              />
            </div>
          )}
        </div>

        <div className="message-actions-row">
          {/* 快速操作（仅 assistant 消息且非流式状态） */}
        {isAssistant && !isThinking && !isStreaming && !isError && onQuickAction && (
          <QuickActions
            messageId={message.id}
            onAction={onQuickAction}
            loadingAction={loadingAction}
          />
        )}

          {isAssistant && !isThinking && !isStreaming && !isError && onSaveToKnowledge && (
            <Button
              type="text"
              size="small"
              icon={<BookOutlined />}
              onClick={() => onSaveToKnowledge(message.id)}
              title="保存到知识收件箱"
            >
              存入收件箱
            </Button>
          )}

          {/* 反馈按钮 */}
          {isLastAssistant && isAssistant && !isThinking && onFeedback && (
            <div className="message-feedback">
              <Button
                type="text"
                size="small"
                onClick={() => onFeedback(message.id, 'like')}
                className={message.feedback === 'like' ? 'message-feedback-active' : ''}
                title="有帮助"
              >
                有帮助
              </Button>
              <Button
                type="text"
                size="small"
                onClick={() => onFeedback(message.id, 'dislike')}
                className={message.feedback === 'dislike' ? 'message-feedback-active' : ''}
                title="没有帮助"
              >
                没帮助
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
