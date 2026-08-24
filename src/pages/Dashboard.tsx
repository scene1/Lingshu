import React, { useState, useEffect, useCallback, useRef } from 'react'
import { 
  Layout, 
  Card, 
  Row, 
  Col, 
  Statistic, 
  Tag, 
  Table, 
  Progress,
  Timeline,
  Badge,
  List,
  Button,
  Space,
  Typography,
  Spin,
  Empty,
  Alert,
  Tabs,
  message,
  Drawer,
  Select,
  Descriptions
} from 'antd'
import {
  DatabaseOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  MessageOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  SyncOutlined,
  FileTextOutlined,
  AppstoreOutlined,
  TeamOutlined,
  BranchesOutlined,
  DownloadOutlined,
  BarChartOutlined,
  LinkOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { normalizeAgentsFromConfig, type AgentStatus } from '../utils/agents'
import type { RunRecord } from '../types'

const { Title, Text } = Typography

interface Agent {
  id: string
  name: string
  status: AgentStatus
  model: string | { primary?: string }
  lastActive: string
  messageCount: number
  uptime: string
}

interface Session {
  id: string
  agentId: string
  agentName: string
  status: 'active' | 'idle' | 'closed'
  startTime: string
  lastMessage: string
  messageCount: number
}

interface SystemStats {
  totalAgents: number
  runningAgents: number
  totalSessions: number
  activeSessions: number
  totalSkills: number
  activeSkills: number
  systemUptime: string
  cpuUsage: number
  memoryUsage: number
  // Phase 2 扩展字段
  todayChats?: number
  todayTokens?: number
  activeAgents?: number
  activeAutomations?: number
}

interface LogEntry {
  id?: string
  timestamp?: string
  time?: string
  level?: string
  source?: string
  message?: string
  text?: string
}

interface SelfCheckItem {
  key: string
  label: string
  ok: boolean
  value?: string
  path?: string
}

interface SelfCheck {
  ok: boolean
  productName: string
  version: string
  commit?: string
  port: number
  dataDir: string
  distPath?: string
  time: string
  checks: SelfCheckItem[]
}

interface SearchIndexStatus {
  available: boolean
  reason?: string
  dbPath?: string
  indexedCount: number
  vaultCount?: number
  staleCount?: number
  lastIndexedAt?: string
}

interface ModelEvaluationModel {
  model: string
  provider?: string
  responseCount: number
  callCount: number
  errorCount: number
  feedbackTotal: number
  likes: number
  dislikes: number
  adoptedCount: number
  abCandidateCount: number
  avgLatencyMs: number
  usefulRate: number | null
  adoptionRate: number | null
  errorRate: number
  score: number
  lastUsedAt?: string
}

interface ModelEvaluationData {
  generatedAt: string
  summary: {
    models: number
    responses: number
    calls: number
    feedback: number
    usefulRate: number | null
    abRuns: number
    adoptions: number
    avgLatencyMs: number
    errorRate: number
  }
  models: ModelEvaluationModel[]
  recentAB: Array<Record<string, any>>
}

const Dashboard: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('workbench')
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [recentActivity, setRecentActivity] = useState<any[]>([])
  const [runHistory, setRunHistory] = useState<RunRecord[]>([])
  const [runHistoryType, setRunHistoryType] = useState<string>('all')
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null)
  const [modelEvaluation, setModelEvaluation] = useState<ModelEvaluationData | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logStats, setLogStats] = useState({ total: 0, info: 0, warn: 0, error: 0 })
  const [selfCheck, setSelfCheck] = useState<SelfCheck | null>(null)
  const [searchIndexStatus, setSearchIndexStatus] = useState<SearchIndexStatus | null>(null)
  const [rebuildingSearchIndex, setRebuildingSearchIndex] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const navigate = useNavigate()

  const getRunSourceRoute = (run?: RunRecord | null) => {
    if (!run) return ''
    const targetId = run.targetId || ''
    const input = (run.input && typeof run.input === 'object' ? run.input : {}) as Record<string, any>
    if (run.type === 'workflow') return '/workflows'
    if (run.type === 'automation') return '/automations'
    if (run.type === 'tool') return '/tool-registry'
    if (run.type === 'skill') return '/skills'
    if (run.type === 'agent_team') return '/group-chat'
    if (run.type === 'model_eval') return '/system-overview'
    if (run.type === 'chat' || input.sessionId || targetId.startsWith('session')) return '/'
    return ''
  }

  const openRunSource = (run: RunRecord) => {
    const route = getRunSourceRoute(run)
    if (!route) {
      message.info('这条运行记录暂时没有可跳转的来源页面')
      return
    }
    setSelectedRun(null)
    navigate(route)
  }

  const loadDashboardData = useCallback(async () => {
    try {
      let nextStats: SystemStats | null = null
      const statsRes = await fetch('/api/dashboard/stats')
      if (statsRes.ok) {
        nextStats = await statsRes.json()
      }

      let nextAgents: Agent[] = []
      const configRes = await fetch('/api/config')
      if (configRes.ok) {
        const config = await configRes.json()
        nextAgents = normalizeAgentsFromConfig(config)
        setAgents(nextAgents)
      } else {
        setAgents([])
      }

      if (nextStats) {
        setStats({
          ...nextStats,
          totalAgents: nextAgents.length,
          runningAgents: nextAgents.filter(agent => agent.status === 'running').length
        })
      }

      const sessionsRes = await fetch('/api/sessions/active')
      if (sessionsRes.ok) {
        setSessions(await sessionsRes.json())
      }

      const activityRes = await fetch('/api/dashboard/activity')
      if (activityRes.ok) {
        setRecentActivity(await activityRes.json())
      }

      const logsRes = await fetch('/api/logs')
      if (logsRes.ok) {
        const data = await logsRes.json()
        const entries = data.entries || data.logs || data || []
        const nextLogs = Array.isArray(entries) ? entries : []
        setLogs(nextLogs.slice(0, 50))
        setLogStats({
          total: nextLogs.length,
          info: nextLogs.filter((entry: LogEntry) => entry.level === 'info').length,
          warn: nextLogs.filter((entry: LogEntry) => entry.level === 'warn' || entry.level === 'warning').length,
          error: nextLogs.filter((entry: LogEntry) => entry.level === 'error').length
        })
      }

      const selfCheckRes = await fetch('/api/system/self-check')
      if (selfCheckRes.ok) {
        setSelfCheck(await selfCheckRes.json())
      }

      const searchIndexRes = await fetch('/api/documents/index/status')
      if (searchIndexRes.ok) {
        setSearchIndexStatus(await searchIndexRes.json())
      }

      const runHistoryParams = new URLSearchParams({ limit: '20' })
      if (runHistoryType !== 'all') runHistoryParams.set('type', runHistoryType)
      const runHistoryRes = await fetch(`/api/run-history?${runHistoryParams.toString()}`)
      if (runHistoryRes.ok) {
        const data = await runHistoryRes.json()
        setRunHistory(Array.isArray(data.records) ? data.records : [])
      }

      const modelEvalRes = await fetch('/api/model-evaluations?limit=1200')
      if (modelEvalRes.ok) {
        setModelEvaluation(await modelEvalRes.json())
      }
    } catch (error) {
      console.error('加载数据失败:', error)
    } finally {
      setLoading(false)
    }
  }, [runHistoryType])

  const rebuildSearchIndex = useCallback(async () => {
    setRebuildingSearchIndex(true)
    try {
      const res = await fetch('/api/documents/index/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true, maxFiles: 10000 })
      })
      const data = await res.json()
      if (!res.ok || data.success === false) {
        throw new Error(data.error || data.reason || '重建知识库索引失败')
      }
      setSearchIndexStatus(data.status || null)
      message.success(`索引已重建：更新 ${data.indexed || 0}，跳过 ${data.skipped || 0}，删除 ${data.deleted || 0}`)
      loadDashboardData()
    } catch (error: any) {
      message.error(error.message || '重建知识库索引失败')
    } finally {
      setRebuildingSearchIndex(false)
    }
  }, [loadDashboardData])

  useEffect(() => {
    loadDashboardData()
    const interval = setInterval(loadDashboardData, 10000)
    pollRef.current = interval
    // 页面不可见时暂停轮询，可见时恢复（动态间隔：活跃 10s / 非活跃 30s）
    const handleVisibility = () => {
      if (document.hidden) {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = setInterval(loadDashboardData, 30000)
      } else {
        if (pollRef.current) clearInterval(pollRef.current)
        loadDashboardData()
        pollRef.current = setInterval(loadDashboardData, 10000)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [loadDashboardData])

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  const services = [
    { name: '前端界面', status: 'running', port: 'Vite/Electron' },
    { name: '后端 API', status: stats ? 'running' : 'unknown', port: 'Express' },
    { name: 'Markdown Vault', status: 'running', port: '本地文件系统' }
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
      case 'active':
        return 'success'
      case 'idle':
        return 'warning'
      case 'stopped':
      case 'closed':
        return 'default'
      case 'error':
        return 'error'
      case 'unknown':
        return 'warning'
      default:
        return 'default'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
      case 'active':
        return <CheckCircleOutlined />
      case 'idle':
        return <ClockCircleOutlined />
      case 'error':
        return <ExclamationCircleOutlined />
      case 'unknown':
        return <ExclamationCircleOutlined />
      default:
        return <ClockCircleOutlined />
    }
  }

  const getRunTypeLabel = (type: string) => {
    if (type === 'agent_team') return 'Agent Team'
    if (type === 'workflow') return 'Workflow'
    if (type === 'automation') return 'Automation'
    if (type === 'tool') return 'Tool'
    if (type === 'skill') return 'Skill'
    if (type === 'model_eval') return '模型评测'
    return type || 'Run'
  }

  const getRunTypeColor = (type: string) => {
    if (type === 'agent_team') return 'purple'
    if (type === 'workflow') return 'blue'
    if (type === 'automation') return 'green'
    if (type === 'tool') return 'orange'
    if (type === 'skill') return 'cyan'
    if (type === 'model_eval') return 'magenta'
    return 'default'
  }

  const getRunStatusLabel = (status: string) => {
    if (status === 'success') return '成功'
    if (status === 'error') return '失败'
    if (status === 'running') return '运行中'
    if (status === 'queued') return '排队中'
    if (status === 'cancelled') return '已取消'
    return status || '未知'
  }

  const getRunStatusColor = (status: string) => {
    if (status === 'success') return 'success'
    if (status === 'error') return 'error'
    if (status === 'running' || status === 'queued') return 'processing'
    if (status === 'cancelled') return 'default'
    return 'default'
  }

  const formatRunJson = (value: unknown) => {
    if (value === undefined || value === null || value === '') return '-'
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  const exportRunHistory = () => {
    if (runHistory.length === 0) {
      message.info('暂无可导出的运行记录')
      return
    }
    const blob = new Blob([JSON.stringify(runHistory, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `lingshu-run-history-${runHistoryType}-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const modelEvaluationColumns = [
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      render: (model: string, record: ModelEvaluationModel) => (
        <Space direction="vertical" size={0}>
          <Text strong ellipsis={{ tooltip: model }} style={{ maxWidth: 220 }}>{model}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.provider || 'provider 未记录'}
          </Text>
        </Space>
      ),
    },
    {
      title: '综合分',
      dataIndex: 'score',
      key: 'score',
      width: 92,
      render: (score: number) => <Progress type="circle" percent={score || 0} size={42} />,
    },
    {
      title: '调用/回复',
      key: 'usage',
      width: 110,
      render: (_: any, record: ModelEvaluationModel) => (
        <Text>{record.callCount || 0} / {record.responseCount || 0}</Text>
      ),
    },
    {
      title: '反馈',
      key: 'feedback',
      width: 130,
      render: (_: any, record: ModelEvaluationModel) => (
        <Space direction="vertical" size={0}>
          <Text>{record.usefulRate === null ? '-' : `${record.usefulRate}%`} 有用</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.likes || 0} 赞 / {record.dislikes || 0} 踩
          </Text>
        </Space>
      ),
    },
    {
      title: 'A/B 采用',
      key: 'adoption',
      width: 120,
      render: (_: any, record: ModelEvaluationModel) => (
        <Space direction="vertical" size={0}>
          <Text>{record.adoptionRate === null ? '-' : `${record.adoptionRate}%`}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.adoptedCount || 0} / {record.abCandidateCount || 0}
          </Text>
        </Space>
      ),
    },
    {
      title: '延迟/错误',
      key: 'quality',
      width: 130,
      render: (_: any, record: ModelEvaluationModel) => (
        <Space direction="vertical" size={0}>
          <Text>{record.avgLatencyMs ? `${record.avgLatencyMs}ms` : '-'}</Text>
          <Text type={record.errorRate > 0 ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
            错误率 {record.errorRate || 0}%
          </Text>
        </Space>
      ),
    },
  ]

  const agentColumns = [
    {
      title: 'Agent',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, _record: Agent) => (
        <Space>
          <RobotOutlined style={{ color: '#1890ff' }} />
          <Text strong>{text}</Text>
        </Space>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag icon={getStatusIcon(status)} color={getStatusColor(status)}>
          {status === 'running' ? '运行中' : status === 'stopped' ? '已停止' : status === 'error' ? '错误' : status === 'unknown' ? '未设置' : status}
        </Tag>
      )
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      render: (model: any) => {
        const label = typeof model === 'object' ? (model.primary || model.name || JSON.stringify(model)) : (model || 'N/A')
        return <Tag color="blue">{label}</Tag>
      }
    },
    {
      title: '消息数',
      dataIndex: 'messageCount',
      key: 'messageCount',
      render: (count: number) => <Text>{count.toLocaleString()}</Text>
    },
    {
      title: '运行时间',
      dataIndex: 'uptime',
      key: 'uptime'
    },
    {
      title: '最后活跃',
      dataIndex: 'lastActive',
      key: 'lastActive',
      render: (time: string) => <Text type="secondary">{time || '从未活跃'}</Text>
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Agent) => (
        <Space>
          {record.status !== 'running' && (
            <Button
              type="primary"
              size="small"
              icon={<ThunderboltOutlined />}
              onClick={async () => {
                try {
                  const response = await fetch(`/api/instances/local/agents/${record.id}/start`, { method: 'POST' })
                  if (response.ok) {
                    message.success(`${record.name} 已启动`)
                    loadDashboardData()
                  } else {
                    message.error('启动失败')
                  }
                } catch (error) {
                  message.error('启动请求失败')
                }
              }}
            >
              启动
            </Button>
          )}
          <Button type="primary" size="small" icon={<MessageOutlined />}>
            对话
          </Button>
          <Button size="small" icon={<ThunderboltOutlined />}>
            配置
          </Button>
        </Space>
      )
    }
  ]

  const sessionColumns = [
    {
      title: '会话 ID',
      dataIndex: 'id',
      key: 'id',
      render: (id: string) => <Text code>{id.slice(0, 8)}...</Text>
    },
    {
      title: 'Agent',
      dataIndex: 'agentName',
      key: 'agentName',
      render: (name: string) => (
        <Space>
          <RobotOutlined style={{ color: '#52c41a' }} />
          {name}
        </Space>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Badge 
          status={status === 'active' ? 'processing' : status === 'idle' ? 'warning' : 'default'} 
          text={status === 'active' ? '活跃' : status === 'idle' ? '空闲' : '已关闭'}
        />
      )
    },
    {
      title: '消息数',
      dataIndex: 'messageCount',
      key: 'messageCount'
    },
    {
      title: '最后消息',
      dataIndex: 'lastMessage',
      key: 'lastMessage',
      ellipsis: true,
      render: (text: string) => <Text type="secondary">{text}</Text>
    },
    {
      title: '开始时间',
      dataIndex: 'startTime',
      key: 'startTime',
      render: (time: string) => new Date(time).toLocaleString('zh-CN')
    }
  ]

  const logLevelColor = (level?: string) => {
    if (level === 'error') return 'red'
    if (level === 'warn' || level === 'warning') return 'orange'
    if (level === 'info') return 'blue'
    return 'default'
  }

  if (loading) {
    return (
      <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <Spin size="large" tip="加载中..." />
        </div>
      </Layout>
    )
  }

  // 工作台首屏视图
  const workbenchView = (
    <div>
      {/* 今日概览卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}>
          <Card hoverable onClick={() => navigate('/')}>
            <Statistic
              title="今日对话"
              value={stats?.todayChats ?? stats?.activeSessions ?? 0}
              prefix={<MessageOutlined style={{ color: '#1890ff' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card hoverable>
            <Statistic
              title="活跃 Agent"
              value={stats?.activeAgents ?? stats?.runningAgents ?? 0}
              prefix={<RobotOutlined style={{ color: '#52c41a' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card hoverable onClick={() => navigate('/automations')}>
            <Statistic
              title="自动化任务"
              value={stats?.activeAutomations ?? 0}
              prefix={<BranchesOutlined style={{ color: '#722ed1' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card hoverable>
            <Statistic
              title="Token 用量"
              value={stats?.todayTokens ?? 0}
              prefix={<ThunderboltOutlined style={{ color: '#fa8c16' }} />}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <Space>
            <BarChartOutlined />
            模型评测与 A/B
          </Space>
        }
        size="small"
        style={{ marginBottom: 24 }}
        extra={<Button type="link" size="small" onClick={loadDashboardData}>刷新</Button>}
      >
        {modelEvaluation && modelEvaluation.models.length > 0 ? (
          <>
            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
              <Col xs={12} sm={6}>
                <Statistic title="评测模型" value={modelEvaluation.summary.models || 0} />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic title="调用样本" value={modelEvaluation.summary.calls || modelEvaluation.summary.responses || 0} />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="有用反馈"
                  value={modelEvaluation.summary.usefulRate ?? 0}
                  suffix={modelEvaluation.summary.usefulRate === null ? '' : '%'}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic title="A/B 采用" value={modelEvaluation.summary.adoptions || 0} />
              </Col>
            </Row>
            <Table
              columns={modelEvaluationColumns}
              dataSource={modelEvaluation.models.slice(0, 6)}
              rowKey="model"
              pagination={false}
              size="small"
            />
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              综合分按有用反馈、A/B 采用率和错误率计算；样本少时仅作方向参考。
            </Text>
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无模型评测样本。使用对比模式并采用回复，或给 AI 回复点赞/点踩后这里会开始累积。"
          />
        )}
      </Card>

      {/* 快捷操作 */}
      <Card title="快捷操作" size="small" style={{ marginBottom: 24 }}>
        <Row gutter={[16, 16]}>
          <Col span={4}>
            <Card hoverable size="small" onClick={() => navigate('/')} style={{ textAlign: 'center' }}>
              <MessageOutlined style={{ fontSize: 24, color: '#1890ff' }} />
              <div style={{ marginTop: 8, fontSize: 12 }}>新对话</div>
            </Card>
          </Col>
          <Col span={4}>
            <Card hoverable size="small" onClick={() => navigate('/agents')} style={{ textAlign: 'center' }}>
              <RobotOutlined style={{ fontSize: 24, color: '#52c41a' }} />
              <div style={{ marginTop: 8, fontSize: 12 }}>Agent 管理</div>
            </Card>
          </Col>
          <Col span={4}>
            <Card hoverable size="small" onClick={() => navigate('/tool-registry')} style={{ textAlign: 'center' }}>
              <AppstoreOutlined style={{ fontSize: 24, color: '#722ed1' }} />
              <div style={{ marginTop: 8, fontSize: 12 }}>工具注册表</div>
            </Card>
          </Col>
          <Col span={4}>
            <Card hoverable size="small" onClick={() => navigate('/automations')} style={{ textAlign: 'center' }}>
              <BranchesOutlined style={{ fontSize: 24, color: '#fa8c16' }} />
              <div style={{ marginTop: 8, fontSize: 12 }}>自动化</div>
            </Card>
          </Col>
          <Col span={4}>
            <Card hoverable size="small" onClick={() => navigate('/group-chat')} style={{ textAlign: 'center' }}>
              <TeamOutlined style={{ fontSize: 24, color: '#13c2c2' }} />
              <div style={{ marginTop: 8, fontSize: 12 }}>多 Agent 群聊</div>
            </Card>
          </Col>
          <Col span={4}>
            <Card hoverable size="small" onClick={() => navigate('/documents')} style={{ textAlign: 'center' }}>
              <FileTextOutlined style={{ fontSize: 24, color: '#eb2f96' }} />
              <div style={{ marginTop: 8, fontSize: 12 }}>文档工作台</div>
            </Card>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        {/* 最近对话 */}
        <Col xs={24} lg={16}>
          <Card title="最近对话" size="small" extra={<Button type="link" onClick={() => navigate('/')}>查看全部</Button>}>
            {recentActivity.length > 0 ? (
              <List
                size="small"
                dataSource={recentActivity.slice(0, 8)}
                renderItem={(item: any) => (
                  <List.Item
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate('/')}
                  >
                    <List.Item.Meta
                      avatar={<MessageOutlined style={{ color: '#1890ff', fontSize: 16 }} />}
                      title={<Text ellipsis style={{ maxWidth: 400 }}>{item.message}</Text>}
                      description={<Text type="secondary" style={{ fontSize: 12 }}>{item.time}</Text>}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="暂无对话记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>

        {/* 统一运行历史 */}
        <Col xs={24} lg={8}>
          <Card
            title="运行历史"
            size="small"
            extra={
              <Space size={6}>
                <Select
                  size="small"
                  value={runHistoryType}
                  onChange={setRunHistoryType}
                  style={{ width: 118 }}
                  options={[
                    { value: 'all', label: '全部' },
                    { value: 'agent_team', label: 'Agent Team' },
                    { value: 'workflow', label: 'Workflow' },
                    { value: 'automation', label: 'Automation' },
                    { value: 'tool', label: 'Tool' },
                    { value: 'skill', label: 'Skill' },
                    { value: 'model_eval', label: '模型评测' },
                  ]}
                />
                <Button size="small" icon={<DownloadOutlined />} onClick={exportRunHistory} />
                <Button type="link" size="small" onClick={loadDashboardData}>刷新</Button>
              </Space>
            }
          >
            {runHistory.length > 0 ? (
              <List
                size="small"
                dataSource={runHistory.slice(0, 8)}
                renderItem={run => (
                  <List.Item
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedRun(run)}
                    actions={[
                      getRunSourceRoute(run) ? (
                        <Button
                          key="open"
                          type="link"
                          size="small"
                          icon={<LinkOutlined />}
                          onClick={(event) => {
                            event.stopPropagation()
                            openRunSource(run)
                          }}
                        >
                          打开
                        </Button>
                      ) : null,
                      <Button key="detail" type="link" size="small">详情</Button>,
                    ].filter(Boolean)}
                  >
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space wrap>
                        <Tag color={getRunTypeColor(run.type)}>{getRunTypeLabel(run.type)}</Tag>
                        <Tag color={getRunStatusColor(run.status)}>
                          {getRunStatusLabel(run.status)}
                        </Tag>
                        {typeof run.durationMs === 'number' && (
                          <Text type="secondary" style={{ fontSize: 12 }}>{run.durationMs}ms</Text>
                        )}
                      </Space>
                      <Text ellipsis={{ tooltip: run.targetName || run.targetId }} style={{ maxWidth: 260 }}>
                        {run.targetName || run.targetId || run.id}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {run.finishedAt ? new Date(run.finishedAt).toLocaleString('zh-CN') : new Date(run.startedAt).toLocaleString('zh-CN')}
                        {Array.isArray(run.steps) && run.steps.length > 0 ? ` · ${run.steps.length} 步` : ''}
                      </Text>
                      {run.error && (
                        <Text type="danger" ellipsis={{ tooltip: run.error }} style={{ fontSize: 12 }}>
                          {run.error}
                        </Text>
                      )}
                    </Space>
                  </List.Item>
                )}
              />
            ) : recentActivity.length > 0 ? (
              <Timeline mode="left">
                {recentActivity.slice(0, 6).map((activity, index) => (
                  <Timeline.Item
                    key={index}
                    color={activity.type === 'error' ? 'red' : activity.type === 'warning' ? 'orange' : 'green'}
                  >
                    <Text style={{ fontSize: 13 }}>{activity.message}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>{activity.time}</Text>
                  </Timeline.Item>
                ))}
              </Timeline>
            ) : (
              <Empty description="暂无运行记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5', padding: '24px' }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'workbench',
            label: '工作台',
            children: workbenchView,
          },
          {
            key: 'system',
            label: '系统状态',
            children: (
              <>
                <Title level={2} style={{ marginBottom: 24 }}>
                  <DatabaseOutlined style={{ marginRight: 12 }} />
                  系统概览
                </Title>
                <Text type="secondary" style={{ display: 'block', marginTop: -16, marginBottom: 24 }}>
                  合并系统状态与运行分析：统一查看 Agent、会话、Skills、资源、服务状态和最近日志。当前时间：{currentTime.toLocaleString('zh-CN')}
                </Text>

      <Card
        title="发布与运行自检"
        extra={<Button icon={<SyncOutlined />} onClick={loadDashboardData}>刷新自检</Button>}
        style={{ marginBottom: 24 }}
      >
        {selfCheck ? (
          <>
            <Space size="small" wrap style={{ marginBottom: 16 }}>
              <Tag color={selfCheck.ok ? 'success' : 'warning'} icon={selfCheck.ok ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}>
                {selfCheck.ok ? '自检通过' : '有项目需要确认'}
              </Tag>
              <Tag color="blue">{selfCheck.productName} v{selfCheck.version}</Tag>
              {selfCheck.commit && <Tag>commit {selfCheck.commit}</Tag>}
              <Tag>API :{selfCheck.port}</Tag>
              <Text type="secondary">数据目录：{selfCheck.dataDir}</Text>
            </Space>
            <List
              grid={{ gutter: 12, xs: 1, sm: 2, md: 2, lg: 4, xl: 4, xxl: 4 }}
              dataSource={selfCheck.checks}
              renderItem={item => (
                <List.Item>
                  <Card size="small">
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space>
                        <Badge status={item.ok ? 'success' : 'warning'} />
                        <Text strong>{item.label}</Text>
                      </Space>
                      <Text type="secondary" ellipsis={{ tooltip: item.value || item.path || '-' }}>
                        {item.value || item.path || '-'}
                      </Text>
                    </Space>
                  </Card>
                </List.Item>
              )}
            />
            <Card size="small" style={{ marginTop: 16 }} bodyStyle={{ padding: 12 }}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Space wrap>
                    <DatabaseOutlined style={{ color: '#1890ff' }} />
                    <Text strong>Markdown 搜索索引</Text>
                    <Tag color={searchIndexStatus?.available ? 'success' : 'warning'}>
                      {searchIndexStatus?.available ? 'SQLite FTS5 可用' : '未就绪'}
                    </Tag>
                    {typeof searchIndexStatus?.staleCount === 'number' && searchIndexStatus.staleCount > 0 && (
                      <Tag color="orange">待更新 {searchIndexStatus.staleCount}</Tag>
                    )}
                  </Space>
                  <Button
                    size="small"
                    icon={<SyncOutlined spin={rebuildingSearchIndex} />}
                    loading={rebuildingSearchIndex}
                    onClick={rebuildSearchIndex}
                  >
                    重建索引
                  </Button>
                </Space>
                {searchIndexStatus ? (
                  <Space size="middle" wrap>
                    <Text type="secondary">已索引：{searchIndexStatus.indexedCount || 0}</Text>
                    <Text type="secondary">Vault 文件：{searchIndexStatus.vaultCount || 0}</Text>
                    <Text type="secondary">
                      最近更新：{searchIndexStatus.lastIndexedAt ? new Date(searchIndexStatus.lastIndexedAt).toLocaleString('zh-CN') : '未记录'}
                    </Text>
                    <Text type={searchIndexStatus.available ? 'secondary' : 'warning'} ellipsis={{ tooltip: searchIndexStatus.reason || searchIndexStatus.dbPath || '-' }}>
                      {searchIndexStatus.reason || searchIndexStatus.dbPath || '-'}
                    </Text>
                  </Space>
                ) : (
                  <Text type="secondary">正在读取索引状态…</Text>
                )}
              </Space>
            </Card>
          </>
        ) : (
          <Alert
            type="warning"
            showIcon
            message="暂未读取到自检结果"
            description="请确认灵枢后端服务已启动，并稍后刷新。"
          />
        )}
      </Card>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card>
            <Statistic
              title="总 Agents"
              value={stats?.totalAgents || 0}
              prefix={<RobotOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
            <Progress 
              percent={stats && stats.totalAgents > 0 ? Math.round((stats.runningAgents / stats.totalAgents) * 100) : 0} 
              size="small"
              status="active"
            />
            <Text type="secondary">{stats?.runningAgents || 0} 运行中</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card>
            <Statistic
              title="活跃会话"
              value={stats?.activeSessions || 0}
              prefix={<MessageOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
            <Text type="secondary">总计 {stats?.totalSessions || 0} 会话</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card>
            <Statistic
              title="Skills"
              value={stats?.activeSkills || 0}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#722ed1' }}
              suffix={`/ ${stats?.totalSkills || 0}`}
            />
            <Text type="secondary">已启用</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card>
            <Statistic
              title="系统运行时间"
              value={stats?.systemUptime || '0h'}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#fa8c16' }}
            />
            <Space>
              <Tag color={stats && stats.memoryUsage > 90 ? 'red' : 'blue'}>CPU {stats?.cpuUsage || 0}%</Tag>
              <Tag color={stats && stats.memoryUsage > 90 ? 'red' : (stats && stats.memoryUsage > 70 ? 'orange' : 'green')}>内存 {stats?.memoryUsage || 0}%</Tag>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card>
            <Statistic
              title="日志条目"
              value={logStats.total}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: logStats.error > 0 ? '#ff4d4f' : '#13c2c2' }}
            />
            <Space>
              <Tag color="blue">INFO {logStats.info}</Tag>
              <Tag color={logStats.warn > 0 ? 'orange' : 'default'}>WARN {logStats.warn}</Tag>
              <Tag color={logStats.error > 0 ? 'red' : 'green'}>ERROR {logStats.error}</Tag>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 内存告警 */}
      {stats && stats.memoryUsage > 90 && (
        <Alert
          message="内存使用过高"
          description={`当前内存使用率 ${stats.memoryUsage}%，已超过 90% 阈值。建议关闭不必要的应用或重启系统以释放内存，避免影响系统稳定性。`}
          type="error"
          showIcon
          icon={<ExclamationCircleOutlined />}
          style={{ marginBottom: 24 }}
          action={
            <Button size="small" danger onClick={() => window.open('x-apple.systempreferences:com.apple.preference.memory', '_blank')}>
              查看内存
            </Button>
          }
        />
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={10}>
          <Card title="服务状态">
            <List
              dataSource={services}
              renderItem={item => (
                <List.Item>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Space>
                      <Badge status={item.status === 'running' ? 'success' : 'warning'} text={item.name} />
                      <Text type="secondary">{item.port}</Text>
                    </Space>
                    <Tag color={item.status === 'running' ? 'success' : 'warning'}>
                      {item.status === 'running' ? '运行中' : '待确认'}
                    </Tag>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="最近日志" extra={<Button icon={<SyncOutlined />} onClick={loadDashboardData}>刷新</Button>}>
            {logs.length === 0 ? (
              <Empty description="暂无日志数据" />
            ) : (
              <List
                size="small"
                dataSource={logs.slice(0, 8)}
                renderItem={(entry: LogEntry) => (
                  <List.Item style={{ padding: '4px 0' }}>
                    <Space style={{ width: '100%' }} align="start">
                      <Text type="secondary" style={{ minWidth: 132, fontSize: 12 }}>
                        {(entry.timestamp || entry.time || '').substring(0, 19) || '-'}
                      </Text>
                      <Tag color={logLevelColor(entry.level)}>{(entry.level || 'log').toUpperCase()}</Tag>
                      <Text style={{ fontSize: 12, wordBreak: 'break-word' }}>
                        {entry.source && <Text type="secondary">[{entry.source}] </Text>}
                        {entry.message || entry.text || '-'}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* Agent 列表 */}
      <Card 
        title="Agent 状态" 
        extra={<Button icon={<SyncOutlined />} onClick={loadDashboardData}>刷新</Button>}
        style={{ marginBottom: 24 }}
      >
        <Table 
          columns={agentColumns} 
          dataSource={agents}
          rowKey="id"
          pagination={false}
          size="middle"
          locale={{ emptyText: <Empty description="暂无 Agent 数据" /> }}
        />
      </Card>

      {/* 活跃会话 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title="活跃会话">
            <Table
              columns={sessionColumns}
              dataSource={sessions}
              rowKey="id"
              pagination={{ pageSize: 5 }}
              size="small"
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="最近活动">
            <Timeline mode="left">
              {recentActivity.length > 0 ? recentActivity.map((activity, index) => (
                <Timeline.Item 
                  key={index}
                  color={activity.type === 'error' ? 'red' : activity.type === 'warning' ? 'orange' : 'green'}
                >
                  <Text>{activity.message}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>{activity.time}</Text>
                </Timeline.Item>
              )) : (
                <Empty description="暂无活动" />
              )}
            </Timeline>
          </Card>
        </Col>
      </Row>
              </>
            ),
          },
        ]}
      />
      <Drawer
        title="运行详情"
        open={!!selectedRun}
        onClose={() => setSelectedRun(null)}
        width={680}
      >
        {selectedRun && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {getRunSourceRoute(selectedRun) && (
              <Alert
                type="info"
                showIcon
                message="可打开来源页面"
                description={`将跳转到 ${getRunSourceRoute(selectedRun)}，用于继续查看或处理这条运行记录对应的对象。`}
                action={
                  <Button
                    type="primary"
                    size="small"
                    icon={<LinkOutlined />}
                    onClick={() => openRunSource(selectedRun)}
                  >
                    打开来源
                  </Button>
                }
              />
            )}
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="类型">
                <Tag color={getRunTypeColor(selectedRun.type)}>{getRunTypeLabel(selectedRun.type)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={getRunStatusColor(selectedRun.status)}>{getRunStatusLabel(selectedRun.status)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="目标">
                {selectedRun.targetName || selectedRun.targetId || selectedRun.id}
              </Descriptions.Item>
              <Descriptions.Item label="开始时间">
                {new Date(selectedRun.startedAt).toLocaleString('zh-CN')}
              </Descriptions.Item>
              <Descriptions.Item label="结束时间">
                {selectedRun.finishedAt ? new Date(selectedRun.finishedAt).toLocaleString('zh-CN') : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="耗时">
                {typeof selectedRun.durationMs === 'number' ? `${selectedRun.durationMs}ms` : '-'}
              </Descriptions.Item>
              {selectedRun.error && (
                <Descriptions.Item label="错误">
                  <Text type="danger">{selectedRun.error}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            <Card size="small" title="输入">
              <pre style={{ margin: 0, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {formatRunJson(selectedRun.input)}
              </pre>
            </Card>

            <Card size="small" title="输出">
              <pre style={{ margin: 0, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {formatRunJson(selectedRun.output)}
              </pre>
            </Card>

            <Card size="small" title={`步骤 (${selectedRun.steps?.length || 0})`}>
              {Array.isArray(selectedRun.steps) && selectedRun.steps.length > 0 ? (
                <List
                  size="small"
                  dataSource={selectedRun.steps}
                  renderItem={(step: Record<string, unknown>, index) => (
                    <List.Item>
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Space wrap>
                          <Tag>{String(step.type || `step-${index + 1}`)}</Tag>
                          <Tag color={getRunStatusColor(String(step.status || ''))}>
                            {getRunStatusLabel(String(step.status || ''))}
                          </Tag>
                          {typeof step.durationMs === 'number' && (
                            <Text type="secondary" style={{ fontSize: 12 }}>{step.durationMs}ms</Text>
                          )}
                        </Space>
                        <Text strong>{String(step.name || step.agentId || step.id || `步骤 ${index + 1}`)}</Text>
                        <pre style={{ margin: 0, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                          {formatRunJson(step)}
                        </pre>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description="暂无步骤详情" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Space>
        )}
      </Drawer>
    </Layout>
  )
}

export default Dashboard
