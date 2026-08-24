// ============================================================
// 灵枢 v3.0 — 会话侧边栏组件
// ============================================================

import React, { useState } from 'react'
import { List, Input, Button, Space, Tooltip, Dropdown, Typography } from 'antd'
import {
  SearchOutlined,
  PlusOutlined,
  MoreOutlined,
  EditOutlined,
  StarOutlined,
  DeleteOutlined,
  StarFilled,
  MessageOutlined,
} from '@ant-design/icons'
import type { Session } from '../../types'

const { Text } = Typography

interface ChatSidebarProps {
  sessions: Session[]
  currentSessionId: string | null
  onSelect: (sessionId: string) => void
  onNew: () => void
  onDelete: (sessionId: string) => void
  onToggleFavorite: (sessionId: string) => void
  onEdit?: (sessionId: string) => void
  onAutoTitle?: (sessionId: string) => void
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  sessions,
  currentSessionId,
  onSelect,
  onNew,
  onDelete,
  onToggleFavorite,
  onEdit,
  onAutoTitle,
}) => {
  const [searchText, setSearchText] = useState('')

  const filteredSessions = searchText
    ? sessions.filter(s =>
        s.title.toLowerCase().includes(searchText.toLowerCase()) ||
        s.lastMessage.toLowerCase().includes(searchText.toLowerCase())
      )
    : sessions

  const favorites = filteredSessions.filter(s => s.isFavorite)
  const normal = filteredSessions.filter(s => !s.isFavorite)

  const renderSessionItem = (session: Session) => {
    const isActive = session.id === currentSessionId
    const contextMenu = {
      items: [
        {
          key: 'favorite',
          icon: session.isFavorite ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />,
          label: session.isFavorite ? '取消收藏' : '收藏',
          onClick: () => onToggleFavorite(session.id),
        },
        ...(onEdit ? [{
          key: 'edit',
          icon: <EditOutlined />,
          label: '重命名',
          onClick: () => onEdit(session.id),
        }] : []),
        ...(onAutoTitle ? [{
          key: 'auto-title',
          icon: <MessageOutlined />,
          label: '智能命名',
          onClick: () => onAutoTitle(session.id),
        }] : []),
        {
          key: 'delete',
          icon: <DeleteOutlined />,
          label: '删除',
          danger: true,
          onClick: () => onDelete(session.id),
        },
      ],
    }

    return (
      <List.Item
        key={session.id}
        onClick={() => onSelect(session.id)}
        className={`chat-session-item ${isActive ? 'chat-session-item-active' : ''}`}
        onMouseEnter={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover, #f5f5f5)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLElement).style.background = 'transparent'
          }
        }}
      >
        <div style={{ width: '100%', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <MessageOutlined style={{ color: isActive ? '#1677ff' : '#999', fontSize: 12 }} />
              <Text
                strong={isActive}
                style={{
                  fontSize: 13,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 140,
                }}
              >
                {session.title}
              </Text>
              {session.isFavorite && <StarFilled style={{ color: '#faad14', fontSize: 12 }} />}
            </Space>

            <Dropdown menu={contextMenu} trigger={['click']}>
              <Button
                type="text"
                size="small"
                icon={<MoreOutlined />}
                onClick={(e) => e.stopPropagation()}
                style={{ opacity: 0.5 }}
              />
            </Dropdown>
          </div>

          <Text
            type="secondary"
            style={{
              fontSize: 11,
              display: 'block',
              marginTop: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 160,
            }}
          >
            {session.lastMessage || '新对话'}
          </Text>

          <Text type="secondary" style={{ fontSize: 10, marginTop: 2, display: 'block' }}>
            {new Date(session.timestamp).toLocaleDateString()}
            {' · '}
            {session.messageCount} 条消息
          </Text>
        </div>
      </List.Item>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 搜索 + 新建 */}
      <div style={{ padding: '12px 12px 8px' }}>
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索对话..."
              size="small"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
              style={{ flex: 1 }}
            />
            <Tooltip title="新建对话">
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={onNew}
              />
            </Tooltip>
          </div>
        </Space>
      </div>

      {/* 会话列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
        {favorites.length > 0 && (
          <>
            <Text type="secondary" style={{ fontSize: 11, padding: '0 4px' }}>
              收藏
            </Text>
            <List
              dataSource={favorites}
              renderItem={renderSessionItem}
              split={false}
            />
          </>
        )}

        <List
          dataSource={normal}
          renderItem={renderSessionItem}
          split={false}
          locale={{ emptyText: searchText ? '未找到匹配的对话' : '暂无对话记录' }}
        />
      </div>
    </div>
  )
}
