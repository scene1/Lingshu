// ============================================================
// 灵枢 v3.0 — 反馈栏组件
// ============================================================

import React from 'react'
import { Tooltip, Button } from 'antd'
import {
  LikeOutlined,
  DislikeOutlined,
  CopyOutlined,
  ReloadOutlined,
  BranchesOutlined,
} from '@ant-design/icons'
import { writeClipboardText } from '../../utils/clipboard'

interface FeedbackBarProps {
  messageId: string
  feedback?: 'helpful' | 'not_helpful' | null
  onFeedback?: (id: string, feedback: 'helpful' | 'not_helpful') => void
  onRetry?: (id: string) => void
  onCopy?: (content: string) => void
  content?: string
}

export const FeedbackBar: React.FC<FeedbackBarProps> = ({
  messageId,
  feedback,
  onFeedback,
  onRetry,
  onCopy,
  content,
}) => {
  return (
    <div
      className="message-feedback"
      style={{
        marginTop: 8,
        display: 'flex',
        gap: 4,
        opacity: 0.7,
        transition: 'opacity 0.2s',
      }}
    >
      <Tooltip title="有帮助">
        <Button
          type="text"
          size="small"
          icon={<LikeOutlined />}
          onClick={() => onFeedback?.(messageId, 'helpful')}
          style={{
            color: feedback === 'helpful' ? '#52c41a' : undefined,
            background: feedback === 'helpful' ? '#f6ffed' : undefined,
          }}
        />
      </Tooltip>

      <Tooltip title="没有帮助">
        <Button
          type="text"
          size="small"
          icon={<DislikeOutlined />}
          onClick={() => onFeedback?.(messageId, 'not_helpful')}
          style={{
            color: feedback === 'not_helpful' ? '#ff4d4f' : undefined,
            background: feedback === 'not_helpful' ? '#fff2f0' : undefined,
          }}
        />
      </Tooltip>

      {content && (
        <Tooltip title="复制">
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            onClick={() => {
              void writeClipboardText(content).then(() => onCopy?.(content)).catch(() => undefined)
            }}
          />
        </Tooltip>
      )}

      <Tooltip title="重新生成">
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => onRetry?.(messageId)}
        />
      </Tooltip>

      <Tooltip title="从此分支">
        <Button
          type="text"
          size="small"
          icon={<BranchesOutlined />}
        />
      </Tooltip>
    </div>
  )
}
