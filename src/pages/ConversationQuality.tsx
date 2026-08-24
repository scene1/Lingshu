import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, Card, Col, Empty, Form, Input, InputNumber, Modal, Popconfirm, Row, Select,
  Space, Statistic, Switch, Table, Tabs, Tag, Typography, message,
} from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, PauseCircleOutlined,
  EditOutlined, ExclamationCircleOutlined, PlayCircleOutlined, ReloadOutlined, RobotOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ConversationPolicyPanel from '../components/chat/ConversationPolicyPanel'

const { Title, Text } = Typography

interface MemoryItem {
  id: string
  type: string
  content: string
  status: string
  sourceSessionId?: string
  updatedAt?: string
  lastSeenAt?: string
  seenCount?: number
  scope?: string
  scopeId?: string
  expiresAt?: string
  conflictWith?: string[]
  supersedes?: string[]
  supersededBy?: string
}

interface Governance {
  approvalPolicies: Record<string, 'allow' | 'always_ask' | 'deny'>
  rateLimits: Record<string, { limit: number; windowMs: number }>
}

interface QualityOverview {
  memory?: { total?: number; byType?: Record<string, number>; byStatus?: Record<string, number> }
  openkb?: any
  evaluations?: any
  governance?: Governance
  approvals?: { total?: number; approved?: number; denied?: number; pending?: number; rateLimited?: number; recent?: any[] }
  qualityGate?: { config?: Record<string, any>; updatedAt?: string }
  policies?: { active?: any; canary?: any; total?: number; byStatus?: Record<string, number> }
  qualitySettings?: Record<string, any>
}

interface ModelCandidate {
  key: string
  label: string
  provider: string
  hasApiKey?: boolean | string
  configured?: boolean
}

type QualityModelRole = 'reviewer' | 'embedding' | 'reranker'

interface ModelDiagnostic {
  success: boolean
  role: QualityModelRole
  model: string
  durationMs?: number
  checkedAt?: string
  cached?: boolean
  error?: string
  details?: Record<string, unknown>
}

const TYPE_LABELS: Record<string, string> = {
  fact: '事实', preference: '偏好', decision: '决定', task: '待办', inference: '推断',
}

const POLICY_OPTIONS = [
  { value: 'allow', label: '直接允许' },
  { value: 'always_ask', label: '每次确认' },
  { value: 'deny', label: '始终拒绝' },
]

const ConversationQuality: React.FC = () => {
  const [overview, setOverview] = useState<QualityOverview>({})
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [newMemory, setNewMemory] = useState('')
  const [correctingMemory, setCorrectingMemory] = useState<MemoryItem | null>(null)
  const [correctionContent, setCorrectionContent] = useState('')
  const [openkbDiagnosis, setOpenkbDiagnosis] = useState<any>(null)
  const [labelingItem, setLabelingItem] = useState<any>(null)
  const [modelCandidates, setModelCandidates] = useState<ModelCandidate[]>([])
  const [modelDiagnostics, setModelDiagnostics] = useState<Partial<Record<QualityModelRole, ModelDiagnostic>>>({})
  const [diagnosticLoading, setDiagnosticLoading] = useState<Partial<Record<QualityModelRole, boolean>>>({})
  const [savingBindings, setSavingBindings] = useState(false)
  const [governanceForm] = Form.useForm()
  const [qualityGateForm] = Form.useForm()
  const [openkbForm] = Form.useForm()
  const [qualityModelForm] = Form.useForm()
  const [labelForm] = Form.useForm()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [overviewResponse, memoryResponse, openkbSettingsResponse, modelsResponse] = await Promise.all([
        fetch('/api/conversation-quality/overview'),
        fetch(`/api/conversation-memory?limit=500&q=${encodeURIComponent(query)}&type=${encodeURIComponent(typeFilter)}`),
        fetch('/api/openkb/settings'),
        fetch('/api/models'),
      ])
      if (!overviewResponse.ok || !memoryResponse.ok || !openkbSettingsResponse.ok || !modelsResponse.ok) throw new Error('读取对话质量配置失败')
      const [overviewData, memoryData, openkbSettings, modelsData] = await Promise.all([overviewResponse.json(), memoryResponse.json(), openkbSettingsResponse.json(), modelsResponse.json()])
      setOverview(overviewData)
      setMemories(Array.isArray(memoryData.items) ? memoryData.items : [])
      setModelCandidates((Array.isArray(modelsData.models) ? modelsData.models : []).filter((item: ModelCandidate) => Boolean(item.configured || item.hasApiKey)))
      governanceForm.setFieldsValue(overviewData.governance || {})
      qualityGateForm.setFieldsValue(overviewData.qualityGate?.config || {})
      qualityModelForm.setFieldsValue(overviewData.qualitySettings || {})
      openkbForm.setFieldsValue({ ...openkbSettings, token: openkbSettings.authConfigured ? '********' : '' })
    } catch (error: any) {
      message.error(error?.message || '读取对话质量数据失败')
    } finally {
      setLoading(false)
    }
  }, [governanceForm, openkbForm, qualityGateForm, qualityModelForm, query, typeFilter])

  useEffect(() => { void loadData() }, [loadData])

  const updateMemory = async (id: string, patch: Record<string, unknown>) => {
    const response = await fetch(`/api/conversation-memory/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    if (!response.ok) throw new Error('更新记忆失败')
    await loadData()
  }

  const deleteMemory = async (id: string) => {
    const response = await fetch(`/api/conversation-memory/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!response.ok) throw new Error('删除记忆失败')
    message.success('记忆已删除')
    await loadData()
  }

  const captureMemory = async () => {
    const content = newMemory.trim()
    if (!content) return
    const response = await fetch('/api/conversation-memory/capture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || '记录记忆失败')
    setNewMemory('')
    message.success('长期记忆已记录')
    await loadData()
  }

  const correctMemory = async () => {
    if (!correctingMemory || !correctionContent.trim()) return
    const response = await fetch(`/api/conversation-memory/${encodeURIComponent(correctingMemory.id)}/correct`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: correctionContent.trim() }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || data.error || '纠正记忆失败')
    setCorrectingMemory(null)
    setCorrectionContent('')
    message.success('已创建纠正版，旧记忆保留为被替代记录')
    await loadData()
  }

  const resolveMemoryConflict = async (id: string, resolution: 'accept_new' | 'keep_existing') => {
    const response = await fetch(`/api/conversation-memory/${encodeURIComponent(id)}/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolution }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || data.error || '处理冲突失败')
    message.success(resolution === 'accept_new' ? '已采用新记忆，旧值已标记为被替代' : '已保留旧记忆')
    await loadData()
  }

  const saveQualityGate = async () => {
    const values = await qualityGateForm.validateFields()
    const response = await fetch('/api/conversation-quality/gate', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
    })
    if (!response.ok) throw new Error('保存质量门槛失败')
    message.success('质量门槛已保存')
    await loadData()
  }

  const saveOpenKB = async () => {
    const values = await openkbForm.validateFields()
    const response = await fetch('/api/openkb/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || data.error || '保存 OpenKB 配置失败')
    message.success('OpenKB 配置已保存')
    await loadData()
  }

  const diagnoseOpenKB = async () => {
    const values = await openkbForm.validateFields()
    const response = await fetch('/api/openkb/diagnostics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
    })
    const data = await response.json().catch(() => ({}))
    setOpenkbDiagnosis(data.result || { connected: false, error: data.error || '诊断失败' })
    if (!response.ok) throw new Error(data.result?.error || data.error || 'OpenKB 连接失败')
    message.success('OpenKB Sidecar 连接正常')
    await loadData()
  }

  const saveGovernance = async () => {
    try {
      const values = await governanceForm.validateFields()
      const response = await fetch('/api/tool-runtime/governance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      })
      if (!response.ok) throw new Error('保存治理策略失败')
      message.success('治理策略已保存')
      await loadData()
    } catch (error: any) {
      message.error(error?.message || '保存失败')
    }
  }

  const evaluationTrend = useMemo(() => (overview.evaluations?.trend || []).map((item: any) => ({
    ...item,
    label: new Date(item.createdAt).toLocaleDateString('zh-CN'),
    passRatePercent: Math.round(Number(item.passRate || 0) * 100),
    averageScorePercent: item.averageScore === null ? null : Math.round(Number(item.averageScore || 0) * 100),
  })), [overview.evaluations])

  const memoryColumns = [
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (value: string) => <Tag>{TYPE_LABELS[value] || value}</Tag>,
    },
    {
      title: '内容', dataIndex: 'content', ellipsis: true,
      render: (value: string, item: MemoryItem) => (
        <Space direction="vertical" size={0}>
          <Text>{value}</Text>
          {Boolean(item.conflictWith?.length) && <Text type="warning"><ExclamationCircleOutlined /> 与 {item.conflictWith?.length} 条现有记忆冲突</Text>}
          {Boolean(item.supersedes?.length) && <Text type="secondary">替代 {item.supersedes?.length} 条旧记忆</Text>}
        </Space>
      ),
    },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (value: string) => {
        const labels: Record<string, string> = { active: '启用', candidate: '待确认', archived: '已归档', rejected: '已拒绝', expired: '已过期', superseded: '被替代' }
        const colors: Record<string, string> = { active: 'green', candidate: 'gold', rejected: 'red', expired: 'default', superseded: 'blue' }
        return <Tag color={colors[value] || 'default'}>{labels[value] || value}</Tag>
      },
    },
    { title: '出现次数', dataIndex: 'seenCount', width: 90 },
    {
      title: '更新时间', width: 170,
      render: (_: unknown, item: MemoryItem) => item.lastSeenAt || item.updatedAt ? new Date(item.lastSeenAt || item.updatedAt || '').toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', width: 270,
      render: (_: unknown, item: MemoryItem) => (
        <Space wrap size={4}>
          {Boolean(item.conflictWith?.length) && item.status === 'candidate' && <>
            <Button size="small" type="primary" onClick={() => resolveMemoryConflict(item.id, 'accept_new').catch(error => message.error(error.message))}>采用新值</Button>
            <Button size="small" onClick={() => resolveMemoryConflict(item.id, 'keep_existing').catch(error => message.error(error.message))}>保留旧值</Button>
          </>}
          <Button
            size="small"
            icon={<EditOutlined />}
            aria-label="纠正记忆"
            onClick={() => { setCorrectingMemory(item); setCorrectionContent(item.content) }}
          />
          <Button
            size="small"
            icon={item.status === 'active' ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            disabled={Boolean(item.conflictWith?.length) || ['superseded', 'rejected', 'expired'].includes(item.status)}
            onClick={() => updateMemory(item.id, { status: item.status === 'active' ? 'archived' : 'active' }).catch(error => message.error(error.message))}
          >
            {item.status === 'active' ? '归档' : '启用'}
          </Button>
          <Popconfirm title="删除这条长期记忆？" onConfirm={() => deleteMemory(item.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} aria-label="删除记忆" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const openkb = overview.openkb || {}
  const openkbMetrics = openkb.observability || {}
  const approvalPolicies = overview.governance?.approvalPolicies || {}
  const rateLimits = overview.governance?.rateLimits || {}
  const latestGate = overview.evaluations?.latestGate || { passed: false, failures: ['没有评测报告'] }
  const modelComparison = overview.evaluations?.comparison?.models || []
  const conflictCount = memories.filter(item => item.status === 'candidate' && item.conflictWith?.length).length
  const categoryComparison = overview.evaluations?.categoryComparison || []
  const labelQueue = overview.evaluations?.labelQueue || { items: [], summary: {} }
  const modelOptions = useMemo(() => modelCandidates.map(item => ({
    value: item.key,
    label: item.label || item.key,
    provider: item.provider,
  })), [modelCandidates])
  const reviewerModelOptions = useMemo(() => modelOptions.map(item => ({ ...item, label: `${item.label} · 可用于评审` })), [modelOptions])
  const semanticModelOptions = useMemo(() => modelOptions
    .filter(item => !['anthropic', 'claude-cli'].includes(item.provider))
    .sort((left, right) => Number(!/embed|bge|e5|gte|jina/i.test(left.value)) - Number(!/embed|bge|e5|gte|jina/i.test(right.value)))
    .map(item => ({ ...item, label: `${item.label}${/embed|bge|e5|gte|jina/i.test(item.value) ? ' · Embedding 推荐' : ' · 需确认 /embeddings'}` })), [modelOptions])
  const rerankerModelOptions = useMemo(() => modelOptions
    .filter(item => !['anthropic', 'claude-cli'].includes(item.provider))
    .sort((left, right) => Number(!/rerank|cross.encoder|bge-reranker|jina-reranker/i.test(left.value)) - Number(!/rerank|cross.encoder|bge-reranker|jina-reranker/i.test(right.value)))
    .map(item => ({ ...item, label: `${item.label}${/rerank|cross.encoder|bge-reranker|jina-reranker/i.test(item.value) ? ' · Reranker 推荐' : ' · 需确认 /rerank'}` })), [modelOptions])

  const modelFieldByRole: Record<QualityModelRole, string> = {
    reviewer: 'reviewerModel', embedding: 'embeddingModel', reranker: 'rerankerModel',
  }

  const clearModelDiagnostic = (role: QualityModelRole) => {
    setModelDiagnostics(current => ({ ...current, [role]: undefined }))
  }

  const runModelDiagnostic = async (role: QualityModelRole, force = true) => {
    const model = String(qualityModelForm.getFieldValue(modelFieldByRole[role]) || '').trim()
    if (!model) throw new Error('请先选择模型')
    setDiagnosticLoading(current => ({ ...current, [role]: true }))
    try {
      const response = await fetch('/api/conversation-quality/model-diagnostics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, model, force }),
      })
      const data = await response.json().catch(() => ({})) as ModelDiagnostic
      setModelDiagnostics(current => ({ ...current, [role]: data }))
      if (!response.ok || !data.success) throw new Error(data.error || '模型能力测试失败')
      return data
    } finally {
      setDiagnosticLoading(current => ({ ...current, [role]: false }))
    }
  }

  const testAllQualityModels = async () => {
    const roles = (['reviewer', 'embedding', 'reranker'] as QualityModelRole[])
      .filter(role => Boolean(qualityModelForm.getFieldValue(modelFieldByRole[role])))
    if (roles.length === 0) throw new Error('请至少选择一个模型')
    const results = await Promise.allSettled(roles.map(role => runModelDiagnostic(role)))
    const failed = results.filter(result => result.status === 'rejected').length
    if (failed > 0) throw new Error(`${failed} 项模型能力测试未通过`)
    message.success(`${results.length} 项模型能力测试通过`)
  }

  const renderModelDiagnostic = (role: QualityModelRole) => {
    const diagnostic = modelDiagnostics[role]
    if (!diagnostic) return null
    return (
      <div style={{ marginTop: 6 }}>
        <Tag color={diagnostic.success ? 'success' : 'error'} icon={diagnostic.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
          {diagnostic.success ? `可用${diagnostic.durationMs !== undefined ? ` · ${diagnostic.durationMs}ms` : ''}` : diagnostic.error || '不可用'}
        </Tag>
      </div>
    )
  }

  const saveQualityModels = async () => {
    setSavingBindings(true)
    try {
      const values = await qualityModelForm.validateFields()
      const response = await fetch('/api/conversation-quality/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) })
      const data = await response.json().catch(() => ({}))
      if (Array.isArray(data.diagnostics)) {
        setModelDiagnostics(data.diagnostics.reduce((result: Partial<Record<QualityModelRole, ModelDiagnostic>>, item: ModelDiagnostic) => ({ ...result, [item.role]: item }), {}))
      }
      if (!response.ok) throw new Error(data.message || data.error || '保存质量模型配置失败')
      message.success('模型能力测试通过，绑定已保存')
      await loadData()
    } finally {
      setSavingBindings(false)
    }
  }

  const reviewLatest = async () => {
    const reportId = overview.evaluations?.latest?.id
    if (!reportId) throw new Error('暂无可评审报告')
    const response = await fetch(`/api/model-evaluations/${encodeURIComponent(reportId)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 12 }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || data.error || '独立评审失败')
    message.success(`已评审 ${data.reviewed || 0} 条，剩余 ${data.remaining || 0} 条`)
    await loadData()
  }

  const submitHumanLabel = async () => {
    if (!labelingItem) return
    const values = await labelForm.validateFields()
    const response = await fetch(`/api/evaluation-label-queue/${encodeURIComponent(labelingItem.id)}/label`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, reviewer: '桌面端人工评审' }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || data.error || '保存人工标注失败')
    setLabelingItem(null)
    message.success('人工标注已保存')
    await loadData()
  }

  return (
    <div style={{ maxWidth: 1320, minWidth: 0, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>对话质量</Title>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadData()}>刷新</Button>
      </div>

      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="当前策略" value={overview.policies?.active ? `v${overview.policies.active.version}` : '-'} suffix={overview.policies?.canary ? <Text style={{ marginLeft: 8, fontSize: 14 }}>灰度 v{overview.policies.canary.version}</Text> : ''} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="质量门槛" value={latestGate.passed ? '通过' : '未通过'} prefix={latestGate.passed ? <CheckCircleOutlined /> : <CloseCircleOutlined />} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="OpenKB" value={openkb.connected ? '已连接' : openkb.enabled ? '异常' : '未启用'} prefix={openkb.connected ? <CheckCircleOutlined /> : <CloseCircleOutlined />} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="待处理记忆冲突" value={conflictCount} prefix={conflictCount ? <ExclamationCircleOutlined /> : <CheckCircleOutlined />} /></Card></Col>
      </Row>

      <Card>
        <Tabs items={[
          {
            key: 'memory', label: '长期记忆',
            children: (
              <>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Input.Search allowClear placeholder="搜索记忆" value={query} onChange={event => setQuery(event.target.value)} onSearch={() => void loadData()} style={{ width: 280 }} />
                  <Select allowClear placeholder="全部类型" value={typeFilter || undefined} onChange={value => setTypeFilter(value || '')} options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} style={{ width: 140 }} />
                  <Input placeholder="记录明确事实、偏好、决定或待办" value={newMemory} onChange={event => setNewMemory(event.target.value)} onPressEnter={() => captureMemory().catch(error => message.error(error.message))} style={{ width: 320 }} />
                  <Button type="primary" onClick={() => captureMemory().catch(error => message.error(error.message))}>记录</Button>
                </Space>
                <Table rowKey="id" columns={memoryColumns} dataSource={memories} loading={loading} size="small" scroll={{ x: 1000 }} pagination={{ pageSize: 12 }} />
              </>
            ),
          },
          {
            key: 'evaluation', label: '评测趋势',
            children: (
              <>
                <Card size="small" title="质量模型与语义检索" style={{ marginBottom: 16 }}>
                  <Form form={qualityModelForm} layout="vertical">
                    <Row gutter={12} align="bottom">
                      <Col xs={24} lg={8}>
                        <Form.Item label="独立评审模型">
                          <Space.Compact block>
                            <Form.Item name="reviewerModel" noStyle><Select allowClear showSearch optionFilterProp="label" placeholder="选择已配置模型" options={reviewerModelOptions} notFoundContent="没有已配置模型" onChange={() => clearModelDiagnostic('reviewer')} /></Form.Item>
                            <Button loading={diagnosticLoading.reviewer} onClick={() => runModelDiagnostic('reviewer').then(() => message.success('独立评审模型可用')).catch(error => message.error(error.message))}>测试</Button>
                          </Space.Compact>
                          {renderModelDiagnostic('reviewer')}
                        </Form.Item>
                      </Col>
                      <Col xs={24} lg={8}>
                        <Form.Item label="Embedding 模型">
                          <Space.Compact block>
                            <Form.Item name="embeddingModel" noStyle><Select allowClear showSearch optionFilterProp="label" placeholder="选择支持 /embeddings 的模型" options={semanticModelOptions} notFoundContent="没有可绑定模型" onChange={() => clearModelDiagnostic('embedding')} /></Form.Item>
                            <Button loading={diagnosticLoading.embedding} onClick={() => runModelDiagnostic('embedding').then(() => message.success('Embedding 模型可用')).catch(error => message.error(error.message))}>测试</Button>
                          </Space.Compact>
                          {renderModelDiagnostic('embedding')}
                        </Form.Item>
                      </Col>
                      <Col xs={24} lg={8}>
                        <Form.Item label="Cross-encoder 模型">
                          <Space.Compact block>
                            <Form.Item name="rerankerModel" noStyle><Select allowClear showSearch optionFilterProp="label" placeholder="选择支持 /rerank 的模型" options={rerankerModelOptions} notFoundContent="没有可绑定模型" onChange={() => clearModelDiagnostic('reranker')} /></Form.Item>
                            <Button loading={diagnosticLoading.reranker} onClick={() => runModelDiagnostic('reranker').then(() => message.success('Cross-encoder 模型可用')).catch(error => message.error(error.message))}>测试</Button>
                          </Space.Compact>
                          {renderModelDiagnostic('reranker')}
                        </Form.Item>
                      </Col>
                      <Col xs={12} lg={5}><Form.Item name="semanticRetrievalEnabled" label="语义检索" valuePropName="checked"><Switch /></Form.Item></Col>
                      <Col xs={12} lg={5}><Form.Item name="semanticReviewEnabled" label="灰度异步评审" valuePropName="checked"><Switch /></Form.Item></Col>
                      <Col xs={12} lg={7}><Form.Item name="allowRemoteKnowledgeProcessing" label="允许外部处理知识片段" valuePropName="checked"><Switch /></Form.Item></Col>
                      <Col xs={12} lg={7}><Form.Item name="allowRemoteEvaluationProcessing" label="允许外部处理评测内容" valuePropName="checked"><Switch /></Form.Item></Col>
                      <Col xs={24} lg={14}><Form.Item><Space wrap><Button type="primary" loading={savingBindings} onClick={() => saveQualityModels().catch(error => message.error(error.message))}>测试并保存</Button><Button loading={Object.values(diagnosticLoading).some(Boolean)} onClick={() => testAllQualityModels().catch(error => message.error(error.message))}>测试全部</Button><Button icon={<ReloadOutlined />} onClick={() => void loadData()}>刷新模型</Button><Button onClick={() => { window.location.href = '/model-config' }}>模型配置</Button><Button icon={<RobotOutlined />} onClick={() => reviewLatest().catch(error => message.error(error.message))}>评审下一批</Button></Space></Form.Item></Col>
                    </Row>
                  </Form>
                  <Alert type="warning" showIcon message="保存前会执行真实能力测试" description="测试只发送固定探测文本；启用外部处理后，检索片段或评测请求与回答才会发送给你配置的 Provider。API Key 仍只保存在本机模型配置中。" />
                </Card>
                <Alert
                  type={latestGate.passed ? 'success' : 'warning'}
                  showIcon
                  message={latestGate.passed ? '最新评测已达到发布门槛' : '最新评测不可作为发布基线'}
                  description={latestGate.passed ? '关键类别、样本、评分和延迟均达标。' : (latestGate.failures || []).join('；')}
                  style={{ marginBottom: 16 }}
                />
                <Form form={qualityGateForm} layout="vertical">
                  <Row gutter={12} align="bottom">
                    <Col xs={12} lg={6}><Form.Item name="minCases" label="最小样本数"><InputNumber min={1} max={1000} style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={12} lg={6}><Form.Item name="minPassRate" label="最低通过率"><InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={12} lg={6}><Form.Item name="minAverageScore" label="最低平均评分"><InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={12} lg={6}><Form.Item name="minSemanticSamples" label="语义最小样本"><InputNumber min={0} max={1000} style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={12} lg={6}><Form.Item name="minSemanticScore" label="最低语义评分"><InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={12} lg={6}><Form.Item name="maxAverageDurationMs" label="最大平均延迟 ms"><InputNumber min={100} max={600000} style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={24} lg={18}><Form.Item name="criticalCategories" label="关键类别"><Select mode="tags" tokenSeparators={[',']} /></Form.Item></Col>
                    <Col xs={24} lg={6}><Form.Item><Button type="primary" onClick={() => saveQualityGate().catch(error => message.error(error.message))}>保存门槛</Button></Form.Item></Col>
                  </Row>
                </Form>
                <Title level={5}>多模型最新结果</Title>
                <Table
                  rowKey="reportId" size="small" pagination={false} scroll={{ x: 800 }}
                  dataSource={modelComparison}
                  columns={[
                    { title: '模型', dataIndex: 'model' },
                    { title: '样本', dataIndex: 'total', width: 80 },
                    { title: '通过率', render: (_: unknown, item: any) => `${Math.round(Number(item.passRate || 0) * 100)}%`, width: 90 },
                    { title: '评分', render: (_: unknown, item: any) => item.averageScore === null ? '-' : `${Math.round(Number(item.averageScore) * 100)}%`, width: 80 },
                    { title: '平均延迟', render: (_: unknown, item: any) => item.averageDurationMs === null ? '-' : `${item.averageDurationMs} ms`, width: 110 },
                    { title: 'Gate', render: (_: unknown, item: any) => <Tag color={item.gate?.passed ? 'green' : 'red'}>{item.gate?.passed ? '通过' : '未通过'}</Tag>, width: 90 },
                    { title: '时间', render: (_: unknown, item: any) => new Date(item.createdAt).toLocaleString('zh-CN'), width: 180 },
                  ]}
                />
                <Title level={5} style={{ marginTop: 20 }}>按类别对比</Title>
                <Table
                  rowKey="category" size="small" pagination={false} scroll={{ x: 900 }} dataSource={categoryComparison}
                  columns={[
                    { title: '类别', dataIndex: 'category', width: 180 },
                    { title: '领先模型', render: (_: unknown, item: any) => item.leader?.model || '-', width: 200 },
                    { title: '模型对比', render: (_: unknown, item: any) => <Space wrap>{(item.values || []).map((value: any) => <Tag key={`${item.category}-${value.model}`} color={value.model === item.leader?.model ? 'green' : 'default'}>{value.model} · {Math.round(Number(value.semanticScore ?? value.averageScore ?? value.passRate ?? 0) * 100)}%{value.semanticScore != null ? ` (${value.semanticSamples || 0} 语义样本)` : ''}</Tag>)}</Space> },
                  ]}
                />
                <Title level={5} style={{ marginTop: 20 }}>人工标注队列 <Tag>{labelQueue.summary?.pending || 0} 待处理</Tag></Title>
                <Table
                  rowKey="id" size="small" pagination={{ pageSize: 8 }} scroll={{ x: 1000 }} dataSource={labelQueue.items || []}
                  columns={[
                    { title: '优先级', dataIndex: 'priority', render: (value: string) => <Tag color={value === 'high' ? 'red' : 'default'}>{value}</Tag>, width: 90 },
                    { title: '类别', dataIndex: 'category', width: 160 },
                    { title: '请求', dataIndex: 'prompt', ellipsis: true },
                    { title: '回答', dataIndex: 'output', ellipsis: true },
                    { title: '模型评分', render: (_: unknown, item: any) => item.modelScore == null ? '-' : `${Math.round(Number(item.modelScore) * 100)}%`, width: 100 },
                    { title: '操作', render: (_: unknown, item: any) => <Button size="small" onClick={() => { setLabelingItem(item); labelForm.setFieldsValue({ score: item.modelScore ?? 0.7, verdict: 'pass', comment: '' }) }}>标注</Button>, width: 90 },
                  ]}
                />
                <Title level={5} style={{ marginTop: 20 }}>历史趋势</Title>
                {evaluationTrend.length ? <>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={evaluationTrend} margin={{ top: 12, right: 20, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" /><YAxis domain={[0, 100]} /><Tooltip /><Legend />
                      <Line type="monotone" dataKey="passRatePercent" name="通过率" stroke="#1677ff" strokeWidth={2} />
                      <Line type="monotone" dataKey="averageScorePercent" name="评分" stroke="#52c41a" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </> : <Empty description="暂无基线运行记录" />}
              </>
            ),
          },
          {
            key: 'openkb', label: 'OpenKB',
            children: (
              <>
                <Form form={openkbForm} layout="vertical">
                  <Row gutter={12} align="bottom">
                    <Col xs={24} sm={6} lg={3}><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item></Col>
                    <Col xs={24} sm={18} lg={7}><Form.Item name="baseUrl" label="Sidecar 地址" rules={[{ required: true }]}><Input placeholder="http://127.0.0.1:7566" /></Form.Item></Col>
                    <Col xs={24} sm={12} lg={5}><Form.Item name="kb" label="知识库" rules={[{ required: true }]}><Input /></Form.Item></Col>
                    <Col xs={24} sm={12} lg={5}><Form.Item name="token" label="访问令牌"><Input.Password autoComplete="off" /></Form.Item></Col>
                    <Col xs={24} lg={4}><Form.Item><Space><Button type="primary" onClick={() => saveOpenKB().catch(error => message.error(error.message))}>保存</Button><Button onClick={() => diagnoseOpenKB().catch(error => message.warning(error.message))}>测试</Button></Space></Form.Item></Col>
                  </Row>
                </Form>
                {openkbDiagnosis && <Alert
                  style={{ marginBottom: 16 }} showIcon
                  type={openkbDiagnosis.connected ? 'success' : 'error'}
                  message={openkbDiagnosis.connected ? `连接成功 · ${openkbDiagnosis.latencyMs} ms` : '连接失败'}
                  description={openkbDiagnosis.connected ? `版本 ${openkbDiagnosis.version || '-'}，知识库 ${openkbDiagnosis.kb}` : openkbDiagnosis.error}
                />}
                <Row gutter={[12, 12]}>
                  <Col xs={12} md={6}><Card size="small"><Statistic title="查询" value={openkbMetrics.queries || 0} /></Card></Col>
                  <Col xs={12} md={6}><Card size="small"><Statistic title="成功率" value={openkbMetrics.successRate ?? 0} suffix="%" /></Card></Col>
                  <Col xs={12} md={6}><Card size="small"><Statistic title="缓存命中" value={openkbMetrics.cacheHits || 0} /></Card></Col>
                  <Col xs={12} md={6}><Card size="small"><Statistic title="降级返回" value={openkbMetrics.degradedResponses || 0} /></Card></Col>
                  <Col span={24}><Space wrap><Tag color={openkb.connected ? 'green' : 'default'}>{openkb.connected ? 'Connected' : openkb.enabled ? 'Unavailable' : 'Disabled'}</Tag><Text type="secondary">平均延迟 {openkbMetrics.averageLatencyMs || 0} ms</Text><Text type="secondary">缓存 {openkbMetrics.cacheSize || 0}</Text>{openkbMetrics.lastError && <Text type="danger">{openkbMetrics.lastError}</Text>}</Space></Col>
                </Row>
              </>
            ),
          },
          {
            key: 'policies', label: '策略版本',
            children: <ConversationPolicyPanel reports={overview.evaluations?.reports || []} onChanged={() => void loadData()} />,
          },
          {
            key: 'governance', label: '工具治理',
            children: (
              <Form form={governanceForm} layout="vertical">
                <Row gutter={12}>
                  {Object.keys(approvalPolicies).map(key => (
                    <Col xs={12} md={8} lg={6} key={key}>
                      <Form.Item name={['approvalPolicies', key]} label={`审批策略 · ${key}`}>
                        <Select options={key === 'highRisk' ? POLICY_OPTIONS.filter(item => item.value !== 'allow') : POLICY_OPTIONS} />
                      </Form.Item>
                    </Col>
                  ))}
                </Row>
                <Row gutter={12}>
                  {Object.keys(rateLimits).map(key => (
                    <Col xs={12} md={8} lg={6} key={key}>
                      <Form.Item name={['rateLimits', key, 'limit']} label={`每分钟限额 · ${key}`}>
                        <InputNumber min={1} max={1000} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name={['rateLimits', key, 'windowMs']} hidden><InputNumber /></Form.Item>
                    </Col>
                  ))}
                </Row>
                <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => void saveGovernance()}>保存治理策略</Button>
                <Table
                  style={{ marginTop: 20 }} rowKey="id" size="small" scroll={{ x: 800 }} pagination={{ pageSize: 8 }}
                  dataSource={overview.approvals?.recent || []}
                  columns={[
                    { title: '时间', dataIndex: 'timestamp', render: (value: string) => new Date(value).toLocaleString('zh-CN'), width: 180 },
                    { title: '事件', dataIndex: 'action' },
                    { title: '工具', dataIndex: 'commandId' },
                    { title: '状态', dataIndex: 'status', render: (value: string) => <Tag>{value}</Tag>, width: 110 },
                    { title: '原因', dataIndex: 'reason', ellipsis: true },
                  ]}
                />
              </Form>
            ),
          },
        ]} />
      </Card>
      <Modal
        title="纠正长期记忆"
        open={Boolean(correctingMemory)}
        okText="保存纠正版"
        cancelText="取消"
        onCancel={() => { setCorrectingMemory(null); setCorrectionContent('') }}
        onOk={() => correctMemory().catch(error => message.error(error.message))}
      >
        <Alert type="info" showIcon message="旧记忆不会删除，会保留为可追溯的被替代记录。" style={{ marginBottom: 12 }} />
        <Input.TextArea value={correctionContent} onChange={event => setCorrectionContent(event.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} />
      </Modal>
      <Modal title={`人工标注 · ${labelingItem?.category || ''}`} open={Boolean(labelingItem)} okText="提交标注" onCancel={() => setLabelingItem(null)} onOk={() => submitHumanLabel().catch(error => message.error(error.message))}>
        {labelingItem && <Alert type="info" message={labelingItem.prompt || '无请求'} description={labelingItem.output || '无回答'} style={{ marginBottom: 16, maxHeight: 220, overflow: 'auto' }} />}
        <Form form={labelForm} layout="vertical">
          <Form.Item name="score" label="语义质量评分" rules={[{ required: true }]}><InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="verdict" label="结论" rules={[{ required: true }]}><Select options={[{ value: 'pass', label: '通过' }, { value: 'fail', label: '不通过' }, { value: 'uncertain', label: '不确定' }]} /></Form.Item>
          <Form.Item name="comment" label="标注说明"><Input.TextArea rows={3} maxLength={1000} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ConversationQuality
