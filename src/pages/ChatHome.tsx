import React, { useState, useRef, useEffect } from 'react'
import { 
  Layout, 
  Input, 
  Button, 
  Space, 
  Dropdown, 
  Tag, 
  Avatar, 
  List,
  Tabs,
  Tooltip
} from 'antd'
import {
  SendOutlined,
  PaperClipOutlined,
  PictureOutlined,
  CodeOutlined,
  FileTextOutlined,
  DownOutlined,
  PlusOutlined,
  SearchOutlined,
  MoreOutlined,
  RobotOutlined,
  UserOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  EditOutlined,
  MessageOutlined,
  StarOutlined,
  DeleteOutlined
} from '@ant-design/icons'

const { Sider, Content, Header } = Layout
const { TextArea } = Input

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  timestamp: string
  isTask?: boolean
}

interface Session {
  id: string
  title: string
  model: string
  lastMessage: string
  timestamp: string
  isFavorite?: boolean
}

interface Model {
  id: string
  name: string
  provider: string
  icon: React.ReactNode
}

const ChatHome: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([
    { id: '1', title: '测试', model: 'xiaomimimo-2.5-pro', lastMessage: '生成图片：一张蓝天白云的风景图', timestamp: '10:30', isFavorite: false },
    { id: '2', title: '测试2', model: 'qwen-3.6-plus', lastMessage: '{"impact": {"skillCode": "media.image.generate"...', timestamp: '09:25', isFavorite: true },
    { id: '3', title: '代码生成', model: 'step-alpha', lastMessage: '帮我写一个React组件', timestamp: '昨天' },
  ])
  
  const [currentSession, setCurrentSession] = useState<string>('2')
  const [inputValue, setInputValue] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>('qwen-3.6-plus')
  const [mode, setMode] = useState<string>('auto')
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: '你好！我是 OpenClaw 助手。我可以帮你生成图片、代码、文档等。', timestamp: '09:20', model: 'qwen-3.6-plus' },
    { id: '2', role: 'user', content: '生成图片：一张蓝天白云的风景图', timestamp: '09:25' },
    { id: '3', role: 'assistant', content: '{\n  "impact": {\n    "skillCode": "media.image.generate",\n    "objectName": "生成图片：一张蓝天白云的风景图",\n    "objectType": "skill_run"\n  },\n  "payload": {\n    "title": "生成图片：一张蓝天白云的风景图",\n    "payload": {\n      "size": "1024x1024",\n      "count": 1\n    }\n  }\n}', timestamp: '09:25', isTask: true, model: 'qwen-3.6-plus' },
  ])
  const [searchText, setSearchText] = useState('')
  const [activeTab, setActiveTab] = useState('all')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const models: Model[] = [
    { id: 'step-alpha', name: 'Step-Alpha', provider: '阶跃星辰', icon: <RobotOutlined /> },
    { id: 'qwen-3.6-plus', name: '千问全能(3.6)', provider: '阿里云', icon: <ThunderboltOutlined /> },
    { id: 'xiaomimimo-2.5-pro', name: 'xiaomimimo-2.5-pro', provider: 'OpenClaw', icon: <ToolOutlined /> },
    { id: 'glm-4', name: 'GLM-4', provider: '智谱AI', icon: <RobotOutlined /> },
    { id: 'doubao-pro', name: '豆包Pro', provider: '火山引擎', icon: <RobotOutlined /> },
  ]

  const modes = [
    { key: 'auto', label: '自动', desc: '智能选择最佳处理方式' },
    { key: 'generate', label: '直接生成', desc: '直接生成回答' },
    { key: 'task', label: '转为任务', desc: '创建结构化任务' },
    { key: 'skill', label: '调用 Skill', desc: '使用特定技能处理' },
    { key: 'draft', label: '流程草稿', desc: '生成可编辑的草稿' },
  ]

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = () => {
    if (!inputValue.trim()) return

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }

    setMessages([...messages, newMessage])
    setInputValue('')

    // 模拟回复
    setTimeout(() => {
      const reply: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: mode === 'task' 
          ? '{\n  "task": {\n    "type": "' + mode + '",\n    "content": "' + inputValue + '"\n  }\n}'
          : '收到：' + inputValue,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        model: selectedModel,
        isTask: mode === 'task'
      }
      setMessages(prev => [...prev, reply])
    }, 1000)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const filteredSessions = sessions.filter(s => 
    s.title.toLowerCase().includes(searchText.toLowerCase()) ||
    s.lastMessage.toLowerCase().includes(searchText.toLowerCase())
  )

  const currentModel = models.find(m => m.id === selectedModel)

  return (
    <Layout style={{ height: '100vh', background: '#f5f7fa' }}>
      {/* 左侧边栏 */}
      <Sider 
        width={280} 
        style={{ 
          background: '#fff', 
          borderRight: '1px solid #e8e8e8',
          overflow: 'auto'
        }}
      >
        <div style={{ padding: '16px' }}>
          {/* 标题 */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
            <RobotOutlined style={{ fontSize: 24, color: '#1890ff', marginRight: 8 }} />
            <span style={{ fontSize: 18, fontWeight: 'bold' }}>AI Chat</span>
            <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>智能体对话</span>
          </div>

          {/* 新建会话按钮 */}
          <Button 
            type="primary" 
            icon={<PlusOutlined />} 
            block 
            style={{ marginBottom: 16 }}
          >
            新建会话
          </Button>

          {/* 搜索 */}
          <Input
            placeholder="搜索会话"
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ marginBottom: 16 }}
          />

          {/* 标签页 */}
          <Tabs 
            activeKey={activeTab} 
            onChange={setActiveTab}
            style={{ marginBottom: 8 }}
            size="small"
          >
            <Tabs.TabPane tab="全部" key="all" />
            <Tabs.TabPane tab="我的" key="mine" />
            <Tabs.TabPane tab="共享" key="shared" />
            <Tabs.TabPane tab="收藏" key="fav" />
          </Tabs>

          {/* 会话列表 */}
          <List
            dataSource={filteredSessions}
            renderItem={session => (
              <List.Item
                style={{
                  padding: '12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  backgroundColor: currentSession === session.id ? '#e6f7ff' : 'transparent',
                  marginBottom: 8
                }}
                onClick={() => setCurrentSession(session.id)}
                actions={[
                  <Tooltip title={session.isFavorite ? '取消收藏' : '收藏'}>
                    <Button
                      type="text"
                      size="small"
                      icon={<StarOutlined style={{ color: session.isFavorite ? '#faad14' : '#999' }} />}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSessions(sessions.map(s => 
                          s.id === session.id ? { ...s, isFavorite: !s.isFavorite } : s
                        ))
                      }}
                    />
                  </Tooltip>,
                  <Tooltip title="删除">
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSessions(sessions.filter(s => s.id !== session.id))
                      }}
                    />
                  </Tooltip>
                ]}
              >
                <List.Item.Meta
                  title={
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{ fontWeight: 500 }}>{session.title}</span>
                      {session.isFavorite && <StarOutlined style={{ color: '#faad14', marginLeft: 4, fontSize: 12 }} />}
                    </div>
                  }
                  description={
                    <div>
                      <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                        {session.model}
                      </div>
                      <div style={{ fontSize: 12, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {session.lastMessage}
                      </div>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        </div>
      </Sider>

      {/* 主内容区 */}
      <Layout>
        {/* 顶部栏 */}
        <Header style={{ 
          background: '#fff', 
          borderBottom: '1px solid #e8e8e8',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 16, fontWeight: 500, marginRight: 16 }}>
              {sessions.find(s => s.id === currentSession)?.title || '新会话'}
            </span>
            <EditOutlined style={{ color: '#999', cursor: 'pointer' }} />
          </div>

          <Space>
            {/* 模型选择 */}
            <Dropdown
              overlay={
                <div style={{ width: 280, background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', padding: 8 }}>
                  <div style={{ fontSize: 12, color: '#999', padding: '8px 12px' }}>选择模型</div>
                  {models.map(model => (
                    <div
                      key={model.id}
                      style={{
                        padding: '10px 12px',
                        cursor: 'pointer',
                        borderRadius: 6,
                        backgroundColor: selectedModel === model.id ? '#e6f7ff' : 'transparent',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      onClick={() => setSelectedModel(model.id)}
                    >
                      <Avatar size="small" style={{ backgroundColor: '#1890ff', marginRight: 8 }}>
                        {model.icon}
                      </Avatar>
                      <div>
                        <div style={{ fontWeight: 500 }}>{model.name}</div>
                        <div style={{ fontSize: 12, color: '#999' }}>{model.provider}</div>
                      </div>
                    </div>
                  ))}
                </div>
              }
              trigger={['click']}
            >
              <Button type="text">
                <Space>
                  <Avatar size="small" style={{ backgroundColor: '#1890ff' }}>
                    {currentModel?.icon}
                  </Avatar>
                  <span>{currentModel?.name}</span>
                  <span style={{ color: '#999' }}>· {currentModel?.provider}</span>
                  <Tag color="green">free_chat</Tag>
                  <DownOutlined />
                </Space>
              </Button>
            </Dropdown>

            <Button type="text" icon={<MessageOutlined />}>上下文</Button>
            <Button type="text" icon={<ToolOutlined />}>Action 记录</Button>
            <Button type="text" icon={<StarOutlined />} />
            <Button type="text" icon={<MoreOutlined />} />
          </Space>
        </Header>

        {/* 消息区域 */}
        <Content style={{ 
          flex: 1, 
          overflow: 'auto', 
          padding: '24px',
          background: '#f5f7fa'
        }}>
          {/* 上下文信息 */}
          <div style={{ marginBottom: 16 }}>
            <Space>
              <Tag icon={<MessageOutlined />}>上下文: 无绑定上下文</Tag>
              <Tag>7 轮消息</Tag>
              <Tag>2 个成果物</Tag>
              <Tag>0 个待确认 Action</Tag>
            </Space>
          </div>

          {/* 消息列表 */}
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {messages.map(msg => (
              <div
                key={msg.id}
                style={{
                  marginBottom: 24,
                  display: 'flex',
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                }}
              >
                <Avatar
                  size="large"
                  icon={msg.role === 'assistant' ? <RobotOutlined /> : <UserOutlined />}
                  style={{
                    backgroundColor: msg.role === 'assistant' ? '#1890ff' : '#52c41a',
                    marginRight: msg.role === 'user' ? 0 : 12,
                    marginLeft: msg.role === 'user' ? 12 : 0,
                  }}
                />
                <div style={{ flex: 1, maxWidth: '80%' }}>
                  <div style={{ 
                    backgroundColor: msg.role === 'assistant' ? '#fff' : '#1890ff',
                    color: msg.role === 'assistant' ? '#333' : '#fff',
                    padding: '16px 20px',
                    borderRadius: 12,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    fontSize: 14,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap'
                  }}>
                    {msg.content}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: '#999', textAlign: msg.role === 'user' ? 'right' : 'left' }}>
                    {msg.timestamp} {msg.model && `· ${msg.model}`}
                  </div>
                  
                  {msg.isTask && (
                    <Space style={{ marginTop: 8 }}>
                      <Button type="default" size="small" icon={<FileTextOutlined />}>复制 JSON</Button>
                      <Button type="primary" size="small" icon={<ToolOutlined />}>打开任务</Button>
                    </Space>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </Content>

        {/* 底部输入区 */}
        <div style={{ 
          padding: '16px 24px',
          background: '#fff',
          borderTop: '1px solid #e8e8e8'
        }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {/* 模式选择 */}
            <Tabs
              activeKey={mode}
              onChange={setMode}
              style={{ marginBottom: 12 }}
              size="small"
              tabBarExtraContent={
                <Button type="text" size="small">
                  选择能力 <DownOutlined />
                </Button>
              }
            >
              {modes.map(m => (
                <Tabs.TabPane 
                  tab={m.label} 
                  key={m.key}
                />
              ))}
            </Tabs>

            {/* 输入框 */}
            <div style={{
              border: '1px solid #d9d9d9',
              borderRadius: 12,
              padding: '12px 16px',
              background: '#fafafa'
            }}>
              <TextArea
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="和智能体对话，或直接要求当前 Agent 生成图片、代码、文档、JSON 草稿"
                autoSize={{ minRows: 3, maxRows: 6 }}
                bordered={false}
                style={{ 
                  background: 'transparent',
                  fontSize: 14,
                  resize: 'none'
                }}
              />
              
              {/* 工具栏 */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px solid #f0f0f0'
              }}>
                <Space>
                  <Tooltip title="附件">
                    <Button type="text" icon={<PaperClipOutlined />} />
                  </Tooltip>
                  <Tooltip title="图片">
                    <Button type="text" icon={<PictureOutlined />} />
                  </Tooltip>
                  <Tooltip title="代码">
                    <Button type="text" icon={<CodeOutlined />} />
                  </Tooltip>
                  <Tooltip title="文档">
                    <Button type="text" icon={<FileTextOutlined />} />
                  </Tooltip>
                  <Tooltip title="更多">
                    <Button type="text" icon={<ToolOutlined />} />
                  </Tooltip>
                </Space>

                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  style={{
                    borderRadius: 8,
                    backgroundColor: inputValue.trim() ? '#1890ff' : '#bfbfbf'
                  }}
                >
                  发送
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Layout>
    </Layout>
  )
}

export default ChatHome
