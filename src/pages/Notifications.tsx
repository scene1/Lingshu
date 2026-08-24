import React, { useEffect, useState, useCallback } from 'react'
import { Card, List, Badge, Button, Tag, Space, Tabs, message, Popconfirm, Empty, Spin } from 'antd'
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  DeleteOutlined,
  CheckOutlined,
  BellOutlined
} from '@ant-design/icons'

interface Notification {
  id: string
  title: string
  content: string
  type: 'success' | 'info' | 'warning' | 'error'
  timestamp: string
  read: boolean
}

const Notifications: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('all')

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/notifications')
      if (!response.ok) throw new Error(`读取失败: ${response.status}`)
      const data = await response.json()
      setNotifications(Array.isArray(data.notifications) ? data.notifications : [])
      window.dispatchEvent(new Event('lingshu:notifications-updated'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取通知失败')
      setNotifications([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadNotifications()
  }, [loadNotifications])

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />
      case 'warning':
        return <WarningOutlined style={{ color: '#faad14' }} />
      case 'error':
        return <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
      default:
        return <InfoCircleOutlined style={{ color: '#1890ff' }} />
    }
  }

  const getTag = (type: string) => {
    const colors = {
      success: 'success',
      info: 'default',
      warning: 'warning',
      error: 'error'
    }
    return <Tag color={colors[type as keyof typeof colors]}>{type}</Tag>
  }

  const handleMarkRead = async (id: string) => {
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' })
      if (!response.ok) throw new Error('标记失败')
      await loadNotifications()
    } catch {
      message.error('标记失败')
    }
  }

  const handleMarkAllRead = async () => {
    try {
      const response = await fetch('/api/notifications/mark-all-read', { method: 'POST' })
      if (!response.ok) throw new Error('标记失败')
      message.success('全部标记为已读')
      await loadNotifications()
    } catch {
      message.error('标记失败')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('删除失败')
      message.success('已删除')
      await loadNotifications()
    } catch {
      message.error('删除失败')
    }
  }

  const handleClearAll = async () => {
    try {
      const response = await fetch('/api/notifications', { method: 'DELETE' })
      if (!response.ok) throw new Error('清空失败')
      message.success('已清空所有通知')
      await loadNotifications()
    } catch {
      message.error('清空失败')
    }
  }

  const filteredNotifications = notifications.filter(n => {
    if (activeTab === 'all') return true
    if (activeTab === 'unread') return !n.read
    return n.type === activeTab
  })

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>
        <BellOutlined /> 通知中心
        {unreadCount > 0 && (
          <Badge count={unreadCount} style={{ marginLeft: 8 }} />
        )}
      </h2>

      <Card
        extra={
          <Space>
            <Button onClick={loadNotifications}>刷新</Button>
            <Button onClick={handleMarkAllRead} icon={<CheckOutlined />}>
              全部已读
            </Button>
            <Popconfirm
              title="确认清空"
              description="确定要清空所有通知吗？"
              onConfirm={handleClearAll}
              okText="确定"
              cancelText="取消"
            >
              <Button danger icon={<DeleteOutlined />}>清空</Button>
            </Popconfirm>
          </Space>
        }
      >
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <Tabs.TabPane tab={`全部 (${notifications.length})`} key="all" />
          <Tabs.TabPane tab={`未读 (${unreadCount})`} key="unread" />
          <Tabs.TabPane tab="成功" key="success" />
          <Tabs.TabPane tab="警告" key="warning" />
          <Tabs.TabPane tab="错误" key="error" />
          <Tabs.TabPane tab="信息" key="info" />
        </Tabs>

        <Spin spinning={loading}>
          <List
          dataSource={filteredNotifications}
          locale={{ emptyText: <Empty description="暂无通知" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          renderItem={item => (
            <List.Item
              style={{
                backgroundColor: item.read ? 'transparent' : '#f0f7ff',
                padding: '16px',
                marginBottom: '8px',
                borderRadius: '8px'
              }}
              actions={[
                !item.read && (
                  <Button
                    type="link"
                    onClick={() => handleMarkRead(item.id)}
                  >
                    标记已读
                  </Button>
                ),
                <Button
                  type="link"
                  danger
                  onClick={() => handleDelete(item.id)}
                >
                  删除
                </Button>
              ].filter(Boolean)}
            >
              <List.Item.Meta
                avatar={getIcon(item.type)}
                title={
                  <Space>
                    <span style={{ fontWeight: item.read ? 'normal' : 'bold' }}>
                      {item.title}
                    </span>
                    {getTag(item.type)}
                  </Space>
                }
                description={
                  <div>
                    <div>{item.content}</div>
                    <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                      {new Date(item.timestamp).toLocaleString('zh-CN')}
                    </div>
                  </div>
                }
              />
            </List.Item>
          )}
        />
        </Spin>
      </Card>
    </div>
  )
}

export default Notifications
