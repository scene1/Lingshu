import React, { useState, useEffect, useCallback } from 'react'
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
  message
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
  FileTextOutlined
} from '@ant-design/icons'
import { normalizeAgentsFromConfig, type AgentStatus } from '../utils/agents'

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

const Dashboard: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [recentActivity, setRecentActivity] = useState<any[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logStats, setLogStats] = useState({ total: 0, info: 0, warn: 0, error: 0 })
  const [currentTime, setCurrentTime] = useState(new Date())

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
    } catch (error) {
      console.error('加载数据失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDashboardData()
    const interval = setInterval(loadDashboardData, 30000)
    // 页面不可见时暂停轮询，可见时恢复
    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(interval)
      } else {
        loadDashboardData()
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        pollRef.current = setInterval(loadDashboardData, 30000)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      clearInterval(interval)
      if (pollRef.current) clearInterval(pollRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [loadDashboardData])

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  const pollRef = { current: null as ReturnType<typeof setInterval> | null }

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

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5', padding: '24px' }}>
      <Title level={2} style={{ marginBottom: 24 }}>
        <DatabaseOutlined style={{ marginRight: 12 }} />
        系统概览
      </Title>
      <Text type="secondary" style={{ display: 'block', marginTop: -16, marginBottom: 24 }}>
        合并 Dashboard 与系统状态：统一查看 Agent、会话、Skills、资源、服务状态和最近日志。当前时间：{currentTime.toLocaleString('zh-CN')}
      </Text>

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
    </Layout>
  )
}

export default Dashboard
