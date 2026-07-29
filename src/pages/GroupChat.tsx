import React, { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Input, Button, Space, Tag, Avatar, List,
  Tabs, Tooltip, message, Spin, Empty, Select,
  Card, Typography, Dropdown
} from 'antd'
import {
  SendOutlined, PlusOutlined, DeleteOutlined,
  RobotOutlined, UserOutlined, TeamOutlined,
  CloseOutlined, EditOutlined, CheckOutlined,
  PaperClipOutlined, PictureOutlined, CodeOutlined,
  FileTextOutlined, ThunderboltOutlined,
  CloudOutlined, DesktopOutlined, InboxOutlined
} from '@ant-design/icons'

const { Text } = Typography
const { TextArea } = Input

interface Participant {
  agentId: string
  model: string
  provider: string
  avatarColor: string
}

interface GroupMessage {
  id: string
  role: 'user' | 'assistant'
  sender: string
  content: string
  model?: string
  provider?: string
  timestamp: string
}

interface GroupSession {
  id: string
  name: string
  participantCount: number
  messageCount: number
  createdAt: string
  updatedAt: string
}

const AGENT_COLORS = ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16']
const DRAFT_KEY = 'group-chat-draft'

const GroupChat: React.FC = () => {
  const [sessions, setSessions] = useState<GroupSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string>('')
  const [sessionName, setSessionName] = useState('群聊')
  // M-04 fix：不在初始化时从 sessionStorage 恢复草稿，避免覆盖已有会话数据
  const [participants, setParticipants] = useState<Participant[]>([
    { agentId: 'Agent-1', model: '', provider: '', avatarColor: AGENT_COLORS[0] }
  ])
  const [draftLoaded, setDraftLoaded] = useState(false)

  // M-04 fix：仅在无 currentSessionId 时加载草稿
  useEffect(() => {
    if (draftLoaded || currentSessionId) return
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY)
      if (draft) {
        const parsed = JSON.parse(draft)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setParticipants(parsed)
        }
      }
    } catch (e) { console.warn('GroupChat error:', e) }
    setDraftLoaded(true)
  }, [currentSessionId, draftLoaded])
  const [messages, setMessages] = useState<GroupMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [mode, setMode] = useState<'sequential' | 'free' | 'all'>('all')
  const [showMention, setShowMention] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionAgent, setMentionAgent] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<any[]>([])
  const [availableAgents, setAvailableAgents] = useState<any[]>([])
  const [editingName, setEditingName] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [attachments, setAttachments] = useState<{ name: string; path: string }[]>([])
  const [filePickMode, setFilePickMode] = useState<'attachment' | 'image' | 'document'>('attachment')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadSessions()
    loadModels()
    loadAgents()
  }, [])

  useEffect(() => {
    if (currentSessionId) loadSessionMessages(currentSessionId)
  }, [currentSessionId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadSessions = async () => {
    try {
      const res = await fetch('/api/group-chat/sessions')
      if (res.ok) setSessions(await res.json())
    } catch (e) { console.warn('GroupChat error:', e) }
  }

  const loadSessionMessages = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/group-chat/sessions/${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
        setParticipants(data.participants || [{ agentId: 'Agent-1', model: '', provider: '', avatarColor: AGENT_COLORS[0] }])
        setSessionName(data.name || '群聊')
      }
    } catch (e) { console.warn('GroupChat error:', e) }
  }

  const loadModels = async () => {
    try {
      const res = await fetch('/api/models')
      if (res.ok) {
        const data = await res.json()
        setAvailableModels(data.models || [])
      }
    } catch (e) { console.warn('GroupChat error:', e) }
  }

  const loadAgents = async () => {
    try {
      const res = await fetch('/api/instances/local/agents')
      if (res.ok) {
        const data = await res.json()
        setAvailableAgents(data.agents || data || [])
      }
    } catch (e) { console.warn('GroupChat error:', e) }
  }

  const getModelLabel = (modelKey: string) => {
    if (!modelKey) return '选择模型'
    const found = availableModels.find(m => m.key === modelKey)
    return found ? found.label : modelKey
  }

  const handleNewSession = async () => {
    try {
      const res = await fetch('/api/group-chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sessionName || '新群聊', participants })
      })
      if (res.ok) {
        const newSession = await res.json()
        setSessions(prev => [newSession, ...prev])
        setCurrentSessionId(newSession.id)
        setMessages([])
        setSessionName('新群聊')
        setAttachments([])
        // 清除草稿，并将当前 participants 保存到新创建的会话
        sessionStorage.removeItem(DRAFT_KEY)
        saveParticipantsToSession(newSession.id, participants)
      }
    } catch (_) { message.error('创建群聊失败') }
  }

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await fetch(`/api/group-chat/sessions/${sessionId}`, { method: 'DELETE' })
      setSessions(sessions.filter(s => s.id !== sessionId))
      if (currentSessionId === sessionId) {
        setCurrentSessionId('')
        setMessages([])
      }
    } catch (_) { message.error('删除失败') }
  }

  const handleAddParticipant = () => {
    const idx = participants.length
    const defaultAgent = availableAgents.length > 0
      ? availableAgents[idx % availableAgents.length]
      : null
    const agentId = defaultAgent?.id || defaultAgent?.name || `Agent-${idx + 1}`
    const updated = [...participants, {
      agentId,
      model: '',
      provider: '',
      avatarColor: AGENT_COLORS[idx % AGENT_COLORS.length]
    }]
    setParticipants(updated)
    saveParticipants(updated)
  }

  const handleRemoveParticipant = (idx: number) => {
    if (participants.length <= 1) {
      message.warning('至少保留一个参与者')
      return
    }
    const updated = participants.filter((_, i) => i !== idx)
    setParticipants(updated)
    saveParticipants(updated)
  }

  const handleParticipantChange = (idx: number, field: string, value: string) => {
    const updated = [...participants]
    if (field === 'model') {
      const parts = value.split('/')
      updated[idx] = { ...updated[idx], model: value, provider: parts[0] }
    } else {
      updated[idx] = { ...updated[idx], [field]: value }
    }
    setParticipants(updated)
    saveParticipants(updated)
  }

  const saveParticipants = async (newParticipants: Participant[]) => {
    // 保存到 sessionStorage 作为草稿/保险
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(newParticipants))
    } catch (e) { console.warn('GroupChat error:', e) }
    if (!currentSessionId) return
    try {
      await fetch(`/api/group-chat/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participants: newParticipants })
      })
    } catch (_) { /* 静默失败，不打断用户操作 */ }
  }

  // 用于新创建会话时保存 participants（此时 currentSessionId 还未更新）
  const saveParticipantsToSession = async (sessionId: string, newParticipants: Participant[]) => {
    try {
      await fetch(`/api/group-chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participants: newParticipants })
      })
    } catch (e) { console.warn('GroupChat error:', e) }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInputValue(val)

    // 检测 @ 提及
    const lastAt = val.lastIndexOf('@')
    if (lastAt !== -1 && (lastAt === 0 || val[lastAt - 1] === ' ')) {
      const afterAt = val.slice(lastAt + 1)
      if (!afterAt.includes(' ')) {
        setShowMention(true)
        setMentionFilter(afterAt)
      } else {
        setShowMention(false)
      }
    } else {
      setShowMention(false)
    }
  }

  const handleMentionSelect = (agentId: string) => {
    setMentionAgent(agentId)
    const lastAt = inputValue.lastIndexOf('@')
    const newVal = inputValue.slice(0, lastAt) + `@${agentId} `
    setInputValue(newVal)
    setShowMention(false)
    inputRef.current?.focus()
  }

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return
    if (participants.length === 0) {
      message.warning('请至少添加一个参与者')
      return
    }

    const hasModel = participants.some(p => p.model)
    if (!hasModel) {
      message.warning('请为至少一个参与者选择模型')
      return
    }

    // 自动创建会话
    let sid = currentSessionId
    if (!sid) {
      try {
        const res = await fetch('/api/group-chat/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: sessionName, participants })
        })
        if (res.ok) {
          const data = await res.json()
          sid = data.id
          setSessions(prev => [data, ...prev])
          setCurrentSessionId(sid)
          sessionStorage.removeItem(DRAFT_KEY)
          saveParticipantsToSession(sid, participants)
        }
      } catch (_) {
        message.error('创建会话失败')
        return
      }
    }

    const msg = inputValue.trim()
    setInputValue('')
    setMentionAgent(null)
    setAttachments([])
    setIsLoading(true)

    const userMsg: GroupMessage = {
      id: Date.now().toString(), role: 'user', sender: 'You',
      content: msg, timestamp: new Date().toISOString()
    }
    setMessages(prev => [...prev, userMsg])

    try {
      const res = await fetch('/api/group-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participants: participants.map(p => ({ agentId: p.agentId, model: p.model, provider: p.provider })),
          message: msg,
          mentionAgent: mentionAgent || undefined,
          mode: mode === 'free' && mentionAgent ? 'free' : mode,
          sessionId: sid
        })
      })

      if (res.ok) {
        const data = await res.json()
        // 过滤掉已经存在的 user 消息
        const newMsgs = data.messages.filter((m: GroupMessage) => m.role === 'assistant')
        setMessages(prev => [...prev, ...newMsgs])
        loadSessions()
      } else {
        const err = await res.json()
        message.error(err.error || '发送失败')
      }
    } catch (e: any) {
      message.error('发送失败: ' + e.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !showMention) {
      e.preventDefault()
      handleSend()
    }
  }

  const saveSessionName = async () => {
    setEditingName(false)
    if (currentSessionId && sessionName) {
      try {
        // M-06 fix：使用 PATCH 写入会话名称，而非仅读取
        await fetch(`/api/group-chat/sessions/${currentSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: sessionName })
        })
      } catch (e) { console.warn('GroupChat error:', e) }
    }
  }

  const filteredParticipants = participants.filter(p =>
    p.agentId.toLowerCase().includes(mentionFilter.toLowerCase())
  )

  const modelOptions = availableModels.length === 0
    ? [{ value: '', label: '暂无可用模型', disabled: true }]
    : [
        { value: '', label: '-- 选择模型 --', disabled: true },
        ...availableModels.map(m => ({
          value: m.key,
          label: `${m.label} ${m.hasApiKey ? '✓' : '(未配置)'}`
        }))
      ]

  const agentOptions = availableAgents.length === 0
    ? [{ value: '', label: '暂无可用 Agent', disabled: true }]
    : availableAgents.map((a: any) => ({
        value: a.id || a.name,
        label: a.name || a.id
      }))

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', background: '#f5f7fa' }}>
      {/* 左侧面板 */}
      <div style={{ width: 300, minWidth: 300, background: '#fff', borderRight: '1px solid #e8e8e8', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
            <TeamOutlined style={{ fontSize: 24, color: '#1890ff', marginRight: 8 }} />
            <span style={{ fontSize: 16, fontWeight: 'bold' }}>多 Agent 群聊</span>
          </div>

          <Button type="primary" icon={<PlusOutlined />} block style={{ marginBottom: 16 }} onClick={handleNewSession}>
            新建群聊
          </Button>

          {/* 群聊列表 */}
          <Tabs defaultActiveKey="sessions" size="small" items={[
            {
              key: 'sessions', label: '群聊列表',
              children: (
                <List
                  dataSource={sessions}
                  locale={{ emptyText: <Empty description="暂无群聊" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                  renderItem={s => (
                    <List.Item
                      style={{
                        padding: 12, borderRadius: 8, cursor: 'pointer',
                        backgroundColor: currentSessionId === s.id ? '#e6f7ff' : 'transparent',
                        marginBottom: 4, border: 'none'
                      }}
                      onClick={() => setCurrentSessionId(s.id)}
                      actions={[
                        <Button type="text" size="small" danger icon={<DeleteOutlined />}
                          onClick={e => { e.stopPropagation(); handleDeleteSession(s.id) }} />
                      ]}
                    >
                      <List.Item.Meta
                        title={<Space><TeamOutlined />{s.name}</Space>}
                        description={
                          <div style={{ fontSize: 12, color: '#999' }}>
                            {s.participantCount} 人 · {s.messageCount} 条消息
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
              )
            },
            {
              key: 'config', label: '配置',
              children: (
                <div>
                  {/* 群聊名称 */}
                  <div style={{ marginBottom: 16 }}>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>群聊名称</Text>
                    {editingName ? (
                      <Input
                        value={sessionName}
                        onChange={e => setSessionName(e.target.value)}
                        onPressEnter={saveSessionName}
                        onBlur={saveSessionName}
                        suffix={<CheckOutlined style={{ color: '#52c41a' }} />}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ flex: 1 }}>{sessionName}</span>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingName(true)} />
                      </div>
                    )}
                  </div>

                  {/* 会话模式 */}
                  <div style={{ marginBottom: 16 }}>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>会话模式</Text>
                    <Select
                      value={mode}
                      onChange={setMode}
                      style={{ width: '100%' }}
                      options={[
                        { value: 'all', label: '全员发言 - 所有 Agent 都回复' },
                        { value: 'sequential', label: '轮流发言 - 依次回复' },
                        { value: 'free', label: '自由发言 - 仅 @ 的 Agent 回复' }
                      ]}
                    />
                  </div>

                  {/* 参与者列表 */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Text strong>参与者</Text>
                      <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={handleAddParticipant}>
                        添加
                      </Button>
                    </div>
                    {participants.map((p, idx) => (
                      <Card size="small" key={idx} style={{ marginBottom: 8 }}
                        title={
                          <Space>
                            <Avatar size="small" style={{ backgroundColor: p.avatarColor }}>
                              {p.agentId.charAt(0)}
                            </Avatar>
                            <Select
                              size="small"
                              value={p.agentId || undefined}
                              onChange={v => handleParticipantChange(idx, 'agentId', v)}
                              style={{ width: 130 }}
                              placeholder="选择 Agent"
                              options={agentOptions}
                              showSearch
                              optionFilterProp="label"
                            />
                          </Space>
                        }
                        extra={
                          <Button type="text" size="small" danger icon={<CloseOutlined />}
                            onClick={() => handleRemoveParticipant(idx)} />
                        }
                      >
                        <Select
                          size="small"
                          style={{ width: '100%' }}
                          value={p.model || undefined}
                          onChange={v => handleParticipantChange(idx, 'model', v)}
                          options={modelOptions}
                          placeholder="选择模型"
                        />
                      </Card>
                    ))}
                  </div>
                </div>
              )
            }
          ]} />
        </div>
      </div>

      {/* 右侧聊天区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 头部 */}
        <div style={{
          background: '#fff', borderBottom: '1px solid #e8e8e8',
          padding: '0 16px', height: 48, lineHeight: '48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <Space>
            <TeamOutlined style={{ color: '#1890ff' }} />
            <span style={{ fontSize: 16, fontWeight: 500 }}>{sessionName}</span>
            <Tag>{mode === 'all' ? '全员' : mode === 'sequential' ? '轮流' : '自由'}</Tag>
            <Tag color="blue">{participants.length} 人</Tag>
          </Space>
          <Space>
            {participants.slice(0, 4).map((p, i) => (
              <Tooltip key={i} title={`${p.agentId} · ${getModelLabel(p.model)}`}>
                <Avatar size="small" style={{ backgroundColor: p.avatarColor }}>
                  {p.agentId.charAt(0)}
                </Avatar>
              </Tooltip>
            ))}
            {participants.length > 4 && <Text type="secondary">+{participants.length - 4}</Text>}
          </Space>
        </div>

        {/* 消息区 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px', background: '#f5f7fa' }}>
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            {messages.length === 0 ? (
              <Empty description="暂无消息，开始群聊吧" style={{ marginTop: 80 }}>
                <Text type="secondary">在输入框中使用 @ 可以指定某个 Agent 回复</Text>
              </Empty>
            ) : (
              messages.map(msg => {
                const isUser = msg.sender === 'You'
                const participant = participants.find(p => p.agentId === msg.sender)
                const color = participant?.avatarColor || '#1890ff'
                return (
                  <div key={msg.id} style={{ marginBottom: 12, display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row' }}>
                    <Avatar
                      size="large"
                      icon={isUser ? <UserOutlined /> : <RobotOutlined />}
                      style={{
                        backgroundColor: isUser ? '#52c41a' : color,
                        marginRight: isUser ? 0 : 8,
                        marginLeft: isUser ? 8 : 0,
                        flexShrink: 0
                      }}
                    />
                    <div style={{ maxWidth: '55%', minWidth: 'fit-content' }}>
                      <div style={{
                        fontSize: 12, color: '#999', marginBottom: 2,
                        textAlign: isUser ? 'right' : 'left'
                      }}>
                        {isUser ? '我' : (
                          <Space size={4}>
                            <span style={{ fontWeight: 600, color: color }}>{msg.sender}</span>
                            {msg.model && <Tag style={{ fontSize: 12, lineHeight: '16px' }}>{getModelLabel(msg.model)}</Tag>}
                          </Space>
                        )}
                      </div>
                      <div style={{
                        backgroundColor: isUser ? '#1890ff' : '#fff',
                        color: isUser ? '#fff' : '#333',
                        padding: '8px 12px', borderRadius: 10,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                        fontSize: 12, lineHeight: 1.45,
                        whiteSpace: isUser ? 'pre-wrap' : 'normal'
                      }}>
                        {isUser ? msg.content : (
                          <div className="markdown-content" style={{ lineHeight: 1.6 }}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                      <div style={{
                        marginTop: 4, fontSize: 12, color: '#bbb',
                        textAlign: isUser ? 'right' : 'left'
                      }}>
                        {new Date(msg.timestamp).toLocaleTimeString('zh-CN')}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            {isLoading && (
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <Avatar size="large" icon={<RobotOutlined />} style={{ backgroundColor: '#1890ff', marginRight: 8 }} />
                <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 10 }}>
                  <Spin size="small" /> <Text type="secondary">Agent 正在回复...</Text>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 输入区 */}
        <div
          style={{
            padding: '8px 0', background: '#fff', borderTop: '1px solid #e8e8e8', position: 'relative',
            ...(isDragOver ? { border: '2px dashed #1890ff', background: '#e6f7ff' } : {})
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOver(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOver(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOver(false)
            const files = e.dataTransfer.files
            if (files.length > 0) {
              const newAttachments: { name: string; path: string }[] = []
              for (let i = 0; i < files.length; i++) {
                const file = files[i]
                newAttachments.push({ name: file.name, path: (file as any).path || file.name })
              }
              setAttachments(prev => [...prev, ...newAttachments])
            }
          }}
        >
          <div style={{ maxWidth: '100%', padding: '0 12px' }}>
            {/* 附件列表 */}
            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {attachments.map((att, i) => (
                  <Tag key={i} closable onClose={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}>
                    {att.name.length > 20 ? att.name.slice(0, 20) + '...' : att.name}
                  </Tag>
                ))}
              </div>
            )}

            {/* @ 提及弹窗 */}
            {showMention && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 16,
                background: '#fff', border: '1px solid #d9d9d9', borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 200, overflow: 'auto',
                width: 200, zIndex: 10
              }}>
                {filteredParticipants.length === 0 ? (
                  <div style={{ padding: '8px 12px', color: '#999', fontSize: 14 }}>无匹配参与者</div>
                ) : (
                  filteredParticipants.map((p, i) => (
                    <div
                      key={i}
                      style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseDown={e => { e.preventDefault(); handleMentionSelect(p.agentId) }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f0f7ff')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Avatar size="small" style={{ backgroundColor: p.avatarColor }}>
                        {p.agentId.charAt(0)}
                      </Avatar>
                      <div>
                        <div style={{ fontSize: 14 }}>{p.agentId}</div>
                        <div style={{ fontSize: 12, color: '#999' }}>{getModelLabel(p.model) || '未选择模型'}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* 工具栏 */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                accept={
                  filePickMode === 'image' ? 'image/*' :
                  filePickMode === 'document' ? '.pdf,.doc,.docx,.txt,.md' : '*'
                }
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (filePickMode === 'image') {
                    setInputValue(prev => prev + `[图片: ${file.name}]`)
                  } else if (filePickMode === 'document') {
                    setInputValue(prev => prev + `[文档: ${file.name}]`)
                  } else {
                    setAttachments(prev => [...prev, { name: file.name, path: (file as any).path || file.name }])
                  }
                  e.target.value = ''
                }}
              />
              <Space size={4}>
                <Tooltip title="附件">
                  <Button type="text" size="small" icon={<PaperClipOutlined />} onClick={() => {
                    setFilePickMode('attachment')
                    fileInputRef.current?.click()
                  }} />
                </Tooltip>
                <Tooltip title="图片">
                  <Button type="text" size="small" icon={<PictureOutlined />} onClick={() => {
                    setFilePickMode('image')
                    fileInputRef.current?.click()
                  }} />
                </Tooltip>
                <Tooltip title="代码块">
                  <Button type="text" size="small" icon={<CodeOutlined />} onClick={() => {
                    setInputValue(prev => prev + '\n```\n\n```\n')
                  }} />
                </Tooltip>
                <Tooltip title="文档">
                  <Button type="text" size="small" icon={<FileTextOutlined />} onClick={() => {
                    setFilePickMode('document')
                    fileInputRef.current?.click()
                  }} />
                </Tooltip>
                <Dropdown
                  menu={{
                    items: [
                      { key: 'feishu', label: '打开飞书', icon: <CloudOutlined /> },
                      { key: 'wechat', label: '打开微信', icon: <RobotOutlined /> },
                      { key: 'chrome', label: '打开 Chrome', icon: <DesktopOutlined /> },
                      { key: 'vscode', label: '打开 VS Code', icon: <CodeOutlined /> },
                      { type: 'divider' },
                      { key: 'weather', label: '查询天气', icon: <ThunderboltOutlined /> },
                    ],
                    onClick: async ({ key }) => {
                      if (key === 'weather') {
                        try {
                          const response = await fetch('/api/instances/local/skills/weather/execute', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ params: '北京' })
                          })
                          const result = await response.json()
                          if (result.success) {
                            setInputValue(result.output || '')
                            message.success('已获取天气信息')
                          } else {
                            message.error(result.error || '获取失败')
                          }
                        } catch (_: any) {
                          message.error('调用失败')
                        }
                      } else {
                        try {
                          const response = await fetch(`/api/instances/local/apps/${key}/open`, {
                            method: 'POST'
                          })
                          const result = await response.json()
                          if (result.success) {
                            message.success(`已打开 ${key}`)
                          } else {
                            message.error(result.error || '打开失败')
                          }
                        } catch (_: any) {
                          message.error('调用失败')
                        }
                      }
                    }
                  }}
                >
                  <Tooltip title="Skills">
                    <Button type="text" size="small" icon={<ThunderboltOutlined />} />
                  </Tooltip>
                </Dropdown>
              </Space>
              {mentionAgent && (
                <Tag closable onClose={() => setMentionAgent(null)} style={{ marginLeft: 8 }}>
                  @{mentionAgent}
                </Tag>
              )}
              {isDragOver && (
                <div style={{ flex: 1, textAlign: 'center', color: '#1890ff', fontSize: 14 }}>
                  <InboxOutlined style={{ marginRight: 4 }} /> 释放文件以添加附件
                </div>
              )}
            </div>

            {/* 输入框 */}
            <div style={{ border: '1px solid #d9d9d9', borderRadius: 10, padding: '8px 12px', background: '#fafafa' }}>
              <TextArea
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={mode === 'free' ? "输入消息，使用 @ 指定 Agent..." : "输入群聊消息..."}
                autoSize={{ minRows: 1, maxRows: 3 }}
                bordered={false}
                disabled={isLoading}
                style={{ background: 'transparent', fontSize: 14, resize: 'none' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 6, borderTop: '1px solid #f0f0f0' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>输入 @ 提及 Agent · Enter 发送</Text>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleSend}
                  loading={isLoading}
                  disabled={!inputValue.trim() || isLoading}
                  style={{ borderRadius: 8 }}
                >
                  发送
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GroupChat
