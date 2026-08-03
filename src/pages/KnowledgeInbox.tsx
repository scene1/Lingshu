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
  const [vaultFolder, setVaultFolder] = useState('00_Inbox/灵枢知识流')
  const [form] = Form.useForm()

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

  useEffect(() => {
    loadInbox()
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
      message.success('已捕获到知识流 Inbox')
      setModalVisible(false)
      form.resetFields()
      await loadInbox()
    } catch (error: any) {
      message.error(error.message || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

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
      message.success('反馈已记录')
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
            <Title level={3} style={{ margin: 0 }}>知识流 Inbox</Title>
            <Text type="secondary">把信息先接住，再处理、确认、写入 Obsidian / Markdown Vault。</Text>
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
        message="一期闭环：捕获 → 规则抽取 → 待确认 → 写入 Vault"
        description="当前先做本地规则抽取摘要、标签和实体，不会自动污染知识库；点击“入库”后才会写入指定 Vault 目录。"
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
              locale={{ emptyText: <Empty description="暂无 Inbox 条目，先捕获一条内容吧" /> }}
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
                <Space wrap>
                  <Button icon={<ThunderboltOutlined />} disabled={selectedItem.status === 'written'} onClick={() => processItem(selectedItem)}>重新处理</Button>
                  <Button type="primary" icon={<FileTextOutlined />} disabled={selectedItem.status === 'written'} onClick={() => writeToVault(selectedItem)}>写入 Vault</Button>
                  <Button icon={<CheckCircleOutlined />} onClick={() => saveFeedback(selectedItem, 'useful')}>有用</Button>
                  <Button onClick={() => saveFeedback(selectedItem, 'rejected')}>拒绝</Button>
                </Space>
              </Space>
            ) : (
              <Empty description="选择左侧条目查看处理预览" />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title="捕获到知识流 Inbox"
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
