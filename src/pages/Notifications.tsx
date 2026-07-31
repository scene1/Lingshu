import React, { useState } from 'react'
import { Card, List, Badge, Button, Tag, Space, Tabs, message, Popconfirm } from 'antd'
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
  const [notifications, setNotifications] = useState<Notification[]>([
    {
      id: '1',
      title: 'Skill 更新完成',
      content: 'weather skill 已更新至 v1.1.0',
      type: 'success',
      timestamp: '2024-05-21 10:30',
      read: false
    },
    {
      id: '2',
      title: '系统警告',
      content: '内存使用率超过 80%',
      type: 'warning',
      timestamp: '2024-05-21 10:15',
      read: false
    },
    {
      id: '3',
      title: '配置已保存',
      content: '灵枢运行时配置已成功保存',
      type: 'info',
      timestamp: '2024-05-21 09:45',
      read: true
    },
    {
      id: '4',
      title: '连接失败',
      content: '微信渠道连接超时，请检查配置',
      type: 'error',
      timestamp: '2024-05-21 09:30',
      read: false
    }
  ])

  const [activeTab, setActiveTab] = useState('all')

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

  const handleMarkRead = (id: string) => {
    setNotifications(notifications.map(n =>
      n.id === id ? { ...n, read: true } : n
    ))
  }

  const handleMarkAllRead = () => {
    setNotifications(notifications.map(n => ({ ...n, read: true })))
    message.success('全部标记为已读')
  }

  const handleDelete = (id: string) => {
    setNotifications(notifications.filter(n => n.id !== id))
    message.success('已删除')
  }

  const handleClearAll = () => {
    setNotifications([])
    message.success('已清空所有通知')
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

        <List
          dataSource={filteredNotifications}
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
                      {item.timestamp}
                    </div>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  )
}

export default Notifications
