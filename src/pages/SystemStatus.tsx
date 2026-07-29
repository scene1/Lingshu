import React, { useState, useEffect } from 'react'
import { 
  Card, 
  Tag, 
  Space, 
  Typography, 
  Row, 
  Col,
  Statistic,
  List,
  Badge
} from 'antd'
import { 
  RocketOutlined,
  SettingOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  CloudOutlined,
  RobotOutlined,
  BranchesOutlined
} from '@ant-design/icons'

const { Title, Text } = Typography

interface ServiceStatus {
  name: string
  url: string
  status: 'running' | 'stopped' | 'error'
  port: number
}

const SystemStatus: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [logs, setLogs] = useState<any[]>([])
  const [logStats, setLogStats] = useState({ total: 0, info: 0, warn: 0, error: 0 })
  const [dashboard, setDashboard] = useState<any>(null)

  useEffect(() => {
    // 每分钟更新一次即可，无需每秒 re-render
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then(r => r.json())
      .then(d => setDashboard(d))
      .catch(() => {})
    fetch('/api/logs')
      .then(r => r.json())
      .then(data => {
        const entries = data.entries || data.logs || data || []
        setLogs(entries.slice(0, 50))
        const info = entries.filter((e: any) => e.level === 'info').length
        const warn = entries.filter((e: any) => e.level === 'warn' || e.level === 'warning').length
        const error = entries.filter((e: any) => e.level === 'error').length
        setLogStats({ total: entries.length, info, warn, error })
      })
      .catch(() => {})
  }, [])

  // 服务状态
  const services: ServiceStatus[] = [
    { name: '前端服务', url: 'http://localhost:3000', status: 'running', port: 3000 },
    { name: '后端 API', url: 'http://localhost:3005', status: 'running', port: 3005 }
  ]

  const stats = {
    providers: 17,
    models: 100,
    instances: dashboard?.totalAgents || 2,
    skills: dashboard?.totalSkills || 37,
    logTotal: logStats.total,
    logError: logStats.error
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* 标题 */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ marginBottom: 8 }}>
          <DatabaseOutlined style={{ marginRight: 12 }} />
          系统状态与记忆
        </Title>
        <Text type="secondary">
          当前时间：{currentTime.toLocaleString('zh-CN', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit', 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
          })}
        </Text>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={4}>
          <Card>
            <Statistic 
              title="AI 提供商" 
              value={stats.providers} 
              prefix={<CloudOutlined />} 
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic 
              title="模型总数" 
              value={stats.models} 
              prefix={<RobotOutlined />} 
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic 
              title="实例数" 
              value={stats.instances} 
              prefix={<BranchesOutlined />} 
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic 
              title="Skills" 
              value={stats.skills} 
              prefix={<SettingOutlined />} 
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic 
              title="日志条目" 
              value={stats.logTotal} 
              prefix={<FileTextOutlined />} 
              valueStyle={{ color: '#13c2c2' }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic 
              title="错误日志" 
              value={stats.logError} 
              prefix={<RocketOutlined />} 
              valueStyle={{ color: stats.logError > 0 ? '#ff4d4f' : '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 日志概览 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card title="系统日志摘要">
            <Row gutter={16}>
              <Col span={8}><Statistic title="总计" value={logStats.total} valueStyle={{ color: '#1890ff' }} /></Col>
              <Col span={8}><Statistic title="INFO" value={logStats.info} valueStyle={{ color: '#52c41a' }} /></Col>
              <Col span={8}><Statistic title="ERROR" value={logStats.error} valueStyle={{ color: '#ff4d4f' }} /></Col>
            </Row>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="服务状态">
            <List
              dataSource={services}
              renderItem={item => (
                <List.Item>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Space>
                      <Badge status={item.status === 'running' ? 'success' : 'error'} text={item.name} />
                      <Text type="secondary">端口 {item.port}</Text>
                    </Space>
                    <Tag color={item.status === 'running' ? 'success' : 'error'}>
                      {item.status === 'running' ? '运行中' : '已停止'}
                    </Tag>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      {/* 实时日志 */}
      <Card title="实时日志 (最近50条)" style={{ marginBottom: 24 }}>
        {logs.length === 0 ? (
          <Text type="secondary">暂无日志数据</Text>
        ) : (
          <List
            size="small"
            dataSource={logs}
            renderItem={(entry: any) => {
              const levelColor = entry.level === 'error' ? 'red' : entry.level === 'warn' || entry.level === 'warning' ? 'orange' : entry.level === 'info' ? 'blue' : 'default'
              return (
                <List.Item style={{ padding: '2px 0', border: 'none' }}>
                  <Space style={{ width: '100%' }}>
                    <Text type="secondary" style={{ fontSize: 12, minWidth: 140 }}>
                      {entry.timestamp?.substring(0, 19) || entry.time || '-'}
                    </Text>
                    <Tag color={levelColor} style={{ fontSize: 11, lineHeight: '16px' }}>
                      {entry.level?.toUpperCase() || 'LOG'}
                    </Tag>
                    <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>
                      {entry.source && <Text type="secondary">[{entry.source}] </Text>}
                      {entry.message || entry.text || '-'}
                    </Text>
                  </Space>
                </List.Item>
              )
            }}
          />
        )}
      </Card>

      {/* 项目架构 */}
      <Card title="项目架构" style={{ marginBottom: 24 }}>
        <Row gutter={[16, 16]}>
          <Col span={8}>
            <Card type="inner" title="前端">
              <Space direction="vertical">
                <Tag>React 18</Tag>
                <Tag>TypeScript</Tag>
                <Tag>Ant Design 5</Tag>
                <Tag>Vite 5</Tag>
              </Space>
            </Card>
          </Col>
          <Col span={8}>
            <Card type="inner" title="后端">
              <Space direction="vertical">
                <Tag>Express.js</Tag>
                <Tag>Node.js 22</Tag>
                <Tag>ES Modules</Tag>
                <Tag>REST API</Tag>
              </Space>
            </Card>
          </Col>
          <Col span={8}>
            <Card type="inner" title="功能模块">
              <Space direction="vertical">
                <Tag>多实例管理</Tag>
                <Tag>模型配置</Tag>
                <Tag>聊天对话</Tag>
                <Tag>Skills 管理</Tag>
              </Space>
            </Card>
          </Col>
        </Row>
      </Card>

      {/* 支持的 AI 提供商 */}
      <Card title="支持的 AI 提供商" style={{ marginBottom: 24 }}>
        <Row gutter={[8, 8]}>
          {[
            { name: 'StepFun', icon: '🚀', color: 'blue' },
            { name: 'OpenAI', icon: '🅾️', color: 'green' },
            { name: 'Anthropic', icon: '🅰️', color: 'purple' },
            { name: '智谱 AI', icon: '🧠', color: 'cyan' },
            { name: '火山引擎', icon: '🌋', color: 'orange' },
            { name: '通义千问', icon: '🇶', color: 'red' },
            { name: 'DeepSeek', icon: '🔍', color: 'geekblue' },
            { name: '月之暗面', icon: '🌙', color: 'magenta' },
            { name: '百川智能', icon: '🌊', color: 'lime' },
            { name: 'OpenRouter', icon: '🔀', color: 'gold' },
            { name: 'SiliconFlow', icon: '💧', color: 'volcano' },
            { name: 'Google', icon: '🇬', color: 'blue' },
            { name: 'Cohere', icon: '🇨', color: 'green' },
            { name: 'Azure', icon: '☁️', color: 'blue' },
            { name: 'Groq', icon: '⚡', color: 'yellow' },
            { name: 'Together', icon: '🔷', color: 'purple' },
            { name: 'Perplexity', icon: '❓', color: 'cyan' },
          ].map((provider, index) => (
            <Col span={4} key={index}>
              <Tag color={provider.color} style={{ width: '100%', textAlign: 'center', padding: '8px 0' }}>
                <span style={{ fontSize: 16, marginRight: 4 }}>{provider.icon}</span>
                {provider.name}
              </Tag>
            </Col>
          ))}
        </Row>
      </Card>

      {/* 快速链接 */}
      <Card title="快速链接">
        <Row gutter={[16, 16]}>
          <Col span={6}>
            <Card type="inner" hoverable>
              <a href="http://localhost:3000/model-config" target="_blank" rel="noopener noreferrer">
                <Space>
                  <RobotOutlined />
                  模型配置
                </Space>
              </a>
            </Card>
          </Col>
          <Col span={6}>
            <Card type="inner" hoverable>
              <a href="http://localhost:3000/instances" target="_blank" rel="noopener noreferrer">
                <Space>
                  <CloudOutlined />
                  实例管理
                </Space>
              </a>
            </Card>
          </Col>
          <Col span={6}>
            <Card type="inner" hoverable>
              <a href="http://localhost:3000/skills" target="_blank" rel="noopener noreferrer">
                <Space>
                  <SettingOutlined />
                  Skills 管理
                </Space>
              </a>
            </Card>
          </Col>
          <Col span={6}>
            <Card type="inner" hoverable>
              <a href="http://localhost:3000/" target="_blank" rel="noopener noreferrer">
                <Space>
                  <ThunderboltOutlined />
                  AI 对话
                </Space>
              </a>
            </Card>
          </Col>
        </Row>
      </Card>
    </div>
  )
}

export default SystemStatus
