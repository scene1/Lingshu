import React, { useState, useRef, useEffect, useCallback } from 'react'
import { 
  Layout, 
  Input, 
  Button, 
  Space, 
  Tag, 
  Avatar, 
  List,
  Tabs,
  Tooltip,
  message,
  Spin,
  Modal,
  Dropdown
} from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  SendOutlined,
  PaperClipOutlined,
  PictureOutlined,
  CodeOutlined,
  FileTextOutlined,
  PlusOutlined,
  SearchOutlined,
  MoreOutlined,
  RobotOutlined,
  UserOutlined,
  EditOutlined,
  StarOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  CloudOutlined,
  DesktopOutlined,
  StopOutlined
} from '@ant-design/icons'

const { Sider, Content, Header } = Layout
const { TextArea } = Input

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  timestamp: string
}

interface Session {
  id: string
  title: string
  model: string
  lastMessage: string
  timestamp: string
  messageCount: number
  isFavorite?: boolean
}

const MODEL_STORAGE_KEY = 'openclaw-selected-model'

// 安全的 JSON 解析，当响应不是 JSON 时给出友好错误
async function safeJson(response: Response) {
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`请求失败 (${response.status}): ${text.substring(0, 100)}`)
  }
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '')
    throw new Error(`服务器返回了非 JSON 响应: ${text.substring(0, 100)}`)
  }
  return response.json()
}

const RealChat: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string>('')
  const [currentInstanceId, _setCurrentInstanceId] = useState<string>('local') // 默认使用本地实例
  const [currentModel, setCurrentModel] = useState<string>(() => {
    try {
      return localStorage.getItem(MODEL_STORAGE_KEY) || ''
    } catch { return '' }
  })
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [searchText, setSearchText] = useState('')
  const [activeTab, setActiveTab] = useState('all')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [modelList, setModelList] = useState<{ key: string; label: string; provider?: string; providerName?: string }[]>([])
  const [filePickMode, setFilePickMode] = useState<'attachment' | 'image' | 'document'>('attachment')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 加载会话列表（用 useCallback 避免闭包过期）
  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true)
    try {
      const response = await fetch(`/api/instances/${currentInstanceId}/sessions`)
      if (response.ok) {
        const data = await response.json()
        setSessions(Array.isArray(data) ? data : data.sessions || [])
      }
    } catch (error) {
      console.error('加载会话失败:', error)
    } finally {
      setIsLoadingSessions(false)
    }
  }, [currentInstanceId])

  // 加载单个会话的消息
  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/instances/${currentInstanceId}/sessions/${sessionId}`)
      if (response.ok) {
        const data = await response.json()
        setMessages(data.messages || [])
      }
    } catch (error) {
      console.error('加载消息失败:', error)
    }
  }, [currentInstanceId])

  // 初始化加载
  useEffect(() => {
    loadSessions()
    loadModels()
  }, [loadSessions])

  // 加载可用模型列表
  const loadModels = async () => {
    try {
      const response = await fetch('/api/models')
      if (response.ok) {
        const data = await response.json()
        if (data.models) {
          setModelList(data.models.map((m: any) => ({ 
            key: m.key, 
            label: m.label,
            provider: m.provider,
            providerName: m.providerName,
          })))
          // 优先恢复 localStorage 中的选择
          const savedModel = (() => { try { return localStorage.getItem(MODEL_STORAGE_KEY) } catch { return null } })()
          const savedModelExists = savedModel && data.models.some((m: any) => m.key === savedModel)
          if (savedModelExists) {
            setCurrentModel(savedModel)
          } else if (data.models.length > 0) {
            // 保存的模型已不可用或从未选择过，使用第一个可用模型
            setCurrentModel(data.models[0].key)
            if (savedModel && !savedModelExists) {
              console.warn(`已保存的模型 "${savedModel}" 不再可用，已自动切换到 "${data.models[0].key}"`)
            }
          }
        }
      }
    } catch (error) {
      console.error('加载模型列表失败:', error)
    }
  }

  // 切换会话时加载消息
  useEffect(() => {
    if (currentSessionId) {
      loadSessionMessages(currentSessionId)
    }
  }, [currentSessionId, loadSessionMessages])

  const currentSession = sessions.find(s => s.id === currentSessionId)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // 发送消息
  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return

    // 如果没有当前会话，创建一个新会话
    let sessionId = currentSessionId
    if (!sessionId) {
      try {
        const response = await fetch(`/api/instances/${currentInstanceId}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: inputValue.substring(0, 20) })
        })
        if (response.ok) {
          const newSession = await response.json()
          sessionId = newSession.id
          setCurrentSessionId(sessionId)
          setSessions([newSession, ...sessions])
        }
      } catch (error) {
        message.error('创建会话失败')
        return
      }
    }

    // 解析快捷命令
    const commandPatterns = [
      { pattern: /^打开(飞书|lark)$/i, action: 'feishu', type: 'app' },
      { pattern: /^打开(微信|wechat)$/i, action: 'wechat', type: 'app' },
      { pattern: /^打开(chrome|谷歌浏览器)$/i, action: 'chrome', type: 'app' },
      { pattern: /^打开(vscode|code|visual studio code)$/i, action: 'vscode', type: 'app' },
      { pattern: /^打开(终端|terminal)$/i, action: 'terminal', type: 'app' },
    ]
    
    const matchedCommand = commandPatterns.find(cmd => cmd.pattern.test(inputValue.trim()))
    
    if (matchedCommand) {
      // 执行命令
      setInputValue('')
      setIsLoading(true)
      
      try {
        if (matchedCommand.type === 'app') {
          const response = await fetch(`/api/instances/${currentInstanceId}/apps/${matchedCommand.action}/open`, {
            method: 'POST'
          })
          const result = await response.json()
          
          const systemMessage: Message = {
            id: Date.now().toString(),
            role: 'assistant',
            content: result.success 
              ? `✅ 已打开 ${matchedCommand.action}` 
              : `❌ 打开失败: ${result.error || '未知错误'}`,
            timestamp: new Date().toISOString(),
            model: 'system'
          }
          setMessages(prev => [...prev, systemMessage])
        }
      } catch (error: any) {
        message.error('执行命令失败: ' + error.message)
      } finally {
        setIsLoading(false)
      }
      return
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const response = await fetch(`/api/instances/${currentInstanceId}/sessions/${sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: inputValue,
          model: currentModel // 传递当前选择的模型
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error('API 请求失败')
      }

      const data = await safeJson(response)
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.reply,
        timestamp: data.timestamp,
        model: data.model || 'step-alpha'
      }

      setMessages(prev => [...prev, assistantMessage])
      
      // 刷新会话列表
      loadSessions()
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        message.error('发送失败，请重试')
      }
    } finally {
      abortControllerRef.current = null
      setIsLoading(false)
    }
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsLoading(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 粘贴图片处理（currentInstanceId 是常量 'local'，不需要在依赖中）
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        
        try {
          const formData = new FormData()
          formData.append('file', file)
          const response = await fetch(`/api/instances/local/files/upload`, {
            method: 'POST',
            body: formData
          })
          if (response.ok) {
            const data = await response.json()
            setInputValue(prev => prev + `![image](${data.url || data.filePath})\n`)
            message.success('图片已上传')
          } else {
            message.error('图片上传失败')
          }
        } catch (error) {
          message.error('上传失败: ' + (error as Error).message)
        }
        return
      }
    }
  }, [])

  const appendFileReference = async (file: File, mode: typeof filePickMode) => {
    if (mode === 'image') {
      try {
        const formData = new FormData()
        formData.append('file', file)
        const response = await fetch(`/api/instances/${currentInstanceId}/files/upload`, {
          method: 'POST',
          body: formData
        })
        if (response.ok) {
          const data = await response.json()
          setInputValue(prev => `${prev}${prev ? '\n' : ''}![${file.name}](${data.url || data.filePath})\n`)
          message.success('图片已添加')
          return
        }
      } catch (_) {}
      setInputValue(prev => `${prev}${prev ? '\n' : ''}[图片: ${file.name}]\n`)
      message.info('已插入图片引用')
      return
    }

    if (mode === 'document') {
      setInputValue(prev => `${prev}${prev ? '\n' : ''}[文档: ${file.name}]\n`)
      message.success('已插入文档引用')
      return
    }

    setInputValue(prev => `${prev}${prev ? '\n' : ''}[附件: ${file.name}]\n`)
    message.success('已插入附件引用')
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await appendFileReference(file, filePickMode)
    e.target.value = ''
  }

  const handleNewSession = async () => {
    try {
      const response = await fetch(`/api/instances/${currentInstanceId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '新会话' })
      })
      
      if (response.ok) {
        const newSession = await response.json()
        setSessions([newSession, ...sessions])
        setCurrentSessionId(newSession.id)
        setMessages([])
      }
    } catch (error) {
      message.error('创建会话失败')
    }
  }

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await fetch(`/api/instances/${currentInstanceId}/sessions/${sessionId}`, { method: 'DELETE' })
      setSessions(sessions.filter(s => s.id !== sessionId))
      if (currentSessionId === sessionId) {
        setCurrentSessionId('')
        setMessages([])
      }
    } catch (error) {
      message.error('删除会话失败')
    }
  }

  const handleToggleFavorite = async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId)
    if (!session) return
    
    try {
      await fetch(`/api/instances/${currentInstanceId}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite: !session.isFavorite })
      })
      
      setSessions(sessions.map(s => 
        s.id === sessionId ? { ...s, isFavorite: !s.isFavorite } : s
      ))
    } catch (error) {
      message.error('操作失败')
    }
  }

  const handleEditTitle = (session: Session) => {
    setEditingSession(session)
    setNewTitle(session.title)
    setEditModalVisible(true)
  }

  const handleSaveTitle = async () => {
    if (!editingSession || !newTitle.trim()) return
    
    try {
      await fetch(`/api/instances/${currentInstanceId}/sessions/${editingSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() })
      })
      
      setSessions(sessions.map(s => 
        s.id === editingSession.id ? { ...s, title: newTitle.trim() } : s
      ))
      setEditModalVisible(false)
    } catch (error) {
      message.error('修改标题失败')
    }
  }

  const filteredSessions = sessions.filter(s => 
    s.title.toLowerCase().includes(searchText.toLowerCase()) ||
    (s.lastMessage || '').toLowerCase().includes(searchText.toLowerCase())
  )

  const tabSessions = filteredSessions.filter(s => {
    if (activeTab === 'all') return true
    if (activeTab === 'fav') return s.isFavorite
    return true
  })

  const formatTime = (timestamp: string) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    return date.toLocaleDateString('zh-CN')
  }

  return (
    <Layout className="chat-page">
      {/* 左侧边栏 */}
      <Sider width={320} className="chat-sidebar">
        <div className="chat-sidebar-inner">
          <div className="chat-sidebar-title">
            <div className="chat-brand-icon"><RobotOutlined /></div>
            <div>
              <div className="chat-brand-name">OpenClaw Chat</div>
              <div className="chat-brand-meta">{sessions.length} 个会话 · local 实例</div>
            </div>
          </div>

          <Button type="primary" icon={<PlusOutlined />} block className="chat-new-session" onClick={handleNewSession}>
            新建会话
          </Button>

          <Input
            placeholder="搜索标题或消息"
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="chat-search"
          />

          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            className="chat-tabs"
            size="small"
            items={[
              { key: 'all', label: `全部 (${sessions.length})` },
              { key: 'fav', label: `收藏 (${sessions.filter(s => s.isFavorite).length})` },
            ]}
          />

          <Spin spinning={isLoadingSessions}>
            <List
              className="session-list"
              dataSource={tabSessions}
              locale={{ emptyText: searchText ? '没有匹配的会话' : '还没有会话' }}
              renderItem={session => (
                <List.Item
                  className={`session-item ${currentSessionId === session.id ? 'session-item-active' : ''}`}
                  onClick={() => setCurrentSessionId(session.id)}
                  actions={[
                    <Tooltip title={session.isFavorite ? '取消收藏' : '收藏'}>
                      <Button
                        type="text"
                        size="small"
                        icon={<StarOutlined style={{ color: session.isFavorite ? '#faad14' : '#999' }} />}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleToggleFavorite(session.id)
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
                          handleDeleteSession(session.id)
                        }}
                      />
                    </Tooltip>
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <div className="session-title">
                        <span>{session.title}</span>
                        {session.isFavorite && <StarOutlined style={{ color: '#faad14', marginLeft: 4, fontSize: 12 }} />}
                      </div>
                    }
                    description={
                      <div>
                        <div className="session-meta">
                          <Tag color="blue">{session.model}</Tag>
                          <span>{session.messageCount} 条</span>
                          <span>{formatTime(session.timestamp)}</span>
                        </div>
                        <div className="session-preview">
                          {session.lastMessage || '暂无消息'}
                        </div>
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </Spin>
        </div>
      </Sider>

      {/* 主内容区 */}
      <Layout className="chat-main">
        <Header className="chat-header">
          <div className="chat-header-title">
            <span>
              {currentSession?.title || '新会话'}
            </span>
            <Tooltip title={currentSession ? '重命名会话' : '选择会话后可重命名'}>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                disabled={!currentSession}
                onClick={() => currentSession && handleEditTitle(currentSession)}
              />
            </Tooltip>
          </div>

          <Space className="chat-header-actions">
            <Tag icon={<CheckCircleOutlined />} color="success">已连接</Tag>
            <Dropdown
              menu={{
                items: (() => {
                  if (modelList.length === 0) {
                    return [{ key: currentModel, label: currentModel || '未选择模型' }]
                  }
                  // 按供应商分组
                  const groups: Record<string, { provider: string; providerName: string; children: { key: string; label: string }[] }> = {}
                  for (const m of modelList) {
                    const pid = m.provider || 'other'
                    if (!groups[pid]) {
                      groups[pid] = { provider: pid, providerName: m.providerName || pid, children: [] }
                    }
                    groups[pid].children.push({ key: m.key, label: m.label })
                  }
                  // 构建分组菜单项
                  const items: any[] = []
                  for (const g of Object.values(groups)) {
                    items.push({
                      type: 'group',
                      label: g.providerName,
                      children: g.children,
                    })
                  }
                  return items
                })(),
                onClick: ({ key }) => {
                  setCurrentModel(key)
                  try { localStorage.setItem(MODEL_STORAGE_KEY, key) } catch {}
                  message.success(`已切换到 ${key}`)
                }
              }}
            >
              <Tag color="blue" className="model-tag">
                {modelList.find(m => m.key === currentModel)?.label || currentModel || '选择模型'}
              </Tag>
            </Dropdown>
            <Tooltip title="刷新页面">
              <Button type="text" icon={<ReloadOutlined />} onClick={() => window.location.reload()} />
            </Tooltip>
            <Tooltip title="模型配置">
              <Button type="text" icon={<SettingOutlined />} onClick={() => window.open('/model-config', '_blank')} />
            </Tooltip>
            <Tooltip title="更多">
              <Button type="text" icon={<MoreOutlined />} />
            </Tooltip>
          </Space>
        </Header>

        <Content className="chat-messages">
          <div className="chat-message-track">
            {messages.length === 0 ? (
              <div className="chat-empty-state">
                <div className="chat-empty-icon"><RobotOutlined /></div>
                <div className="chat-empty-title">准备开始一个新会话</div>
                <div className="chat-empty-desc">选择模型后直接输入问题，也可以粘贴图片或用下方技能调用本地能力。</div>
                <Space wrap>
                  <Button onClick={() => setInputValue('帮我总结一下 OpenClaw 当前能力')}>总结能力</Button>
                  <Button onClick={() => setInputValue('打开 Chrome')}>打开 Chrome</Button>
                  <Button type="primary" onClick={() => setInputValue('你好！')}>发送第一条消息</Button>
                </Space>
              </div>
            ) : (
              messages.map(msg => (
                <div
                  key={msg.id}
                  className={`message-row ${msg.role === 'user' ? 'message-row-user' : 'message-row-assistant'}`}
                >
                  <Avatar
                    size="large"
                    icon={msg.role === 'assistant' ? <RobotOutlined /> : <UserOutlined />}
                    className={`message-avatar ${msg.role === 'assistant' ? 'message-avatar-assistant' : 'message-avatar-user'}`}
                  />
                  <div className="message-stack">
                    <div className={`message-bubble ${msg.role === 'assistant' ? 'message-bubble-assistant' : 'message-bubble-user'}`}>
                      {msg.role === 'assistant' ? (
                        <div className="markdown-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        msg.content
                      )}
                    </div>
                    <div className="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString('zh-CN')} {msg.model && `· ${msg.model}`}
                    </div>
                  </div>
                </div>
              ))
            )}
            
            {isLoading && (
              <div className="message-row message-row-assistant">
                <Avatar size="large" icon={<RobotOutlined />} className="message-avatar message-avatar-assistant" />
                <div className="typing-bubble">
                  <Spin size="small" />
                  <span>正在思考...</span>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </Content>

        <div className="chat-composer">
          <div className="chat-composer-inner">
            <div className="chat-input-box">
              <TextArea
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="输入消息，粘贴图片，或用下方技能调用本地能力..."
                autoSize={{ minRows: 2, maxRows: 6 }}
                variant="borderless"
                disabled={isLoading}
                className="chat-textarea"
              />
              
              <div className="chat-input-toolbar">
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  accept={
                    filePickMode === 'image' ? 'image/*' :
                    filePickMode === 'document' ? '.pdf,.doc,.docx,.txt,.md,.rtf' : '*'
                  }
                  onChange={handleFileChange}
                />
                <Space>
                  <Tooltip title="附件">
                    <Button type="text" icon={<PaperClipOutlined />} onClick={() => {
                      setFilePickMode('attachment')
                      fileInputRef.current?.click()
                    }} />
                  </Tooltip>
                  <Tooltip title="图片">
                    <Button type="text" icon={<PictureOutlined />} onClick={() => {
                      setFilePickMode('image')
                      fileInputRef.current?.click()
                    }} />
                  </Tooltip>
                  <Tooltip title="代码块">
                    <Button type="text" icon={<CodeOutlined />} onClick={() => {
                      setInputValue(prev => `${prev}${prev ? '\n' : ''}\`\`\`\n\n\`\`\`\n`)
                    }} />
                  </Tooltip>
                  <Tooltip title="文档">
                    <Button type="text" icon={<FileTextOutlined />} onClick={() => {
                      setFilePickMode('document')
                      fileInputRef.current?.click()
                    }} />
                  </Tooltip>
                  
                  {/* 技能按钮 - 调用后端 API */}
                  <Dropdown
                    menu={{
                      items: [
                        { key: 'feishu', label: '打开飞书', icon: <CloudOutlined /> },
                        { key: 'wechat', label: '打开微信', icon: <RobotOutlined /> },
                        { key: 'chrome', label: '打开 Chrome', icon: <DesktopOutlined /> },
                        { key: 'vscode', label: '打开 VS Code', icon: <CodeOutlined /> },
                        { type: 'divider' },
                        { key: 'weather', label: '插入天气查询', icon: <ThunderboltOutlined /> },
                      ],
                      onClick: async ({ key }) => {
                        const instanceId = 'local' // 使用本地实例
                        
                        if (key === 'weather') {
                          setInputValue(prev => `${prev}${prev ? '\n' : ''}请查询北京天气，并给出简洁建议`)
                          message.success('已插入天气查询提示')
                        } else {
                          // 打开本地应用
                          try {
                            const response = await fetch(`/api/instances/${instanceId}/apps/${key}/open`, {
                              method: 'POST'
                            })
                            const result = await safeJson(response)
                            if (result.success) {
                              message.success(`已打开 ${key}`)
                            } else {
                              message.error(result.error || '打开失败')
                            }
                          } catch (error: any) {
                            message.error('调用失败: ' + error.message)
                          }
                        }
                      }
                    }}
                  >
                    <Tooltip title="执行技能">
                      <Button type="text" icon={<ThunderboltOutlined />} />
                    </Tooltip>
                  </Dropdown>
                </Space>

                {isLoading ? (
                  <Button
                    danger
                    icon={<StopOutlined />}
                    onClick={handleStop}
                    style={{ borderRadius: 8 }}
                  >
                    停止
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    onClick={handleSend}
                    disabled={!inputValue.trim()}
                    style={{ borderRadius: 8 }}
                  >
                    发送
                  </Button>
                )}
              </div>
            </div>
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 12, color: '#999' }}>
              按 Enter 发送，Shift + Enter 换行
            </div>
          </div>
        </div>
      </Layout>

      {/* 编辑标题弹窗 */}
      <Modal
        title="修改会话标题"
        open={editModalVisible}
        onOk={handleSaveTitle}
        onCancel={() => setEditModalVisible(false)}
      >
        <Input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          placeholder="输入新标题"
        />
      </Modal>
    </Layout>
  )
}

export default RealChat
