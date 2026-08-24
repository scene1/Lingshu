import React, { useMemo, useState, useEffect } from 'react'
import { 
  Card, 
  Row, 
  Col, 
  Tag, 
  Button, 
  Badge,
  Space,
  Modal,
  Form,
  Input,
  Select,
  message,
  Spin,
  Alert,
  Typography,
  List,
  Empty,
  Tooltip,
  Tabs
} from 'antd'
import {
  CloudOutlined,
  DesktopOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  HistoryOutlined,
  ToolOutlined,
  BugOutlined,
  MessageOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { getSystemInfo } from '../utils/electron'

const { Option } = Select
const { Text } = Typography

interface Instance {
  id: string
  name: string
  type: 'local' | 'agent-desktop' | 'stepfun-desktop' | 'remote' | 'cloud'
  status: 'connected' | 'disconnected' | 'error'
  host?: string
  port?: number
  baseUrl?: string
  healthPath?: string
  restartPath?: string
  logsPath?: string
  apiToken?: string
  timeoutMs?: number
  tls?: boolean
  lastLatencyMs?: number
  remoteRuntime?: { status?: string; version?: string; name?: string }
  configPath: string
  workspacePath: string
  appName?: string
  bundleId?: string
  description?: string
  invocationMode?: 'open' | 'url-scheme' | 'cli'
  urlScheme?: string
  urlTemplate?: string
  cliCommand?: string
  cliArgsTemplate?: string
  lastConnected?: string
  installed?: boolean
  runtimeState?: 'running' | 'stopped' | 'unknown'
  lastRuntimeCheckedAt?: string
}

interface LocalAgentApp {
  name: string
  displayName: string
  bundleId?: string
  version?: string
  executable?: string
  path: string
  matchedReason?: string
  invocation?: {
    canOpen?: boolean
    canUseUrlScheme?: boolean
    canUseCli?: boolean
    urlScheme?: string
    cliCommand?: string
    suggestedInvocationMode?: 'open' | 'url-scheme' | 'cli'
    note?: string
  }
  instanceExists?: boolean
}

interface RunRecord {
  id: string
  type: string
  targetId?: string
  targetName?: string
  status?: string
  startedAt?: string
  finishedAt?: string
  createdAt?: string
  durationMs?: number
  error?: string
  totalTokens?: number
}

interface AgentInvocation {
  id: string
  instanceId: string
  instanceName?: string
  appName?: string
  instruction?: string
  invocationMode?: string
  source?: string
  createdAt?: string
  status?: string
  error?: string
  durationMs?: number
  totalTokens?: number
}

interface InstanceLog {
  id: string
  timestamp: string
  level: string
  source: string
  message: string
}

interface SystemInfo {
  platform: string
  arch: string
  hostname: string
  homedir: string
  username: string
}

const desktopAgentPresets = [
  { value: 'WorkBuddy', label: 'WorkBuddy' },
  { value: 'Marvis', label: 'Marvis' },
  { value: 'Codex', label: 'Codex' },
  { value: 'custom', label: '自定义桌面 Agent' }
]

const isDesktopAgentInstance = (instance: Instance) => instance.type === 'agent-desktop' || instance.type === 'stepfun-desktop'

const getInstanceTypeMeta = (type: Instance['type']) => {
  const map: Record<string, { label: string; color: string; icon: React.ReactNode; group: string }> = {
    local: { label: '本地运行时', color: 'blue', icon: <DesktopOutlined />, group: '本地' },
    'agent-desktop': { label: '桌面 Agent', color: 'geekblue', icon: <DesktopOutlined />, group: '桌面 Agent' },
    'stepfun-desktop': { label: '桌面 Agent', color: 'geekblue', icon: <DesktopOutlined />, group: '桌面 Agent' },
    remote: { label: '远程服务器', color: 'purple', icon: <CloudOutlined />, group: '远程/云端' },
    cloud: { label: '云端服务', color: 'cyan', icon: <CloudOutlined />, group: '远程/云端' },
  }
  return map[type] || { label: type, color: 'default', icon: <CloudOutlined />, group: '其他' }
}

const getInstanceStatusMeta = (status: Instance['status']) => {
  if (status === 'connected') return { label: '已连接', badge: 'success' as const, color: 'success' }
  if (status === 'error') return { label: '异常', badge: 'error' as const, color: 'error' }
  return { label: '待连接', badge: 'default' as const, color: 'default' }
}

const getDesktopAgentStatusMeta = (instance: Instance) => {
  if (instance.status === 'error' || instance.installed === false) {
    return { label: '未安装', badge: 'error' as const, color: 'error' }
  }
  return { label: '已配置', badge: 'success' as const, color: 'success' }
}

const getRuntimeStateMeta = (state?: Instance['runtimeState']) => {
  if (state === 'running') return { label: '运行中', badge: 'processing' as const, color: 'processing' }
  if (state === 'stopped') return { label: '未运行', badge: 'default' as const, color: 'default' }
  return { label: '未检测', badge: 'default' as const, color: 'default' }
}

const getInvocationLabel = (mode?: Instance['invocationMode']) => {
  if (mode === 'cli') return 'CLI 投递'
  if (mode === 'url-scheme') return 'URL 投递'
  return '打开 App'
}

const formatInstanceTime = (value?: string) => {
  if (!value) return '从未连接'
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return value
  }
}

const formatDuration = (value?: number) => {
  if (!value) return '-'
  if (value < 1000) return `${value}ms`
  return `${(value / 1000).toFixed(1)}s`
}

const getRunStatusColor = (status?: string) => {
  if (status === 'success' || status === 'completed') return 'green'
  if (status === 'running') return 'processing'
  if (status === 'error' || status === 'failed') return 'red'
  return 'default'
}

const isSuccessStatus = (status?: string) => ['success', 'completed', 'ok'].includes(String(status || '').toLowerCase())

const isErrorStatus = (status?: string) => ['error', 'failed', 'failure'].includes(String(status || '').toLowerCase())

const getDeliverableMeta = (instance: Instance) => {
  if (instance.invocationMode === 'cli') return { label: '可投递', color: 'purple', detail: instance.cliCommand || 'CLI' }
  if (instance.invocationMode === 'url-scheme') return { label: '可投递', color: 'geekblue', detail: instance.urlScheme ? `${instance.urlScheme}://` : 'URL Scheme' }
  return { label: '仅打开', color: 'default', detail: '记录调用意图' }
}

const InstanceManager: React.FC = () => {
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null)
  const [agentScanVisible, setAgentScanVisible] = useState(false)
  const [scanningAgents, setScanningAgents] = useState(false)
  const [detectedAgentApps, setDetectedAgentApps] = useState<LocalAgentApp[]>([])
  const [activeTab, setActiveTab] = useState('local-runtime')
  const [runHistory, setRunHistory] = useState<RunRecord[]>([])
  const [agentInvocations, setAgentInvocations] = useState<AgentInvocation[]>([])
  const [logsModalVisible, setLogsModalVisible] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [selectedLogInstance, setSelectedLogInstance] = useState<Instance | null>(null)
  const [instanceLogs, setInstanceLogs] = useState<InstanceLog[]>([])
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [form] = Form.useForm()
  const selectedType = Form.useWatch('type', form)
  const selectedAppName = Form.useWatch('appName', form)
  const selectedInvocationMode = Form.useWatch('invocationMode', form)

  // 加载实例列表
  const loadInstances = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/instances')
      if (response.ok) {
        const data = await response.json()
        setInstances(data)
      }
    } catch (error) {
      message.error('加载实例失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInstances()
    loadRuntimeActivity()
    getSystemInfo().then(setSystemInfo).catch(() => setSystemInfo(null))
  }, [])

  const loadRuntimeActivity = async () => {
    try {
      const [runResponse, invocationResponse] = await Promise.all([
        fetch('/api/run-history?limit=20'),
        fetch('/api/agent-desktop/invocations?limit=30')
      ])
      if (runResponse.ok) {
        const data = await runResponse.json()
        setRunHistory(Array.isArray(data.records) ? data.records : [])
      }
      if (invocationResponse.ok) {
        const data = await invocationResponse.json()
        setAgentInvocations(Array.isArray(data.invocations) ? data.invocations : [])
      }
    } catch (_) {
      setRunHistory([])
      setAgentInvocations([])
    }
  }

  // 测试连接
  const testConnection = async (id: string) => {
    try {
      const response = await fetch(`/api/instances/${id}/test`, { method: 'POST' })
      const data = await response.json()
      
      if (data.success) {
        const runtimeText = data.runtimeState === 'running' ? '，当前运行中' : data.runtimeState === 'stopped' ? '，当前未运行' : ''
        message.success(data.status === 'configured' ? `应用已配置${runtimeText}` : '连接成功')
        loadInstances()
      } else {
        message.error(data.message || '连接失败')
      }
    } catch (error) {
      message.error('测试连接失败')
    }
  }

  // 重启实例
  const restartInstance = async (id: string) => {
    try {
      const response = await fetch(`/api/instances/${id}/restart`, { method: 'POST' })
      const data = await response.json()
      
      if (data.success) {
        message.success(data.message || '操作成功')
        loadInstances()
        loadRuntimeActivity()
      } else if (data.opened && data.verified === false) {
        message.warning(data.message || '打开请求已发送，但未检测到应用运行')
        loadInstances()
        loadRuntimeActivity()
      } else {
        message.error(data.message || '重启失败')
      }
    } catch (error) {
      message.error('重启失败')
    }
  }

  const openInstanceLogs = async (instance: Instance) => {
    setSelectedLogInstance(instance)
    setLogsModalVisible(true)
    setLogsLoading(true)
    try {
      const response = await fetch(`/api/instances/${instance.id}/logs?lines=80`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || data.error || '读取日志失败')
      setInstanceLogs(Array.isArray(data) ? data : [])
    } catch (error: any) {
      setInstanceLogs([])
      message.error(error.message || '读取日志失败')
    } finally {
      setLogsLoading(false)
    }
  }

  const invokeFromChatHint = (instance: Instance) => {
    if (!isDesktopAgentInstance(instance)) {
      message.info('本地运行时会自动承载 AI 对话，无需单独调用。')
      return
    }
    message.info(`去 AI 对话输入“调用 ${instance.appName || instance.name} ...”，或使用输入框下方能力菜单。`)
  }

  // 删除实例
  const deleteInstance = async (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后无法恢复，是否继续？',
      onOk: async () => {
        try {
          await fetch(`/api/instances/${id}`, { method: 'DELETE' })
          message.success('删除成功')
          loadInstances()
        } catch (error) {
          message.error('删除失败')
        }
      }
    })
  }

  // 保存实例
  const handleSave = async (values: any) => {
    const normalizedValues = {
      ...values,
      type: values.type === 'stepfun-desktop' ? 'agent-desktop' : values.type,
      appName: values.type === 'agent-desktop' && values.appName === 'custom' ? values.customAppName : values.appName
    }
    delete normalizedValues.customAppName

    try {
      if (editingInstance) {
        // 更新
        await fetch(`/api/instances/${editingInstance.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(normalizedValues)
        })
        message.success('更新成功')
      } else {
        // 创建
        await fetch('/api/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(normalizedValues)
        })
        message.success('创建成功')
      }
      
      setModalVisible(false)
      form.resetFields()
      setEditingInstance(null)
      loadInstances()
    } catch (error) {
      message.error('保存失败')
    }
  }

  // 打开编辑弹窗
  const handleEdit = (instance: Instance) => {
    setEditingInstance(instance)
    const normalized = {
      ...instance,
      type: instance.type === 'stepfun-desktop' ? 'agent-desktop' : instance.type,
      appName: instance.appName || ''
    }
    form.setFieldsValue(normalized)
    setModalVisible(true)
  }

  // 打开创建弹窗
  const handleCreate = () => {
    setEditingInstance(null)
    form.resetFields()
    setModalVisible(true)
  }

  const scanLocalAgentApps = async () => {
    if (!isMac) {
      message.info(`${platformLabel} 暂不支持自动扫描桌面 Agent，可用“添加实例”手动填写应用路径。`)
      return
    }
    setScanningAgents(true)
    try {
      const response = await fetch('/api/local-agent-apps')
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || data.error || '扫描失败')
      if (data.scanSupported === false) {
        message.info(data.message || '当前平台暂不支持自动扫描，可手动添加应用路径。')
        return
      }
      const apps = Array.isArray(data.apps) ? data.apps : []
      setDetectedAgentApps(apps)
      setAgentScanVisible(true)
      message.success(`扫描完成，发现 ${apps.length} 个候选 Agent 应用`)
    } catch (error: any) {
      message.error(error.message || '扫描本机 Agent 失败')
    } finally {
      setScanningAgents(false)
    }
  }

  const addDetectedAgentApp = async (app: LocalAgentApp) => {
    try {
      const response = await fetch('/api/local-agent-apps/seed-instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apps: [app] })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || data.error || '加入失败')
      if (data.count > 0) {
        message.success(`已加入：${app.displayName || app.name}`)
      } else {
        message.info('该 Agent 已在运行实例中')
      }
      await loadInstances()
      await scanLocalAgentApps()
    } catch (error: any) {
      message.error(error.message || '加入 Agent 实例失败')
    }
  }

  const instanceStats = useMemo(() => ({
    total: instances.length,
    configured: instances.filter(item => item.status === 'connected').length,
    runningAgents: instances.filter(item => isDesktopAgentInstance(item) && item.runtimeState === 'running').length,
    desktopAgents: instances.filter(isDesktopAgentInstance).length,
    issues: instances.filter(item => item.status === 'error').length,
  }), [instances])

  const localInstances = useMemo(() => instances.filter(item => item.type === 'local'), [instances])
  const desktopInstances = useMemo(() => instances.filter(isDesktopAgentInstance), [instances])
  const remoteInstances = useMemo(() => instances.filter(item => item.type === 'remote' || item.type === 'cloud'), [instances])
  const invocationByInstanceId = useMemo(() => {
    const map = new Map<string, AgentInvocation>()
    for (const item of agentInvocations) {
      if (!item.instanceId || map.has(item.instanceId)) continue
      map.set(item.instanceId, item)
    }
    return map
  }, [agentInvocations])
  const runtimeEvents = useMemo(() => {
    const normalizedRunRecords = runHistory.map(item => ({
      id: item.id,
      label: item.targetName || item.targetId || item.type,
      type: item.type,
      status: item.status,
      createdAt: item.startedAt || item.createdAt,
      durationMs: item.durationMs,
      totalTokens: item.totalTokens,
      error: item.error
    }))
    const normalizedInvocations = agentInvocations.map(item => ({
      id: item.id,
      label: item.appName || item.instanceName || item.instanceId,
      type: `desktop:${item.invocationMode || 'open'}`,
      status: item.status || 'success',
      createdAt: item.createdAt,
      durationMs: item.durationMs,
      totalTokens: item.totalTokens,
      error: item.error
    }))
    return [...normalizedRunRecords, ...normalizedInvocations]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 40)
  }, [runHistory, agentInvocations])
  const observationStats = useMemo(() => {
    const total = runtimeEvents.length
    const success = runtimeEvents.filter(item => isSuccessStatus(item.status) || (!item.error && !isErrorStatus(item.status))).length
    const errors = runtimeEvents.filter(item => item.error || isErrorStatus(item.status))
    const durationValues = runtimeEvents.map(item => item.durationMs || 0).filter(Boolean)
    const tokenTotal = runtimeEvents.reduce((sum, item) => sum + (item.totalTokens || 0), 0)
    return {
      total,
      success,
      successRate: total > 0 ? Math.round((success / total) * 100) : 0,
      errorCount: errors.length,
      avgDurationMs: durationValues.length > 0 ? Math.round(durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length) : 0,
      tokenTotal,
      errorReasons: errors.slice(0, 5)
    }
  }, [runtimeEvents])
  const desktopPlatform = systemInfo?.platform || (typeof window !== 'undefined' ? (window as any).electronAPI?.platform : '')
  const isMac = desktopPlatform === 'darwin' || !desktopPlatform
  const platformLabel = desktopPlatform === 'win32' ? 'Windows' : desktopPlatform === 'darwin' ? 'macOS' : desktopPlatform === 'linux' ? 'Linux' : '当前系统'
  const defaultWorkspacePath = systemInfo?.homedir ? `${systemInfo.homedir}/Lingshu/workspace` : '~/Lingshu/workspace'
  const appPathExample = desktopPlatform === 'win32'
    ? 'C:\\Program Files\\Codex\\Codex.exe'
    : desktopPlatform === 'linux'
      ? '/opt/Codex/codex'
      : '/Applications/Codex.app'
  const scanLocationText = isMac ? '/Applications 与 ~/Applications' : `${platformLabel} 应用目录`

  const renderInstanceCard = (item: Instance, options: { compact?: boolean } = {}) => {
    const typeMeta = getInstanceTypeMeta(item.type)
    const isDesktopAgent = isDesktopAgentInstance(item)
    const statusMeta = isDesktopAgent ? getDesktopAgentStatusMeta(item) : getInstanceStatusMeta(item.status)
    const runtimeMeta = getRuntimeStateMeta(item.runtimeState)
    const deliverableMeta = getDeliverableMeta(item)
    const latestInvocation = invocationByInstanceId.get(item.id)
    const primaryActionLabel = isDesktopAgent ? '打开' : item.type === 'local' ? '重启' : '重连'

    return (
      <List.Item className="instance-list-item">
        <Card className="instance-card" styles={{ body: { padding: 16 } }}>
          <div className="instance-card-header">
            <Space align="start" size={12}>
              <div className={`instance-card-icon instance-card-icon-${item.type}`}>
                {typeMeta.icon}
              </div>
              <div className="instance-card-title">
                <Space wrap size={6}>
                  <Text strong>{item.name}</Text>
                  <Tag color={typeMeta.color}>{typeMeta.label}</Tag>
                  {isDesktopAgent && item.appName && <Tag>{item.appName}</Tag>}
                </Space>
                <div className="instance-card-desc">
                  {item.description || (isDesktopAgent ? '本机桌面 Agent，可从 AI 对话里调用。' : '灵枢运行宿主。')}
                </div>
              </div>
            </Space>
            <Space size={10}>
              <Badge status={statusMeta.badge} text={statusMeta.label} />
              {isDesktopAgent && <Badge status={runtimeMeta.badge} text={runtimeMeta.label} />}
            </Space>
          </div>

          <div className="instance-card-meta">
            <div>
              <Text type="secondary">{isDesktopAgent ? '调用方式' : item.type === 'local' ? '本地服务' : '连接方式'}</Text>
              <div>{isDesktopAgent ? getInvocationLabel(item.invocationMode) : typeMeta.group}</div>
            </div>
            <div>
              <Text type="secondary">{isDesktopAgent ? '最近调用' : '最近检查'}</Text>
              <div>{formatInstanceTime(isDesktopAgent ? latestInvocation?.createdAt || item.lastConnected : item.lastConnected)}</div>
            </div>
            {isDesktopAgent && (
              <div>
                <Text type="secondary">可投递</Text>
                <div><Tag color={deliverableMeta.color}>{deliverableMeta.label}</Tag></div>
              </div>
            )}
            {!isDesktopAgent && item.type !== 'local' && (
              <div>
                <Text type="secondary">协议 / 延迟</Text>
                <div><Tag>{item.baseUrl?.startsWith('https://') || item.tls !== false ? 'HTTPS' : 'HTTP'}</Tag>{item.lastLatencyMs ? `${item.lastLatencyMs}ms` : '-'}</div>
              </div>
            )}
            {!isDesktopAgent && item.type !== 'local' && item.remoteRuntime?.version && (
              <div>
                <Text type="secondary">远程版本</Text>
                <div>{item.remoteRuntime.version}</div>
              </div>
            )}
            <div className="instance-card-path">
              <Text type="secondary">{isDesktopAgent ? '应用路径' : item.type === 'local' ? '配置文件' : '连接地址'}</Text>
              <Tooltip title={item.type === 'remote' || item.type === 'cloud' ? item.baseUrl || item.host || '-' : item.configPath || '-'}>
                <div>{item.type === 'remote' || item.type === 'cloud' ? item.baseUrl || item.host || '-' : item.configPath || '-'}</div>
              </Tooltip>
            </div>
            {!options.compact && (
              <div className="instance-card-path">
                <Text type="secondary">工作目录</Text>
                <Tooltip title={item.workspacePath || '-'}>
                  <div>{item.workspacePath || '-'}</div>
                </Tooltip>
              </div>
            )}
          </div>

          <div className="instance-card-actions">
            <Space wrap>
              <Button
                size="small"
                icon={<CheckCircleOutlined />}
                onClick={() => testConnection(item.id)}
              >
                检测
              </Button>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => restartInstance(item.id)}
              >
                {primaryActionLabel}
              </Button>
              <Button
                size="small"
                icon={<MessageOutlined />}
                onClick={() => invokeFromChatHint(item)}
              >
                AI 对话调用
              </Button>
              <Button
                size="small"
                icon={<FileTextOutlined />}
                onClick={() => openInstanceLogs(item)}
              >
                日志
              </Button>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleEdit(item)}
              >
                编辑
              </Button>
              {item.id !== 'local' && (
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => deleteInstance(item.id)}
                >
                  删除
                </Button>
              )}
            </Space>
          </div>
        </Card>
      </List.Item>
    )
  }

  const renderInstanceList = (items: Instance[], emptyText: string) => (
    <Spin spinning={loading}>
      {items.length === 0 ? (
        <Empty className="instance-empty" description={emptyText} />
      ) : (
        <List dataSource={items} renderItem={item => renderInstanceCard(item)} />
      )}
    </Spin>
  )

  const renderLocalRuntime = () => (
    <div className="instance-tab-panel">
      <Alert
        type="info"
        showIcon
        className="instance-inline-note"
        message="本地运行时负责灵枢的默认会话、配置、文件和知识库能力"
        description="这里看的是本机灵枢服务本身，不是外部 Agent 角色。"
      />
      {renderInstanceList(localInstances, '没有找到本地灵枢运行时实例。')}
    </div>
  )

  const renderDesktopAgents = () => (
    <Card className="instance-list-card" styles={{ body: { padding: 0 } }}>
      <div className="instance-list-toolbar">
        <Space><DesktopOutlined /><Text strong>桌面 Agent</Text><Tag>{desktopInstances.length}</Tag></Space>
        <Button size="small" icon={<ReloadOutlined />} loading={scanningAgents} onClick={scanLocalAgentApps}>扫描</Button>
      </div>
      <div className="instance-agent-grid">
        {desktopInstances.length === 0 ? (
          <Empty className="instance-empty" description={isMac ? '暂无桌面 Agent，可先扫描本机应用目录。' : '暂无桌面 Agent，可用“添加实例”手动添加应用路径。'} />
        ) : desktopInstances.map(item => {
          const statusMeta = getDesktopAgentStatusMeta(item)
          const runtimeMeta = getRuntimeStateMeta(item.runtimeState)
          const deliverableMeta = getDeliverableMeta(item)
          const latestInvocation = invocationByInstanceId.get(item.id)
          return (
            <Card key={item.id} className="instance-agent-card" styles={{ body: { padding: 14 } }}>
              <div className="instance-agent-card-head">
                <Space size={10}>
                  <div className="instance-card-icon instance-card-icon-agent-desktop"><DesktopOutlined /></div>
                  <div>
                    <Text strong>{item.appName || item.name}</Text>
                    <div className="instance-card-desc">{item.bundleId || item.description || '-'}</div>
                  </div>
                </Space>
                <Badge status={statusMeta.badge} text={statusMeta.label} />
              </div>
              <div className="instance-agent-metrics">
                <div><Text type="secondary">运行</Text><Tag color={runtimeMeta.color}>{runtimeMeta.label}</Tag></div>
                <div><Text type="secondary">调用</Text><Tag color="geekblue">{getInvocationLabel(item.invocationMode)}</Tag></div>
                <div><Text type="secondary">投递</Text><Tag color={deliverableMeta.color}>{deliverableMeta.label}</Tag></div>
                <div><Text type="secondary">最近</Text><span>{formatInstanceTime(latestInvocation?.createdAt || item.lastConnected)}</span></div>
              </div>
              <div className="instance-card-actions">
                <Space wrap>
                  <Button size="small" icon={<CheckCircleOutlined />} onClick={() => testConnection(item.id)}>检测</Button>
                  <Button size="small" icon={<ReloadOutlined />} onClick={() => restartInstance(item.id)}>打开</Button>
                  <Button size="small" icon={<MessageOutlined />} onClick={() => invokeFromChatHint(item)}>AI 对话调用</Button>
                  <Button size="small" icon={<FileTextOutlined />} onClick={() => openInstanceLogs(item)}>日志</Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(item)}>编辑</Button>
                </Space>
              </div>
            </Card>
          )
        })}
      </div>
    </Card>
  )

  const renderRemoteRuntime = () => (
    <div className="instance-tab-panel">
      <Alert
        type="warning"
        showIcon
        className="instance-inline-note"
        message="远程 Runtime 使用受控 HTTP API 连接"
        description="支持 HTTPS 健康检查、Bearer Token、超时、远程重启和日志 API。地址不会跟随重定向，Token 不会返回到页面；SSH 与 WebSocket 暂不在 2.1 首批范围内。"
      />
      <Row gutter={[12, 12]}>
        {['远程 OpenClaw', 'Hermes', '自托管 Agent Server'].map(name => (
          <Col xs={24} md={8} key={name}>
            <Card className="instance-runtime-card">
              <Space direction="vertical" size={8}>
                <Space><CloudOutlined /><Text strong>{name}</Text></Space>
                <Text type="secondary">HTTPS API / Bearer Token / 健康检查</Text>
                <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={handleCreate}>添加连接</Button>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
      {renderInstanceList(remoteInstances, '暂无远程 Runtime；可添加远程 OpenClaw、Hermes 或自托管 Agent Server。')}
    </div>
  )

  const renderActivity = () => (
    <div className="instance-tab-panel">
      <div className="instance-panel-toolbar">
        <Text type="secondary">运行观测汇总最近运行、桌面 Agent 调用、错误原因、Token 与耗时。</Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={loadRuntimeActivity}>刷新</Button>
      </div>
      <Row gutter={[12, 12]} className="instance-stat-grid">
        <Col xs={12} md={6}>
          <Card className="instance-stat-card"><div>{observationStats.total}</div><Text type="secondary">最近调用</Text></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="instance-stat-card"><div>{observationStats.successRate}%</div><Text type="secondary">成功率</Text></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="instance-stat-card"><div className={observationStats.errorCount > 0 ? 'instance-stat-danger' : ''}>{observationStats.errorCount}</div><Text type="secondary">错误</Text></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="instance-stat-card"><div>{formatDuration(observationStats.avgDurationMs)}</div><Text type="secondary">平均耗时</Text></Card>
        </Col>
      </Row>
      <Row gutter={[14, 14]}>
        <Col xs={24} lg={16}>
          <Card title={<Space><HistoryOutlined />最近调用</Space>} className="instance-runtime-card">
            {runtimeEvents.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无调用记录" />
            ) : (
              <List
                size="small"
                dataSource={runtimeEvents}
                renderItem={item => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space wrap>
                          <Tag color={getRunStatusColor(item.status)}>{item.status || 'success'}</Tag>
                          <Text strong>{item.label}</Text>
                          <Tag>{item.type}</Tag>
                        </Space>
                      }
                      description={
                        <Space wrap size={8}>
                          <Text type="secondary">{formatInstanceTime(item.createdAt)}</Text>
                          <Text type="secondary">耗时 {formatDuration(item.durationMs)}</Text>
                          <Text type="secondary">Token {item.totalTokens || 0}</Text>
                          {item.error && <Text type="danger">{item.error}</Text>}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<Space><BugOutlined />错误原因</Space>} className="instance-runtime-card">
            {observationStats.errorReasons.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="最近没有错误" />
            ) : (
              <List
                size="small"
                dataSource={observationStats.errorReasons}
                renderItem={item => (
                  <List.Item>
                    <Space direction="vertical" size={2}>
                      <Text strong>{item.label}</Text>
                      <Text type="danger">{item.error || item.status}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
            <Button block style={{ marginTop: 12 }} icon={<FileTextOutlined />} onClick={() => {
              const local = localInstances[0] || instances[0]
              if (local) openInstanceLogs(local)
            }}>打开日志入口</Button>
          </Card>
          <Card title={<Space><ToolOutlined />Token</Space>} className="instance-runtime-card" style={{ marginTop: 14 }}>
            <div className="instance-token-total">{observationStats.tokenTotal}</div>
            <Text type="secondary">最近记录累计 Token</Text>
          </Card>
        </Col>
      </Row>
    </div>
  )

  return (
    <div className="instance-manager-page">
      <div className="instance-hero">
        <div className="instance-hero-main">
          <Space align="center" size={10}>
            <CloudOutlined className="instance-hero-icon" />
            <Text type="secondary">连接与运行时</Text>
          </Space>
          <div className="instance-hero-title">连接灵枢可调用的运行环境</div>
          <Text type="secondary">
            本地运行时负责会话和配置，桌面 Agent 负责打开或投递到外部 AI App，远程/云端实例通过受控 HTTP API 接入。
          </Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={loadInstances} loading={loading}>刷新</Button>
          <Button icon={<ReloadOutlined />} loading={scanningAgents} onClick={scanLocalAgentApps}>
            扫描本机 Agent
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            添加实例
          </Button>
        </Space>
      </div>

      <Row gutter={[12, 12]} className="instance-stat-grid">
        <Col xs={12} md={6}>
          <Card className="instance-stat-card">
            <div>{instanceStats.total}</div>
            <Text type="secondary">全部实例</Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="instance-stat-card">
            <div>{instanceStats.configured}</div>
            <Text type="secondary">已配置</Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="instance-stat-card">
            <div>{instanceStats.runningAgents}</div>
            <Text type="secondary">运行中 Agent</Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="instance-stat-card">
            <div className={instanceStats.issues > 0 ? 'instance-stat-danger' : ''}>{instanceStats.issues}</div>
            <Text type="secondary">需要处理</Text>
          </Card>
        </Col>
      </Row>

      <Card className="instance-tabs-card" styles={{ body: { padding: 0 } }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          className="instance-tabs"
          items={[
            {
              key: 'local-runtime',
              label: '本地运行时',
              children: renderLocalRuntime()
            },
            {
              key: 'desktop',
              label: '桌面 Agent',
              children: renderDesktopAgents()
            },
            {
              key: 'remote',
              label: '远程/云端 Runtime',
              children: renderRemoteRuntime()
            },
            {
              key: 'activity',
              label: '运行观测',
              children: renderActivity()
            }
          ]}
        />
      </Card>

      <Modal
        title="本机 Agent 扫描结果"
        open={agentScanVisible}
        width={780}
        footer={null}
        onCancel={() => setAgentScanVisible(false)}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`已自动扫描 ${scanLocationText}`}
          description="这里会列出 WorkBuddy、Marvis、Codex、ChatGPT、Claude、Cursor、Orcha 等 Agent/AI 类桌面应用。加入后可在 AI 对话工具菜单中直接调用。"
        />
        {detectedAgentApps.length === 0 ? (
          <Empty description="没有发现 Agent 类应用。你仍可用“添加运行实例”手动添加。" />
        ) : (
          <List
            itemLayout="horizontal"
            dataSource={detectedAgentApps}
            renderItem={app => (
              <List.Item
                actions={[
                  app.instanceExists ? (
                    <Tag color="green" key="exists">已加入</Tag>
                  ) : (
                    <Button size="small" type="primary" key="add" onClick={() => addDetectedAgentApp(app)}>
                      加入实例
                    </Button>
                  )
                ]}
              >
                <List.Item.Meta
                  avatar={<DesktopOutlined style={{ fontSize: 22, color: '#1677ff' }} />}
                  title={
                    <Space wrap>
                      <span>{app.displayName || app.name}</span>
                      {app.version && <Tag>{app.version}</Tag>}
                      {app.matchedReason === 'keyword-match' && <Tag color="blue">关键词匹配</Tag>}
                      {app.invocation?.canUseCli && <Tag color="purple">CLI</Tag>}
                      {app.invocation?.canUseUrlScheme && <Tag color="geekblue">URL Scheme</Tag>}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2}>
                      {app.bundleId && <Text type="secondary">{app.bundleId}</Text>}
                      <Text type="secondary">{app.path}</Text>
                      {app.invocation?.note && <Text type="secondary">{app.invocation.note}</Text>}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Modal>

      <Modal
        title={selectedLogInstance ? `${selectedLogInstance.name} 日志` : '实例日志'}
        open={logsModalVisible}
        width={820}
        footer={null}
        onCancel={() => {
          setLogsModalVisible(false)
          setSelectedLogInstance(null)
          setInstanceLogs([])
        }}
      >
        <Spin spinning={logsLoading}>
          {instanceLogs.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无日志" />
          ) : (
            <List
              size="small"
              className="instance-log-list"
              dataSource={instanceLogs}
              renderItem={item => (
                <List.Item>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space wrap size={8}>
                      <Tag color={item.level === 'error' ? 'red' : item.level === 'warn' ? 'gold' : 'blue'}>{item.level}</Tag>
                      <Text type="secondary">{item.timestamp}</Text>
                      <Tag>{item.source}</Tag>
                    </Space>
                    <Text>{item.message}</Text>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Spin>
      </Modal>

      {/* 创建/编辑弹窗 */}
      <Modal
        title={editingInstance ? '编辑连接' : '添加连接'}
        open={modalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setModalVisible(false)
          form.resetFields()
          setEditingInstance(null)
        }}
      >
        <Form form={form} onFinish={handleSave} layout="vertical">
          <Form.Item
            name="name"
            label="实例名称"
            rules={[{ required: true, message: '请输入实例名称' }]}
          >
            <Input placeholder="如：Codex 桌面端 / WorkBuddy / Marvis" />
          </Form.Item>
          
          <Form.Item
            name="type"
            label="实例类型"
            rules={[{ required: true, message: '请选择实例类型' }]}
          >
            <Select placeholder="选择类型">
              <Option value="local">本地运行时</Option>
              <Option value="agent-desktop">Agent 桌面端</Option>
              <Option value="remote">远程服务器</Option>
              <Option value="cloud">云端服务</Option>
            </Select>
          </Form.Item>

          {selectedType === 'agent-desktop' && (
            <>
              <Form.Item
                name="appName"
                label="桌面 Agent 应用"
                rules={[{ required: true, message: '请选择或输入要连接的桌面 Agent 应用' }]}
                tooltip={`用于检测和打开${platformLabel}上的桌面 Agent。`}
              >
                <Select
                  placeholder="选择 WorkBuddy、Marvis、Codex 或自定义"
                  options={desktopAgentPresets}
                  onChange={(value) => {
                    if (value !== 'custom') {
                      form.setFieldsValue({
                        name: value,
                        configPath: isMac ? `/Applications/${value}.app` : '',
                        workspacePath: defaultWorkspacePath,
                        invocationMode: 'open'
                      })
                    }
                  }}
                />
              </Form.Item>

              {selectedAppName === 'custom' && (
                <Form.Item
                  name="customAppName"
                  label="自定义应用名称"
                  rules={[{ required: true, message: '请输入应用名称' }]}
                >
                  <Input placeholder="例如：Raycast / Cursor / 你的 Agent App 名称" />
                </Form.Item>
              )}

              <Form.Item
                name="invocationMode"
                label="调用方式"
                initialValue="open"
                tooltip="默认只打开 App；如果该 Agent 支持 URL Scheme 或 CLI，可以把对话指令自动投递过去。"
              >
                <Select
                  options={[
                    { value: 'open', label: '仅打开 App 并记录意图' },
                    { value: 'url-scheme', label: 'URL Scheme 投递' },
                    { value: 'cli', label: 'CLI 投递' }
                  ]}
                />
              </Form.Item>

              {selectedInvocationMode === 'url-scheme' && (
                <>
                  <Form.Item name="urlScheme" label="URL Scheme">
                    <Input placeholder="例如：codex / marvis / workbuddy" />
                  </Form.Item>
                  <Form.Item
                    name="urlTemplate"
                    label="URL 模板"
                    tooltip="支持 {{instruction}} 和 {{encodedInstruction}}。中文和空格建议使用 encodedInstruction。"
                  >
                    <Input placeholder="例如：codex://new?prompt={{encodedInstruction}}" />
                  </Form.Item>
                </>
              )}

              {selectedInvocationMode === 'cli' && (
                <>
                  <Form.Item name="cliCommand" label="CLI 命令路径">
                    <Input placeholder={isMac ? '例如：/opt/homebrew/bin/codex 或 codex' : '例如：codex 或 C:\\Program Files\\Codex\\codex.exe'} />
                  </Form.Item>
                  <Form.Item
                    name="cliArgsTemplate"
                    label="CLI 参数模板"
                    tooltip="支持 {{instruction}}。多参数可用空格分隔；复杂参数建议每行一个参数。"
                  >
                    <Input.TextArea rows={3} placeholder="{{instruction}}" />
                  </Form.Item>
                </>
              )}
            </>
          )}
          
          {(selectedType === 'remote' || selectedType === 'cloud') && (
            <>
              <Form.Item
                name="baseUrl"
                label="Runtime API 地址"
                rules={[{ required: true, message: '请输入远程 Runtime API 地址' }, { type: 'url', message: '请输入完整的 HTTP/HTTPS 地址' }]}
              >
                <Input placeholder="https://runtime.example.com:8443" />
              </Form.Item>
              <Form.Item name="apiToken" label="访问 Token">
                <Input.Password placeholder="Bearer Token；保存后不会再次显示原值" />
              </Form.Item>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="healthPath" label="健康检查路径" initialValue="/api/health">
                    <Input placeholder="/api/health" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="timeoutMs" label="超时（毫秒）" initialValue={8000}>
                    <Input type="number" min={1000} max={30000} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="restartPath" label="重启 API（可选）">
                    <Input placeholder="/api/runtime/restart" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="logsPath" label="日志 API（可选）">
                    <Input placeholder="/api/logs" />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}

          {selectedType !== 'remote' && selectedType !== 'cloud' && <Form.Item
            name="configPath"
            label={selectedType === 'agent-desktop' ? '应用路径 / 配置路径' : '配置路径'}
            rules={[{ required: true, message: '请输入配置路径' }]}
            initialValue="~/Lingshu/openclaw.json"
          >
            <Input placeholder={selectedType === 'agent-desktop' ? appPathExample : '~/Lingshu/openclaw.json'} />
          </Form.Item>}
          
          {selectedType !== 'remote' && selectedType !== 'cloud' && <Form.Item
            name="workspacePath"
            label="工作目录"
            rules={[{ required: true, message: '请输入工作目录' }]}
            initialValue="~/Lingshu/workspace"
          >
            <Input placeholder={defaultWorkspacePath} />
          </Form.Item>}
          
          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea placeholder="实例描述信息" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default InstanceManager
