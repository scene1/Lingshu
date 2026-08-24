import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Switch,
  Typography,
  message,
} from 'antd'
import {
  BranchesOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  GithubOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { openExternal } from '../utils/electron'

const { Text, Title, Paragraph } = Typography
const { TextArea } = Input

type ProjectStatus = 'active' | 'paused' | 'done' | 'archived'
type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent'
type WorkItemStatus = 'inbox' | 'todo' | 'doing' | 'blocked' | 'review' | 'done'

interface ProjectLink {
  id: string
  type: string
  title: string
  targetId?: string
  url?: string
  excerpt?: string
  createdAt: string
}

interface ProjectConfigItem {
  id: string
  type: 'server' | 'credential' | 'variable' | 'note'
  title: string
  environment?: string
  host?: string
  port?: string
  username?: string
  value?: string
  notes?: string
  sensitive?: boolean
  hasValue?: boolean
  hasNotes?: boolean
  createdAt: string
  updatedAt: string
}

type BulkConfigMode = 'table' | 'free'

interface Project {
  id: string
  name: string
  description?: string
  status: ProjectStatus
  owner?: string
  priority?: ProjectPriority
  startDate?: string
  targetDate?: string
  progress: number
  tags: string[]
  linkedRepositories: string[]
  linkedDocuments: ProjectLink[]
  linkedMeetings: ProjectLink[]
  linkedSessions: ProjectLink[]
  configItems: ProjectConfigItem[]
  createdAt: string
  updatedAt: string
  taskCount?: number
  doneCount?: number
  blockedCount?: number
  repositoryCount?: number
  resourceCount?: number
  configCount?: number
}

interface WorkItem {
  id: string
  projectId: string
  type: 'task' | 'bug' | 'feature' | 'decision' | 'risk' | 'research'
  title: string
  description?: string
  status: WorkItemStatus
  priority: ProjectPriority
  assignee?: string
  dueDate?: string
  labels: string[]
  source?: { type: string; title?: string; url?: string; excerpt?: string }
  links: ProjectLink[]
  createdAt: string
  updatedAt: string
}

interface ProjectUpdate {
  id: string
  type: string
  title: string
  content?: string
  actor?: string
  targetId?: string
  createdAt: string
}

interface ExtractedTaskDraft {
  type: WorkItem['type']
  title: string
  description?: string
  status: WorkItemStatus
  priority: ProjectPriority
  assignee?: string
  dueDate?: string
  labels?: string[]
  source?: { type: string; title?: string; excerpt?: string }
}

type ResourceCandidateType = 'document' | 'meeting' | 'chat' | 'git'

interface ResourceCandidate {
  id: string
  type: ResourceCandidateType
  title: string
  subtitle?: string
  targetId?: string
  url?: string
  excerpt?: string
}

const projectStatusOptions = [
  { value: 'active', label: '进行中' },
  { value: 'paused', label: '暂停' },
  { value: 'done', label: '完成' },
  { value: 'archived', label: '归档' },
]

const priorityOptions = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
]

const workItemStatusOptions = [
  { value: 'inbox', label: '收集箱' },
  { value: 'todo', label: '待处理' },
  { value: 'doing', label: '进行中' },
  { value: 'blocked', label: '阻塞' },
  { value: 'review', label: '评审' },
  { value: 'done', label: '完成' },
]

const workItemTypeOptions = [
  { value: 'task', label: '任务' },
  { value: 'bug', label: '缺陷' },
  { value: 'feature', label: '功能' },
  { value: 'decision', label: '决策' },
  { value: 'risk', label: '风险' },
  { value: 'research', label: '调研' },
]

const resourceTypeOptions: Array<{ value: ResourceCandidateType; label: string }> = [
  { value: 'document', label: '文档' },
  { value: 'meeting', label: '会议' },
  { value: 'chat', label: 'AI 会话' },
  { value: 'git', label: 'Git 仓库' },
]

const configTypeOptions = [
  { value: 'server', label: '服务器连接' },
  { value: 'credential', label: '账号凭据' },
  { value: 'variable', label: '环境变量/地址' },
  { value: 'note', label: '项目备注' },
]

const statusColor: Record<string, string> = {
  active: 'processing',
  paused: 'warning',
  done: 'success',
  archived: 'default',
  inbox: 'default',
  todo: 'blue',
  doing: 'processing',
  blocked: 'error',
  review: 'purple',
}

const priorityColor: Record<string, string> = {
  low: 'default',
  medium: 'blue',
  high: 'orange',
  urgent: 'red',
}

const configTypeColor: Record<string, string> = {
  server: 'blue',
  credential: 'red',
  variable: 'purple',
  note: 'default',
}

function optionLabel(options: Array<{ value: string; label: string }>, value?: string) {
  return options.find(item => item.value === value)?.label || value || '-'
}

function splitLines(value?: string) {
  return String(value || '').split(/[\n,]/).map(item => item.trim()).filter(Boolean)
}

function parseBulkConfigRows(rawText?: string, defaultType = 'server', sensitive = true) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  return lines.map((line, index) => {
    const parts = line.includes('\t')
      ? line.split('\t')
      : line.split(/[,，]/)
    const cells = parts.map(item => item.trim())
    const [environment, title, host, port, username, value, ...notes] = cells
    return {
      type: defaultType,
      environment: environment || '',
      title: title || host || `服务器 ${index + 1}`,
      host: host || '',
      port: port || '',
      username: username || '',
      value: value || '',
      notes: notes.join('，'),
      sensitive,
    }
  }).filter(item => item.title || item.host || item.username || item.value)
}

const Projects: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [workItems, setWorkItems] = useState<WorkItem[]>([])
  const [updates, setUpdates] = useState<ProjectUpdate[]>([])
  const [loading, setLoading] = useState(false)
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [workItemModalOpen, setWorkItemModalOpen] = useState(false)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [repoModalOpen, setRepoModalOpen] = useState(false)
  const [configModalOpen, setConfigModalOpen] = useState(false)
  const [bulkConfigModalOpen, setBulkConfigModalOpen] = useState(false)
  const [extractTasksModalOpen, setExtractTasksModalOpen] = useState(false)
  const [resourceSelectorOpen, setResourceSelectorOpen] = useState(false)
  const [resourceType, setResourceType] = useState<ResourceCandidateType>('document')
  const [resourceQuery, setResourceQuery] = useState('')
  const [resourceLoading, setResourceLoading] = useState(false)
  const [resourceCandidates, setResourceCandidates] = useState<ResourceCandidate[]>([])
  const [bulkConfigMode, setBulkConfigMode] = useState<BulkConfigMode>('table')
  const [aiAssistLoading, setAiAssistLoading] = useState<'summary' | 'risk' | ''>('')
  const [aiAssistResult, setAiAssistResult] = useState<{ title: string; content: string } | null>(null)
  const [extractTasksLoading, setExtractTasksLoading] = useState(false)
  const [extractedTasks, setExtractedTasks] = useState<ExtractedTaskDraft[]>([])
  const [editingConfigItem, setEditingConfigItem] = useState<ProjectConfigItem | null>(null)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editingWorkItem, setEditingWorkItem] = useState<WorkItem | null>(null)
  const [projectForm] = Form.useForm()
  const [workItemForm] = Form.useForm()
  const [linkForm] = Form.useForm()
  const [repoForm] = Form.useForm()
  const [configForm] = Form.useForm()
  const [bulkConfigForm] = Form.useForm()
  const [extractTasksForm] = Form.useForm()

  const activeCount = projects.filter(item => item.status === 'active').length
  const blockedCount = projects.reduce((sum, item) => sum + Number(item.blockedCount || 0), 0)
  const dueSoonCount = workItems.filter(item => item.dueDate && item.status !== 'done').length

  const loadProjects = async (nextSelectedId = selectedProjectId) => {
    setLoading(true)
    try {
      const response = await fetch('/api/projects')
      if (!response.ok) throw new Error('读取项目失败')
      const data = await response.json()
      const list = Array.isArray(data.projects) ? data.projects : []
      setProjects(list)
      const targetId = nextSelectedId || list[0]?.id || ''
      setSelectedProjectId(targetId)
      if (targetId) await loadProjectDetail(targetId)
      else {
        setSelectedProject(null)
        setWorkItems([])
        setUpdates([])
      }
    } catch (error: any) {
      message.error(error.message || '读取项目失败')
    } finally {
      setLoading(false)
    }
  }

  const loadProjectDetail = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`)
      if (!response.ok) throw new Error('读取项目详情失败')
      const data = await response.json()
      setSelectedProject(data.project || null)
      setWorkItems(Array.isArray(data.workItems) ? data.workItems : [])
      setUpdates(Array.isArray(data.updates) ? data.updates : [])
    } catch (error: any) {
      message.error(error.message || '读取项目详情失败')
    }
  }

  useEffect(() => {
    loadProjects('')
  }, [])

  const openCreateProject = () => {
    setEditingProject(null)
    projectForm.resetFields()
    projectForm.setFieldsValue({ status: 'active', priority: 'medium', progress: 0 })
    setProjectModalOpen(true)
  }

  const openEditProject = () => {
    if (!selectedProject) return
    setEditingProject(selectedProject)
    projectForm.setFieldsValue({
      ...selectedProject,
      tags: selectedProject.tags?.join('\n'),
      linkedRepositories: selectedProject.linkedRepositories?.join('\n'),
    })
    setProjectModalOpen(true)
  }

  const saveProject = async (values: any) => {
    const payload = {
      ...values,
      tags: splitLines(values.tags),
      linkedRepositories: splitLines(values.linkedRepositories),
    }
    try {
      const response = await fetch(editingProject ? `/api/projects/${editingProject.id}` : '/api/projects', {
        method: editingProject ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error('保存项目失败')
      const saved = await response.json()
      message.success(editingProject ? '项目已更新' : '项目已创建')
      setProjectModalOpen(false)
      await loadProjects(saved.id)
    } catch (error: any) {
      message.error(error.message || '保存项目失败')
    }
  }

  const deleteProject = async () => {
    if (!selectedProject) return
    try {
      const response = await fetch(`/api/projects/${selectedProject.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('删除项目失败')
      message.success('项目已删除')
      await loadProjects('')
    } catch (error: any) {
      message.error(error.message || '删除项目失败')
    }
  }

  const openCreateWorkItem = () => {
    setEditingWorkItem(null)
    workItemForm.resetFields()
    workItemForm.setFieldsValue({ type: 'task', status: 'todo', priority: 'medium' })
    setWorkItemModalOpen(true)
  }

  const openEditWorkItem = (item: WorkItem) => {
    setEditingWorkItem(item)
    workItemForm.setFieldsValue({
      ...item,
      labels: item.labels?.join('\n'),
    })
    setWorkItemModalOpen(true)
  }

  const saveWorkItem = async (values: any) => {
    if (!selectedProject) return
    const payload = {
      ...values,
      labels: splitLines(values.labels),
    }
    try {
      const url = editingWorkItem
        ? `/api/projects/${selectedProject.id}/work-items/${editingWorkItem.id}`
        : `/api/projects/${selectedProject.id}/work-items`
      const response = await fetch(url, {
        method: editingWorkItem ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error('保存任务失败')
      message.success(editingWorkItem ? '任务已更新' : '任务已创建')
      setWorkItemModalOpen(false)
      await loadProjects(selectedProject.id)
    } catch (error: any) {
      message.error(error.message || '保存任务失败')
    }
  }

  const updateWorkItemStatus = async (item: WorkItem, status: WorkItemStatus) => {
    if (!selectedProject) return
    try {
      const response = await fetch(`/api/projects/${selectedProject.id}/work-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!response.ok) throw new Error('更新状态失败')
      await loadProjects(selectedProject.id)
    } catch (error: any) {
      message.error(error.message || '更新状态失败')
    }
  }

  const deleteWorkItem = async (item: WorkItem) => {
    if (!selectedProject) return
    try {
      const response = await fetch(`/api/projects/${selectedProject.id}/work-items/${item.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('删除任务失败')
      message.success('任务已删除')
      await loadProjects(selectedProject.id)
    } catch (error: any) {
      message.error(error.message || '删除任务失败')
    }
  }

  const addRepositoryValue = async (repository: string) => {
    if (!selectedProject) return
    const cleanRepository = String(repository || '').trim()
    if (!cleanRepository) {
      message.warning('请选择或输入仓库')
      return
    }
    try {
      const response = await fetch(`/api/projects/${selectedProject.id}/repositories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repository: cleanRepository }),
      })
      if (!response.ok) throw new Error('关联仓库失败')
      message.success('仓库已关联')
      setRepoModalOpen(false)
      setResourceSelectorOpen(false)
      repoForm.resetFields()
      await loadProjects(selectedProject.id)
    } catch (error: any) {
      message.error(error.message || '关联仓库失败')
    }
  }

  const addRepository = async (values: any) => {
    await addRepositoryValue(values.repository)
  }

  const addProjectLink = async (values: any) => {
    if (!selectedProject) return
    try {
      const response = await fetch(`/api/projects/${selectedProject.id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!response.ok) throw new Error('关联资料失败')
      message.success('资料已关联')
      setLinkModalOpen(false)
      setResourceSelectorOpen(false)
      linkForm.resetFields()
      await loadProjects(selectedProject.id)
    } catch (error: any) {
      message.error(error.message || '关联资料失败')
    }
  }

  const openCreateConfigItem = () => {
    setEditingConfigItem(null)
    configForm.resetFields()
    configForm.setFieldsValue({ type: 'server', sensitive: false })
    setConfigModalOpen(true)
  }

  const openEditConfigItem = (item: ProjectConfigItem) => {
    setEditingConfigItem(item)
    configForm.setFieldsValue(item)
    setConfigModalOpen(true)
  }

  const saveConfigItem = async (values: any) => {
    if (!selectedProject) return
    try {
      const response = await fetch(
        editingConfigItem
          ? `/api/projects/${selectedProject.id}/config-items/${editingConfigItem.id}`
          : `/api/projects/${selectedProject.id}/config-items`,
        {
          method: editingConfigItem ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        }
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '保存项目配置失败')
      message.success(editingConfigItem ? '项目配置已更新' : '项目配置已保存')
      setConfigModalOpen(false)
      configForm.resetFields()
      await loadProjects(selectedProject.id)
    } catch (error: any) {
      message.error(error.message || '保存项目配置失败')
    }
  }

  const saveBulkConfigItems = async (values: any) => {
    if (!selectedProject) return
    const items = bulkConfigMode === 'free'
      ? [{
        type: 'note',
        title: String(values.freeTitle || '').trim() || '项目自由粘贴',
        notes: String(values.freeText || '').trim(),
        sensitive: values.sensitive !== false,
      }]
      : parseBulkConfigRows(values.rows, values.type || 'server', values.sensitive !== false)
    if (items.length === 0) {
      message.warning(bulkConfigMode === 'free' ? '请粘贴项目相关内容' : '请粘贴至少一行服务器信息')
      return
    }
    if (bulkConfigMode === 'free' && !items[0].notes) {
      message.warning('请粘贴项目相关内容')
      return
    }
    try {
      const response = await fetch(`/api/projects/${selectedProject.id}/config-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '批量导入失败')
      message.success(bulkConfigMode === 'free' ? '自由粘贴内容已保存' : `已导入 ${items.length} 条项目配置`)
      setBulkConfigModalOpen(false)
      bulkConfigForm.resetFields()
      await loadProjects(selectedProject.id)
    } catch (error: any) {
      message.error(error.message || '批量导入失败')
    }
  }

  const deleteConfigItem = async (item: ProjectConfigItem) => {
    if (!selectedProject) return
    try {
      const response = await fetch(`/api/projects/${selectedProject.id}/config-items/${item.id}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '删除项目配置失败')
      message.success('项目配置已删除')
      await loadProjects(selectedProject.id)
    } catch (error: any) {
      message.error(error.message || '删除项目配置失败')
    }
  }

  const runProjectAssist = async (kind: 'summary' | 'risk') => {
    if (!selectedProject) return
    setAiAssistLoading(kind)
    try {
      const endpoint = kind === 'summary' ? 'summary' : 'risk-scan'
      const response = await fetch(`/api/projects/${selectedProject.id}/ai/${endpoint}`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '生成失败')
      setAiAssistResult({
        title: kind === 'summary' ? '项目摘要' : '风险扫描',
        content: data.content || '',
      })
      message.success(kind === 'summary' ? '项目摘要已生成' : '风险扫描已完成')
      await loadProjects(selectedProject.id)
    } catch (error: any) {
      message.error(error.message || '生成失败')
    } finally {
      setAiAssistLoading('')
    }
  }

  const openExtractTasks = () => {
    extractTasksForm.resetFields()
    extractTasksForm.setFieldsValue({ sourceType: 'meeting', sourceTitle: '会议纪要' })
    setExtractedTasks([])
    setExtractTasksModalOpen(true)
  }

  const extractTasksFromText = async (values: any) => {
    if (!selectedProject) return
    setExtractTasksLoading(true)
    try {
      const response = await fetch(`/api/projects/${selectedProject.id}/ai/extract-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: values.text,
          source: {
            type: values.sourceType || 'manual',
            title: values.sourceTitle || '文本提取',
          },
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '提取任务失败')
      setExtractedTasks(Array.isArray(data.tasks) ? data.tasks : [])
      if (data.count > 0) message.success(`提取到 ${data.count} 个任务草案`)
      else message.warning('没有识别到明显任务，可以换成更明确的待办文本')
    } catch (error: any) {
      message.error(error.message || '提取任务失败')
    } finally {
      setExtractTasksLoading(false)
    }
  }

  const importExtractedTasks = async () => {
    if (!selectedProject || extractedTasks.length === 0) return
    setExtractTasksLoading(true)
    try {
      const response = await fetch(`/api/projects/${selectedProject.id}/ai/import-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: extractedTasks }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '导入任务失败')
      message.success(`已导入 ${extractedTasks.length} 个任务`)
      setExtractTasksModalOpen(false)
      setExtractedTasks([])
      extractTasksForm.resetFields()
      await loadProjects(selectedProject.id)
    } catch (error: any) {
      message.error(error.message || '导入任务失败')
    } finally {
      setExtractTasksLoading(false)
    }
  }

  const loadResourceCandidates = async (type = resourceType, query = resourceQuery) => {
    setResourceLoading(true)
    try {
      if (type === 'document') {
        const endpoint = query.trim()
          ? `/api/documents/search?q=${encodeURIComponent(query.trim())}&limit=30`
          : '/api/documents/link-candidates?limit=80'
        const response = await fetch(endpoint)
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '读取文档失败')
        const source = Array.isArray(data.results) ? data.results : Array.isArray(data.candidates) ? data.candidates : []
        setResourceCandidates(source.map((item: any, index: number) => ({
          id: item.path || item.relativePath || item.title || `document-${index}`,
          type: 'document',
          title: item.title || item.name || item.relativePath || item.path || '未命名文档',
          subtitle: item.relativePath || item.path || '',
          targetId: item.relativePath || item.path || item.title,
          excerpt: item.snippet || item.excerpt || item.headings?.slice?.(0, 3)?.join(' / ') || '',
        })))
        return
      }

      if (type === 'meeting') {
        const response = await fetch('/api/meetings')
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '读取会议失败')
        const source = Array.isArray(data.meetings) ? data.meetings : []
        const normalizedQuery = query.trim().toLowerCase()
        setResourceCandidates(source
          .filter((item: any) => !normalizedQuery || `${item.title || ''} ${item.vaultRelativePath || ''}`.toLowerCase().includes(normalizedQuery))
          .slice(0, 60)
          .map((item: any) => ({
            id: item.id,
            type: 'meeting',
            title: item.title || '未命名会议',
            subtitle: item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : item.status || '',
            targetId: item.id,
            excerpt: item.vaultRelativePath || (item.hasMinutes ? '已有纪要' : item.hasTranscript ? '已有逐字稿' : '待整理'),
          })))
        return
      }

      if (type === 'chat') {
        const response = await fetch('/api/instances/local/sessions')
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '读取 AI 会话失败')
        const source = Array.isArray(data.sessions) ? data.sessions : Array.isArray(data) ? data : []
        const normalizedQuery = query.trim().toLowerCase()
        setResourceCandidates(source
          .filter((item: any) => !normalizedQuery || `${item.title || ''} ${item.lastMessage || ''}`.toLowerCase().includes(normalizedQuery))
          .slice(0, 80)
          .map((item: any) => ({
            id: item.id,
            type: 'chat',
            title: item.title || '未命名会话',
            subtitle: `${item.messageCount || 0} 条消息${item.model ? ` · ${item.model}` : ''}`,
            targetId: item.id,
            excerpt: item.lastMessage || '',
          })))
        return
      }

      const response = await fetch('/api/git-integrations')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '读取 Git 集成失败')
      const normalizedQuery = query.trim().toLowerCase()
      const source = (Array.isArray(data.integrations) ? data.integrations : [])
        .filter((item: any) => item.enabled)
        .flatMap((integration: any) => (integration.repositories || []).map((repo: string) => ({
          id: `${integration.id}:${repo}`,
          type: 'git' as ResourceCandidateType,
          title: repo,
          subtitle: integration.name,
          targetId: repo,
          url: /^https?:\/\//i.test(repo) ? repo : `${String(integration.baseUrl || '').replace(/\/+$/, '')}/${repo.replace(/^\/+/, '')}`,
          excerpt: integration.baseUrl || '',
        })))
      setResourceCandidates(source.filter((item: ResourceCandidate) => (
        !normalizedQuery || `${item.title} ${item.subtitle || ''}`.toLowerCase().includes(normalizedQuery)
      )))
    } catch (error: any) {
      setResourceCandidates([])
      message.warning(error.message || '读取可关联资料失败')
    } finally {
      setResourceLoading(false)
    }
  }

  const openResourceSelector = (type: ResourceCandidateType) => {
    setResourceType(type)
    setResourceQuery('')
    setResourceSelectorOpen(true)
    loadResourceCandidates(type, '')
  }

  const selectResourceCandidate = async (candidate: ResourceCandidate) => {
    if (candidate.type === 'git') {
      await addRepositoryValue(candidate.targetId || candidate.url || candidate.title)
      return
    }
    await addProjectLink({
      type: candidate.type,
      title: candidate.title,
      targetId: candidate.targetId,
      url: candidate.url,
      excerpt: candidate.excerpt || candidate.subtitle,
    })
  }

  const taskColumns = [
    {
      title: '任务',
      dataIndex: 'title',
      key: 'title',
      render: (text: string, record: WorkItem) => (
        <Space direction="vertical" size={2}>
          <Space wrap>
            <Text strong>{text}</Text>
            <Tag color={priorityColor[record.priority]}>{optionLabel(priorityOptions, record.priority)}</Tag>
            <Tag>{optionLabel(workItemTypeOptions, record.type)}</Tag>
          </Space>
          {record.description && <Text type="secondary" ellipsis={{ tooltip: record.description }}>{record.description}</Text>}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: WorkItemStatus, record: WorkItem) => (
        <Select size="small" value={value} style={{ width: 92 }} onChange={(next) => updateWorkItemStatus(record, next)}>
          {workItemStatusOptions.map(item => <Select.Option key={item.value} value={item.value}>{item.label}</Select.Option>)}
        </Select>
      ),
    },
    { title: '负责人', dataIndex: 'assignee', width: 100, render: (value: string) => value || '-' },
    { title: '截止', dataIndex: 'dueDate', width: 110, render: (value: string) => value || '-' },
    {
      title: '操作',
      width: 130,
      render: (_: unknown, record: WorkItem) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditWorkItem(record)} />
          <Popconfirm title="删除任务？" onConfirm={() => deleteWorkItem(record)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const boardColumns = useMemo(() => workItemStatusOptions.map(status => ({
    ...status,
    items: workItems.filter(item => item.status === status.value),
  })), [workItems])

  const resourceLinks = [
    ...(selectedProject?.linkedDocuments || []),
    ...(selectedProject?.linkedMeetings || []),
    ...(selectedProject?.linkedSessions || []),
  ]

  return (
    <div className="projects-workspace">
      <Space align="start" size={14} style={{ marginBottom: 20 }}>
        <div style={{
          display: 'grid',
          placeItems: 'center',
          width: 44,
          height: 44,
          borderRadius: 8,
          background: '#eef6ff',
          color: '#2563eb',
          fontSize: 22,
        }}>
          <UnorderedListOutlined />
        </div>
        <div>
          <Title level={3} style={{ margin: 0 }}>项目工作台</Title>
          <Text type="secondary">组织项目、任务、Git 仓库、会议纪要、文档和 AI 会话。</Text>
        </div>
      </Space>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}><Card size="small"><Statistic title="进行中项目" value={activeCount} /></Card></Col>
        <Col xs={24} md={8}><Card size="small"><Statistic title="阻塞任务" value={blockedCount} /></Card></Col>
        <Col xs={24} md={8}><Card size="small"><Statistic title="待关注任务" value={dueSoonCount} /></Card></Col>
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="项目模块第一版"
        description="先打通项目、任务、看板、Git 和资料关联。下一步可以从 AI 对话、会议纪要和 Git Issue 自动生成任务。"
      />

      <Row gutter={16}>
        <Col xs={24} lg={8} xl={7}>
          <Card
            title="项目"
            extra={
              <Space>
                <Button size="small" icon={<ReloadOutlined />} onClick={() => loadProjects(selectedProjectId)} loading={loading} />
                <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreateProject}>新建</Button>
              </Space>
            }
            bodyStyle={{ padding: 0 }}
          >
            <List
              loading={loading}
              dataSource={projects}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无项目" /> }}
              renderItem={project => (
                <List.Item
                  onClick={() => {
                    setSelectedProjectId(project.id)
                    loadProjectDetail(project.id)
                  }}
                  style={{
                    cursor: 'pointer',
                    padding: '14px 16px',
                    background: selectedProjectId === project.id ? '#eef6ff' : '#fff',
                    borderLeft: selectedProjectId === project.id ? '3px solid #1677ff' : '3px solid transparent',
                  }}
                >
                  <List.Item.Meta
                    title={
                      <Space wrap>
                        <Text strong>{project.name}</Text>
                        <Tag color={statusColor[project.status]}>{optionLabel(projectStatusOptions, project.status)}</Tag>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Text type="secondary" ellipsis>{project.description || '暂无描述'}</Text>
                        <Progress percent={project.progress || 0} size="small" />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {project.doneCount || 0}/{project.taskCount || 0} 完成 · {project.blockedCount || 0} 阻塞
                        </Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col xs={24} lg={16} xl={17}>
          {!selectedProject ? (
            <Card><Empty description="选择或新建一个项目" /></Card>
          ) : (
            <Card
              title={
                <Space wrap>
                  <Text strong>{selectedProject.name}</Text>
                  <Tag color={statusColor[selectedProject.status]}>{optionLabel(projectStatusOptions, selectedProject.status)}</Tag>
                  <Tag color={priorityColor[selectedProject.priority || 'medium']}>{optionLabel(priorityOptions, selectedProject.priority)}</Tag>
                </Space>
              }
              extra={
                <Space>
                  <Button loading={aiAssistLoading === 'summary'} onClick={() => runProjectAssist('summary')}>生成摘要</Button>
                  <Button loading={aiAssistLoading === 'risk'} onClick={() => runProjectAssist('risk')}>风险扫描</Button>
                  <Button onClick={openExtractTasks}>提取任务</Button>
                  <Button icon={<EditOutlined />} onClick={openEditProject}>编辑</Button>
                  <Popconfirm title="删除这个项目？" onConfirm={deleteProject}>
                    <Button danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              }
            >
              <Paragraph type="secondary">{selectedProject.description || '暂无项目描述'}</Paragraph>
              <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={6}><Statistic title="进度" value={selectedProject.progress || 0} suffix="%" /></Col>
                <Col xs={12} md={6}><Statistic title="任务" value={selectedProject.taskCount || 0} /></Col>
                <Col xs={12} md={6}><Statistic title="仓库" value={selectedProject.repositoryCount || 0} /></Col>
                <Col xs={12} md={6}><Statistic title="配置" value={selectedProject.configCount || 0} /></Col>
              </Row>

              <Tabs
                items={[
                  {
                    key: 'overview',
                    label: '总览',
                    children: (
                      <Row gutter={[16, 16]}>
                        <Col xs={24} lg={12}>
                          <Card size="small" title="项目目标">
                            <Paragraph>{selectedProject.description || '可以在项目描述中写下当前目标。'}</Paragraph>
                            <Space wrap>
                              {(selectedProject.tags || []).map(tag => <Tag key={tag}>{tag}</Tag>)}
                            </Space>
                          </Card>
                        </Col>
                        <Col xs={24} lg={12}>
                          <Card size="small" title="最近动态">
                            {updates.length > 0 ? (
                              <Timeline
                                items={updates.slice(0, 6).map(item => ({
                                  children: (
                                    <div>
                                      <Text>{item.title}</Text>
                                      {item.content && <div><Text type="secondary">{item.content}</Text></div>}
                                      <Text type="secondary" style={{ fontSize: 12 }}>{new Date(item.createdAt).toLocaleString('zh-CN')}</Text>
                                    </div>
                                  ),
                                }))}
                              />
                            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无动态" />}
                          </Card>
                        </Col>
                      </Row>
                    ),
                  },
                  {
                    key: 'tasks',
                    label: '任务',
                    children: (
                      <Card
                        size="small"
                        title="任务列表"
                        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreateWorkItem}>新增任务</Button>}
                      >
                        <Table columns={taskColumns} dataSource={workItems} rowKey="id" pagination={{ pageSize: 8 }} />
                      </Card>
                    ),
                  },
                  {
                    key: 'board',
                    label: '看板',
                    children: (
                      <Row gutter={12}>
                        {boardColumns.map(column => (
                          <Col xs={24} md={12} xl={4} key={column.value}>
                            <Card
                              size="small"
                              title={<Space><Tag color={statusColor[column.value]}>{column.label}</Tag><Text type="secondary">{column.items.length}</Text></Space>}
                              bodyStyle={{ minHeight: 240 }}
                            >
                              <Space direction="vertical" style={{ width: '100%' }}>
                                {column.items.map(item => (
                                  <Card key={item.id} size="small" bodyStyle={{ padding: 10 }}>
                                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                      <Text strong>{item.title}</Text>
                                      <Space wrap>
                                        <Tag color={priorityColor[item.priority]}>{optionLabel(priorityOptions, item.priority)}</Tag>
                                        {item.assignee && <Tag>{item.assignee}</Tag>}
                                      </Space>
                                      <Select
                                        size="small"
                                        value={item.status}
                                        onChange={(next) => updateWorkItemStatus(item, next)}
                                        style={{ width: '100%' }}
                                      >
                                        {workItemStatusOptions.map(option => <Select.Option key={option.value} value={option.value}>{option.label}</Select.Option>)}
                                      </Select>
                                    </Space>
                                  </Card>
                                ))}
                              </Space>
                            </Card>
                          </Col>
                        ))}
                      </Row>
                    ),
                  },
                  {
                    key: 'git',
                    label: 'Git',
                    children: (
                      <Card
                        size="small"
                        title="关联仓库"
                        extra={
                          <Space>
                            <Button icon={<GithubOutlined />} onClick={() => openResourceSelector('git')}>从 Git 集成选择</Button>
                            <Button icon={<PlusOutlined />} onClick={() => setRepoModalOpen(true)}>手动关联</Button>
                          </Space>
                        }
                      >
                        {(selectedProject.linkedRepositories || []).length > 0 ? (
                          <Space wrap>
                            {selectedProject.linkedRepositories.map(repo => (
                              <Button
                                key={repo}
                                icon={<GithubOutlined />}
                                onClick={() => /^https?:\/\//i.test(repo) ? openExternal(repo) : message.info('请在代码仓库模块配置服务后打开完整仓库地址')}
                              >
                                {repo}
                              </Button>
                            ))}
                          </Space>
                        ) : <Text type="secondary">还没有关联仓库。</Text>}
                      </Card>
                    ),
                  },
                  {
                    key: 'config',
                    label: '配置',
                    children: (
                      <Card
                        size="small"
                        title="项目配置"
                        extra={
                          <Space>
                            <Button onClick={() => {
                              bulkConfigForm.resetFields()
                              bulkConfigForm.setFieldsValue({ type: 'server', sensitive: true })
                              setBulkConfigMode('table')
                              setBulkConfigModalOpen(true)
                            }}>批量导入</Button>
                            <Button onClick={() => {
                              bulkConfigForm.resetFields()
                              bulkConfigForm.setFieldsValue({ freeTitle: '项目资料粘贴', sensitive: true })
                              setBulkConfigMode('free')
                              setBulkConfigModalOpen(true)
                            }}>自由粘贴</Button>
                            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateConfigItem}>新增配置</Button>
                          </Space>
                        }
                      >
                        {(selectedProject.configItems || []).length > 0 ? (
                          <List
                            dataSource={selectedProject.configItems || []}
                            renderItem={item => {
                              const displayValue = item.sensitive && item.hasValue ? '已安全保存' : item.value
                              const displayNotes = item.sensitive && item.hasNotes ? '已安全保存敏感备注' : item.notes
                              return (
                                <List.Item
                                  actions={[
                                    <Button type="link" onClick={() => openEditConfigItem(item)}>编辑</Button>,
                                    <Popconfirm title="删除这条配置？" onConfirm={() => deleteConfigItem(item)}>
                                      <Button type="link" danger>删除</Button>
                                    </Popconfirm>,
                                  ]}
                                >
                                  <List.Item.Meta
                                    avatar={<SafetyCertificateOutlined />}
                                    title={
                                      <Space wrap>
                                        <Text strong>{item.title}</Text>
                                        <Tag color={configTypeColor[item.type]}>{optionLabel(configTypeOptions, item.type)}</Tag>
                                        {item.environment && <Tag>{item.environment}</Tag>}
                                        {item.sensitive && <Tag color="red">敏感</Tag>}
                                      </Space>
                                    }
                                    description={
                                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        <Space wrap>
                                          {item.host && <Text type="secondary">地址：{item.host}{item.port ? `:${item.port}` : ''}</Text>}
                                          {item.username && <Text type="secondary">用户：{item.username}</Text>}
                                          {displayValue && <Text type="secondary">值：{displayValue}</Text>}
                                        </Space>
                                        {displayNotes && <Text type="secondary" style={{ whiteSpace: 'pre-wrap' }}>{displayNotes}</Text>}
                                      </Space>
                                    }
                                  />
                                </List.Item>
                              )
                            }}
                          />
                        ) : <Text type="secondary">可以保存服务器连接、登录账号、环境变量、部署地址和项目备注。敏感项默认隐藏。</Text>}
                      </Card>
                    ),
                  },
                  {
                    key: 'resources',
                    label: '资料',
                    children: (
                      <Card
                        size="small"
                        title="项目资料"
                        extra={
                          <Space wrap>
                            <Button icon={<FileTextOutlined />} onClick={() => openResourceSelector('document')}>选择文档</Button>
                            <Button onClick={() => openResourceSelector('meeting')}>选择会议</Button>
                            <Button onClick={() => openResourceSelector('chat')}>选择会话</Button>
                            <Button icon={<LinkOutlined />} onClick={() => setLinkModalOpen(true)}>手动关联</Button>
                          </Space>
                        }
                      >
                        {resourceLinks.length > 0 ? (
                          <List
                            dataSource={resourceLinks}
                            renderItem={item => (
                              <List.Item
                                actions={[
                                  item.url ? <Button type="link" onClick={() => openExternal(item.url || '')}>打开</Button> : null,
                                ]}
                              >
                                <List.Item.Meta
                                  avatar={<FileTextOutlined />}
                                  title={<Space><Text strong>{item.title}</Text><Tag>{item.type}</Tag></Space>}
                                  description={item.excerpt || item.url || item.targetId || '-'}
                                />
                              </List.Item>
                            )}
                          />
                        ) : <Text type="secondary">点击上方按钮，从已有文档、会议纪要、AI 会话中选择项目相关资料，也可以手动贴外部链接。</Text>}
                      </Card>
                    ),
                  },
                ]}
              />
            </Card>
          )}
        </Col>
      </Row>

      <Modal
        title={editingProject ? '编辑项目' : '新建项目'}
        open={projectModalOpen}
        onCancel={() => setProjectModalOpen(false)}
        onOk={() => projectForm.submit()}
        width={720}
      >
        <Form form={projectForm} layout="vertical" onFinish={saveProject}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <TextArea rows={3} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="status" label="状态"><Select options={projectStatusOptions} /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="优先级"><Select options={priorityOptions} /></Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="owner" label="负责人"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="targetDate" label="目标日期"><Input placeholder="YYYY-MM-DD" /></Form.Item></Col>
          </Row>
          <Form.Item name="progress" label="进度"><Input type="number" min={0} max={100} /></Form.Item>
          <Form.Item name="tags" label="标签"><TextArea rows={3} placeholder="每行一个标签" /></Form.Item>
          <Form.Item name="linkedRepositories" label="关联仓库"><TextArea rows={3} placeholder="每行一个仓库，例如 owner/repo 或 https://..." /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={aiAssistResult?.title || '项目助手'}
        open={!!aiAssistResult}
        onCancel={() => setAiAssistResult(null)}
        footer={<Button type="primary" onClick={() => setAiAssistResult(null)}>知道了</Button>}
        width={820}
      >
        <Typography>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
            fontFamily: 'inherit',
            lineHeight: 1.7,
          }}>
            {aiAssistResult?.content}
          </pre>
        </Typography>
      </Modal>

      <Modal
        title="从文本提取项目任务"
        open={extractTasksModalOpen}
        onCancel={() => setExtractTasksModalOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setExtractTasksModalOpen(false)}>取消</Button>
            <Button loading={extractTasksLoading} onClick={() => extractTasksForm.submit()}>提取草案</Button>
            <Button type="primary" disabled={extractedTasks.length === 0} loading={extractTasksLoading} onClick={importExtractedTasks}>导入任务</Button>
          </Space>
        }
        width={920}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="可以粘贴会议纪要、聊天记录、需求说明或任意待办文本"
          description="基础版会按关键词识别任务、风险、负责人、截止日期和优先级；导入前会先显示草案。"
        />
        <Form form={extractTasksForm} layout="vertical" onFinish={extractTasksFromText}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="sourceType" label="来源类型" initialValue="meeting">
                <Select
                  options={[
                    { value: 'meeting', label: '会议纪要' },
                    { value: 'chat', label: 'AI 会话' },
                    { value: 'document', label: '文档' },
                    { value: 'manual', label: '手动文本' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sourceTitle" label="来源标题" initialValue="会议纪要">
                <Input placeholder="例如：8 月迭代会议" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="text" label="原文" rules={[{ required: true, message: '请粘贴原文' }]}>
            <TextArea
              rows={8}
              placeholder={[
                '示例：',
                '- 待办：张三本周修复登录失败问题',
                '- 需要优化项目配置批量导入体验，负责人 Codex',
                '- 风险：转写服务还没有配置，可能阻塞会议模块',
                '- 截止 2026-08-15 完成 Git 仓库接入验证',
              ].join('\n')}
            />
          </Form.Item>
        </Form>
        {extractedTasks.length > 0 && (
          <Card size="small" title={`任务草案 ${extractedTasks.length}`} style={{ marginTop: 12 }}>
            <List
              dataSource={extractedTasks}
              renderItem={(item, index) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space wrap>
                        <Text strong>{index + 1}. {item.title}</Text>
                        <Tag>{optionLabel(workItemTypeOptions, item.type)}</Tag>
                        <Tag color={priorityColor[item.priority]}>{optionLabel(priorityOptions, item.priority)}</Tag>
                        <Tag color={statusColor[item.status]}>{optionLabel(workItemStatusOptions, item.status)}</Tag>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={3}>
                        <Space wrap>
                          {item.assignee && <Text type="secondary">负责人：{item.assignee}</Text>}
                          {item.dueDate && <Text type="secondary">截止：{item.dueDate}</Text>}
                        </Space>
                        {item.description && <Text type="secondary">{item.description}</Text>}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        )}
      </Modal>

      <Modal
        title={editingWorkItem ? '编辑任务' : '新增任务'}
        open={workItemModalOpen}
        onCancel={() => setWorkItemModalOpen(false)}
        onOk={() => workItemForm.submit()}
        width={720}
      >
        <Form form={workItemForm} layout="vertical" onFinish={saveWorkItem}>
          <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请输入任务标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述"><TextArea rows={3} /></Form.Item>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="type" label="类型"><Select options={workItemTypeOptions} /></Form.Item></Col>
            <Col span={8}><Form.Item name="status" label="状态"><Select options={workItemStatusOptions} /></Form.Item></Col>
            <Col span={8}><Form.Item name="priority" label="优先级"><Select options={priorityOptions} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="assignee" label="负责人"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="dueDate" label="截止日期"><Input placeholder="YYYY-MM-DD" /></Form.Item></Col>
          </Row>
          <Form.Item name="labels" label="标签"><TextArea rows={3} placeholder="每行一个标签" /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title="关联仓库"
        open={repoModalOpen}
        onCancel={() => setRepoModalOpen(false)}
        onOk={() => repoForm.submit()}
      >
        <Form form={repoForm} layout="vertical" onFinish={addRepository}>
          <Form.Item name="repository" label="仓库" rules={[{ required: true, message: '请输入仓库' }]}>
            <Input placeholder="owner/repo 或完整 https:// 地址" prefix={<BranchesOutlined />} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingConfigItem ? '编辑项目配置' : '新增项目配置'}
        open={configModalOpen}
        onCancel={() => setConfigModalOpen(false)}
        onOk={() => configForm.submit()}
        width={720}
      >
        <Form form={configForm} layout="vertical" onFinish={saveConfigItem}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
                <Select options={configTypeOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="environment" label="环境">
                <Input placeholder="production / staging / local" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="例如：生产服务器、数据库账号、API Base URL" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item name="host" label="地址 / Host / URL">
                <Input placeholder="https://example.com 或 192.168.1.10" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="port" label="端口">
                <Input placeholder="22 / 443 / 5432" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="username" label="用户 / Key">
                <Input placeholder="root / deploy / OPENAI_API_KEY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="value" label="密码 / Token / 值">
                <Input.Password placeholder={editingConfigItem?.sensitive ? '留空则保留原值' : '敏感内容不会返回到页面'} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="notes" label="备注">
            <TextArea rows={3} placeholder={editingConfigItem?.sensitive ? '留空则保留原敏感备注' : '连接说明、部署命令、注意事项、负责人等'} />
          </Form.Item>
          <Form.Item name="sensitive" label="敏感信息" valuePropName="checked">
            <Switch checkedChildren="隐藏" unCheckedChildren="普通" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="导入项目配置"
        open={bulkConfigModalOpen}
        onCancel={() => setBulkConfigModalOpen(false)}
        onOk={() => bulkConfigForm.submit()}
        okText={bulkConfigMode === 'free' ? '保存' : '导入'}
        width={820}
      >
        <Tabs
          activeKey={bulkConfigMode}
          onChange={(key) => setBulkConfigMode(key as BulkConfigMode)}
          items={[
            { key: 'table', label: '按表格导入' },
            { key: 'free', label: '自由粘贴' },
          ]}
        />
        <Alert
          type={bulkConfigMode === 'free' ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 14 }}
          message={bulkConfigMode === 'free' ? '自由粘贴会保存为一条项目配置备注' : '可直接从表格复制多行服务器信息'}
          description={bulkConfigMode === 'free'
            ? '适合把服务器清单、账号说明、部署步骤、临时记录整段复制进来，不要求任何格式。默认按敏感内容隐藏。'
            : '每行格式：环境，标题，地址，端口，用户，密码/Token，备注。也支持用 Tab 分隔，适合从 Excel、飞书表格、Notion 表格直接复制。'}
        />
        <Form form={bulkConfigForm} layout="vertical" onFinish={saveBulkConfigItems}>
          {bulkConfigMode === 'table' ? (
            <>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="type" label="默认类型" initialValue="server">
                    <Select options={configTypeOptions} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="sensitive" label="默认按敏感信息隐藏" valuePropName="checked" initialValue>
                    <Switch checkedChildren="隐藏" unCheckedChildren="普通" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item
                name="rows"
                label="批量内容"
                rules={[{ required: bulkConfigMode === 'table', message: '请粘贴服务器信息' }]}
              >
                <TextArea
                  rows={10}
                  placeholder={[
                    'prod,生产服务器,10.0.0.8,22,deploy,******,主应用',
                    'prod,数据库,10.0.0.12,5432,postgres,******,PostgreSQL',
                    'staging,预发服务器,10.0.1.8,22,deploy,******,预发环境',
                  ].join('\n')}
                />
              </Form.Item>
            </>
          ) : (
            <>
              <Row gutter={12}>
                <Col span={16}>
                  <Form.Item name="freeTitle" label="标题" initialValue="项目资料粘贴">
                    <Input placeholder="例如：服务器清单、线上账号、部署信息" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="sensitive" label="按敏感信息隐藏" valuePropName="checked" initialValue>
                    <Switch checkedChildren="隐藏" unCheckedChildren="普通" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item
                name="freeText"
                label="自由粘贴内容"
                rules={[{ required: bulkConfigMode === 'free', message: '请粘贴项目相关内容' }]}
              >
                <TextArea
                  rows={12}
                  placeholder={[
                    '直接把任意项目相关内容粘贴到这里：',
                    '服务器清单、登录方式、账号密码、部署步骤、域名、数据库说明、注意事项……',
                    '',
                    '不需要按固定格式填写。保存后会作为一条项目配置备注展示。',
                  ].join('\n')}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      <Modal
        title="选择项目相关资料"
        open={resourceSelectorOpen}
        onCancel={() => setResourceSelectorOpen(false)}
        footer={null}
        width={760}
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Space.Compact style={{ width: '100%' }}>
            <Select
              value={resourceType}
              style={{ width: 140 }}
              options={resourceTypeOptions}
              onChange={(next) => {
                const nextType = next as ResourceCandidateType
                setResourceType(nextType)
                loadResourceCandidates(nextType, resourceQuery)
              }}
            />
            <Input.Search
              allowClear
              value={resourceQuery}
              placeholder="搜索标题、路径或摘要"
              onChange={(event) => setResourceQuery(event.target.value)}
              onSearch={(value) => loadResourceCandidates(resourceType, value)}
              enterButton="搜索"
            />
          </Space.Compact>
          <List
            loading={resourceLoading}
            dataSource={resourceCandidates}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可关联内容" /> }}
            style={{ maxHeight: 460, overflow: 'auto' }}
            renderItem={(candidate) => (
              <List.Item
                actions={[
                  candidate.url && candidate.type !== 'git'
                    ? <Button type="link" onClick={() => openExternal(candidate.url || '')}>打开</Button>
                    : null,
                  <Button type="primary" onClick={() => selectResourceCandidate(candidate)}>关联</Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={candidate.type === 'git' ? <GithubOutlined /> : <FileTextOutlined />}
                  title={
                    <Space wrap>
                      <Text strong>{candidate.title}</Text>
                      <Tag>{resourceTypeOptions.find(item => item.value === candidate.type)?.label || candidate.type}</Tag>
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2}>
                      {candidate.subtitle && <Text type="secondary">{candidate.subtitle}</Text>}
                      {candidate.excerpt && <Text type="secondary" ellipsis={{ tooltip: candidate.excerpt }}>{candidate.excerpt}</Text>}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        </Space>
      </Modal>

      <Modal
        title="关联资料"
        open={linkModalOpen}
        onCancel={() => setLinkModalOpen(false)}
        onOk={() => linkForm.submit()}
      >
        <Form form={linkForm} layout="vertical" onFinish={addProjectLink}>
          <Form.Item name="type" label="类型" initialValue="document">
            <Select
              options={[
                { value: 'document', label: '文档' },
                { value: 'meeting', label: '会议' },
                { value: 'chat', label: 'AI 会话' },
                { value: 'url', label: '外部链接' },
              ]}
            />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="url" label="链接"><Input placeholder="https:// 或 lingshu://..." /></Form.Item>
          <Form.Item name="excerpt" label="摘要"><TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Projects
