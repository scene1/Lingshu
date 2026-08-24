// ============================================================
// 灵枢 v3.0 — 消息操作菜单
// 从这条分支 / 撤销到此处 / 复制内容
// ============================================================

import React from 'react'
import { Dropdown, message } from 'antd'
import type { MenuProps } from 'antd'
import { MoreOutlined, BranchesOutlined, RollbackOutlined, CopyOutlined } from '@ant-design/icons'
import { writeClipboardText } from '../../utils/clipboard'

interface MessageMenuProps {
  /** 消息内容（用于复制） */
  content: string
  /** 消息在列表中的索引（用于撤销到此处） */
  messageIndex: number
  /** 消息 ID（用于分支） */
  messageId: string
  /** 从这条消息分支回调 */
  onBranch?: (messageId: string) => void
  /** 撤销到此处回调 */
  onUndo?: (messageIndex: number) => void
}

/**
 * 消息操作菜单组件
 *
 * 通过 Dropdown 包裹 ⋮ 按钮，提供三种操作：
 * - 从这条分支：复制当前消息及之前的所有消息到新会话
 * - 撤销到此处：截断当前消息之后的所有消息
 * - 复制内容：将消息文本复制到剪贴板
 */
export const MessageMenu: React.FC<MessageMenuProps> = ({
  content,
  messageIndex,
  messageId,
  onBranch,
  onUndo,
}) => {
  const handleCopy = async () => {
    try {
      await writeClipboardText(content)
      message.success('已复制到剪贴板')
    } catch (error: any) {
      message.error(error?.message || '复制失败')
    }
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'branch',
      label: '从这条分支',
      icon: <BranchesOutlined />,
      onClick: () => onBranch?.(messageId),
    },
    {
      key: 'undo',
      label: '撤销到此处',
      icon: <RollbackOutlined />,
      onClick: () => onUndo?.(messageIndex),
    },
    { type: 'divider' },
    {
      key: 'copy',
      label: '复制内容',
      icon: <CopyOutlined />,
      onClick: () => void handleCopy(),
    },
  ]

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
      <span
        className="message-menu-trigger"
        style={{
          cursor: 'pointer',
          padding: '2px 6px',
          borderRadius: 4,
          fontSize: 14,
          color: '#999',
          transition: 'all 0.2s',
          display: 'inline-flex',
          alignItems: 'center',
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#f0f0f0'
          e.currentTarget.style.color = '#333'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = '#999'
        }}
      >
        <MoreOutlined />
      </span>
    </Dropdown>
  )
}

export default MessageMenu
