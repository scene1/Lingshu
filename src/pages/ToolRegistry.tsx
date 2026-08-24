import React, { useState, useEffect, useCallback } from 'react'
import {
  Alert, Card, Table, Button, Space, Tag, Modal, Form, Input,
  message, Switch, Row, Col, InputNumber, Typography,
  Tabs, Collapse, List, Badge, Tooltip
} from 'antd'
import {
  ApiOutlined, ToolOutlined, CloudServerOutlined, EyeOutlined,
  SafetyCertificateOutlined, HistoryOutlined, ReloadOutlined,
  SearchOutlined, ThunderboltOutlined, ExperimentOutlined,
  ImportOutlined, PlayCircleOutlined
} from '@ant-design/icons'
import { toolRegistryService, type ToolLayer } from '../core/tool-registry'
import type { ToolRegistryItem } from '../types'

const { TextArea } = Input
const { Text } = Typography

// ---- 安全策略类型 ----
interface ToolRuntimeSecurity {
  allowExecution: boolean
  requireConfirmation: boolean
  allowedCommands: string[]
  blockedPatterns: string[]
  timeoutMs: number
  maxOutputChars: number
  maxParamLength: number
  maxCommandLength: number
}

interface ToolRuntimeAuditEntry {
  id: string
  timestamp: string
  action: string
  commandId?: string
  status: string
  reason?: string
  durationMs?: number
  commandPreview?: string
}

const DEFAULT_SECURITY: ToolRuntimeSecurity = {
  allowExecution: false,
  requireConfirmation: true,
  allowedCommands: ['open', 'git', 'npm', 'node', 'python3'],
  blockedPatterns: ['rm -rf', 'sudo ', 'chmod -R', 'mkfs'],
  timeoutMs: 15000,
  maxOutputChars: 4000,
  maxParamLength: 500,
  maxCommandLength: 2000,
}

const LAYER_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  mcp: { label: 'MCP 工具', icon: <ApiOutlined />, color: '#1890ff' },
  native: { label: '内置工具', icon: <ToolOutlined />, color: '#722ed1' },
  plugin: { label: '插件工具', icon: <ThunderboltOutlined />, color: '#52c41a' },
  openapi: { label: 'OpenAPI', icon: <ImportOutlined />, color: '#fa8c16' },
}

const listToText = (list: string[]) => list.join('\n')
const textToList = (text?: string) => (text || '').split(/[\n,]/).map(item => item.trim()).filter(Boolean)

const ToolRegistry: React.FC = () => {
  const [activeLayer, setActiveLayer] = useState<ToolLayer>('mcp')
  const [tools, setTools] = useState<ToolRegistryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importModalVisible, setImportModalVisible] = useState(false)
  const [discoverModalVisible, setDiscoverModalVisible] = useState(false)
  const [discoveredTools, setDiscoveredTools] = useState<ToolRegistryItem[]>([])
  const [editingTool, setEditingTool] = useState<ToolRegistryItem | null>(null)
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [testingToolIds, setTestingToolIds] = useState<Set<string>>(new Set())
  const [executingTool, setExecutingTool] = useState<ToolRegistryItem | null>(null)
  const [executeModalVisible, setExecuteModalVisible] = useState(false)
  const [executeLoading, setExecuteLoading] = useState(false)
  const [executeResult, setExecuteResult] = useState<any>(null)
  const [form] = Form.useForm()
  const [importForm] = Form.useForm()
  const [executeForm] = Form.useForm()

  // 安全设置
  const [security, setSecurity] = useState<ToolRuntimeSecurity>(DEFAULT_SECURITY)
  const [securityForm] = Form.useForm()
  const [auditLogs, setAuditLogs] = useState<ToolRuntimeAuditEntry[]>([])

  // ---- 加载工具列表 ----
  const loadTools = useCallback(async (layer?: ToolLayer) => {
    const targetLayer = layer || activeLayer
    setLoading(true)
    try {
      const items = await toolRegistryService.getTools(targetLayer)
      setTools(items)
    } catch (error) {
      console.error('加载工具失败:', error)
      setTools([])
    } finally {
      setLoading(false)
    }
  }, [activeLayer])

  // ---- 加载安全策略 ----
  const loadSecurity = useCallback(async () => {
    try {
      const resp = await fetch('/api/tool-runtime/security')
      const data = resp.ok ? await resp.json() : DEFAULT_SECURITY
      const merged = { ...DEFAULT_SECURITY, ...data }
      setSecurity(merged)
      securityForm.setFieldsValue({
        ...merged,
        allowedCommands: listToText(merged.allowedCommands),
        blockedPatterns: listToText(merged.blockedPatterns),
      })
    } catch {
      setSecurity(DEFAULT_SECURITY)
    }
  }, [securityForm])

  // ---- 加载审计日志 ----
  const loadAuditLogs = useCallback(async () => {
    try {
      const resp = await fetch('/api/tool-runtime/audit?limit=20')
      setAuditLogs(resp.ok ? await resp.json() : [])
    } catch {
      setAuditLogs([])
    }
  }, [])

  useEffect(() => {
    loadTools()
    loadSecurity()
    loadAuditLogs()
  }, [])

  useEffect(() => {
    loadTools()
  }, [activeLayer])

  // ---- 启用/禁用工具 ----
  const handleToggleTool = async (tool: ToolRegistryItem) => {
    try {
      if (tool.enabled) {
        await toolRegistryService.disableTool(tool.id)
        message.success(`已禁用: ${tool.name}`)
      } else {
        await toolRegistryService.enableTool(tool.id)
        message.success(`已启用: ${tool.name}`)
      }
      loadTools()
    } catch (error) {
      message.error(`操作失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ---- 发现工具 ----
  const handleDiscover = async () => {
    setDiscoverLoading(true)
    try {
      const discovered = await toolRegistryService.discoverTools()
      setDiscoveredTools(discovered)
      setDiscoverModalVisible(true)
      message.success(`发现 ${discovered.length} 个可用工具`)
    } catch (error) {
      message.error(`发现工具失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setDiscoverLoading(false)
    }
  }

  // ---- 导入 OpenAPI ----
  const handleImportOpenAPI = async () => {
    try {
      const values = await importForm.validateFields()
      setImportLoading(true)
      let spec: Record<string, unknown>
      try {
        spec = JSON.parse(values.specJson)
      } catch {
        throw new Error('请粘贴 JSON 格式的 OpenAPI/Swagger 文档')
      }
      const data = await toolRegistryService.importOpenAPISpec({
        spec,
        name: values.name?.trim(),
        source: values.source?.trim(),
        serverUrl: values.serverUrl?.trim(),
      })
      message.success(`已导入 ${data.count} 个 OpenAPI 工具`)
      setImportModalVisible(false)
      importForm.resetFields()
      setActiveLayer('openapi')
      await loadTools('openapi')
      await loadAuditLogs()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      setImportLoading(false)
    }
  }

  // ---- 测试工具 ----
  const handleTestTool = async (tool: ToolRegistryItem) => {
    setTestingToolIds(prev => new Set(prev).add(tool.id))
    try {
      const data = await toolRegistryService.testTool(tool.id)
      const result = data.result
      if (data.success) {
        message.success(`${tool.name} 检查通过：${result?.message || '可用'}`)
      } else {
        message.warning(`${tool.name} 检查未通过：${result?.message || '请查看状态'}`)
      }
      await Promise.all([loadTools(), loadAuditLogs()])
    } catch (error) {
      message.error(`测试失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTestingToolIds(prev => {
        const next = new Set(prev)
        next.delete(tool.id)
        return next
      })
    }
  }

  const buildSampleInput = (tool: ToolRegistryItem) => {
    const inputSchema = tool.inputSchema || {}
    const properties = (inputSchema.properties || {}) as Record<string, any>
    const sample: Record<string, unknown> = {}
    for (const group of ['path', 'query', 'header']) {
      const groupSchema = properties[group]
      const groupProps = groupSchema?.properties || {}
      if (Object.keys(groupProps).length > 0) {
        sample[group] = Object.fromEntries(Object.keys(groupProps).map(key => [key, '']))
      }
    }
    if (properties.body) sample.body = {}
    if (tool.auth?.type && tool.auth.type !== 'none') {
      sample.auth = tool.auth.type === 'bearer'
        ? { bearerToken: '' }
        : { apiKey: '', apiKeyName: tool.auth.name || '', apiKeyIn: tool.auth.in || 'header' }
    }
    return JSON.stringify(sample, null, 2)
  }

  const openExecuteModal = (tool: ToolRegistryItem) => {
    setExecutingTool(tool)
    setExecuteResult(null)
    executeForm.setFieldsValue({
      inputJson: buildSampleInput(tool),
      serverUrl: String(tool.config?.serverUrl || tool.runtime?.serverUrl || ''),
      timeoutMs: 15000,
    })
    setExecuteModalVisible(true)
  }

  const handleExecuteTool = async () => {
    if (!executingTool) return
    setExecuteLoading(true)
    try {
      const values = await executeForm.validateFields()
      let input = {}
      try {
        input = values.inputJson ? JSON.parse(values.inputJson) : {}
      } catch {
        throw new Error('输入参数必须是合法 JSON')
      }
      const data = await toolRegistryService.executeTool(executingTool.id, {
        input,
        serverUrl: values.serverUrl?.trim(),
        timeoutMs: values.timeoutMs,
      })
      setExecuteResult(data.result)
      if (data.success) {
        message.success('OpenAPI 工具执行成功')
      } else {
        message.warning('OpenAPI 工具执行完成，但返回非成功状态')
      }
      await Promise.all([loadTools(), loadAuditLogs()])
    } catch (error) {
      message.error(`执行失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setExecuteLoading(false)
    }
  }

  // ---- 保存安全策略 ----
  const handleSaveSecurity = async (values: any) => {
    const payload: ToolRuntimeSecurity = {
      ...DEFAULT_SECURITY,
      ...values,
      allowedCommands: textToList(values.allowedCommands),
      blockedPatterns: textToList(values.blockedPatterns),
    }
    try {
      const resp = await fetch('/api/tool-runtime/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) throw new Error('保存失败')
      const data = await resp.json()
      setSecurity(data.security || payload)
      message.success('安全策略已保存')
      loadAuditLogs()
    } catch {
      message.error('安全策略保存失败')
    }
  }

  // ---- 工具表格列 ----
  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: ToolRegistryItem) => (
        <Space>
          <span style={{ color: LAYER_CONFIG[record.layer]?.color || '#1890ff' }}>
            {LAYER_CONFIG[record.layer]?.icon}
          </span>
          <span style={{ fontWeight: 500 }}>{text}</span>
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      width: 240,
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 120,
      render: (text: string) => <Tag>{text}</Tag>,
    },
    {
      title: '能力/权限',
      key: 'capabilities',
      width: 190,
      render: (_: any, record: ToolRegistryItem) => {
        const permissions = record.permissions || {}
        const enabledPermissions = Object.entries(permissions)
          .filter(([, value]) => value === true)
          .map(([key]) => key)
        return (
          <Space size={[4, 4]} wrap>
            {record.inputSchema && <Tag color="blue">schema</Tag>}
            {enabledPermissions.length === 0 ? (
              <Tag>无额外权限</Tag>
            ) : enabledPermissions.map(item => (
              <Tag key={item} color={item === 'shell' ? 'red' : item === 'network' ? 'geekblue' : 'purple'}>
                {item}
              </Tag>
            ))}
          </Space>
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          enabled: 'success',
          disabled: 'default',
          online: 'success',
          offline: 'default',
          error: 'error',
          discovered: 'processing',
        }
        return <Tag color={colorMap[status] || 'default'}>{status}</Tag>
      },
    },
    {
      title: '最近检查',
      key: 'lastCheckedAt',
      width: 170,
      render: (_: any, record: ToolRegistryItem) => (
        record.lastCheckedAt ? (
          <Space direction="vertical" size={0}>
            <Text style={{ fontSize: 12 }}>{new Date(record.lastCheckedAt).toLocaleString()}</Text>
            {record.lastTestResult?.message && (
              <Text type={record.lastTestResult.success ? 'success' : 'danger'} style={{ fontSize: 12 }}>
                {record.lastTestResult.message}
              </Text>
            )}
          </Space>
        ) : <Text type="secondary">未检查</Text>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 70,
      render: (enabled: boolean, record: ToolRegistryItem) => (
        <Switch
          checked={enabled}
          size="small"
          onChange={() => handleToggleTool(record)}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 170,
      render: (_: any, record: ToolRegistryItem) => (
        <Space>
          {record.layer === 'openapi' && (
            <Tooltip title="执行 OpenAPI 请求">
              <Button
                size="small"
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={() => openExecuteModal(record)}
              />
            </Tooltip>
          )}
          <Tooltip title="测试工具">
            <Button
              size="small"
              icon={<ExperimentOutlined />}
              loading={testingToolIds.has(record.id)}
              onClick={() => handleTestTool(record)}
            />
          </Tooltip>
          <Tooltip title="查看配置">
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => {
                setEditingTool(record)
                form.setFieldsValue({
                  name: record.name,
                  description: record.description,
                  configJson: JSON.stringify(record.config || {}, null, 2),
                  inputSchemaJson: JSON.stringify(record.inputSchema || {}, null, 2),
                  outputSchemaJson: JSON.stringify(record.outputSchema || {}, null, 2),
                  authJson: JSON.stringify(record.auth || {}, null, 2),
                  runtimeJson: JSON.stringify(record.runtime || {}, null, 2),
                })
                setEditModalVisible(true)
              }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]

  // ---- 审计日志列 ----
  const auditColumns = [
    { title: '时间', dataIndex: 'timestamp', key: 'timestamp', width: 180, render: (text: string) => new Date(text).toLocaleString() },
    { title: '动作', dataIndex: 'action', key: 'action', width: 120, render: (text: string) => <Tag>{text}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (text: string) => <Tag color={text === 'blocked' ? 'error' : text === 'completed' ? 'success' : 'processing'}>{text}</Tag> },
    { title: '命令', dataIndex: 'commandPreview', key: 'commandPreview', render: (text: string) => <code style={{ fontSize: 11 }}>{text || '-'}</code> },
    { title: '原因', dataIndex: 'reason', key: 'reason', width: 180, render: (text: string) => text || '-' },
  ]

  const tabItems = [
    { key: 'mcp', label: 'MCP 工具', children: null },
    { key: 'native', label: '内置工具', children: null },
    { key: 'plugin', label: '插件工具', children: null },
    { key: 'openapi', label: 'OpenAPI', children: null },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>
          <CloudServerOutlined style={{ marginRight: 8 }} />
          工具注册表
        </h2>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { loadTools(); loadAuditLogs() }}>
            刷新
          </Button>
          <Button
            icon={<ImportOutlined />}
            onClick={() => setImportModalVisible(true)}
          >
            导入 OpenAPI
          </Button>
          <Button
            type="primary"
            icon={<SearchOutlined />}
            loading={discoverLoading}
            onClick={handleDiscover}
          >
            发现工具
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="统一工具注册表"
        description="MCP 工具、内置工具、插件工具和 OpenAPI operation 统一在此管理。支持启用/禁用、发现已安装 MCP 服务、导入 OpenAPI JSON，并为每个工具保留 Schema、权限和测试记录。"
      />

      {/* 工具层 Tab */}
      <Card style={{ marginBottom: 24 }}>
        <Tabs
          activeKey={activeLayer}
          onChange={(key) => setActiveLayer(key as ToolLayer)}
          items={tabItems.map(item => ({
            key: item.key,
            label: (
              <span>
                {LAYER_CONFIG[item.key]?.icon} {LAYER_CONFIG[item.key]?.label}
                <Badge
                  count={tools.length}
                  size="small"
                  style={{ marginLeft: 8, backgroundColor: LAYER_CONFIG[item.key]?.color }}
                />
              </span>
            ),
            children: (
              <Table
                columns={columns}
                dataSource={tools}
                rowKey="id"
                loading={loading}
                pagination={false}
                size="middle"
              />
            ),
          }))}
        />
      </Card>

      {/* 安全设置 + 审计日志 折叠区 */}
      <Collapse
        defaultActiveKey={[]}
        items={[
          {
            key: 'security',
            label: (
              <span>
                <SafetyCertificateOutlined style={{ marginRight: 8 }} />
                安全设置
              </span>
            ),
            children: (
              <Form form={securityForm} layout="vertical" onFinish={handleSaveSecurity}>
                <Alert
                  type={security.allowExecution ? 'error' : 'info'}
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={security.allowExecution ? '实际执行已开放' : '当前为预览与审计模式'}
                  description="建议默认保持关闭实际执行。开放前请确认白名单、阻断规则、超时和输出截断策略符合预期。"
                />
                <Row gutter={16}>
                  <Col span={6}>
                    <Form.Item name="allowExecution" label="允许实际执行" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Form.Item name="requireConfirmation" label="执行前确认" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Form.Item name="timeoutMs" label="超时（毫秒）">
                      <InputNumber min={1000} max={120000} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Form.Item name="maxOutputChars" label="输出截断字符数">
                      <InputNumber min={500} max={50000} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="allowedCommands" label="命令白名单（一行一个）">
                      <TextArea rows={4} style={{ fontFamily: 'monospace' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="blockedPatterns" label="阻断规则（一行一个）">
                      <TextArea rows={4} style={{ fontFamily: 'monospace' }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Button type="primary" htmlType="submit">保存安全策略</Button>
              </Form>
            ),
          },
          {
            key: 'audit',
            label: (
              <span>
                <HistoryOutlined style={{ marginRight: 8 }} />
                审计日志
              </span>
            ),
            children: (
              <>
                <div style={{ marginBottom: 8, textAlign: 'right' }}>
                  <Button size="small" icon={<ReloadOutlined />} onClick={loadAuditLogs}>刷新</Button>
                </div>
                <Table
                  columns={auditColumns}
                  dataSource={auditLogs}
                  rowKey="id"
                  pagination={false}
                  size="small"
                />
              </>
            ),
          },
        ]}
      />

      {/* 导入 OpenAPI Modal */}
      <Modal
        title="导入 OpenAPI"
        open={importModalVisible}
        onCancel={() => setImportModalVisible(false)}
        width={760}
        footer={[
          <Button key="cancel" onClick={() => setImportModalVisible(false)}>取消</Button>,
          <Button key="import" type="primary" icon={<ImportOutlined />} loading={importLoading} onClick={handleImportOpenAPI}>
            导入
          </Button>,
        ]}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="把 OpenAPI operation 注册为可管理工具"
          description="当前入口支持 JSON 格式的 OpenAPI 3.x / Swagger 2.0 文档。导入后可以在 OpenAPI 页签查看 Schema、权限、认证信息，并执行健康检查。"
        />
        <Form form={importForm} layout="vertical">
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="name" label="服务名称">
                <Input placeholder="例如：Linear API" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="source" label="来源标识">
                <Input placeholder="例如：linear" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="serverUrl" label="服务地址覆盖">
                <Input placeholder="https://api.example.com" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="specJson"
            label="OpenAPI JSON"
            rules={[{ required: true, message: '请粘贴 OpenAPI JSON' }]}
          >
            <TextArea
              rows={14}
              style={{ fontFamily: 'monospace' }}
              placeholder='{"openapi":"3.0.0","info":{"title":"Demo","version":"1.0.0"},"paths":{...}}'
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 发现工具 Modal */}
      <Modal
        title="发现的 MCP 工具"
        open={discoverModalVisible}
        onCancel={() => setDiscoverModalVisible(false)}
        width={720}
        footer={[
          <Button key="close" onClick={() => setDiscoverModalVisible(false)}>关闭</Button>,
        ]}
      >
        {discoveredTools.length === 0 ? (
          <Alert type="info" showIcon message="未发现新的 MCP 服务" description="检查了常见 MCP 配置目录和 npm 全局包，未找到可用的 MCP 服务。" />
        ) : (
          <List
            dataSource={discoveredTools}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    key="enable"
                    type="primary"
                    size="small"
                    onClick={async () => {
                      try {
                        await toolRegistryService.enableTool(item.id)
                        message.success(`已启用: ${item.name}`)
                        loadTools()
                      } catch {
                        message.error('启用失败')
                      }
                    }}
                  >
                    启用
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={<ApiOutlined style={{ fontSize: 24, color: '#1890ff' }} />}
                  title={item.name}
                  description={
                    <Space direction="vertical" size={2}>
                      <Text type="secondary">{item.description}</Text>
                      <Space size={4}>
                        <Tag>{item.source}</Tag>
                        <Tag color="processing">已发现</Tag>
                        {item.config && (item.config as any).type && (
                          <Tag>{(item.config as any).type}</Tag>
                        )}
                      </Space>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Modal>

      {/* 执行 OpenAPI 工具 Modal */}
      <Modal
        title={`执行 OpenAPI: ${executingTool?.name || ''}`}
        open={executeModalVisible}
        onCancel={() => setExecuteModalVisible(false)}
        width={820}
        footer={[
          <Button key="close" onClick={() => setExecuteModalVisible(false)}>关闭</Button>,
          <Button key="run" type="primary" icon={<PlayCircleOutlined />} loading={executeLoading} onClick={handleExecuteTool}>
            执行
          </Button>,
        ]}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="这里会发起真实 OpenAPI 网络请求"
          description="临时认证参数只随本次请求发送，不会写入工具配置。执行记录会进入审计日志和 Run History。"
        />
        <Form form={executeForm} layout="vertical">
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item name="serverUrl" label="服务地址">
                <Input placeholder="https://api.example.com" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="timeoutMs" label="超时（毫秒）">
                <InputNumber min={1000} max={120000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="inputJson"
            label="输入参数 JSON"
            rules={[{ required: true, message: '请输入 JSON 参数' }]}
          >
            <TextArea
              rows={12}
              style={{ fontFamily: 'monospace' }}
              placeholder='{"path":{"id":"123"},"query":{"limit":10},"header":{},"body":{},"auth":{"bearerToken":"..."}}'
            />
          </Form.Item>
        </Form>
        {executeResult && (
          <Card size="small" title="执行结果" style={{ marginTop: 16 }}>
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Space wrap>
                <Tag color={executeResult.success ? 'success' : 'error'}>
                  {executeResult.statusCode} {executeResult.statusText}
                </Tag>
                <Tag>{executeResult.method}</Tag>
                <Tag>{executeResult.durationMs}ms</Tag>
              </Space>
              <Text code style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                {executeResult.url}
              </Text>
              <TextArea
                rows={10}
                style={{ fontFamily: 'monospace' }}
                value={JSON.stringify(executeResult.data ?? executeResult.rawText ?? executeResult, null, 2)}
                readOnly
              />
            </Space>
          </Card>
        )}
      </Modal>

      {/* 工具配置 Modal */}
      <Modal
        title={`工具配置: ${editingTool?.name || ''}`}
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setEditModalVisible(false)}>关闭</Button>,
        ]}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称">
            <Input disabled />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input disabled />
          </Form.Item>
          <Form.Item name="configJson" label="配置（只读）">
            <TextArea rows={5} style={{ fontFamily: 'monospace' }} disabled />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="inputSchemaJson" label="输入 Schema">
                <TextArea rows={6} style={{ fontFamily: 'monospace' }} disabled />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="outputSchemaJson" label="输出 Schema">
                <TextArea rows={6} style={{ fontFamily: 'monospace' }} disabled />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="authJson" label="认证">
                <TextArea rows={4} style={{ fontFamily: 'monospace' }} disabled />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="runtimeJson" label="运行时">
                <TextArea rows={4} style={{ fontFamily: 'monospace' }} disabled />
              </Form.Item>
            </Col>
          </Row>
          {editingTool?.lastTestResult && (
            <Alert
              type={editingTool.lastTestResult.success ? 'success' : 'warning'}
              showIcon
              message={editingTool.lastTestResult.message}
              description={editingTool.lastCheckedAt ? `最近检查：${new Date(editingTool.lastCheckedAt).toLocaleString()}` : undefined}
            />
          )}
        </Form>
      </Modal>
    </div>
  )
}

export default ToolRegistry
