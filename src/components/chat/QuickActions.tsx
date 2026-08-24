// ============================================================
// 灵枢 v3.0 — 消息快速操作按钮组
// 翻译 / 解释 / 优化 / 总结
// ============================================================

import React from 'react'
import { Button, Space, Tooltip } from 'antd'
import {
  ReloadOutlined,
  TranslationOutlined,
  BulbOutlined,
  HighlightOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import type { QuickActionType } from '../../types'

interface QuickActionsProps {
  /** 当前消息 ID */
  messageId: string
  /** 快速操作回调 */
  onAction: (action: QuickActionType, messageId: string) => void
  /** 是否处于 loading 状态（由父组件控制） */
  loadingAction?: QuickActionType | null
}

const ACTION_CONFIG: Array<{
  type: QuickActionType
  label: string
  icon: React.ReactNode
}> = [
  { type: 'retry', label: '重试', icon: <ReloadOutlined /> },
  { type: 'translate', label: '翻译', icon: <TranslationOutlined /> },
  { type: 'explain', label: '解释', icon: <BulbOutlined /> },
  { type: 'optimize', label: '优化', icon: <HighlightOutlined /> },
  { type: 'summarize', label: '总结', icon: <UnorderedListOutlined /> },
]

/**
 * 快速操作按钮组组件
 *
 * 在 assistant 消息底部渲染，提供四种快捷操作：
 * - 翻译：将内容翻译为英文
 * - 解释：详细解释内容
 * - 优化：优化内容表达
 * - 总结：用要点总结内容
 */
export const QuickActions: React.FC<QuickActionsProps> = ({
  messageId,
  onAction,
  loadingAction = null,
}) => {
  return (
    <div className="quick-actions" style={{ marginTop: 8, display: 'flex', gap: 4 }}>
      <Space size={4}>
        {ACTION_CONFIG.map(({ type, label, icon }) => (
          <Tooltip key={type} title={label}>
            <Button
              type="text"
              size="small"
              icon={icon}
              loading={loadingAction === type}
              disabled={loadingAction !== null && loadingAction !== type}
              onClick={(e) => {
                e.stopPropagation()
                onAction(type, messageId)
              }}
              style={{ fontSize: 12, color: '#8c8c8c' }}
            >
              {label}
            </Button>
          </Tooltip>
        ))}
      </Space>
    </div>
  )
}

export default QuickActions
