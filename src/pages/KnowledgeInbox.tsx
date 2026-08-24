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
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message
} from 'antd'
import {
  CheckCircleOutlined,
  DeleteOutlined,
  FileTextOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

type InboxStatus = 'captured' | 'processed' | 'ready' | 'written' | 'ignored'

interface KnowledgeInboxItem {
  id: string
  title: string
  sourceType: string
  sourceUrl?: string
  content: string
  summary?: string
  tags: string[]
  entities: string[]
  status: InboxStatus
  priority: string
  vaultRelativePath?: string
  feedback?: { value: string; note?: string; at: string } | null
  createdAt: string
  updatedAt: string
  processedAt?: string
  writtenAt?: string
}

interface InboxStats {
  total: number
  status: Record<string, number>
  sourceType: Record<string, number>
}

interface KnowledgeAutomationSource {
  id: string
  type: 'rss' | 'webhook' | 'cron'
  name: string
  url?: string
  cron?: string
  instruction?: string
  enabled: boolean
  tags: string[]
  token?: string
  seenKeys?: string[]
  lastScheduledMinute?: string
  lastRunAt?: string
  lastRunStatus?: string
  lastRunMessage?: string
  capturedCount?: number
}

const sourceTypeOptions = [
  { value: 'text', label: '文本 / 灵感' },
  { value: 'url', label: '网页 URL' },
  { value: 'document', label: '文档摘录' },
  { value: 'meeting', label: '会议内容' },
  { value: 'conversation', label: '对话记录' },
  { value: 'agent-output', label: 'Agent 输出' },
  { value: 'api', label: 'API / Webhook' },
  { value: 'rss', label: 'RSS' }
]

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'captured', label: '待处理' },
  { value: 'processed', label: '已处理' },
  { value: 'ready', label: '待写入' },
  { value: 'written', label: '已入库' },
  { value: 'ignored', label: '已忽略' }
]

const sourceFilterOptions = [{ value: '', label: '全部来源' }, ...sourceTypeOptions]

const automationTypeOptions = [
  { value: 'rss', label: 'RSS' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'cron', label: 'Cron' }
]

const apiJson = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, options)
  const text = await response.text()
  let data: any = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!response.ok) throw new Error(data.message || data.error || `请求失败 (${response.status})`)
  return data
}

const statusLabel = (status: string) => {
  const match = statusOptions.find(item => item.value === status)
  return match?.label || status
}

const statusColor = (status: string) => {
  if (status === 'captured') return 'orange'
  if (status === 'processed') return 'blue'
  if (status === 'ready') return 'cyan'
  if (status === 'written') return 'green'
  if (status === 'ignored') return 'default'
  return 'default'
}

const sourceTypeLabel = (sourceType: string) => sourceTypeOptions.find(item => item.value === sourceType)?.label || sourceType

const feedbackLabel = (value?: string) => {
  if (value === 'useful') return '有用'
  if (value === 'useless') return '无用'
  if (value === 'accepted') return '采纳'
  if (value === 'rejected') return '拒绝'
  return value || ''
}

const feedbackColor = (value?: string) => {
  if (value === 'useful') return 'green'
  if (value === 'useless') return 'orange'
  if (value === 'accepted') return 'blue'
  if (value === 'rejected') return 'red'
  return 'default'
}

const KnowledgeInbox: React.FC = () => {
  const [items, setItems] = useState<KnowledgeInboxItem[]>([])
  const [stats, setStats] = useState<InboxStats>({ total: 0, status: {}, sourceType: {} })
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [selectedItem, setSelectedItem] = useState<KnowledgeInboxItem | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [vaultFolder, setVaultFolder] = useState('灵枢/Inbox/知识流')
  const [automationSources, setAutomationSources] = useState<KnowledgeAutomationSource[]>([])
  const [automationLoading, setAutomationLoading] = useState(false)
  const [runningAutomationId, setRunningAutomationId] = useState('')
  const [form] = Form.useForm()
  const [automationForm] = Form.useForm()

  const loadInbox = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (statusFilter) params.set('status', statusFilter)
      if (sourceFilter) params.set('sourceType', sourceFilter)
      const data = await apiJson(`/api/knowledge-inbox?${params.toString()}`)
      setItems(Array.isArray(data.items) ? data.items : [])
      setStats(data.stats || { total: 0, status: {}, sourceType: {} })
    } catch (error: any) {
      message.error(error.message || '读取知识流 Inbox 失败')
    } finally {
      setLoading(false)
    }
  }

  const loadAutomationSources = async () => {
    setAutomationLoading(true)
    try {
      const data = await apiJson('/api/knowledge-automation')
      setAutomationSources(Array.isArray(data.sources) ? data.sources : [])
    } catch (error: any) {
      message.warning(error.message || '读取自动入口失败')
    } finally {
      setAutomationLoading(false)
    }
  }

  useEffect(() => {
    loadInbox()
    loadAutomationSources()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, sourceFilter])

  const capturedCount = stats.status?.captured || 0
  const processedCount = stats.status?.processed || 0
  const writtenCount = stats.status?.written || 0
  const completionRate = stats.total > 0 ? Math.round((writtenCount / stats.total) * 100) : 0

  const selectedPreview = useMemo(() => {
    if (!selectedItem) return ''
    return [
      selectedItem.summary ? `> ${selectedItem.summary}` : '',
      selectedItem.entities?.length ? `实体：${selectedItem.entities.join('、')}` : '',
      '',
      selectedItem.content
    ].filter(Boolean).join('\n')
  }, [selectedItem])

  const createItem = async (values: any) => {
    setSubmitting(true)
    try {
      await apiJson('/api/knowledge-inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: values.title,
          sourceType: values.sourceType || 'text',
          sourceUrl: values.sourceUrl || '',
          content: values.content,
          tags: values.tags || []
        })
      })
      message.success('已添加到知识收件箱')
      setModalVisible(false)
      form.resetFields()
      await loadInbox()
    } catch (error: any) {
      message.error(error.message || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const createAutomationSource = async (values: any) => {
    try {
      const data = await apiJson('/api/knowledge-automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          tags: values.tags || ['automation', values.type]
        })
      })
      setAutomationSources(prev => [data.source, ...prev])
      automationForm.resetFields()
      message.success('自动入口已创建')
    } catch (error: any) {
      message.error(error.message || '创建自动入口失败')
    }
  }

  const runAutomationSource = async (source: KnowledgeAutomationSource) => {
    setRunningAutomationId(source.id)
    try {
      const data = await apiJson(`/api/knowledge-automation/${source.id}/run`, { method: 'POST' })
      setAutomationSources(prev => prev.map(item => item.id === source.id ? data.source : item))
      message.success(data.result?.message || '自动入口已运行')
      await loadInbox()
    } catch (error: any) {
      message.error(error.message || '运行自动入口失败')
    } finally {
      setRunningAutomationId('')
    }
  }

  const deleteAutomationSource = async (source: KnowledgeAutomationSource) => {
    try {
      await apiJson(`/api/knowledge-automation/${source.id}`, { method: 'DELETE' })
      setAutomationSources(prev => prev.filter(item => item.id !== source.id))
      message.success('自动入口已删除')
    } catch (error: any) {
      message.error(error.message || '删除自动入口失败')
    }
  }

  const webhookUrl = (source: KnowledgeAutomationSource) => `${window.location.origin}/api/webhooks/knowledge/${source.id}${source.token ? `?token=${encodeURIComponent(source.token)}` : ''}`

  const processItem = async (item: KnowledgeInboxItem) => {
    try {
      const data = await apiJson(`/api/knowledge-inbox/${item.id}/process`, { method: 'POST' })
      message.success('已完成摘要、标签和实体抽取')
      setSelectedItem(data.item)
      await loadInbox()
    } catch (error: any) {
      message.error(error.message || '处理失败')
    }
  }

  const processBatch = async () => {
    try {
      const data = await apiJson('/api/knowledge-inbox/process-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      message.success(`已处理 ${data.count || 0} 条`)
      await loadInbox()
    } catch (error: any) {
      message.error(error.message || '批量处理失败')
    }
  }

  const writeToVault = async (item: KnowledgeInboxItem) => {
    try {
      const data = await apiJson(`/api/knowledge-inbox/${item.id}/write-to-vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: vaultFolder })
      })
      message.success(`已写入 ${data.vault?.relativePath || 'Vault'}`)
      setSelectedItem(data.item)
      await loadInbox()
    } catch (error: any) {
      message.error(error.message || '写入 Vault 失败')
    }
  }

  const saveFeedback = async (item: KnowledgeInboxItem, value: string) => {
    try {
      const data = await apiJson(`/api/knowledge-inbox/${item.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      })
      setSelectedItem(data.item)
      setItems(prev => prev.map(entry => entry.id === item.id ? data.item : entry))
      message.success(`反馈已记录：${feedbackLabel(value)}`)
      await loadInbox()
    } catch (error: any) {
      message.error(error.message || '保存反馈失败')
    }
  }

  const deleteItem = async (item: KnowledgeInboxItem) => {
    try {
      await apiJson(`/api/knowledge-inbox/${item.id}`, { method: 'DELETE' })
      if (selectedItem?.id === item.id) setSelectedItem(null)
      message.success('已删除')
      await loadInbox()
    } catch (error: any) {
      message.error(error.message || '删除失败')
    }
  }

  const columns = [
    {
      title: '条目',
      key: 'title',
      render: (_: unknown, item: KnowledgeInboxItem) => (
        <Space direction="vertical" size={2}>
          <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => setSelectedItem(item)}>
            {item.title}
          </Button>
          <Text type="secondary" ellipsis style={{ maxWidth: 520 }}>
            {item.summary || item.content.slice(0, 90)}
          </Text>
        </Space>
      )
    },
    {
      title: '来源',
      dataIndex: 'sourceType',
      width: 120,
      render: (sourceType: string) => <Tag>{sourceTypeLabel(sourceType)}</Tag>
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: string) => <Tag color={statusColor(status)}>{statusLabel(status)}</Tag>
    },
    {
      title: '反馈',
      dataIndex: 'feedback',
      width: 90,
      render: (feedback: KnowledgeInboxItem['feedback']) => (
        feedback?.value ? <Tag color={feedbackColor(feedback.value)}>{feedbackLabel(feedback.value)}</Tag> : <Text type="secondary">-</Text>
      )
    },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (tags: string[]) => (
        <Space size={[0, 4]} wrap>
          {(tags || []).slice(0, 5).map(tag => <Tag key={tag}>#{tag}</Tag>)}
        </Space>
      )
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 170,
      render: (value: string) => <Text type="secondary">{value ? new Date(value).toLocaleString('zh-CN') : '-'}</Text>
    },
    {
      title: '操作',
      key: 'actions',
      width: 230,
      render: (_: unknown, item: KnowledgeInboxItem) => (
        <Space>
          <Button size="small" icon={<ThunderboltOutlined />} disabled={item.status === 'written'} onClick={() => processItem(item)}>
            处理
          </Button>
          <Button size="small" type="primary" icon={<FileTextOutlined />} disabled={item.status === 'written'} onClick={() => writeToVault(item)}>
            入库
          </Button>
          <Popconfirm title="删除这个 Inbox 条目？" onConfirm={() => deleteItem(item)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div className="knowledge-inbox-page">
      <Space align="center" style={{ marginBottom: 20, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <InboxOutlined style={{ fontSize: 26, color: '#1677ff' }} />
          <div>
            <Title level={3} style={{ margin: 0 }}>知识收件箱</Title>
            <Text type="secondary">从对话、网页、会议和自动入口收集内容，确认后写入 Obsidian / Markdown Vault。</Text>
          </div>
        </Space>
        <Space>
          <Button icon={<ThunderboltOutlined />} onClick={processBatch}>批量处理</Button>
          <Button icon={<ReloadOutlined />} onClick={loadInbox} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>捕获内容</Button>
        </Space>
      </Space>

      <Alert
        showIcon
        type="info"
        style={{ marginBottom: 16 }}
        message="入库闭环：收集 → 整理 → 确认 → 写入 Vault → 可被 AI 引用"
        description="AI 对话里保存的内容、RSS / Webhook / Cron 自动捕获的内容都会先进入这里，避免未经确认的信息直接污染知识库。"
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Card><Statistic title="总条目" value={stats.total || 0} prefix={<InboxOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card><Statistic title="待处理" value={capturedCount} valueStyle={{ color: '#fa8c16' }} /></Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card><Statistic title="已处理" value={processedCount} valueStyle={{ color: '#1677ff' }} /></Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card><Statistic title="入库率" value={completionRate} suffix="%" valueStyle={{ color: '#52c41a' }} /></Card>
        </Col>
      </Row>

      <Card
        title="自动收集：RSS / Webhook / Cron"
        extra={<Button size="small" icon={<ReloadOutlined />} loading={automationLoading} onClick={loadAutomationSources}>刷新入口</Button>}
        style={{ marginBottom: 16 }}
      >
        <Form
          form={automationForm}
          layout="vertical"
          onFinish={createAutomationSource}
          initialValues={{ type: 'rss', tags: ['automation'] }}
        >
          <Row gutter={[12, 0]}>
            <Col xs={24} md={4}>
              <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                <Select options={automationTypeOptions} />
              </Form.Item>
            </Col>
            <Col xs={24} md={5}>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入入口名称' }]}>
                <Input placeholder="例如：AI 新闻 RSS" />
              </Form.Item>
            </Col>
            <Col xs={24} md={7}>
              <Form.Item name="url" label="RSS URL / 外部地址">
                <Input placeholder="RSS 填订阅地址；Webhook 可留空" />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item name="cron" label="Cron（后台调度，可选）">
                <Input placeholder="*/30 * * * * 或 0 8 * * *" />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item name="tags" label="标签">
                <Select mode="tags" placeholder="automation" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="instruction" label="处理说明">
                <Input.TextArea rows={2} placeholder="可写过滤条件、摘要偏好，Cron 手动运行时会作为收件箱内容。" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>新增收集入口</Button>
            </Col>
          </Row>
        </Form>

        {automationSources.length > 0 ? (
          <List
            loading={automationLoading}
            size="small"
            dataSource={automationSources}
            renderItem={source => (
              <List.Item
                actions={[
                  <Button key="run" size="small" loading={runningAutomationId === source.id} onClick={() => runAutomationSource(source)}>
                    手动运行
                  </Button>,
                  <Popconfirm key="delete" title="删除这个自动入口？" onConfirm={() => deleteAutomationSource(source)}>
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space wrap>
                      <Tag color={source.type === 'rss' ? 'green' : source.type === 'webhook' ? 'blue' : 'purple'}>{source.type.toUpperCase()}</Tag>
                      <Text strong>{source.name}</Text>
                      <Tag color={source.enabled ? 'success' : 'default'}>{source.enabled ? '启用' : '停用'}</Tag>
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2}>
                      {source.type === 'webhook' ? (
                        <Text copyable={{ text: webhookUrl(source) }} type="secondary">{webhookUrl(source)}</Text>
                      ) : (
                        <Text type="secondary" ellipsis={{ tooltip: source.url || source.cron || source.instruction || '-' }}>
                          {source.url || source.cron || source.instruction || '-'}
                        </Text>
                      )}
                      <Space wrap size={4}>
                        {(source.tags || []).map(tag => <Tag key={`${source.id}-${tag}`}>#{tag}</Tag>)}
                        {source.cron && <Tag color="purple">Cron {source.cron}</Tag>}
                        {source.type === 'webhook' && source.token && <Tag color="blue">Token 鉴权</Tag>}
                        {source.type === 'rss' && <Text type="secondary">去重池 {source.seenKeys?.length || 0}</Text>}
                        {source.lastRunAt && <Text type="secondary">上次：{new Date(source.lastRunAt).toLocaleString('zh-CN')}</Text>}
                        {source.lastRunMessage && <Text type="secondary">{source.lastRunMessage}</Text>}
                        <Text type="secondary">累计捕获 {source.capturedCount || 0}</Text>
                      </Space>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无自动收集入口，可先添加 RSS 或 Webhook。" />
        )}
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索标题、正文、标签、实体"
              value={query}
              onChange={event => setQuery(event.target.value)}
              onPressEnter={loadInbox}
              style={{ width: 320 }}
            />
            <Select value={statusFilter} onChange={setStatusFilter} options={statusOptions} style={{ width: 140 }} />
            <Select value={sourceFilter} onChange={setSourceFilter} options={sourceFilterOptions} style={{ width: 160 }} />
            <Button onClick={loadInbox}>搜索</Button>
          </Space>
          <Input
            addonBefore="入库目录"
            value={vaultFolder}
            onChange={event => setVaultFolder(event.target.value)}
            style={{ width: 360 }}
          />
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card>
            <Table
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={items}
              pagination={{ pageSize: 10 }}
              locale={{ emptyText: <Empty description="暂无收件箱内容，可先从 AI 对话保存一条回复。" /> }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card
            title="处理预览"
            extra={selectedItem && <Tag color={statusColor(selectedItem.status)}>{statusLabel(selectedItem.status)}</Tag>}
          >
            {selectedItem ? (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <div>
                  <Title level={4} style={{ marginTop: 0 }}>{selectedItem.title}</Title>
                  <Space wrap>
                    <Tag>{sourceTypeLabel(selectedItem.sourceType)}</Tag>
                    {selectedItem.sourceUrl && <Text copyable type="secondary">{selectedItem.sourceUrl}</Text>}
                  </Space>
                </div>
                <Space size={[0, 6]} wrap>
                  {(selectedItem.tags || []).map(tag => <Tag key={tag}>#{tag}</Tag>)}
                </Space>
                {selectedItem.entities?.length > 0 && (
                  <List
                    size="small"
                    header={<Text strong>实体 / 关键词</Text>}
                    dataSource={selectedItem.entities}
                    renderItem={entity => <List.Item>{entity}</List.Item>}
                  />
                )}
                <Paragraph className="knowledge-inbox-preview">
                  {selectedPreview}
                </Paragraph>
                {selectedItem.vaultRelativePath && (
                  <Alert type="success" showIcon message="已写入知识库" description={selectedItem.vaultRelativePath} />
                )}
                {selectedItem.feedback?.value && (
                  <Alert
                    type={selectedItem.feedback.value === 'rejected' ? 'warning' : 'info'}
                    showIcon
                    message={`最近反馈：${feedbackLabel(selectedItem.feedback.value)}`}
                    description={selectedItem.feedback.at ? new Date(selectedItem.feedback.at).toLocaleString('zh-CN') : undefined}
                  />
                )}
                <Space wrap>
                  <Button icon={<ThunderboltOutlined />} disabled={selectedItem.status === 'written'} onClick={() => processItem(selectedItem)}>重新处理</Button>
                  <Button type="primary" icon={<FileTextOutlined />} disabled={selectedItem.status === 'written'} onClick={() => writeToVault(selectedItem)}>写入 Vault</Button>
                  <Button icon={<CheckCircleOutlined />} onClick={() => saveFeedback(selectedItem, 'useful')}>有用</Button>
                  <Button onClick={() => saveFeedback(selectedItem, 'useless')}>无用</Button>
                  <Button type="primary" ghost onClick={() => saveFeedback(selectedItem, 'accepted')}>采纳</Button>
                  <Button danger onClick={() => saveFeedback(selectedItem, 'rejected')}>拒绝</Button>
                </Space>
              </Space>
            ) : (
              <Empty description="选择左侧条目查看处理预览" />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title="添加到知识收件箱"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        width={760}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={createItem} initialValues={{ sourceType: 'text', tags: ['inbox'] }}>
          <Form.Item name="title" label="标题">
            <Input placeholder="不填会自动从内容生成" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={10}>
              <Form.Item name="sourceType" label="来源类型">
                <Select options={sourceTypeOptions} />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="sourceUrl" label="来源链接 / 路径">
                <Input placeholder="https://... 或 Vault 相对路径" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="tags" label="初始标签">
            <Select mode="tags" placeholder="输入标签后回车" />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true, message: '请输入要捕获的内容' }]}>
            <TextArea rows={10} placeholder="粘贴网页摘录、会议片段、对话结论、Agent 输出、临时灵感..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default KnowledgeInbox
