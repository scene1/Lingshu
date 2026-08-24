import React, { useState, useEffect } from 'react'
import {
  Alert, Card, Table, Button, Space, Tag, Modal, Form, Input, Select,
  message, Popconfirm, Row, Col, Switch, Drawer, Timeline, Typography, Descriptions
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined,
  ReloadOutlined, ApartmentOutlined, BranchesOutlined
} from '@ant-design/icons'

const { Option } = Select
const { TextArea } = Input
const { Text, Paragraph } = Typography

interface WorkflowNode {
  id: string
  type: 'agent' | 'skill' | 'condition' | 'loop' | 'delay' | 'input' | 'output'
  name: string
  config: Record<string, any>
}

interface WorkflowEdge {
  id: string
  source: string
  target: string
  condition?: string
}

interface Workflow {
  id: string
  name: string
  description: string
  status: 'draft' | 'running' | 'completed' | 'failed'
  mode: 'sequential' | 'parallel' | 'conditional'
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: string
  updatedAt: string
  lastRunAt?: string
}

interface WorkflowRunNode {
  nodeId: string
  nodeName: string
  type: WorkflowNode['type']
  status: 'pending' | 'running' | 'completed' | 'error' | string
  output?: string
  input?: Record<string, any>
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  timestamp?: string
}

interface WorkflowRunResult {
  workflowId: string
  success: boolean
  message?: string
  result: {
    success: boolean
    error?: string
    duration?: number
    results?: WorkflowRunNode[]
  }
  runRecord?: {
    id: string
    durationMs?: number
    status?: string
  }
}

const NODE_TYPE_OPTIONS = [
  { value: 'agent', label: 'Agent 节点', icon: '🤖' },
  { value: 'skill', label: 'Skill 节点', icon: '⚡' },
  { value: 'condition', label: '条件分支', icon: '🔀' },
  { value: 'loop', label: '循环节点', icon: '🔄' },
  { value: 'delay', label: '延迟等待', icon: '⏱️' },
  { value: 'input', label: '输入节点', icon: '📥' },
  { value: 'output', label: '输出节点', icon: '📤' },
]

const Workflow: React.FC = () => {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [nodeModalVisible, setNodeModalVisible] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null)
  const [currentNodes, setCurrentNodes] = useState<WorkflowNode[]>([])
  const [runningWorkflowId, setRunningWorkflowId] = useState('')
  const [runResults, setRunResults] = useState<Record<string, WorkflowRunResult>>({})
  const [runDrawerVisible, setRunDrawerVisible] = useState(false)
  const [selectedRunWorkflow, setSelectedRunWorkflow] = useState<Workflow | null>(null)
  const [form] = Form.useForm()
  const [nodeForm] = Form.useForm()

  useEffect(() => {
    loadWorkflows()
  }, [])

  const loadWorkflows = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/workflows')
      if (response.ok) {
        setWorkflows(await response.json())
      } else {
        setWorkflows(getDefaultWorkflows())
      }
    } catch {
      setWorkflows(getDefaultWorkflows())
    } finally {
      setLoading(false)
    }
  }

  const getDefaultWorkflows = (): Workflow[] => [
    {
      id: 'wf-daily-report',
      name: '示例：每日报告生成',
      description: '每天定时采集数据 → Agent 分析 → 生成报告 → 推送飞书',
      status: 'draft',
      mode: 'sequential',
      nodes: [
        { id: 'n1', type: 'input', name: '定时触发', config: { cron: '0 8 * * *' } },
        { id: 'n2', type: 'agent', name: '数据采集 Agent', config: { agentId: 'main', prompt: '采集今日数据' } },
        { id: 'n3', type: 'agent', name: '报告生成 Agent', config: { agentId: 'main', prompt: '生成分析报告' } },
        { id: 'n4', type: 'skill', name: '飞书推送', config: { skillId: 'feishu', params: { webhook: '' } } },
        { id: 'n5', type: 'output', name: '输出报告', config: { format: 'markdown' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e3', source: 'n3', target: 'n4' },
        { id: 'e4', source: 'n4', target: 'n5' },
      ],
      createdAt: '2026-06-01',
      updatedAt: '2026-06-10',
    },
    {
      id: 'wf-code-review',
      name: '示例：代码审查流水线',
      description: '提交代码 → 并行审查（语法+安全+风格）→ 汇总结果',
      status: 'draft',
      mode: 'parallel',
      nodes: [
        { id: 'n1', type: 'input', name: '代码提交触发', config: { event: 'git_push' } },
        { id: 'n2', type: 'agent', name: '语法检查', config: { agentId: 'main', prompt: '检查语法错误' } },
        { id: 'n3', type: 'agent', name: '安全检查', config: { agentId: 'main', prompt: '检查安全漏洞' } },
        { id: 'n4', type: 'agent', name: '风格检查', config: { agentId: 'main', prompt: '检查代码风格' } },
        { id: 'n5', type: 'agent', name: '结果汇总', config: { agentId: 'main', prompt: '汇总审查结果' } },
        { id: 'n6', type: 'output', name: '审查报告', config: { format: 'markdown' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n1', target: 'n3' },
        { id: 'e3', source: 'n1', target: 'n4' },
        { id: 'e4', source: 'n2', target: 'n5' },
        { id: 'e5', source: 'n3', target: 'n5' },
        { id: 'e6', source: 'n4', target: 'n5' },
        { id: 'e7', source: 'n5', target: 'n6' },
      ],
      createdAt: '2026-06-05',
      updatedAt: '2026-06-12',
    },
    {
      id: 'wf-news-digest',
      name: '示例：新闻智能摘要',
      description: '抓取 RSS → 条件过滤 → 并行摘要 → 分类整理 → 推送',
      status: 'draft',
      mode: 'conditional',
      nodes: [
        { id: 'n1', type: 'input', name: 'RSS 抓取', config: { sources: ['tech', 'finance'] } },
        { id: 'n2', type: 'condition', name: '内容过滤', config: { rule: 'relevance > 0.7' } },
        { id: 'n3', type: 'agent', name: '技术新闻摘要', config: { agentId: 'main', prompt: '总结技术新闻' } },
        { id: 'n4', type: 'agent', name: '财经新闻摘要', config: { agentId: 'main', prompt: '总结财经新闻' } },
        { id: 'n5', type: 'agent', name: '分类整理', config: { agentId: 'main', prompt: '按类别整理' } },
        { id: 'n6', type: 'output', name: '每日摘要', config: { format: 'html' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3', condition: 'tech' },
        { id: 'e3', source: 'n2', target: 'n4', condition: 'finance' },
        { id: 'e4', source: 'n3', target: 'n5' },
        { id: 'e5', source: 'n4', target: 'n5' },
        { id: 'e6', source: 'n5', target: 'n6' },
      ],
      createdAt: '2026-06-08',
      updatedAt: '2026-06-15',
    },
  ]

  const handleCreate = () => {
    setEditingWorkflow(null)
    form.resetFields()
    setCurrentNodes([])
    setModalVisible(true)
  }

  const handleEdit = (wf: Workflow) => {
    setEditingWorkflow(wf)
    form.setFieldsValue(wf)
    setCurrentNodes([...wf.nodes])
    setModalVisible(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/workflows/${id}`, { method: 'DELETE' })
      message.success('删除成功')
      loadWorkflows()
    } catch (error) {
      setWorkflows(workflows.filter(w => w.id !== id))
      message.success('已删除')
    }
  }

  const handleSave = async (values: any) => {
    const workflow: Workflow = {
      id: editingWorkflow?.id || `wf-${Date.now()}`,
      name: values.name,
      description: values.description || '',
      status: 'draft',
      mode: values.mode || 'sequential',
      nodes: currentNodes,
      edges: editingWorkflow?.edges || [],
      createdAt: editingWorkflow?.createdAt || new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
    }

    try {
      const url = editingWorkflow ? `/api/workflows/${workflow.id}` : '/api/workflows'
      const method = editingWorkflow ? 'PUT' : 'POST'
      await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(workflow) })

      // P2: 如果启用了定时触发，注册到自动化引擎
      if (values.enableCron && values.cronExpression) {
        try {
          await fetch('/api/automations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `定时触发: ${workflow.name}`,
              description: `工作流 ${workflow.name} 的定时触发`,
              cronExpression: values.cronExpression,
              actionType: 'workflow',
              workflowId: workflow.id,
              enabled: true,
            }),
          })
          message.success('保存成功，已注册定时触发')
        } catch {
          message.warning('保存成功，但定时触发注册失败')
        }
      } else {
        message.success('保存成功')
      }
      setModalVisible(false)
      loadWorkflows()
    } catch {
      const list = editingWorkflow
        ? workflows.map(w => w.id === workflow.id ? workflow : w)
        : [workflow, ...workflows]
      setWorkflows(list)
      setModalVisible(false)
      message.success('已保存')
    }
  }

  const handleRun = async (id: string) => {
    const workflow = workflows.find(item => item.id === id) || null
    setRunningWorkflowId(id)
    try {
      const response = await fetch(`/api/workflows/${id}/run`, { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data) throw new Error(data?.message || data?.error || '运行失败')
      setRunResults(prev => ({ ...prev, [id]: data }))
      setSelectedRunWorkflow(workflow)
      setRunDrawerVisible(true)
      message.success(data.success ? '工作流执行完成' : '工作流执行失败')
      loadWorkflows()
    } catch (error: any) {
      message.error(error?.message || '工作流运行失败')
    } finally {
      setRunningWorkflowId('')
    }
  }

  const addNode = (values: any) => {
    const node: WorkflowNode = {
      id: `n${Date.now()}`,
      type: values.type,
      name: values.name,
      config: values.config ? JSON.parse(values.config) : {},
    }
    setCurrentNodes([...currentNodes, node])
    setNodeModalVisible(false)
    nodeForm.resetFields()
  }

  const removeNode = (nodeId: string) => {
    setCurrentNodes(currentNodes.filter(n => n.id !== nodeId))
  }

  const getModeTag = (mode: string) => {
    switch (mode) {
      case 'sequential': return <Tag color="blue">串行执行</Tag>
      case 'parallel': return <Tag color="green">并行执行</Tag>
      case 'conditional': return <Tag color="orange">条件分支</Tag>
      default: return <Tag>{mode}</Tag>
    }
  }

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'running': return <Tag color="processing">运行中</Tag>
      case 'completed': return <Tag color="success">已完成</Tag>
      case 'failed': return <Tag color="error">失败</Tag>
      default: return <Tag>草稿</Tag>
    }
  }

  const getNodeIcon = (type: string) => {
    const found = NODE_TYPE_OPTIONS.find(o => o.value === type)
    return found?.icon || '📦'
  }

  const getRunStatusColor = (status?: string) => {
    if (status === 'completed' || status === 'success') return 'green'
    if (status === 'running') return 'blue'
    if (status === 'error' || status === 'failed') return 'red'
    return 'gray'
  }

  const formatDuration = (ms?: number) => {
    if (typeof ms !== 'number') return '-'
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const openRunDebug = (workflow: Workflow) => {
    setSelectedRunWorkflow(workflow)
    setRunDrawerVisible(true)
  }

  const columns = [
    {
      title: '工作流名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Workflow) => (
        <div>
          <Space>
            <ApartmentOutlined style={{ color: '#1890ff', fontSize: 18 }} />
            <span style={{ fontWeight: 500, fontSize: 15 }}>{text}</span>
          </Space>
          <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{record.description}</div>
        </div>
      ),
    },
    {
      title: '执行模式',
      dataIndex: 'mode',
      key: 'mode',
      width: 100,
      render: getModeTag,
    },
    {
      title: '节点数',
      key: 'nodeCount',
      width: 80,
      render: (_: any, record: Workflow) => record.nodes.length,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: getStatusTag,
    },
    {
      title: '最后运行',
      dataIndex: 'lastRunAt',
      key: 'lastRunAt',
      width: 120,
      render: (time: string) => time || '从未运行',
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: any, record: Workflow) => (
        <Space>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            size="small"
            loading={runningWorkflowId === record.id}
            onClick={() => handleRun(record.id)}
          >
            运行
          </Button>
          <Button size="small" disabled={!runResults[record.id]} onClick={() => openRunDebug(record)}>
            调试
          </Button>
          <Button icon={<EditOutlined />} size="small" onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const selectedRun = selectedRunWorkflow ? runResults[selectedRunWorkflow.id] : null
  const selectedRunNodes = selectedRun?.result?.results || []

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>
        <BranchesOutlined style={{ marginRight: 8 }} />
        自动化流程配置（实验）
      </h2>

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="实验性流程编排"
        description="这里已接入基础 Workflow 执行器，可运行节点并查看调试结果；当前仍属于实验能力，后续还需要补齐任务队列、权限边界、真实外部节点执行器和更细的运行日志。"
      />

      <Card
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadWorkflows}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新建工作流
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={workflows}
          rowKey="id"
          loading={loading}
          expandable={{
            expandedRowRender: (record) => (
              <div style={{ padding: '12px 24px', background: '#fafafa' }}>
                <div style={{ fontWeight: 500, marginBottom: 12 }}>
                  节点流程 ({record.mode === 'parallel' ? '并行' : record.mode === 'conditional' ? '条件分支' : '串行'})
                </div>
                <Space wrap size={[8, 8]}>
                  {record.nodes.map((node, idx) => (
                    (() => {
                      const runNode = runResults[record.id]?.result?.results?.find(item => item.nodeId === node.id)
                      return (
                        <React.Fragment key={node.id}>
                          <Tag
                            color={runNode ? getRunStatusColor(runNode.status) : (
                              node.type === 'agent' ? 'blue' :
                              node.type === 'skill' ? 'purple' :
                              node.type === 'condition' ? 'orange' :
                              node.type === 'loop' ? 'cyan' :
                              'default'
                            )}
                            style={{ padding: '4px 10px', fontSize: 13 }}
                          >
                            {getNodeIcon(node.type)} {node.name}
                            {runNode?.durationMs ? ` · ${formatDuration(runNode.durationMs)}` : ''}
                          </Tag>
                          {idx < record.nodes.length - 1 && (
                            <span style={{ color: '#999', fontSize: 18 }}>→</span>
                          )}
                        </React.Fragment>
                      )
                    })()
                  ))}
                </Space>
              </div>
            ),
          }}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* 新建/编辑工作流弹窗 */}
      <Modal
        title={editingWorkflow ? '编辑工作流' : '新建工作流'}
        open={modalVisible}
        onOk={() => form.submit()}
        onCancel={() => setModalVisible(false)}
        width={800}
        okText="保存"
      >
        <Form form={form} onFinish={handleSave} layout="vertical">
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                <Input placeholder="工作流名称" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="mode" label="执行模式" initialValue="sequential">
                <Select>
                  <Option value="sequential">串行执行</Option>
                  <Option value="parallel">并行执行</Option>
                  <Option value="conditional">条件分支</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="描述工作流的用途" />
          </Form.Item>

          {/* P2: 定时触发配置 */}
          <Form.Item name="enableCron" label="定时触发" valuePropName="checked">
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev.enableCron !== curr.enableCron}
          >
            {({ getFieldValue }) =>
              getFieldValue('enableCron') ? (
                <Form.Item name="cronExpression" label="Cron 表达式" rules={[{ required: true, message: '请输入 Cron 表达式' }]}>
                  <Input placeholder="例如：0 9 * * *（每天 9 点执行）" style={{ fontFamily: 'monospace' }} />
                </Form.Item>
              ) : null
            }
          </Form.Item>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontWeight: 500 }}>节点配置（{currentNodes.length} 个节点）</span>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setNodeModalVisible(true)}>
                添加节点
              </Button>
            </div>
            {currentNodes.length === 0 ? (
              <div style={{ color: '#999', padding: 16, textAlign: 'center', background: '#fafafa', borderRadius: 6 }}>
                暂无节点，点击"添加节点"开始构建工作流
              </div>
            ) : (
              <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
                {currentNodes.map((node, idx) => (
                  <div key={node.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 0', borderBottom: idx < currentNodes.length - 1 ? '1px solid #f0f0f0' : 'none'
                  }}>
                    <Space>
                      <Tag color="blue" style={{ minWidth: 60, textAlign: 'center' }}>
                        {getNodeIcon(node.type)} {NODE_TYPE_OPTIONS.find(o => o.value === node.type)?.label || node.type}
                      </Tag>
                      <span style={{ fontWeight: 500 }}>{node.name}</span>
                      {node.type === 'agent' && node.config.agentId && (
                        <Tag>{node.config.agentId}</Tag>
                      )}
                      {node.type === 'skill' && node.config.skillId && (
                        <Tag color="purple">{node.config.skillId}</Tag>
                      )}
                    </Space>
                    <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeNode(node.id)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Form>
      </Modal>

      {/* 添加节点弹窗 */}
      <Modal
        title="添加节点"
        open={nodeModalVisible}
        onOk={() => nodeForm.submit()}
        onCancel={() => { setNodeModalVisible(false); nodeForm.resetFields() }}
        okText="添加"
      >
        <Form form={nodeForm} onFinish={addNode} layout="vertical">
          <Form.Item name="type" label="节点类型" rules={[{ required: true }]}>
            <Select placeholder="选择节点类型">
              {NODE_TYPE_OPTIONS.map(opt => (
                <Option key={opt.value} value={opt.value}>
                  {opt.icon} {opt.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="name" label="节点名称" rules={[{ required: true }]}>
            <Input placeholder="例如：数据采集 Agent" />
          </Form.Item>
          <Form.Item name="config" label="配置 (JSON)">
            <TextArea rows={3} placeholder='例如：{"agentId":"main","prompt":"分析数据"}' style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="Workflow 节点调试"
        open={runDrawerVisible}
        onClose={() => setRunDrawerVisible(false)}
        width={720}
      >
        {selectedRunWorkflow && selectedRun ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="工作流">{selectedRunWorkflow.name}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={selectedRun.success ? 'success' : 'error'}>
                  {selectedRun.success ? '执行成功' : '执行失败'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="执行模式">{getModeTag(selectedRunWorkflow.mode)}</Descriptions.Item>
              <Descriptions.Item label="总耗时">{formatDuration(selectedRun.result?.duration)}</Descriptions.Item>
              {selectedRun.runRecord?.id && (
                <Descriptions.Item label="Run ID">
                  <Text code>{selectedRun.runRecord.id}</Text>
                </Descriptions.Item>
              )}
              {selectedRun.result?.error && (
                <Descriptions.Item label="错误">
                  <Text type="danger">{selectedRun.result.error}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            <Card size="small" title={`节点时间线（${selectedRunNodes.length}）`}>
              {selectedRunNodes.length > 0 ? (
                <Timeline
                  items={selectedRunNodes.map((node, index) => ({
                    color: getRunStatusColor(node.status),
                    children: (
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Space wrap>
                          <Text strong>{index + 1}. {node.nodeName}</Text>
                          <Tag>{node.type}</Tag>
                          <Tag color={getRunStatusColor(node.status)}>{node.status}</Tag>
                          <Text type="secondary">{formatDuration(node.durationMs)}</Text>
                        </Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {node.startedAt || '-'} → {node.finishedAt || node.timestamp || '-'}
                        </Text>
                        {node.output && (
                          <Paragraph style={{ marginBottom: 0 }} ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}>
                            {node.output}
                          </Paragraph>
                        )}
                        {node.input && (
                          <pre style={{
                            margin: 0,
                            maxHeight: 160,
                            overflow: 'auto',
                            fontSize: 12,
                            background: '#f7f7f7',
                            padding: 8,
                            borderRadius: 6,
                          }}>
                            {JSON.stringify(node.input, null, 2)}
                          </pre>
                        )}
                      </Space>
                    ),
                  }))}
                />
              ) : (
                <Text type="secondary">暂无节点结果。</Text>
              )}
            </Card>
          </Space>
        ) : (
          <Text type="secondary">运行一次工作流后，可在这里查看节点调试信息。</Text>
        )}
      </Drawer>
    </div>
  )
}

export default Workflow
