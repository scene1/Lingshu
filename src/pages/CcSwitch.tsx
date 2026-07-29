import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Layout,
  List,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message
} from 'antd'
import {
  CheckCircleOutlined,
  ReloadOutlined,
  SwapOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'

const { Content } = Layout
const { Title, Text, Paragraph } = Typography

interface CcProvider {
  id: string
  name: string
  appType: string
  category?: string
  api?: string
  baseUrl?: string
  modelCount: number
  firstModelId?: string
  firstModelName?: string
  isCurrent: boolean
}

interface CcStatus {
  dbExists: boolean
  dbPath: string
  providerCount: number
  currentProvider?: CcProvider
  proxy?: {
    enabled: boolean
    proxyEnabled: boolean
    listenAddress: string
    listenPort: number
    liveTakeoverActive: boolean
  }
}

const CcSwitch: React.FC = () => {
  const [providers, setProviders] = useState<CcProvider[]>([])
  const [status, setStatus] = useState<CcStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const loadData = async () => {
    setLoading(true)
    try {
      const [providersRes, statusRes] = await Promise.all([
        fetch('/api/cc-switch/providers?appType=openclaw'),
        fetch('/api/cc-switch/status?appType=openclaw')
      ])
      const providersData = await providersRes.json()
      const statusData = await statusRes.json()
      if (!providersRes.ok) throw new Error(providersData.message || providersData.error || '读取 CC Switch providers 失败')
      setProviders(providersData.providers || [])
      setStatus(statusData)
    } catch (error: any) {
      message.error(error.message || '读取 CC Switch 失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const filteredProviders = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return providers
    return providers.filter(provider =>
      provider.name.toLowerCase().includes(keyword) ||
      provider.id.toLowerCase().includes(keyword) ||
      (provider.baseUrl || '').toLowerCase().includes(keyword) ||
      (provider.firstModelName || '').toLowerCase().includes(keyword)
    )
  }, [providers, query])

  const handleSwitch = async (provider: CcProvider) => {
    setSwitchingId(provider.id)
    try {
      const res = await fetch('/api/cc-switch/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appType: 'openclaw', providerId: provider.id })
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.message || data.error || '切换失败')
      message.success(`已切换到 ${provider.name}`)
      await loadData()
    } catch (error: any) {
      message.error(error.message || '切换失败')
    } finally {
      setSwitchingId(null)
    }
  }

  if (loading && providers.length === 0) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />
  }

  return (
    <Layout style={{ minHeight: '100%', background: '#f5f5f5' }}>
      <Content style={{ padding: 24 }}>
        <Space align="center" style={{ marginBottom: 24, width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <SwapOutlined style={{ fontSize: 24, color: '#1890ff' }} />
            <Title level={3} style={{ margin: 0 }}>CC Switch</Title>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>刷新</Button>
        </Space>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="内置 CC Switch 路由"
          description="这里读取 ~/.cc-switch/cc-switch.db 的 openclaw 路由，切换后会同步写入 ~/.stepclaw/openclaw.json。"
        />

        <Space size="middle" wrap style={{ marginBottom: 16 }}>
          <Card size="small">
            <Statistic title="Provider" value={status?.providerCount || providers.length} />
          </Card>
          <Card size="small">
            <Statistic title="当前路由" value={status?.currentProvider?.name || '未选择'} />
          </Card>
          <Card size="small">
            <Statistic title="代理端口" value={status?.proxy ? `${status.proxy.listenAddress}:${status.proxy.listenPort}` : '未启用'} />
          </Card>
        </Space>

        {status?.currentProvider && (
          <Card size="small" style={{ marginBottom: 16 }} title="当前 OpenClaw 路由">
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="名称">{status.currentProvider.name}</Descriptions.Item>
              <Descriptions.Item label="协议">{status.currentProvider.api || '-'}</Descriptions.Item>
              <Descriptions.Item label="默认模型">{status.currentProvider.firstModelName || status.currentProvider.firstModelId || '-'}</Descriptions.Item>
              <Descriptions.Item label="模型数量">{status.currentProvider.modelCount}</Descriptions.Item>
              <Descriptions.Item label="Base URL" span={2}>
                <Text copyable>{status.currentProvider.baseUrl || '-'}</Text>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        )}

        <Card
          title="OpenClaw Providers"
          extra={<Input.Search allowClear placeholder="搜索路由、模型或 Base URL" style={{ width: 280 }} onChange={e => setQuery(e.target.value)} />}
        >
          {filteredProviders.length === 0 ? (
            <Empty description="没有找到 openclaw 路由" />
          ) : (
            <List
              dataSource={filteredProviders}
              renderItem={provider => (
                <List.Item
                  actions={[
                    <Button
                      key="switch"
                      type={provider.isCurrent ? 'default' : 'primary'}
                      icon={provider.isCurrent ? <CheckCircleOutlined /> : <ThunderboltOutlined />}
                      disabled={provider.isCurrent}
                      loading={switchingId === provider.id}
                      onClick={() => handleSwitch(provider)}
                    >
                      {provider.isCurrent ? '当前' : '切换'}
                    </Button>
                  ]}
                >
                  <List.Item.Meta
                    title={(
                      <Space wrap>
                        <Text strong>{provider.name}</Text>
                        {provider.isCurrent && <Tag color="success">当前</Tag>}
                        {provider.category && <Tag>{provider.category}</Tag>}
                        {provider.api && <Tag color="blue">{provider.api}</Tag>}
                      </Space>
                    )}
                    description={(
                      <Space direction="vertical" size={2}>
                        <Text type="secondary">{provider.firstModelName || provider.firstModelId || '未设置默认模型'} · {provider.modelCount} 个模型</Text>
                        <Paragraph copyable style={{ margin: 0 }} type="secondary">{provider.baseUrl || '未设置 Base URL'}</Paragraph>
                      </Space>
                    )}
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </Content>
    </Layout>
  )
}

export default CcSwitch
