import React, { useState } from 'react'
import { List, Avatar, Space, Typography } from 'antd'
import { RobotOutlined, UserOutlined } from '@ant-design/icons'
import ChatInput from '../components/ChatInput'

const { Text } = Typography

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  skill?: string
  timestamp: string
}

const ChatDemo: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '你好！我是 OpenClaw 助手。输入 / 可以选择技能，输入 # 可以插入话题标签。',
      timestamp: '09:25'
    }
  ])

  const handleSend = (content: string, skill?: string) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      skill,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    
    setMessages([...messages, newMessage])
    
    // 模拟回复
    setTimeout(() => {
      const reply: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `收到消息："${content}"${skill ? ` (使用技能: ${skill})` : ''}`,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }
      setMessages(prev => [...prev, reply])
    }, 1000)
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部标题 */}
      <div style={{ 
        padding: '16px 24px', 
        borderBottom: '1px solid #333',
        backgroundColor: '#1a1a1a'
      }}>
        <h2 style={{ margin: 0, color: '#fff' }}>💬 聊天演示</h2>
      </div>

      {/* 消息列表 */}
      <div style={{ 
        flex: 1, 
        overflow: 'auto', 
        padding: '24px',
        backgroundColor: '#141414'
      }}>
        <List
          dataSource={messages}
          renderItem={msg => (
            <List.Item
              style={{
                marginBottom: 16,
                border: 'none',
              }}
            >
              <Space align="start" style={{ width: '100%' }}>
                <Avatar
                  size="large"
                  icon={msg.role === 'assistant' ? <RobotOutlined /> : <UserOutlined />}
                  style={{
                    backgroundColor: msg.role === 'assistant' ? '#1890ff' : '#52c41a',
                    flexShrink: 0
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 4 }}>
                    <Text strong style={{ color: '#fff', marginRight: 8 }}>
                      {msg.role === 'assistant' ? 'OpenClaw' : '用户'}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {msg.timestamp}
                    </Text>
                    {msg.skill && (
                      <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                        · 使用 {msg.skill}
                      </Text>
                    )}
                  </div>
                  <div style={{ 
                    color: '#fff', 
                    backgroundColor: msg.role === 'assistant' ? '#1f1f1f' : '#2b2b2b',
                    padding: '12px 16px',
                    borderRadius: 12,
                    display: 'inline-block'
                  }}>
                    {msg.content}
                  </div>
                </div>
              </Space>
            </List.Item>
          )}
        />
      </div>

      {/* 底部输入框 */}
      <div style={{ 
        padding: '16px 24px',
        backgroundColor: '#1a1a1a',
        borderTop: '1px solid #333'
      }}>
        <ChatInput 
          onSend={handleSend}
          placeholder="输入 / 使用技能..."
        />
      </div>
    </div>
  )
}

export default ChatDemo
