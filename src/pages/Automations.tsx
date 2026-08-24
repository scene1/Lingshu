import React, { useState, useEffect, useCallback } from 'react'
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, Select,
  Switch, message, Popconfirm, Row, Col, Tooltip, Empty,
  Timeline, Typography, InputNumber, Alert
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined,
  ReloadOutlined, ClockCircleOutlined, CheckCircleOutlined,
  CloseCircleOutlined, BranchesOutlined
} from '@ant-design/icons'
import type { AutomationConfig, AutomationLogEntry } from '../types'

const { TextArea } = Input
const { Option } = Select
const { Text } = Typography

function getRetryBackoffLabel(value?: string) {
  if (value === 'linear') return '线性'
  if (value === 'exponential') return '指数'
  return '固定'
}

function formatRetryDelay(ms?: number) {
  const value = Number(ms || 0)
  if (!value) return '立即'
  if (value >= 60000) return `${Math.round(value / 60000)} 分钟`
  return `${Math.round(value / 1000)} 秒`
}

/** Cron 可视化预览：将 cron 表达式翻译为可读描述 */
function describeCron(expr: string): string {
  if (!expr) return '未设置'
  const parts = expr.trim().split(/\s+/)
  if (parts.length < 5) return '格式不正确'

  const [minute, hour, day, , weekday] = parts
  const desc: string[] = []

  // 时间部分
  if (minute === '*' && hour === '*') {
    desc.push('每分钟')
  } else if (minute === '0' && hour === '*') {
    desc.push('每小时整点')
  } else if (minute === '0' && hour !== '*') {
    if (hour.includes('/')) {
      desc.push(`每 ${hour.split('/')[1]} 小时整点`)
    } else if (hour === '*') {
      desc.push('每小时整点')
    } else {
      desc.push(`每天 ${hour}:${minute.padStart(2, '0')}`)
    }
  } else if (minute.includes('*/')) {
    desc.push(`每 ${minute.split('/')[1]} 分钟`)
  } else if (hour === '*') {
    desc.push(`每小时的第 ${minute} 分钟`)
  } else {
    desc.push(`${hour}:${minute.padStart(2, '0')}`)
  }

  // 日期部分
  if (day !== '*') {
    desc.push(`每月 ${day} 日`)
  }
  if (weekday !== '*') {
    const wdMap: Record<string, string> = { '0': '日', '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '日' }
    desc.push(`每周${weekday.split(',').map(w => wdMap[w.trim()] || w).join('、')}`)
  }

  return desc.join('，')
}

const Automations: React.FC = () => {
  const [automations, setAutomations] = useState<AutomationConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingAutomation, setEditingAutomation] = useState<AutomationConfig | null>(null)
  const [form] = Form.useForm()
  const [availableAgents, setAvailableAgents] = useState<any[]>([])
  const [availableWorkflows, setAvailableWorkflows] = useState<any[]>([])
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([])

  // ---- 加载数据 ----
  const loadAutomations = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await fetch('/api/automations')
      if (resp.ok) {
        const data = await resp.json()
        setAutomations(Array.isArray(data) ? data : (data.automations || []))
      } else {
        setAutomations([])
      }
    } catch {
      setAutomations([])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAgents = useCallback(async () => {
    try {
      const resp = await fetch('/api/instances/local/agents')
      if (resp.ok) {
        const data = await resp.json()
        setAvailableAgents(data.agents || data || [])
      }
    } catch { /* ignore */ }
  }, [])

  const loadWorkflows = useCallback(async () => {
    try {
      const resp = await fetch('/api/workflows')
      if (resp.ok) {
        setAvailableWorkflows(await resp.json())
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadAutomations()
    loadAgents()
    loadWorkflows()
  }, [loadAutomations, loadAgents, loadWorkflows])

  // ---- 新建 ----
  const handleCreate = () => {
    setEditingAutomation(null)
    form.resetFields()
    form.setFieldsValue({
      actionType: 'chat',
      enabled: true,
      cronExpression: '0 9 * * *',
      maxRetries: 0,
      retryDelayMs: 30000,
      retryBackoff: 'fixed',
    })
    setModalVisible(true)
  }

  // ---- 编辑 ----
  const handleEdit = (record: AutomationConfig) => {
    setEditingAutomation(record)
    form.setFieldsValue({
      name: record.name,
      description: record.description,
      cronExpression: record.cronExpression,
      actionType: record.actionType,
      agentId: record.agentId,
      prompt: record.prompt,
      workflowId: record.workflowId,
      maxRetries: record.maxRetries ?? 0,
      retryDelayMs: record.retryDelayMs ?? 30000,
      retryBackoff: record.retryBackoff || 'fixed',
      enabled: record.enabled,
    })
    setModalVisible(true)
  }

  // ---- 保存 ----
  const handleSave = async (values: any) => {
    const config = {
      ...values,
      id: editingAutomation?.id,
    }

    try {
      const url = editingAutomation ? `/api/automations/${editingAutomation.id}` : '/api/automations'
      const method = editingAutomation ? 'PUT' : 'POST'
      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        message.error(err.error || `保存失败: HTTP ${resp.status}`)
        return
      }

      message.success(editingAutomation ? '已更新' : '已创建')
      setModalVisible(false)
      loadAutomations()
    } catch (error) {
      message.error(`保存失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ---- 删除 ----
  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/automations/${id}`, { method: 'DELETE' })
      message.success('已删除')
      loadAutomations()
    } catch {
      message.error('删除失败')
    }
  }

  // ---- 启用/禁用 ----
  const handleToggle = async (id: string) => {
    try {
      const resp = await fetch(`/api/automations/${id}/toggle`, { method: 'POST' })
      if (!resp.ok) throw new Error('操作失败')
      message.success('状态已切换')
      loadAutomations()
    } catch {
      message.error('操作失败')
    }
  }

  // ---- 手动执行 ----
  const handleExecute = async (id: string) => {
    try {
      const resp = await fetch(`/api/automations/${id}/execute`, { method: 'POST' })
      if (!resp.ok) throw new Error('执行失败')
      const result = await resp.json()
      if (result.status === 'success') {
        message.success('执行成功')
      } else {
        message.warning(`执行完成: ${result.error || '有错误'}`)
      }
      loadAutomations()
    } catch {
      message.error('执行失败')
    }
  }

  // ---- 表格列 ----
  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: AutomationConfig) => (
        <div>
          <Space>
            <ClockCircleOutlined style={{ color: '#1890ff' }} />
            <span style={{ fontWeight: 500 }}>{text}</span>
          </Space>
          {record.description && (
            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{record.description}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Cron 表达式',
      dataIndex: 'cronExpression',
      key: 'cronExpression',
      width: 160,
      render: (expr: string) => (
        <Tooltip title={describeCron(expr)}>
          <code style={{ fontSize: 12 }}>{expr}</code>
        </Tooltip>
      ),
    },
    {
      title: '可读描述',
      key: 'description',
      width: 200,
      render: (_: any, record: AutomationConfig) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{describeCron(record.cronExpression)}</Text>
      ),
    },
    {
      title: '类型',
      dataIndex: 'actionType',
      key: 'actionType',
      width: 80,
      render: (type: string) => (
        <Tag color={type === 'chat' ? 'blue' : 'green'}>
          {type === 'chat' ? 'AI 对话' : '工作流'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (enabled: boolean) => (
        <Tag color={enabled ? 'success' : 'default'} icon={enabled ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
          {enabled ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '失败重试',
      key: 'retry',
      width: 130,
      render: (_: any, record: AutomationConfig) => {
        const maxRetries = Number(record.maxRetries || 0)
        if (maxRetries <= 0) return <Tag>不重试</Tag>
        return (
          <Tooltip title={`${getRetryBackoffLabel(record.retryBackoff)}退避，初始等待 ${formatRetryDelay(record.retryDelayMs)}`}>
            <Tag color="processing">{maxRetries} 次</Tag>
          </Tooltip>
        )
      },
    },
    {
      title: '下次执行',
      dataIndex: 'nextRun',
      key: 'nextRun',
      width: 160,
      render: (time: string) => time ? new Date(time).toLocaleString('zh-CN') : '-',
    },
    {
      title: '上次执行',
      dataIndex: 'lastRun',
      key: 'lastRun',
      width: 160,
      render: (time: string) => time ? new Date(time).toLocaleString('zh-CN') : '从未',
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: any, record: AutomationConfig) => (
        <Space>
          <Tooltip title="手动执行">
            <Button size="small" icon={<PlayCircleOutlined />} onClick={() => handleExecute(record.id)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          </Tooltip>
          <Tooltip title={record.enabled ? '禁用' : '启用'}>
            <Button size="small" icon={<Switch checked={record.enabled} />} onClick={() => handleToggle(record.id)} />
          </Tooltip>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // ---- 执行历史展开行 ----
  const renderExpandedRow = (record: AutomationConfig) => {
    const logs = record.logs || []
    if (logs.length === 0) {
      return <Empty description="暂无执行记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    }
    return (
      <div style={{ padding: '12px 24px' }}>
        <Text strong>执行历史 ({logs.length} 条)</Text>
        <Timeline style={{ marginTop: 16 }}>
          {logs.slice(0, 20).map((log: AutomationLogEntry) => (
            <Timeline.Item
              key={log.id}
              color={log.status === 'success' ? 'green' : log.status === 'error' ? 'red' : 'blue'}
              dot={log.status === 'success' ? <CheckCircleOutlined /> : log.status === 'error' ? <CloseCircleOutlined /> : <ClockCircleOutlined />}
            >
              <div>
                <Tag color={log.status === 'success' ? 'success' : log.status === 'error' ? 'error' : 'processing'}>
                  {log.status}
                </Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {new Date(log.timestamp).toLocaleString('zh-CN')} · 耗时 {log.durationMs}ms
                </Text>
              </div>
              {log.result && (
                <div style={{ marginTop: 4, fontSize: 13, color: '#666', maxHeight: 100, overflow: 'auto' }}>
                  {log.result.slice(0, 500)}
                </div>
              )}
              {log.error && (
                <div style={{ marginTop: 4, fontSize: 13, color: '#ff4d4f' }}>
                  {log.error}
                </div>
              )}
              {Array.isArray(log.attempts) && log.attempts.length > 1 && (
                <div style={{ marginTop: 8, padding: 8, background: '#fafafa', borderRadius: 6 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>重试明细</Text>
                  <Timeline
                    style={{ marginTop: 8 }}
                    items={log.attempts.map(attempt => ({
                      color: attempt.status === 'success' ? 'green' : 'red',
                      children: (
                        <Space direction="vertical" size={2}>
                          <Space wrap>
                            <Tag color={attempt.status === 'success' ? 'success' : 'error'}>
                              第 {attempt.attempt} 次 · {attempt.status}
                            </Tag>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {attempt.durationMs || 0}ms
                            </Text>
                            {!!attempt.nextRetryDelayMs && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                下次等待 {formatRetryDelay(attempt.nextRetryDelayMs)}
                              </Text>
                            )}
                          </Space>
                          {attempt.error && <Text type="danger" style={{ fontSize: 12 }}>{attempt.error}</Text>}
                        </Space>
                      ),
                    }))}
                  />
                </div>
              )}
            </Timeline.Item>
          ))}
        </Timeline>
      </div>
    )
  }

  const cronExamples = [
    { expr: '0 9 * * *', desc: '每天 9:00' },
    { expr: '0 */2 * * *', desc: '每 2 小时整点' },
    { expr: '*/30 * * * *', desc: '每 30 分钟' },
    { expr: '0 9 * * 1', desc: '每周一 9:00' },
    { expr: '0 0 1 * *', desc: '每月 1 日 0:00' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>
          <BranchesOutlined style={{ marginRight: 8 }} />
          自动化任务
        </h2>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadAutomations}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建自动化
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={automations}
          rowKey="id"
          loading={loading}
          pagination={false}
          expandable={{
            expandedRowKeys,
            onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
            expandedRowRender: renderExpandedRow,
          }}
          size="middle"
        />
      </Card>

      {/* 新建/编辑 Modal */}
      <Modal
        title={editingAutomation ? '编辑自动化任务' : '新建自动化任务'}
        open={modalVisible}
        onOk={() => form.submit()}
        onCancel={() => setModalVisible(false)}
        width={640}
        okText="保存"
      >
        <Form form={form} onFinish={handleSave} layout="vertical">
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
            <Input placeholder="例如：每日晨报生成" />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input placeholder="任务的简要描述" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="cronExpression"
                label="Cron 表达式"
                rules={[{ required: true, message: '请输入 Cron 表达式' }]}
                extra={
                  <Tooltip title={form.getFieldValue('cronExpression') ? describeCron(form.getFieldValue('cronExpression')) : ''}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {form.getFieldValue('cronExpression') ? describeCron(form.getFieldValue('cronExpression')) : '输入后显示可读描述'}
                    </Text>
                  </Tooltip>
                }
              >
                <Input placeholder="0 9 * * *" style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="常用 Cron 示例">
                <Select
                  placeholder="选择示例"
                  onChange={(val) => form.setFieldValue('cronExpression', val)}
                >
                  {cronExamples.map(ex => (
                    <Option key={ex.expr} value={ex.expr}>
                      {ex.desc} ({ex.expr})
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="actionType" label="执行类型" rules={[{ required: true }]}>
            <Select>
              <Option value="chat">AI 对话（定时触发 AI 回复）</Option>
              <Option value="workflow">工作流（定时触发工作流）</Option>
            </Select>
          </Form.Item>

          <Form.Item shouldUpdate={(prev, cur) => prev.actionType !== cur.actionType} noStyle>
            {({ getFieldValue }) => {
              const actionType = getFieldValue('actionType')
              if (actionType === 'chat') {
                return (
                  <>
                    <Form.Item name="agentId" label="关联 Agent / 模型">
                      <Select placeholder="选择 Agent 或直接输入模型 key" allowClear>
                        {availableAgents.map((agent: any) => (
                          <Option key={agent.id || agent.name} value={agent.model || agent.id}>
                            {agent.name || agent.id} ({agent.model || 'N/A'})
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>
                    <Form.Item name="prompt" label="提示词" rules={[{ required: true, message: '请输入提示词' }]}>
                      <TextArea rows={4} placeholder="例如：请生成今日晨报，包含天气、新闻摘要和待办提醒" />
                    </Form.Item>
                  </>
                )
              }
              if (actionType === 'workflow') {
                return (
                  <Form.Item name="workflowId" label="关联工作流" rules={[{ required: true, message: '请选择工作流' }]}>
                    <Select placeholder="选择工作流">
                      {availableWorkflows.map((wf: any) => (
                        <Option key={wf.id} value={wf.id}>{wf.name}</Option>
                      ))}
                    </Select>
                  </Form.Item>
                )
              }
              return null
            }}
          </Form.Item>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="失败重试"
            description="任务失败时会按下面策略自动重试；默认不重试，避免旧任务行为变化。Cron 和手动执行都会使用这套策略。"
          />
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="maxRetries" label="最大重试次数">
                <InputNumber min={0} max={5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="retryDelayMs" label="初始等待（毫秒）">
                <InputNumber min={0} max={300000} step={1000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="retryBackoff" label="退避策略">
                <Select>
                  <Option value="fixed">固定等待</Option>
                  <Option value="linear">线性递增</Option>
                  <Option value="exponential">指数退避</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Automations
