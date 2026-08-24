import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Layout,
  Input,
  Button,
  Space,
  Tag,
  Tooltip,
  message,
  Spin,
  Modal,
  Dropdown
} from 'antd'
import {
  SendOutlined,
  PaperClipOutlined,
  CodeOutlined,
  MoreOutlined,
  RobotOutlined,
  EditOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  CloudOutlined,
  DesktopOutlined,
  StopOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  PictureOutlined,
  CloseOutlined,
  CopyOutlined,
  DownloadOutlined,
  BookOutlined,
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MessageList } from '../components/chat/MessageList'
import { ChatSidebar } from '../components/chat/ChatSidebar'
import { ModelCompare } from '../components/chat/ModelCompare'
import { useChatStore } from '../stores/chatStore'
import type { ArtifactFormat, ChatAttachment, DocumentPreviewPayload, Message, Session, QuickActionType } from '../types'
import { captureScreenshot, onDesktopAction, openExportedFile, openNewChatWindow, readClipboardFiles } from '../utils/electron'
import { writeClipboardText } from '../utils/clipboard'
import { artifactFormatLabel, detectChatArtifact } from '../utils/chatArtifacts'
import { sanitizeAssistantContent } from '../utils/messageSanitizer'

const { Sider, Content, Header } = Layout
const { TextArea } = Input

interface RuntimeInstance {
  id: string
  name: string
  type: string
  appName?: string
  status?: string
}

interface ChatSkill {
  id: string
  name: string
  description?: string
  category?: string
  status?: string
}

interface ChatProject {
  id: string
  name: string
  description?: string
  status?: string
  linkedRepositories?: string[]
  linkedDocuments?: Array<{ title: string }>
  linkedMeetings?: Array<{ title: string }>
  linkedSessions?: Array<{ title: string }>
}

const MODEL_STORAGE_KEY = 'openclaw-selected-model'
const APP_COMMAND_LABELS: Record<string, string> = {
  feishu: '飞书',
  lark: '飞书',
  wechat: '微信',
  chrome: 'Chrome',
  vscode: 'VS Code',
  terminal: '终端',
  finder: 'Finder',
  safari: 'Safari',
  parazta: 'ParaZTA',
  ParaZTA: 'ParaZTA',
}

const APP_COMMAND_ALIASES: Record<string, string> = {
  飞书: 'feishu',
  lark: 'feishu',
  微信: 'wechat',
  wechat: 'wechat',
  chrome: 'chrome',
  谷歌浏览器: 'chrome',
  vscode: 'vscode',
  code: 'vscode',
  'visual studio code': 'vscode',
  终端: 'terminal',
  terminal: 'terminal',
  finder: 'finder',
  访达: 'finder',
  safari: 'safari',
  parazta: 'ParaZTA',
}

function normalizeAppNameFromText(value: string) {
  const clean = value
    .trim()
    .replace(/^["'""'']+|["'""'']+$/g, '')
    .replace(/\s*(应用|app|软件|程序)$/i, '')
    .trim()
  if (!clean) return ''
  return APP_COMMAND_ALIASES[clean.toLowerCase()] || APP_COMMAND_ALIASES[clean] || clean
}

function extractAppOpenCommand(text: string) {
  const clean = text.trim()
  const direct = clean.match(/^打开\s*(.+)$/i)
  if (direct) return normalizeAppNameFromText(direct[1])

  const openByName = clean.match(/open\s+-a\s+["']?([^"'\n`]+)["']?/i)
  if (openByName) return normalizeAppNameFromText(openByName[1])

  const openPath = clean.match(/open\s+(?:["']?)(?:\/Applications\/)?([^"'\n`]+?)(?:\.app)?(?:["']?)(?:\s|$)/i)
  if (openPath) return normalizeAppNameFromText(openPath[1])

  return ''
}

function extractRunnableAppFromAssistant(messages: Message[]) {
  const lastAssistant = [...messages].reverse().find(item => item.role === 'assistant')
  if (!lastAssistant) return ''
  return extractAppOpenCommand(lastAssistant.content)
}

function extractAgentInvocationCommand(text: string, agents: RuntimeInstance[]) {
  const clean = text.trim()
  if (!clean || agents.length === 0) return null
  const prefixMatch = clean.match(/^(调用|让|使用)\s*(.+)$/i)
  if (!prefixMatch) return null
  const rest = prefixMatch[2].trim()
  const candidates = agents
    .flatMap(agent => [agent.name, agent.appName].filter(Boolean).map(name => ({ agent, name: String(name) })))
    .sort((a, b) => b.name.length - a.name.length)
  for (const candidate of candidates) {
    if (!rest.toLowerCase().startsWith(candidate.name.toLowerCase())) continue
    const instruction = rest
      .slice(candidate.name.length)
      .trim()
      .replace(/^(帮我|去|来|执行|处理|打开|做|完成)\s*/i, '')
      .trim()
    return { agent: candidate.agent, instruction: instruction || clean }
  }
  return null
}

function compactFileName(name: string, maxLength = 42) {
  const value = String(name || '未命名附件')
  if (value.length <= maxLength) return value
  const dotIndex = value.lastIndexOf('.')
  const ext = dotIndex > 0 ? value.slice(dotIndex) : ''
  const base = dotIndex > 0 ? value.slice(0, dotIndex) : value
  const keep = Math.max(12, maxLength - ext.length - 3)
  return `${base.slice(0, keep)}...${ext}`
}

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
  // ---- chatStore 状态（对比模式、流式、快速操作等） ----
  const {
    sessions,
    currentSessionId,
    messages,
    isStreaming,
    compareMode,
    loadingAction,
    selectedModel,
    setSelectedModel,
    setCompareMode,
    sendMessage: chatStoreSendMessage,
    respondToApproval,
    executeQuickAction,
    undoToTurn,
    branchFromMessage,
    initRuntime,
    setMessages,
    setSessions,
    setCurrentSession: setCurrentSessionId,
  } = useChatStore()

  // ---- 本地 UI 状态（会话与消息事实源由 chatStore 托管） ----
  const [currentInstanceId] = useState<string>('local')
  const [agentDesktopInstances, setAgentDesktopInstances] = useState<RuntimeInstance[]>([])
  const [availableSkills, setAvailableSkills] = useState<ChatSkill[]>([])
  const [currentModel, setCurrentModel] = useState<string>(() => {
    try {
      return localStorage.getItem(MODEL_STORAGE_KEY) || ''
    } catch { return '' }
  })
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [modelList, setModelList] = useState<{ key: string; label: string; provider?: string; providerName?: string }[]>([])
  const [filePickMode, setFilePickMode] = useState<'attachment' | 'image' | 'document'>('attachment')
  const [selectedSlashSkillIndex, setSelectedSlashSkillIndex] = useState(0)
  const [selectedSkill, setSelectedSkill] = useState<ChatSkill | null>(null)
  const [projects, setProjects] = useState<ChatProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([])
  const [documentPreview, setDocumentPreview] = useState<DocumentPreviewPayload | null>(null)
  const [exportingPreviewFormat, setExportingPreviewFormat] = useState<ArtifactFormat | null>(null)
  const [modelSwitchNotice, setModelSwitchNotice] = useState<{ key: string; label: string } | null>(null)
  // 对比模式选中的模型
  const [compareSelectedModels, setCompareSelectedModels] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<any>(null)
  const skipNextSessionLoadRef = useRef(false)
  const autoTitleCheckedRef = useRef(false)
  const sessionLoadGenerationRef = useRef(0)
  const activeSessionIdRef = useRef<string | null>(null)
  activeSessionIdRef.current = currentSessionId

  const appendScreenshotReference = useCallback((result: any, source = '截图') => {
    if (!result?.success || !result.url) {
      message.error(result?.error || `${source}失败`)
      return
    }
    setPendingAttachments(prev => [...prev, {
      id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'image',
      name: source,
      url: result.url,
      mimeType: 'image/png',
    }])
    message.success(`${source}已加入本轮上下文`)
  }, [])

  const handlePreviewDocument = useCallback((payload: DocumentPreviewPayload) => {
    setDocumentPreview(payload)
  }, [])

  const handleCopyPreviewDocument = useCallback(async () => {
    if (!documentPreview?.content) return
    try {
      await writeClipboardText(documentPreview.content)
      message.success('已复制文档全文')
    } catch (error: any) {
      message.error(error?.message || '复制失败')
    }
  }, [documentPreview])

  const handleExportPreviewArtifact = useCallback(async (format: ArtifactFormat) => {
    if (!documentPreview?.content.trim()) return
    setExportingPreviewFormat(format)
    try {
      const response = await fetch('/api/chat/export-artifact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: documentPreview.title || '生成的内容',
          content: documentPreview.content,
          format,
        }),
      })
      const result = await response.json()
      if (!response.ok || !result?.url) throw new Error(result?.message || result?.error || '导出失败')
      await openExportedFile(result.path, result.url)
      message.success(`已生成 ${String(format).toUpperCase()} 文件`)
    } catch (error: any) {
      message.error(error.message || '导出失败')
    } finally {
      setExportingPreviewFormat(null)
    }
  }, [documentPreview])

  const handleCaptureScreenshot = useCallback(async () => {
    const hide = message.loading('正在截取屏幕...', 0)
    try {
      const result = await captureScreenshot()
      appendScreenshotReference(result, '截图')
    } catch (error: any) {
      message.error(error.message || '截图失败')
    } finally {
      hide()
    }
  }, [appendScreenshotReference])

  // 加载会话列表（用 useCallback 避免闭包过期）
  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true)
    try {
      const response = await fetch(`/api/instances/${currentInstanceId}/sessions`)
      if (response.ok) {
        const data = await response.json()
        const loadedSessions = Array.isArray(data) ? data : data.sessions || []
        setSessions(loadedSessions)
        if (!autoTitleCheckedRef.current && loadedSessions.length > 0) {
          autoTitleCheckedRef.current = true
          fetch(`/api/instances/${currentInstanceId}/sessions/auto-titles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: false })
          })
            .then(async (autoTitleResponse) => {
              if (!autoTitleResponse.ok) return
              const result = await autoTitleResponse.json()
              if (result.updated > 0) {
                const refreshed = await fetch(`/api/instances/${currentInstanceId}/sessions`)
                if (!refreshed.ok) return
                const refreshedData = await refreshed.json()
                const refreshedSessions = Array.isArray(refreshedData) ? refreshedData : refreshedData.sessions || []
                setSessions(refreshedSessions)
              }
            })
            .catch(error => console.warn('会话智能命名跳过:', error))
        }
      }
    } catch (error) {
      console.error('加载会话失败:', error)
    } finally {
      setIsLoadingSessions(false)
    }
  }, [currentInstanceId, setSessions])

  // 加载单个会话的消息
  const loadSessionMessages = useCallback(async (sessionId: string) => {
    const generation = ++sessionLoadGenerationRef.current
    try {
      const response = await fetch(`/api/instances/${currentInstanceId}/sessions/${sessionId}`)
      if (response.ok) {
        const data = await response.json()
        if (generation !== sessionLoadGenerationRef.current || activeSessionIdRef.current !== sessionId) return
        const loadedMessages = (data.messages || []).map((item: Message) => (
          item.role === 'assistant'
            ? { ...item, content: sanitizeAssistantContent(item.content) }
            : item
        ))
        setMessages(loadedMessages)
        setSelectedProjectId(String(data.projectId || ''))
        // 初始化 chatStore runtime
        initRuntime(sessionId, currentModel || selectedModel)
      }
    } catch (error) {
      console.error('加载消息失败:', error)
    }
  }, [currentInstanceId, currentModel, selectedModel, initRuntime, setMessages])

  // 初始化加载
  useEffect(() => {
    loadSessions()
    loadModels()
    loadAgentDesktopInstances()
    loadSkills()
    loadProjects()
  }, [loadSessions])

  useEffect(() => {
    const cleanup = onDesktopAction(event => {
      if (event.action === 'screenshot-captured') {
        appendScreenshotReference(event.payload, '桌面截图')
      }
    })
    return cleanup
  }, [appendScreenshotReference])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('desktopAction') !== 'screenshot') return
    handleCaptureScreenshot()
    window.history.replaceState({}, '', window.location.pathname || '/')
  }, [handleCaptureScreenshot])

  const loadAgentDesktopInstances = async () => {
    try {
      const response = await fetch('/api/instances')
      if (!response.ok) return
      const data = await response.json()
      setAgentDesktopInstances((Array.isArray(data) ? data : [])
        .filter((item: RuntimeInstance) => item.type === 'agent-desktop' || item.type === 'stepfun-desktop'))
    } catch (error) {
      console.error('加载本机 Agent 失败:', error)
    }
  }

  const loadSkills = async () => {
    try {
      const response = await fetch('/api/skills')
      if (!response.ok) return
      const data = await response.json()
      setAvailableSkills(Array.isArray(data) ? data.filter((skill: ChatSkill) => skill.status !== 'inactive') : [])
    } catch (error) {
      console.error('加载 Skills 失败:', error)
    }
  }

  const loadProjects = async () => {
    try {
      const response = await fetch('/api/projects')
      if (!response.ok) return
      const data = await response.json()
      setProjects(Array.isArray(data.projects) ? data.projects : [])
    } catch (error) {
      console.error('加载项目失败:', error)
    }
  }

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
      if (skipNextSessionLoadRef.current) {
        skipNextSessionLoadRef.current = false
        return
      }
      loadSessionMessages(currentSessionId)
    }
  }, [currentSessionId, loadSessionMessages])

  const currentSession = sessions.find(s => s.id === currentSessionId)
  const selectedProject = projects.find(project => project.id === selectedProjectId)
  const activeModelLabel = modelList.find(m => m.key === currentModel)?.label || currentModel || '未选择模型'
  const archiveState = (() => {
    if (currentSession?.obsidianArchive?.relativePath) {
      return {
        color: 'cyan' as const,
        label: '已归档',
        tooltip: `已同步到灵枢 Vault：${currentSession.obsidianArchive.relativePath}。归档会随会话保存更新；不会默认污染知识库检索，只有明确使用知识库/历史资料时才会引用。`,
      }
    }
    if (currentSession?.obsidianArchiveError?.message) {
      return {
        color: 'error' as const,
        label: '归档异常',
        tooltip: currentSession.obsidianArchiveError.message,
      }
    }
    if (currentSession) {
      return {
        color: 'default' as const,
        label: '待归档',
        tooltip: '发送并保存会话后，若已启用 Vault 写入，会自动同步到 灵枢/Conversations/AI对话/ 并更新会话索引。',
      }
    }
    return {
      color: 'default' as const,
      label: '未归档',
      tooltip: '创建会话并发送消息后才会产生归档状态。',
    }
  })()
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const createSession = async (title: string) => {
    const response = await fetch(`/api/instances/${currentInstanceId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, projectId: selectedProjectId })
    })
    if (!response.ok) throw new Error('创建会话失败')
    const newSession = await safeJson(response)
    skipNextSessionLoadRef.current = true
    setCurrentSessionId(newSession.id)
    setSelectedProjectId(String(newSession.projectId || selectedProjectId || ''))
    setSessions(prev => [newSession, ...prev])
    return newSession
  }

  const handleSelectProject = async (projectId: string) => {
    setSelectedProjectId(projectId)
    if (!currentSessionId) return
    try {
      const response = await fetch(`/api/instances/${currentInstanceId}/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId })
      })
      if (!response.ok) throw new Error('关联项目失败')
      setSessions(prev => prev.map(session => session.id === currentSessionId ? { ...session, projectId } : session))
      message.success(projectId ? '已关联当前项目' : '已移出项目上下文')
    } catch (error: any) {
      message.error(error.message || '关联项目失败')
    }
  }

  const removePendingAttachment = (attachmentId: string) => {
    setPendingAttachments(prev => prev.filter(item => item.id !== attachmentId))
  }

  const uploadFileResultAsAttachment = useCallback((data: any, fallback: { name?: string; type?: string }, kind: ChatAttachment['kind']) => {
    const extractedText = String(data?.extractedText || '').trim()
    const attachment: ChatAttachment = {
      id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      name: data.originalName || fallback.name || '未命名附件',
      url: data.url || data.filePath,
      mimeType: data.mimeType || fallback.type,
      ...(extractedText ? { text: extractedText, textLength: Number(data.extractedTextLength || extractedText.length), truncated: Boolean(data.extractedTextTruncated) } : {}),
      ...(data.extractionError ? { extractionError: String(data.extractionError) } : {}),
    }
    setPendingAttachments(prev => [...prev, attachment])
    if (extractedText) message.success(`已读取 ${attachment.name}`)
    else if (data.extractionError) message.warning(`已附加 ${attachment.name}，但未能读取正文`)
    else message.success(`已附加 ${attachment.name}`)
  }, [])

  const appendSessionEvents = async (sessionId: string, nextMessages: Message[]) => {
    const response = await fetch(`/api/instances/${currentInstanceId}/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentModel,
        messages: nextMessages
      })
    })
    if (!response.ok) throw new Error('保存会话事件失败')
    return safeJson(response)
  }

  const refreshSessionMessages = async (sessionId: string) => {
    const generation = ++sessionLoadGenerationRef.current
    const response = await fetch(`/api/instances/${currentInstanceId}/sessions/${sessionId}`)
    if (!response.ok) return null
    const data = await response.json()
    if (generation !== sessionLoadGenerationRef.current || activeSessionIdRef.current !== sessionId) return null
    const refreshedMessages = data.messages || []
    setMessages(refreshedMessages)
    return data
  }

  const replaceSessionMessages = async (sessionId: string, nextMessages: Message[]) => {
    const response = await fetch(`/api/instances/${currentInstanceId}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: nextMessages, model: currentModel })
    })
    if (!response.ok) throw new Error('替换会话消息失败')
    return safeJson(response)
  }

  const handleRefreshChat = async () => {
    if (isRefreshing) return
    const hide = message.loading('正在刷新对话...', 0)
    setIsRefreshing(true)
    try {
      await Promise.all([
        loadSessions(),
        loadModels(),
        loadAgentDesktopInstances(),
        loadSkills(),
        currentSessionId ? refreshSessionMessages(currentSessionId) : Promise.resolve(null),
      ])
      message.success('对话已刷新')
    } catch (error: any) {
      message.error(error.message || '刷新失败')
    } finally {
      hide()
      setIsRefreshing(false)
    }
  }

  const ensureActiveSession = async (title: string) => {
    if (currentSessionId) return currentSessionId
    const newSession = await createSession(title.substring(0, 20) || '新会话')
    return newSession.id
  }

  const runAppOpenCommand = async (appKey: string, promptText?: string) => {
    const cleanPrompt = (promptText || `打开${APP_COMMAND_LABELS[appKey] || appKey}`).trim()
    if (!cleanPrompt || isLoading) return

    let sessionId = currentSessionId
    try {
      sessionId = await ensureActiveSession(cleanPrompt)
    } catch (error) {
      message.error('创建会话失败')
      return
    }

    const now = Date.now()
    const userMessage: Message = {
      id: String(now),
      role: 'user',
      content: cleanPrompt,
      timestamp: new Date().toISOString()
    }
    const appLabel = APP_COMMAND_LABELS[appKey] || appKey

    setInputValue('')
    setIsLoading(true)
    setMessages(prev => [...prev, userMessage])

    let assistantMessage: Message
    try {
      const response = await fetch(`/api/instances/${currentInstanceId}/apps/${encodeURIComponent(appKey)}/open`, {
        method: 'POST'
      })
      const result = await safeJson(response)
      const resultDetails = [
        result.openedAs ? `打开目标：${result.openedAs}` : null,
        result.path ? `路径：${result.path}` : null,
        result.verified === true ? '状态：已检测到进程' : null,
        result.opened && result.verified === false ? '状态：打开请求已发送，但未检测到进程' : null,
      ].filter(Boolean).join('\n')
      assistantMessage = {
        id: String(now + 1),
        role: 'assistant',
        content: result.success
          ? `✅ 已打开 ${appLabel}\n\n> 工具调用：本地应用启动${resultDetails ? `\n> ${resultDetails.replace(/\n/g, '\n> ')}` : ''}`
          : `❌ 打开 ${appLabel} 失败：${result.error || '未知错误'}${resultDetails ? `\n\n> ${resultDetails.replace(/\n/g, '\n> ')}` : ''}`,
        timestamp: new Date().toISOString(),
        model: 'tool'
      }
      if (result.success) message.success(`已打开 ${appLabel}`)
    } catch (error: any) {
      assistantMessage = {
        id: String(now + 1),
        role: 'assistant',
        content: `❌ 打开 ${appLabel} 失败：${error.message || '未知错误'}`,
        timestamp: new Date().toISOString(),
        model: 'tool'
      }
      message.error('执行命令失败: ' + (error.message || '未知错误'))
    }

    const eventMessages = [userMessage, assistantMessage]
    setMessages(prev => [...prev, assistantMessage])
    try {
      if (!sessionId) throw new Error('会话不存在')
      const savedSession = await appendSessionEvents(sessionId, eventMessages)
      setMessages(savedSession.messages || eventMessages)
      loadSessions()
    } catch (error: any) {
      message.warning('工具已执行，但会话历史保存失败：' + (error.message || '未知错误'))
    } finally {
      setIsLoading(false)
    }
  }

  const runDesktopAgentInvocation = async (agent: RuntimeInstance, instruction?: string) => {
    const cleanPrompt = (instruction || `调用 ${agent.name}`).trim()
    if (!cleanPrompt || isLoading) return

    let sessionId = currentSessionId
    try {
      sessionId = await ensureActiveSession(cleanPrompt)
    } catch (error) {
      message.error('创建会话失败')
      return
    }

    const now = Date.now()
    const userMessage: Message = {
      id: String(now),
      role: 'user',
      content: cleanPrompt,
      timestamp: new Date().toISOString()
    }

    setInputValue('')
    setIsLoading(true)
    setMessages(prev => [...prev, userMessage])

    let assistantMessage: Message
    try {
      const response = await fetch(`/api/instances/${agent.id}/agent-desktop/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: cleanPrompt, source: 'chat' })
      })
      const result = await safeJson(response)
      const modeLabel = result.mode === 'cli'
        ? 'CLI 投递'
        : result.mode === 'url-scheme'
          ? 'URL Scheme 投递'
          : '打开 App'
      const resultLines = [
        `> 工具调用：本机 Agent 桌面端`,
        `> 模式：${modeLabel}`,
        result.appPath ? `> 路径：${result.appPath}` : '',
        result.cliCommand ? `> CLI：${result.cliCommand}` : '',
        result.url ? `> URL：${result.url}` : '',
        result.stdout ? `\nCLI 输出：\n\`\`\`\n${String(result.stdout).slice(0, 1200)}\n\`\`\`` : '',
        result.message ? `\n${result.message}` : ''
      ].filter(Boolean).join('\n')
      assistantMessage = {
        id: String(now + 1),
        role: 'assistant',
        content: result.success
          ? `✅ 已调用 ${result.appName || agent.name}\n\n${resultLines}`
          : `❌ 调用 ${agent.name} 失败：${result.error || '未知错误'}`,
        timestamp: new Date().toISOString(),
        model: 'tool'
      }
      message.success(`已调用 ${result.appName || agent.name}`)
    } catch (error: any) {
      assistantMessage = {
        id: String(now + 1),
        role: 'assistant',
        content: `❌ 调用 ${agent.name} 失败：${error.message || '未知错误'}`,
        timestamp: new Date().toISOString(),
        model: 'tool'
      }
      message.error('调用本机 Agent 失败: ' + (error.message || '未知错误'))
    }

    const eventMessages = [userMessage, assistantMessage]
    setMessages(prev => [...prev, assistantMessage])
    try {
      if (!sessionId) throw new Error('会话不存在')
      const savedSession = await appendSessionEvents(sessionId, eventMessages)
      setMessages(savedSession.messages || eventMessages)
      loadSessions()
    } catch (error: any) {
      message.warning('Agent 已调用，但会话历史保存失败：' + (error.message || '未知错误'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (!modelSwitchNotice) return
    const timer = window.setTimeout(() => setModelSwitchNotice(null), 4200)
    return () => window.clearTimeout(timer)
  }, [modelSwitchNotice])

  // 发送消息 — 使用 chatStore.sendMessage（含 SSE 流式），保留特殊路径 pre-check
  const handleSend = async (overrideValue?: string) => {
    const rawInputValue = typeof overrideValue === 'string' ? overrideValue : inputValue
    if ((!rawInputValue.trim() && pendingAttachments.length === 0) || isLoading || isStreaming) return

    const promptValue = rawInputValue.trim() || (pendingAttachments.some(item => item.kind === 'image')
      ? '请分析我附加的图片。'
      : '请阅读并分析我附加的文件。')

    // ---- 特殊路径 pre-check（A2 决策）----

    // 1. Agent 桌面端调用
    const agentInvocation = extractAgentInvocationCommand(promptValue, agentDesktopInstances)
    if (agentInvocation) {
      await runDesktopAgentInvocation(agentInvocation.agent, agentInvocation.instruction)
      return
    }

    // 2. 本地 App 打开命令
    const appOpenCommand = extractAppOpenCommand(promptValue)
    if (appOpenCommand) {
      await runAppOpenCommand(appOpenCommand, promptValue)
      return
    }

    // 3. 确认执行上一条建议的 App 打开
    if (/^(执行|运行|打开|可以|确认|是)$/i.test(promptValue)) {
      const runnableApp = extractRunnableAppFromAssistant(messages)
      if (runnableApp) {
        await runAppOpenCommand(runnableApp, promptValue)
        return
      }
    }

    // ---- 正常消息发送（通过 chatStore，含 SSE 流式）----

    // 确保有会话
    let sessionId = currentSessionId
    if (!sessionId) {
      try {
        const newSession = await createSession(getConversationTitleSeed(promptValue))
        sessionId = newSession.id
      } catch (error) {
        message.error('创建会话失败')
        return
      }
    }

    if (!sessionId) {
      message.error('创建会话失败')
      return
    }

    // 初始化 runtime
    setCurrentSessionId(sessionId)
    initRuntime(sessionId, currentModel || selectedModel)

    const content = promptValue
    const requestContext = {
      ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
      ...(pendingAttachments.length ? { attachments: pendingAttachments } : {}),
      ...(selectedSkill ? {
        skillIds: [selectedSkill.id],
        skills: [{
          id: selectedSkill.id,
          name: selectedSkill.name,
          description: selectedSkill.description,
        }],
      } : {}),
    }
    setInputValue('')
    setSelectedSkill(null)
    setPendingAttachments([])

    // 如果处于对比模式，使用 chatStore 的对比发送
    if (compareMode && compareSelectedModels.length >= 2) {
      await useChatStore.getState().sendCompareMessage(content, compareSelectedModels)
      loadSessions()
      return
    }

    // 正常发送（chatStore.sendMessage 含 SSE 解析）
    setIsLoading(true)
    try {
      const sending = chatStoreSendMessage(content, undefined, requestContext)
      window.setTimeout(() => {
        setMessages(useChatStore.getState().messages)
      }, 0)
      await sending

      // chat 接口已负责持久化 user/assistant；这里只刷新后端最终状态，避免重复追加。
      if (sessionId) {
        try {
          await refreshSessionMessages(sessionId)
        } catch {
          // 刷新失败不影响当前流式结果展示
        }
      }
      loadSessions()
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        message.error('发送失败，请重试')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleStop = () => {
    useChatStore.getState().stopStreaming()
    setIsLoading(false)
  }

  const getSlashSkillSuggestions = useCallback((value: string) => {
    const firstLine = value.split('\n')[0] || ''
    const slashCommand = firstLine.match(/^\/([^\s]*)$/)
    if (!slashCommand) return []

    const query = slashCommand[1].trim().toLowerCase()
    return availableSkills
      .filter(skill => {
        const haystack = `${skill.name || ''} ${skill.id || ''} ${skill.description || ''}`.toLowerCase()
        return !query || haystack.includes(query)
      })
      .slice(0, 8)
  }, [availableSkills])

  const focusComposer = useCallback(() => {
    window.setTimeout(() => {
      inputRef.current?.focus?.({
        cursor: 'end',
      })
    }, 0)
  }, [])

  const getConversationTitleSeed = useCallback((content: string) => {
    return String(content || '')
      .trim()
      .slice(0, 20) || selectedSkill?.name || '新会话'
  }, [selectedSkill])

  const insertSlashSkillInvocation = useCallback((skill: ChatSkill) => {
    const skillName = skill.name || skill.id
    setSelectedSkill(skill)
    setInputValue(prev => (/^\/[^\s]*$/.test(prev.trim()) ? '' : prev))
    focusComposer()
    message.success(`已选择 ${skillName} Skill`)
  }, [focusComposer])

  const handleSuggestedReply = useCallback((value: string, action: 'fill' | 'send' = 'send') => {
    const clean = String(value || '').trim()
    if (!clean) return
    if (action === 'send') {
      void handleSend(clean)
      return
    }
    setInputValue(clean)
    focusComposer()
    message.success('已填入输入框，确认后发送')
  }, [focusComposer, handleSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && inputValue.startsWith('/')) {
      e.preventDefault()
      setInputValue('')
      return
    }

    const isSlashCommand = !selectedSkill && /^\/[^\s]*$/.test(inputValue.trim())
    const slashSuggestions = isSlashCommand ? getSlashSkillSuggestions(inputValue) : []
    if (slashSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedSlashSkillIndex(prev => (prev + 1) % slashSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedSlashSkillIndex(prev => (prev - 1 + slashSuggestions.length) % slashSuggestions.length)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        insertSlashSkillInvocation(slashSuggestions[Math.min(selectedSlashSkillIndex, slashSuggestions.length - 1)])
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (isSlashCommand && slashSuggestions.length > 0) {
        e.preventDefault()
        insertSlashSkillInvocation(slashSuggestions[Math.min(selectedSlashSkillIndex, slashSuggestions.length - 1)])
        return
      }

      e.preventDefault()
      handleSend()
    }
  }

  const appendFileReference = async (file: File, mode: typeof filePickMode) => {
    const uploadFile = async () => {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(`/api/instances/${currentInstanceId}/files/upload`, {
        method: 'POST',
        body: formData
      })
      if (!response.ok) throw new Error('上传失败')
      return response.json()
    }

    if (mode === 'image') {
      try {
        const data = await uploadFile()
        uploadFileResultAsAttachment(data, file, 'image')
        return
      } catch (error: any) {
        message.error(error.message || '图片上传失败')
      }
      return
    }

    if (mode === 'document' || mode === 'attachment') {
      try {
        const data = await uploadFile()
        uploadFileResultAsAttachment(data, file, mode === 'document' ? 'document' : 'attachment')
      } catch (error: any) {
        message.error(error.message || '文件上传失败')
      }
      return
    }
  }

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const clipboardFiles = Array.from(e.clipboardData?.files || [])
    const itemFiles = Array.from(e.clipboardData?.items || [])
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile?.())
      .filter((file): file is File => Boolean(file))
    const uniqueFiles = [...clipboardFiles, ...itemFiles].filter((file, index, files) => (
      files.findIndex(candidate => candidate.name === file.name && candidate.size === file.size && candidate.type === file.type) === index
    ))
    if (uniqueFiles.length === 0) {
      try {
        const result = await readClipboardFiles()
        const files = result.success ? (result.files || []) : []
        if (files.length === 0) return
        e.preventDefault()
        const hide = message.loading('正在读取剪贴板文件...', 0)
        try {
          for (const file of files) {
            const response = await fetch(`/api/instances/${currentInstanceId}/files/upload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ localPath: file.path })
            })
            if (!response.ok) {
              const text = await response.text().catch(() => '')
              throw new Error(text || `导入 ${file.name} 失败`)
            }
            const data = await response.json()
            const kind: ChatAttachment['kind'] = String(data.mimeType || '').startsWith('image/') ? 'image' : 'document'
            uploadFileResultAsAttachment(data, { name: file.name }, kind)
          }
        } finally {
          hide()
        }
      } catch (error: any) {
        message.error(error.message || '读取剪贴板文件失败')
      }
      return
    }

    e.preventDefault()
    for (const file of uniqueFiles) {
      await appendFileReference(file, file.type.startsWith('image/') ? 'image' : 'document')
    }
  }, [appendFileReference, currentInstanceId, uploadFileResultAsAttachment])

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
        body: JSON.stringify({ title: '新会话', projectId: selectedProjectId })
      })

      if (response.ok) {
        const newSession = await response.json()
        setSessions([newSession, ...sessions])
        setCurrentSessionId(newSession.id)
        setMessages([])
        setPendingAttachments([])
        setSelectedProjectId(String(newSession.projectId || selectedProjectId || ''))
        initRuntime(newSession.id, currentModel || selectedModel)
      }
    } catch (error) {
      message.error('创建会话失败')
    }
  }

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await fetch(`/api/instances/${currentInstanceId}/sessions/${sessionId}`, { method: 'DELETE' })
      const updated = sessions.filter(s => s.id !== sessionId)
      setSessions(updated)
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null)
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

      const updated = sessions.map(s =>
        s.id === sessionId ? { ...s, isFavorite: !s.isFavorite } : s
      )
      setSessions(updated)
    } catch (error) {
      message.error('操作失败')
    }
  }

  const handleEditTitle = (session: Session) => {
    setEditingSession(session)
    setNewTitle(session.title)
    setEditModalVisible(true)
  }

  const handleAutoTitle = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/instances/${currentInstanceId}/sessions/${sessionId}/auto-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      })
      if (!response.ok) throw new Error('智能命名失败')
      const result = await response.json()
      if (result.session?.title || result.title) {
        const nextTitle = result.session?.title || result.title
        const updated = sessions.map(s => s.id === sessionId ? { ...s, title: nextTitle } : s)
        setSessions(updated)
      }
      message.success(result.updated ? '已按内容更新会话名称' : '当前名称已合适')
    } catch (error: any) {
      message.error(error.message || '智能命名失败')
    }
  }

  const handleSaveTitle = async () => {
    if (!editingSession || !newTitle.trim()) return

    try {
      await fetch(`/api/instances/${currentInstanceId}/sessions/${editingSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() })
      })

      const updated = sessions.map(s =>
        s.id === editingSession.id ? { ...s, title: newTitle.trim() } : s
      )
      setSessions(updated)
      setEditModalVisible(false)
    } catch (error) {
      message.error('修改标题失败')
    }
  }

  const handleFeedback = async (msgId: string, rating: 'like' | 'dislike') => {
    const targetMessage = messages.find(m => m.id === msgId)
    setMessages(prev => prev.map(m =>
      m.id === msgId ? { ...m, feedback: m.feedback === rating ? undefined : rating } : m
    ))
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: msgId,
          sessionId: currentSessionId,
          rating,
          context: {
            model: targetMessage?.model,
            role: targetMessage?.role,
          }
        })
      })
    } catch (error) {
      // Silently fail, feedback is best-effort
    }
  }

  const handleSaveToKnowledge = async (msgId: string) => {
    const targetMessage = messages.find(m => m.id === msgId)
    if (!targetMessage?.content?.trim()) {
      message.warning('这条消息没有可保存的内容')
      return
    }

    const sessionTitle = currentSession?.title || 'AI 对话'
    const titleBase = targetMessage.content
      .replace(/[#>*_`[\]()]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 36)
    const tags = ['ai-chat', 'conversation']
    if (targetMessage.model && targetMessage.model !== 'tool') tags.push(targetMessage.model)

    try {
      const response = await fetch('/api/knowledge-inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleBase || sessionTitle,
          content: [
            `会话：${sessionTitle}`,
            targetMessage.model ? `模型：${targetMessage.model}` : '',
            '',
            targetMessage.content.trim(),
          ].filter(Boolean).join('\n'),
          sourceType: 'conversation',
          sourceUrl: currentSessionId ? `lingshu://chat/${currentSessionId}/${msgId}` : '',
          tags,
        })
      })
      await safeJson(response)
      message.success('已存入知识收件箱')
    } catch (error: any) {
      message.error(error.message || '保存到知识收件箱失败')
    }
  }

  // 消息菜单：撤销到此处
  const handleUndo = (messageIndex: number) => {
    undoToTurn(messageIndex)
    message.success('已撤销到此处')
  }

  // 消息菜单：从这条分支
  const handleBranch = (messageId: string) => {
    const newSessionId = branchFromMessage(messageId)
    setCurrentSessionId(newSessionId)
    message.success('已创建分支会话')
    loadSessions()
  }

  // 快速操作
  const handleQuickAction = async (action: QuickActionType, messageId: string) => {
    await executeQuickAction(messageId, action)
  }

  const insertSkillInvocation = (skill: ChatSkill) => {
    const skillName = skill.name || skill.id
    setSelectedSkill(skill)
    focusComposer()
    message.success(`已选择 ${skillName} Skill`)
  }

  // 对比模式：采用某条回复
  const handleAdoptCompare = async (model: string, content: string) => {
    let nextMessages: Message[] = []
    let adoptedMessageId = ''
    const comparePrompt = inputValue.trim()
    // 保留选中的回复，移除其他对比结果
    setMessages(prev => {
      // 找到最后一个 user 消息
      const lastUserIdx = [...prev].reverse().findIndex(m => m.role === 'user')
      const actualIdx = lastUserIdx >= 0 ? prev.length - 1 - lastUserIdx : -1

      const canReuseLastUser = actualIdx >= 0 && (!comparePrompt || prev[actualIdx].content === comparePrompt)
      const kept = canReuseLastUser
        ? prev.slice(0, actualIdx + 1)
        : [
            ...prev,
            {
              id: `msg-${Date.now()}-user`,
              role: 'user' as const,
              content: comparePrompt || '多模型对比',
              timestamp: new Date().toISOString(),
            },
          ]
      const adoptedMsg: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        model,
      }
      adoptedMessageId = adoptedMsg.id
      nextMessages = [...kept, adoptedMsg]
      return nextMessages
    })
    if (nextMessages.length > 0) {
      if (currentSessionId) {
        try {
          await replaceSessionMessages(currentSessionId, nextMessages)
          await fetch('/api/model-evaluations/ab-adopt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: currentSessionId,
              messageId: adoptedMessageId,
              prompt: comparePrompt,
              adoptedModel: model,
              candidates: compareSelectedModels,
              content,
            })
          }).catch(() => undefined)
          await refreshSessionMessages(currentSessionId)
          loadSessions()
        } catch {
          message.warning('已采用此回复，但保存会话失败')
        }
      }
    }
    setCompareMode(false)
    setCompareSelectedModels([])
    setInputValue('')
    message.success('已采用此回复')
  }

  const showSlashSkillPanel = !selectedSkill && /^\/[^\s]*$/.test(inputValue) && !isLoading && !isStreaming
  const slashSkillSuggestions = showSlashSkillPanel ? getSlashSkillSuggestions(inputValue) : []

  const renderDocumentPreviewPanel = () => {
    if (!documentPreview) return null
    const previewArtifact = documentPreview.artifact || detectChatArtifact(documentPreview.content)

    return (
      <aside className="chat-document-panel">
        <div className="chat-document-panel-header">
          <div className="chat-document-panel-title">
              <FileTextOutlined />
              <div>
              <div>{previewArtifact?.label || '内容预览'}</div>
              <span>{documentPreview.title}</span>
            </div>
          </div>
          <Tooltip title="关闭预览">
            <Button type="text" icon={<CloseOutlined />} onClick={() => setDocumentPreview(null)} />
          </Tooltip>
        </div>
        <div className="chat-document-panel-actions">
          <Button icon={<CopyOutlined />} onClick={handleCopyPreviewDocument}>
            复制全文
          </Button>
          {(previewArtifact?.formats || ['md', 'html', 'docx']).map(format => (
            <Button
              key={format}
              type="primary"
              icon={<DownloadOutlined />}
              loading={exportingPreviewFormat === format}
              onClick={() => handleExportPreviewArtifact(format)}
            >
              {artifactFormatLabel(format)}
            </Button>
          ))}
        </div>
        <div className="chat-document-panel-body markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {documentPreview.content}
          </ReactMarkdown>
        </div>
      </aside>
    )
  }

  useEffect(() => {
    setSelectedSlashSkillIndex(0)
  }, [inputValue])

  useEffect(() => {
    setSelectedSlashSkillIndex(prev => Math.min(prev, Math.max(slashSkillSuggestions.length - 1, 0)))
  }, [slashSkillSuggestions.length])

  return (
    <Layout className="chat-page">
      {/* 左侧边栏 */}
      <Sider width={320} className="chat-sidebar">
        <div className="chat-sidebar-inner">
          <div className="chat-sidebar-title">
            <div className="chat-brand-icon"><RobotOutlined /></div>
            <div>
              <div className="chat-brand-name">灵枢对话</div>
              <div className="chat-brand-meta">{sessions.length} 个会话 · local 实例</div>
            </div>
          </div>
          <Spin spinning={isLoadingSessions}>
            <ChatSidebar
              sessions={sessions}
              currentSessionId={currentSessionId || null}
              onSelect={(id) => setCurrentSessionId(id)}
              onNew={handleNewSession}
              onDelete={handleDeleteSession}
              onToggleFavorite={handleToggleFavorite}
              onEdit={(id) => {
                const s = sessions.find(s => s.id === id)
                if (s) handleEditTitle(s)
              }}
              onAutoTitle={handleAutoTitle}
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
            <Tooltip title={archiveState.tooltip}>
              <Tag icon={<BookOutlined />} color={archiveState.color}>
                {archiveState.label}
              </Tag>
            </Tooltip>
            <Dropdown
              menu={{
                items: [
                  { key: '', label: '不关联项目' },
                  { type: 'divider' as const },
                  ...projects.map(project => ({
                    key: project.id,
                    label: project.name,
                    icon: <FolderOpenOutlined />,
                  })),
                  ...(projects.length === 0 ? [{ key: 'empty-projects', label: '暂无项目，请先在项目工作台创建', disabled: true }] : []),
                ],
                onClick: ({ key }) => {
                  if (key !== 'empty-projects') handleSelectProject(String(key))
                }
              }}
            >
              <Button className={`chat-project-trigger${selectedProject ? ' chat-project-trigger-active' : ''}`} size="small" icon={<FolderOpenOutlined />}>
                {selectedProject?.name || '选择项目'}
              </Button>
            </Dropdown>
            {/* 对比模式切换 */}
            <Tooltip title="多模型对比模式">
              <Button
                type={compareMode ? 'primary' : 'text'}
                size="small"
                onClick={() => {
                  setCompareMode(!compareMode)
                  if (!compareMode) {
                    setCompareSelectedModels([])
                  }
                }}
              >
                {compareMode ? '对比模式 ON' : '对比'}
              </Button>
            </Tooltip>
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
                  setSelectedModel(key)
                  try { localStorage.setItem(MODEL_STORAGE_KEY, key) } catch {}
                  const label = modelList.find(m => m.key === key)?.label || String(key)
                  setModelSwitchNotice({ key: String(key), label })
                  message.success(`已切换到 ${label}`)
                }
              }}
            >
              <Tag color="blue" className="model-tag">
                {activeModelLabel || '选择模型'}
              </Tag>
            </Dropdown>
            <Tooltip title="刷新对话数据">
              <Button
                type="text"
                icon={<ReloadOutlined />}
                loading={isRefreshing}
                onClick={handleRefreshChat}
              />
            </Tooltip>
            <Tooltip title="模型配置">
              <Button type="text" icon={<SettingOutlined />} onClick={() => window.open('/model-config', '_blank')} />
            </Tooltip>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'refresh', label: '刷新对话数据', icon: <ReloadOutlined /> },
                  { key: 'new-window', label: '新开对话窗口', icon: <DesktopOutlined /> },
                  { key: 'skills', label: '管理 Skills', icon: <ThunderboltOutlined /> },
                  { key: 'model-config', label: '模型配置', icon: <SettingOutlined /> },
                  ...(compareMode ? [{ key: 'compare-off', label: '退出对比模式' }] : []),
                ],
                onClick: async ({ key }) => {
                  if (key === 'refresh') {
                    await handleRefreshChat()
                  } else if (key === 'new-window') {
                    openNewChatWindow('/')
                  } else if (key === 'skills') {
                    window.open('/skills', '_blank')
                  } else if (key === 'model-config') {
                    window.open('/model-config', '_blank')
                  } else if (key === 'compare-off') {
                    setCompareMode(false)
                    setCompareSelectedModels([])
                    message.success('已退出对比模式')
                  }
                },
              }}
            >
              <Tooltip title="更多">
                <Button type="text" icon={<MoreOutlined />} />
              </Tooltip>
            </Dropdown>
          </Space>
        </Header>

        <div className={`chat-workspace${documentPreview ? ' chat-workspace-with-document' : ''}`}>
          <div className="chat-conversation-pane">
            <Content className="chat-messages">
              <div className="chat-stage">
                {/* 对比模式：模型选择器 */}
                {compareMode && currentSessionId && (
                  <div className="chat-compare-bar">
                    <div className="chat-compare-label">对比模型</div>
                    <Space wrap size={[6, 6]}>
                      {modelList.slice(0, 8).map(m => (
                        <Tag.CheckableTag
                          key={m.key}
                          checked={compareSelectedModels.includes(m.key)}
                          onChange={() => {
                            setCompareSelectedModels(prev => {
                              if (prev.includes(m.key)) return prev.filter(k => k !== m.key)
                              if (prev.length >= 3) {
                                message.warning('最多选择 3 个模型')
                                return prev
                              }
                              return [...prev, m.key]
                            })
                          }}
                        >
                          {m.label}
                        </Tag.CheckableTag>
                      ))}
                    </Space>
                  </div>
                )}

                {modelSwitchNotice && (
                  <div className="chat-model-switch-notice">
                    <CheckCircleOutlined />
                    <span>已切换模型：{modelSwitchNotice.label}</span>
                    <Button
                      type="text"
                      size="small"
                      icon={<CloseOutlined />}
                      onClick={() => setModelSwitchNotice(null)}
                      aria-label="关闭模型切换提示"
                    />
                  </div>
                )}

                {/* 对比结果展示 */}
            {compareMode && compareSelectedModels.length >= 2 && inputValue && currentSessionId && (
                  <div className="chat-compare-results">
                    <ModelCompare
                      models={modelList.map(m => ({ key: m.key, label: m.label, provider: m.provider }))}
                      sessionId={currentSessionId}
                      content={inputValue}
                      onAdopt={handleAdoptCompare}
                      onClose={() => {
                        setCompareMode(false)
                        setCompareSelectedModels([])
                      }}
                    />
                  </div>
                )}

                {messages.length === 0 ? (
                  <div className="chat-message-track">
                    <div className={`chat-empty-state${selectedSkill ? ' chat-empty-state--skill' : ''}`}>
                      <div className="chat-empty-icon"><RobotOutlined /></div>
                      <div className="chat-empty-title">
                        {selectedSkill ? `已选择 ${selectedSkill.name || selectedSkill.id} Skill` : '准备开始一个新会话'}
                      </div>
                      <div className="chat-empty-desc">
                        {selectedSkill
                          ? '在下方补充你要它完成的具体需求，然后发送。'
                          : '选择模型后直接输入问题，也可以粘贴图片或用下方技能调用本地能力。'}
                      </div>
                      <Space wrap>
                        <Button onClick={() => setInputValue('帮我总结一下灵枢当前能力')}>总结能力</Button>
                        <Button onClick={() => setInputValue('打开 Chrome')}>打开 Chrome</Button>
                        <Button type="primary" onClick={() => setInputValue('你好！')}>发送第一条消息</Button>
                      </Space>
                    </div>
                  </div>
                ) : (
                  <MessageList
                    messages={messages}
                    onFeedback={handleFeedback}
                    onBranch={handleBranch}
                    onUndo={handleUndo}
                    onQuickAction={handleQuickAction}
                    onSuggestedReply={handleSuggestedReply}
                    onSaveToKnowledge={handleSaveToKnowledge}
                    onPreviewDocument={handlePreviewDocument}
                    onToolApproval={respondToApproval}
                    loadingAction={loadingAction}
                  />
                )}
              </div>
            </Content>

            <div className="chat-composer">
              <div className="chat-composer-inner">
            {showSlashSkillPanel && (
              <div className="chat-slash-panel">
                <div className="chat-slash-header">输入 / 调用 Skill</div>
                <div className="chat-slash-list">
                  {slashSkillSuggestions.length > 0 ? (
                    slashSkillSuggestions.map((skill, index) => (
                      <button
                        key={skill.id}
                        type="button"
                        className={`chat-slash-item${index === selectedSlashSkillIndex ? ' chat-slash-item-active' : ''}`}
                        onMouseEnter={() => setSelectedSlashSkillIndex(index)}
                        onMouseDown={event => {
                          event.preventDefault()
                          insertSlashSkillInvocation(skill)
                        }}
                      >
                        <ThunderboltOutlined />
                        <span className="chat-slash-main">
                          <span className="chat-slash-name">{skill.name || skill.id}</span>
                          {skill.description && (
                            <span className="chat-slash-desc">{skill.description}</span>
                          )}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="chat-slash-empty">未找到匹配 Skill</div>
                  )}
                </div>
              </div>
            )}
            {selectedSkill && (
              <div className="chat-selected-skill">
                <ThunderboltOutlined />
                <div className="chat-selected-skill-main">
                  <span>正在使用 {selectedSkill.name || selectedSkill.id} Skill</span>
                  {selectedSkill.description && <small>{selectedSkill.description}</small>}
                </div>
                <Button
                  type="text"
                  size="small"
                  onClick={() => {
                    setSelectedSkill(null)
                    focusComposer()
                  }}
                >
                  移除
                </Button>
              </div>
            )}
            {(selectedProject || pendingAttachments.length > 0) && (
              <div className="chat-composer-contexts">
                {selectedProject && (
                  <div className="chat-context-chip chat-context-chip-project">
                    <FolderOpenOutlined />
                    <span>项目：{selectedProject.name}</span>
                    <Tooltip title="移出当前项目">
                      <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => handleSelectProject('')} />
                    </Tooltip>
                  </div>
                )}
                {pendingAttachments.map(attachment => (
                  <div className="chat-context-chip" key={attachment.id}>
                    {attachment.kind === 'image' && attachment.url
                      ? <img className="chat-context-thumbnail" src={attachment.url} alt="" />
                      : attachment.kind === 'image' ? <PictureOutlined /> : <FileTextOutlined />}
                    <Tooltip title={attachment.name}>
                      <span>{compactFileName(attachment.name)}</span>
                    </Tooltip>
                    <small>{attachment.text ? `${attachment.textLength || attachment.text.length} 字已读取` : attachment.extractionError ? '解析失败' : '仅上传未解析'}</small>
                    <Tooltip title="移除附件">
                      <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => removePendingAttachment(attachment.id)} />
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
            <div className="chat-input-box">
              <TextArea
                ref={inputRef}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={compareMode ? '对比模式：输入消息后选择模型进行对比' : selectedProject ? `在「${selectedProject.name}」中提问，粘贴图片、文档或代码会作为本轮上下文…` : '输入消息，/ 调用 Skill；可直接粘贴图片、文档或代码…'}
                autoSize={{ minRows: 1, maxRows: 5 }}
                variant="borderless"
                disabled={isLoading || isStreaming}
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
                  <Dropdown
                    overlayClassName="chat-capability-dropdown"
                    placement="topLeft"
                    menu={{
                      items: [
                        { type: 'group' as const, label: '本地能力' },
                        { key: 'feishu', label: '打开飞书', icon: <CloudOutlined /> },
                        { key: 'wechat', label: '打开微信', icon: <RobotOutlined /> },
                        { key: 'chrome', label: '打开 Chrome', icon: <DesktopOutlined /> },
                        { key: 'vscode', label: '打开 VS Code', icon: <CodeOutlined /> },
                        ...(agentDesktopInstances.length > 0 ? [
                          { type: 'divider' as const },
                          { type: 'group' as const, label: '桌面 Agent' },
                          ...agentDesktopInstances.map(agent => ({
                            key: `agent:${agent.id}`,
                            label: `调用 ${agent.appName || agent.name}`,
                            icon: <DesktopOutlined />
                          }))
                        ] : []),
                        { type: 'divider' as const },
                        { type: 'group' as const, label: 'Skills' },
                        ...(availableSkills.length > 0
                          ? availableSkills.slice(0, 8).map(skill => ({
                              key: `skill:${skill.id}`,
                              label: (
                                <div className="chat-capability-skill-label">
                                  <div className="chat-capability-skill-name">{skill.name || skill.id}</div>
                                  {skill.description && (
                                    <div className="chat-capability-skill-desc">
                                      {skill.description}
                                    </div>
                                  )}
                                </div>
                              ),
                              icon: <ThunderboltOutlined />
                            }))
                          : [{ key: 'skills-empty', label: '暂无已加载 Skills', disabled: true }]),
                        { type: 'divider' as const },
                        { key: 'skills-manage', label: availableSkills.length > 8 ? `更多 Skills... (${availableSkills.length})` : '管理 Skills', icon: <SettingOutlined /> },
                      ],
                      onClick: async ({ key }) => {
                        if (key === 'skills-manage') {
                          window.open('/skills', '_blank')
                        } else if (String(key).startsWith('skill:')) {
                          const skill = availableSkills.find(item => item.id === String(key).slice('skill:'.length))
                          if (skill) insertSkillInvocation(skill)
                        } else if (String(key).startsWith('agent:')) {
                          const agent = agentDesktopInstances.find(item => item.id === String(key).slice('agent:'.length))
                          if (agent) await runDesktopAgentInvocation(agent)
                        } else {
                          await runAppOpenCommand(String(key))
                        }
                      }
                    }}
                  >
                    <Tooltip title="能力与 Skills">
                      <Button type="text" icon={<ThunderboltOutlined />} />
                    </Tooltip>
                  </Dropdown>
                </Space>

                {isLoading || isStreaming ? (
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
	                    onClick={() => handleSend()}
                    disabled={!inputValue.trim() && pendingAttachments.length === 0}
                    style={{ borderRadius: 8 }}
                  >
                    发送
                  </Button>
                )}
              </div>
            </div>
            <div className="chat-composer-hint">
              Enter 发送，Shift + Enter 换行 · 输入 / 调用 Skill
            </div>
          </div>
        </div>
          </div>
          {renderDocumentPreviewPanel()}
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
