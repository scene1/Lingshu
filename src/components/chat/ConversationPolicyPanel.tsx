import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert, Button, Col, Form, Input, InputNumber, Modal, Popconfirm, Row, Select,
  Space, Statistic, Table, Tag, Typography, message,
} from 'antd'
import {
  BarChartOutlined, CheckOutlined, DeleteOutlined, DiffOutlined, EditOutlined, ExperimentOutlined, PlayCircleOutlined,
  PlusOutlined, RobotOutlined, RollbackOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons'

const { Text } = Typography

interface PolicyItem {
  id: string
  name: string
  description?: string
  version: number
  status: string
  parentId?: string
  config: Record<string, any>
  evaluation?: { reportId: string; model?: string; gatePassed?: boolean; gateFailures?: string[] }
  rollout?: { percent?: number; minSamples?: number; maxErrorRate?: number; maxLatencyRegressionRatio?: number }
  telemetry?: { total?: number; errorRate?: number; averageLatencyMs?: number; usefulRate?: number | null }
  approval?: { approved?: boolean; reviewer?: string; comment?: string; decidedAt?: string } | null
  origin?: { type?: string; model?: string }
  diff?: Array<{ key: string; before: unknown; after: unknown; basePolicyId?: string }>
  rollbackReason?: string
  createdAt?: string
}

interface Props {
  reports?: any[]
  onChanged?: () => void
}

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿', validated: '已验证', canary: '灰度中', active: '生效中', degraded: '已降级',
  superseded: '被替代', rolled_back: '已回滚', rejected: '已拒绝',
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'default', validated: 'cyan', canary: 'gold', active: 'green', degraded: 'orange',
  superseded: 'blue', rolled_back: 'red', rejected: 'red',
}

const ConversationPolicyPanel: React.FC<Props> = ({ reports = [], onChanged }) => {
  const [items, setItems] = useState<PolicyItem[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<PolicyItem | 'new' | null>(null)
  const [evaluating, setEvaluating] = useState<PolicyItem | null>(null)
  const [canary, setCanary] = useState<PolicyItem | null>(null)
  const [inspecting, setInspecting] = useState<PolicyItem | null>(null)
  const [policyForm] = Form.useForm()
  const [evaluationForm] = Form.useForm()
  const [canaryForm] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/conversation-policies')
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || data.error || '读取策略失败')
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (error: any) {
      message.error(error.message || '读取策略失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const request = async (url: string, method = 'POST', body?: unknown) => {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || data.error || '操作失败')
    await load()
    onChanged?.()
    return data
  }

  const openEditor = (item: PolicyItem | 'new') => {
    setEditing(item)
    if (item === 'new') {
      policyForm.resetFields()
      policyForm.setFieldsValue({ config: { temperature: 0.7, maxTokens: 4000, maxSteps: 6, memoryTopK: 8, maxTools: 12, retrievalMode: 'auto' } })
    } else {
      policyForm.setFieldsValue({ name: item.name, description: item.description, config: item.config })
    }
  }

  const savePolicy = async () => {
    const values = await policyForm.validateFields()
    if (editing === 'new') await request('/api/conversation-policies', 'POST', values)
    else if (editing) await request(`/api/conversation-policies/${encodeURIComponent(editing.id)}`, 'PATCH', values)
    setEditing(null)
    message.success(editing === 'new' ? '候选策略已创建' : '策略草稿已更新')
  }

  const bindEvaluation = async () => {
    if (!evaluating) return
    const values = await evaluationForm.validateFields()
    const data = await request(`/api/conversation-policies/${encodeURIComponent(evaluating.id)}/evaluation`, 'POST', values)
    setEvaluating(null)
    message[data.gate?.passed ? 'success' : 'warning'](data.gate?.passed ? '评测通过，可以启动灰度' : '评测未通过，策略仍保持草稿')
  }

  const startCanary = async () => {
    if (!canary) return
    const values = await canaryForm.validateFields()
    await request(`/api/conversation-policies/${encodeURIComponent(canary.id)}/canary`, 'POST', values)
    setCanary(null)
    message.success('灰度已启动')
  }

  const generateCandidate = async () => {
    setLoading(true)
    try {
      await request('/api/conversation-policies/generate-candidate', 'POST', {})
      message.success('候选策略已生成，等待评测与人工批准')
    } finally {
      setLoading(false)
    }
  }

  const active = items.find(item => item.status === 'active')
  const canaryItem = items.find(item => item.status === 'canary')
  const latestRollback = items.find(item => item.status === 'rolled_back' && item.rollbackReason)

  const columns = [
    {
      title: '版本', width: 90,
      render: (_: unknown, item: PolicyItem) => <Text strong>v{item.version}</Text>,
    },
    {
      title: '策略', dataIndex: 'name',
      render: (value: string, item: PolicyItem) => <Space direction="vertical" size={0}><Space><Text>{value}</Text>{item.origin?.type === 'auto_generated' && <Tag icon={<RobotOutlined />}>自动候选</Tag>}</Space>{item.description && <Text type="secondary" ellipsis>{item.description}</Text>}</Space>,
    },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (value: string) => <Tag color={STATUS_COLORS[value] || 'default'}>{STATUS_LABELS[value] || value}</Tag>,
    },
    {
      title: '评测', width: 150,
      render: (_: unknown, item: PolicyItem) => item.evaluation
        ? <Space direction="vertical" size={0}><Space size={2}><Tag color={item.evaluation.gatePassed ? 'green' : 'red'}>{item.evaluation.gatePassed ? 'Gate 通过' : 'Gate 未通过'}</Tag>{item.approval?.approved && <Tag color="blue">人工批准</Tag>}</Space><Text type="secondary" ellipsis>{item.evaluation.model || item.evaluation.reportId}</Text></Space>
        : <Text type="secondary">未绑定</Text>,
    },
    {
      title: '灰度 / 遥测', width: 190,
      render: (_: unknown, item: PolicyItem) => (
        <Space direction="vertical" size={0}>
          <Text>{item.status === 'canary' ? `${item.rollout?.percent || 0}% · ` : ''}{item.telemetry?.total || 0} 次</Text>
          <Text type="secondary">错误 {Math.round(Number(item.telemetry?.errorRate || 0) * 100)}% · {item.telemetry?.averageLatencyMs || 0} ms</Text>
          <Button type="link" size="small" icon={<BarChartOutlined />} style={{ padding: 0 }} onClick={() => setInspecting(item)}>Diff / cohort</Button>
        </Space>
      ),
    },
    {
      title: '操作', width: 300, fixed: 'right' as const,
      render: (_: unknown, item: PolicyItem) => (
        <Space wrap size={4}>
          {['draft', 'rejected'].includes(item.status) && <Button size="small" icon={<EditOutlined />} onClick={() => openEditor(item)}>编辑</Button>}
          {['draft', 'rejected'].includes(item.status) && <Button size="small" icon={<SafetyCertificateOutlined />} onClick={() => { setEvaluating(item); evaluationForm.resetFields() }}>绑定评测</Button>}
          {item.status === 'validated' && !item.approval?.approved && <Popconfirm title="确认人工批准该策略进入灰度阶段？" onConfirm={() => request(`/api/conversation-policies/${encodeURIComponent(item.id)}/approval`, 'POST', { approved: true, reviewer: '桌面端管理员' }).then(() => message.success('策略已人工批准')).catch(error => message.error(error.message))}><Button size="small" type="primary" icon={<CheckOutlined />}>批准</Button></Popconfirm>}
          {item.status === 'validated' && item.approval?.approved && <Button size="small" type="primary" icon={<ExperimentOutlined />} onClick={() => { setCanary(item); canaryForm.setFieldsValue({ percent: 10, minSamples: 20, maxErrorRate: 0.1, maxLatencyRegressionRatio: 1.5, minFeedbackSamples: 5, minUsefulRate: 0.55, minSemanticSamples: 5, minSemanticScore: 0.72, minCohortSamples: 5, maxCohortErrorRate: 0.2 }) }}>启动灰度</Button>}
          {item.status === 'canary' && <Popconfirm title={`至少需要 ${item.rollout?.minSamples || 20} 次健康样本，确认激活？`} onConfirm={() => request(`/api/conversation-policies/${encodeURIComponent(item.id)}/activate`).then(() => message.success('策略已激活')).catch(error => message.error(error.message))}><Button size="small" type="primary" icon={<PlayCircleOutlined />}>激活</Button></Popconfirm>}
          {['active', 'canary', 'degraded'].includes(item.status) && item.id !== 'policy_default_v1' && <Popconfirm title="回滚该策略？" onConfirm={() => request(`/api/conversation-policies/${encodeURIComponent(item.id)}/rollback`, 'POST', { reason: '桌面端手动回滚' }).then(() => message.success('策略已回滚')).catch(error => message.error(error.message))}><Button size="small" danger icon={<RollbackOutlined />}>回滚</Button></Popconfirm>}
          {['draft', 'rejected', 'rolled_back'].includes(item.status) && <Popconfirm title="删除该策略版本？" onConfirm={() => request(`/api/conversation-policies/${encodeURIComponent(item.id)}`, 'DELETE').then(() => message.success('策略已删除')).catch(error => message.error(error.message))}><Button size="small" danger aria-label="删除策略" icon={<DeleteOutlined />} /></Popconfirm>}
        </Space>
      ),
    },
  ]

  return (
    <>
      <Row gutter={[16, 12]} align="middle" style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}><Statistic title="当前策略" value={active ? `v${active.version}` : '-'} /></Col>
        <Col xs={12} md={6}><Statistic title="灰度策略" value={canaryItem ? `v${canaryItem.version}` : '无'} suffix={canaryItem ? `${canaryItem.rollout?.percent || 0}%` : ''} /></Col>
        <Col xs={12} md={6}><Statistic title="策略版本" value={items.length} /></Col>
        <Col xs={24} md={12} lg={6}><Space wrap><Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor('new')}>新建候选</Button><Button icon={<RobotOutlined />} loading={loading} onClick={() => generateCandidate().catch(error => message.error(error.message))}>自动生成</Button></Space></Col>
      </Row>
      {latestRollback?.rollbackReason && <Alert type="warning" showIcon message={`最近回滚 · v${latestRollback.version}`} description={latestRollback.rollbackReason} style={{ marginBottom: 12 }} />}
      <Table rowKey="id" columns={columns} dataSource={items} loading={loading} size="small" scroll={{ x: 1050 }} pagination={{ pageSize: 10 }} />

      <Modal title={editing === 'new' ? '新建候选策略' : '编辑策略草稿'} open={Boolean(editing)} width={760} okText="保存草稿" onCancel={() => setEditing(null)} onOk={() => savePolicy().catch(error => message.error(error.message))}>
        <Alert type="info" showIcon message="保存只会创建草稿；必须绑定通过 Gate 的评测后才能灰度。" style={{ marginBottom: 16 }} />
        <Form form={policyForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><Form.Item name="name" label="策略名称" rules={[{ required: true }]}><Input maxLength={120} /></Form.Item></Col>
            <Col span={12}><Form.Item name="description" label="说明"><Input maxLength={500} /></Form.Item></Col>
            <Col span={24}><Form.Item name={['config', 'promptAppendix']} label="Prompt 补充"><Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} maxLength={8000} /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name={['config', 'temperature']} label="温度"><InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name={['config', 'maxTokens']} label="输出 Token"><InputNumber min={256} max={32000} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name={['config', 'maxSteps']} label="工具轮数"><InputNumber min={1} max={12} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name={['config', 'maxTools']} label="工具数量"><InputNumber min={0} max={20} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name={['config', 'memoryTopK']} label="记忆 TopK"><InputNumber min={0} max={20} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name={['config', 'retrievalMode']} label="知识检索"><Select options={[{ value: 'auto', label: '自动' }, { value: 'off', label: '关闭' }]} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <Modal title={`绑定评测 · ${evaluating?.name || ''}`} open={Boolean(evaluating)} okText="绑定并校验" onCancel={() => setEvaluating(null)} onOk={() => bindEvaluation().catch(error => message.error(error.message))}>
        <Form form={evaluationForm} layout="vertical">
          <Form.Item name="reportId" label="评测报告" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={reports.map(report => ({ value: report.id, label: `${report.model} · ${report.summary?.total || 0} 条 · ${Math.round(Number(report.summary?.passRate || 0) * 100)}%` }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`启动灰度 · ${canary?.name || ''}`} open={Boolean(canary)} okText="开始灰度" onCancel={() => setCanary(null)} onOk={() => startCanary().catch(error => message.error(error.message))}>
        <Form form={canaryForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><Form.Item name="percent" label="灰度比例 %"><InputNumber min={1} max={50} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="minSamples" label="最小灰度样本"><InputNumber min={5} max={10000} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="maxErrorRate" label="最大错误率"><InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="maxLatencyRegressionRatio" label="最大延迟回归倍数"><InputNumber min={1} max={10} step={0.1} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="minFeedbackSamples" label="反馈最小样本"><InputNumber min={0} max={10000} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="minUsefulRate" label="最低有用率"><InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="minSemanticSamples" label="语义评审最小样本"><InputNumber min={0} max={10000} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="minSemanticScore" label="最低语义评分"><InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="minCohortSamples" label="cohort 最小样本"><InputNumber min={2} max={10000} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="maxCohortErrorRate" label="cohort 最大错误率"><InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <Modal title={`策略分析 · ${inspecting?.name || ''}`} open={Boolean(inspecting)} footer={null} width={860} onCancel={() => setInspecting(null)}>
        <Text strong><DiffOutlined /> 相对父策略变更</Text>
        <Table
          style={{ marginTop: 10, marginBottom: 20 }} size="small" pagination={false} rowKey="key"
          dataSource={inspecting?.diff || []}
          locale={{ emptyText: '与基线配置一致' }}
          columns={[
            { title: '字段', dataIndex: 'key', width: 180 },
            { title: '原值', dataIndex: 'before', render: value => <Text code>{JSON.stringify(value)}</Text> },
            { title: '新值', dataIndex: 'after', render: value => <Text code>{JSON.stringify(value)}</Text> },
          ]}
        />
        <Text strong><BarChartOutlined /> 灰度 cohort</Text>
        <Table
          style={{ marginTop: 10 }} size="small" pagination={false} rowKey="key" scroll={{ x: 760 }}
          dataSource={Object.values((inspecting?.telemetry as any)?.cohorts || {})}
          locale={{ emptyText: '暂无 cohort 样本' }}
          columns={[
            { title: '任务', dataIndex: 'taskCategory' },
            { title: '模型', dataIndex: 'model' },
            { title: '客户端', dataIndex: 'client' },
            { title: '样本', dataIndex: 'total', width: 70 },
            { title: '错误率', render: (_: unknown, item: any) => `${Math.round(Number(item.errorRate || 0) * 100)}%`, width: 90 },
            { title: '延迟', render: (_: unknown, item: any) => `${item.averageLatencyMs || 0} ms`, width: 100 },
            { title: '语义分', render: (_: unknown, item: any) => item.averageSemanticScore == null ? '-' : `${Math.round(Number(item.averageSemanticScore) * 100)}%`, width: 90 },
          ]}
        />
      </Modal>
    </>
  )
}

export default ConversationPolicyPanel
