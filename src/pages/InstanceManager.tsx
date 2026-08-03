import React, { useState, useEffect } from 'react'
import { 
  Card, 
  Row, 
  Col, 
  Tag, 
  Button, 
  Table, 
  Badge,
  Space,
  Modal,
  Form,
  Input,
  Select,
  message,
  Spin,
  Alert,
  Typography,
  List,
  Empty
} from 'antd'
import {
  CloudOutlined,
  DesktopOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CheckCircleOutlined
} from '@ant-design/icons'

const { Option } = Select
const { Text } = Typography

interface Instance {
  id: string
  name: string
  type: 'local' | 'agent-desktop' | 'stepfun-desktop' | 'remote' | 'cloud'
  status: 'connected' | 'disconnected' | 'error'
  host?: string
  port?: number
  configPath: string
  workspacePath: string
  appName?: string
  bundleId?: string
  description?: string
  invocationMode?: 'open' | 'url-scheme' | 'cli'
  urlScheme?: string
  urlTemplate?: string
  cliCommand?: string
  cliArgsTemplate?: string
  lastConnected?: string
}

interface LocalAgentApp {
  name: string
  displayName: string
  bundleId?: string
  version?: string
  executable?: string
  path: string
  matchedReason?: string
  invocation?: {
    canOpen?: boolean
    canUseUrlScheme?: boolean
    canUseCli?: boolean
    urlScheme?: string
    cliCommand?: string
    suggestedInvocationMode?: 'open' | 'url-scheme' | 'cli'
    note?: string
  }
  instanceExists?: boolean
}

const desktopAgentPresets = [
  { value: 'WorkBuddy', label: 'WorkBuddy' },
  { value: 'Marvis', label: 'Marvis' },
  { value: 'Codex', label: 'Codex' },
  { value: 'custom', label: '自定义桌面 Agent' }
]

const InstanceManager: React.FC = () => {
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null)
  const [agentScanVisible, setAgentScanVisible] = useState(false)
  const [scanningAgents, setScanningAgents] = useState(false)
  const [detectedAgentApps, setDetectedAgentApps] = useState<LocalAgentApp[]>([])
  const [form] = Form.useForm()
  const selectedType = Form.useWatch('type', form)
  const selectedAppName = Form.useWatch('appName', form)
  const selectedInvocationMode = Form.useWatch('invocationMode', form)

  // 加载实例列表
  const loadInstances = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/instances')
      if (response.ok) {
        const data = await response.json()
        setInstances(data)
      }
    } catch (error) {
      message.error('加载实例失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInstances()
  }, [])

  // 测试连接
  const testConnection = async (id: string) => {
    try {
      const response = await fetch(`/api/instances/${id}/test`, { method: 'POST' })
      const data = await response.json()
      
      if (data.success) {
        message.success('连接成功')
        loadInstances()
      } else {
        message.error(data.message || '连接失败')
      }
    } catch (error) {
      message.error('测试连接失败')
    }
  }

  // 重启实例
  const restartInstance = async (id: string) => {
    try {
      const response = await fetch(`/api/instances/${id}/restart`, { method: 'POST' })
      const data = await response.json()
      
      if (data.success) {
        message.success('重启成功')
      } else {
        message.error(data.message || '重启失败')
      }
    } catch (error) {
      message.error('重启失败')
    }
  }

  // 删除实例
  const deleteInstance = async (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后无法恢复，是否继续？',
      onOk: async () => {
        try {
          await fetch(`/api/instances/${id}`, { method: 'DELETE' })
          message.success('删除成功')
          loadInstances()
        } catch (error) {
          message.error('删除失败')
        }
      }
    })
  }

  // 保存实例
  const handleSave = async (values: any) => {
    const normalizedValues = {
      ...values,
      type: values.type === 'stepfun-desktop' ? 'agent-desktop' : values.type,
      appName: values.type === 'agent-desktop' && values.appName === 'custom' ? values.customAppName : values.appName
    }
    delete normalizedValues.customAppName

    try {
      if (editingInstance) {
        // 更新
        await fetch(`/api/instances/${editingInstance.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(normalizedValues)
        })
        message.success('更新成功')
      } else {
        // 创建
        await fetch('/api/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(normalizedValues)
        })
        message.success('创建成功')
      }
      
      setModalVisible(false)
      form.resetFields()
      setEditingInstance(null)
      loadInstances()
    } catch (error) {
      message.error('保存失败')
    }
  }

  // 打开编辑弹窗
  const handleEdit = (instance: Instance) => {
    setEditingInstance(instance)
    const normalized = {
      ...instance,
      type: instance.type === 'stepfun-desktop' ? 'agent-desktop' : instance.type,
      appName: instance.appName || ''
    }
    form.setFieldsValue(normalized)
    setModalVisible(true)
  }

  // 打开创建弹窗
  const handleCreate = () => {
    setEditingInstance(null)
    form.resetFields()
    setModalVisible(true)
  }

  const scanLocalAgentApps = async () => {
    setScanningAgents(true)
    try {
      const response = await fetch('/api/local-agent-apps')
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || data.error || '扫描失败')
      const apps = Array.isArray(data.apps) ? data.apps : []
      setDetectedAgentApps(apps)
      setAgentScanVisible(true)
      message.success(`扫描完成，发现 ${apps.length} 个候选 Agent 应用`)
    } catch (error: any) {
      message.error(error.message || '扫描本机 Agent 失败')
    } finally {
      setScanningAgents(false)
    }
  }

  const addDetectedAgentApp = async (app: LocalAgentApp) => {
    try {
      const response = await fetch('/api/local-agent-apps/seed-instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apps: [app] })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || data.error || '加入失败')
      if (data.count > 0) {
        message.success(`已加入：${app.displayName || app.name}`)
      } else {
        message.info('该 Agent 已在运行实例中')
      }
      await loadInstances()
      await scanLocalAgentApps()
    } catch (error: any) {
      message.error(error.message || '加入 Agent 实例失败')
    }
  }

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Instance) => (
        <Space>
          {record.type === 'local' && <DesktopOutlined />}
          {(record.type === 'agent-desktop' || record.type === 'stepfun-desktop') && <DesktopOutlined />}
          {record.type === 'remote' && <CloudOutlined />}
          {record.type === 'cloud' && <CloudOutlined />}
          <span style={{ fontWeight: 500 }}>{text}</span>
          {(record.type === 'agent-desktop' || record.type === 'stepfun-desktop') && record.appName && (
            <Tag color="blue">{record.appName}</Tag>
          )}
          {(record.type === 'agent-desktop' || record.type === 'stepfun-desktop') && record.invocationMode && (
            <Tag color={record.invocationMode === 'cli' ? 'purple' : record.invocationMode === 'url-scheme' ? 'geekblue' : 'default'}>
              {record.invocationMode === 'cli' ? 'CLI 投递' : record.invocationMode === 'url-scheme' ? 'URL 投递' : '打开 App'}
            </Tag>
          )}
        </Space>
      )
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const typeMap: Record<string, string> = {
          'local': '本地',
          'agent-desktop': 'Agent 桌面端',
          'stepfun-desktop': 'Agent 桌面端',
          'remote': '远程',
          'cloud': '云端'
        }
        return <Tag>{typeMap[type] || type}</Tag>
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        if (status === 'connected') {
          return <Badge status="success" text="已连接" />
        } else if (status === 'disconnected') {
          return <Badge status="default" text="未连接" />
        } else {
          return <Badge status="error" text="错误" />
        }
      }
    },
    {
      title: '配置路径',
      dataIndex: 'configPath',
      key: 'configPath',
      ellipsis: true
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Instance) => (
        <Space>
          <Button 
            type="text" 
            icon={<CheckCircleOutlined />} 
            onClick={() => testConnection(record.id)}
          >
            测试
          </Button>
          <Button 
            type="text" 
            icon={<ReloadOutlined />} 
            onClick={() => restartInstance(record.id)}
          >
            重启
          </Button>
          <Button 
            type="text" 
            icon={<EditOutlined />} 
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Button 
            type="text" 
            danger 
            icon={<DeleteOutlined />} 
            onClick={() => deleteInstance(record.id)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ]

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="运行实例是灵枢连接的宿主环境，不是 Agent 角色"
        description="实例负责配置文件、工作目录、连接状态、本地 App 和远程运行时能力；Agent 角色库负责具体的 AI 角色、模型和提示词。一个运行实例可以承载多个 Agent 角色，也可以连接 WorkBuddy、Marvis、Codex 等本机 Agent 桌面端。"
      />

      <div style={{ marginBottom: 16 }}>
        <Space align="center">
          <CloudOutlined style={{ fontSize: 20, color: '#1890ff' }} />
          <span style={{ fontSize: 16, fontWeight: 600 }}>运行实例</span>
          <Text type="secondary">管理本地运行时、Agent 桌面端、远程服务器和云端服务。</Text>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        {/* 统计卡片 */}
        <Col span={6}>
          <Card>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 'bold', color: '#1890ff' }}>
                {instances.length}
              </div>
              <div style={{ color: '#999' }}>宿主数</div>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 'bold', color: '#52c41a' }}>
                {instances.filter(i => i.status === 'connected').length}
              </div>
              <div style={{ color: '#999' }}>已连接</div>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 'bold', color: '#faad14' }}>
                {instances.filter(i => i.status === 'disconnected').length}
              </div>
              <div style={{ color: '#999' }}>未连接</div>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 'bold', color: '#f5222d' }}>
                {instances.filter(i => i.status === 'error').length}
              </div>
              <div style={{ color: '#999' }}>错误</div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 实例列表 */}
      <Card style={{ marginTop: 16 }} title="运行实例列表" extra={
        <Space>
          <Button icon={<ReloadOutlined />} loading={scanningAgents} onClick={scanLocalAgentApps}>
            扫描本机 Agent
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            添加运行实例
          </Button>
        </Space>
      }>
        <Spin spinning={loading}>
          <Table 
            columns={columns} 
            dataSource={instances} 
            rowKey="id"
            pagination={false}
          />
        </Spin>
      </Card>

      <Modal
        title="本机 Agent 扫描结果"
        open={agentScanVisible}
        width={780}
        footer={null}
        onCancel={() => setAgentScanVisible(false)}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="已自动扫描 /Applications 与 ~/Applications"
          description="这里会列出 WorkBuddy、Marvis、Codex、ChatGPT、Claude、Cursor、Orcha 等 Agent/AI 类桌面应用。加入后可在 AI 对话工具菜单中直接调用。"
        />
        {detectedAgentApps.length === 0 ? (
          <Empty description="没有发现 Agent 类应用。你仍可用“添加运行实例”手动添加。" />
        ) : (
          <List
            itemLayout="horizontal"
            dataSource={detectedAgentApps}
            renderItem={app => (
              <List.Item
                actions={[
                  app.instanceExists ? (
                    <Tag color="green" key="exists">已加入</Tag>
                  ) : (
                    <Button size="small" type="primary" key="add" onClick={() => addDetectedAgentApp(app)}>
                      加入实例
                    </Button>
                  )
                ]}
              >
                <List.Item.Meta
                  avatar={<DesktopOutlined style={{ fontSize: 22, color: '#1677ff' }} />}
                  title={
                    <Space wrap>
                      <span>{app.displayName || app.name}</span>
                      {app.version && <Tag>{app.version}</Tag>}
                      {app.matchedReason === 'keyword-match' && <Tag color="blue">关键词匹配</Tag>}
                      {app.invocation?.canUseCli && <Tag color="purple">CLI</Tag>}
                      {app.invocation?.canUseUrlScheme && <Tag color="geekblue">URL Scheme</Tag>}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2}>
                      {app.bundleId && <Text type="secondary">{app.bundleId}</Text>}
                      <Text type="secondary">{app.path}</Text>
                      {app.invocation?.note && <Text type="secondary">{app.invocation.note}</Text>}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Modal>

      {/* 创建/编辑弹窗 */}
      <Modal
        title={editingInstance ? '编辑运行实例' : '添加运行实例'}
        open={modalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setModalVisible(false)
          form.resetFields()
          setEditingInstance(null)
        }}
      >
        <Form form={form} onFinish={handleSave} layout="vertical">
          <Form.Item
            name="name"
            label="实例名称"
            rules={[{ required: true, message: '请输入实例名称' }]}
          >
            <Input placeholder="如：Codex 桌面端 / WorkBuddy / Marvis" />
          </Form.Item>
          
          <Form.Item
            name="type"
            label="实例类型"
            rules={[{ required: true, message: '请选择实例类型' }]}
          >
            <Select placeholder="选择类型">
              <Option value="local">本地运行时</Option>
              <Option value="agent-desktop">Agent 桌面端</Option>
              <Option value="remote">远程服务器</Option>
              <Option value="cloud">云端服务</Option>
            </Select>
          </Form.Item>

          {selectedType === 'agent-desktop' && (
            <>
              <Form.Item
                name="appName"
                label="桌面 Agent 应用"
                rules={[{ required: true, message: '请选择或输入要连接的桌面 Agent 应用' }]}
                tooltip="用于检测和打开本机 /Applications 或 ~/Applications 中的桌面 Agent。"
              >
                <Select
                  placeholder="选择 WorkBuddy、Marvis、Codex 或自定义"
                  options={desktopAgentPresets}
                  onChange={(value) => {
                    if (value !== 'custom') {
                      form.setFieldsValue({
                        name: value,
                        configPath: `/Applications/${value}.app`,
                        workspacePath: '~/Lingshu/workspace',
                        invocationMode: 'open'
                      })
                    }
                  }}
                />
              </Form.Item>

              {selectedAppName === 'custom' && (
                <Form.Item
                  name="customAppName"
                  label="自定义应用名称"
                  rules={[{ required: true, message: '请输入 macOS 应用名称' }]}
                >
                  <Input placeholder="例如：Raycast / Cursor / 你的 Agent App 名称" />
                </Form.Item>
              )}

              <Form.Item
                name="invocationMode"
                label="调用方式"
                initialValue="open"
                tooltip="默认只打开 App；如果该 Agent 支持 URL Scheme 或 CLI，可以把对话指令自动投递过去。"
              >
                <Select
                  options={[
                    { value: 'open', label: '仅打开 App 并记录意图' },
                    { value: 'url-scheme', label: 'URL Scheme 投递' },
                    { value: 'cli', label: 'CLI 投递' }
                  ]}
                />
              </Form.Item>

              {selectedInvocationMode === 'url-scheme' && (
                <>
                  <Form.Item name="urlScheme" label="URL Scheme">
                    <Input placeholder="例如：codex / marvis / workbuddy" />
                  </Form.Item>
                  <Form.Item
                    name="urlTemplate"
                    label="URL 模板"
                    tooltip="支持 {{instruction}} 和 {{encodedInstruction}}。中文和空格建议使用 encodedInstruction。"
                  >
                    <Input placeholder="例如：codex://new?prompt={{encodedInstruction}}" />
                  </Form.Item>
                </>
              )}

              {selectedInvocationMode === 'cli' && (
                <>
                  <Form.Item name="cliCommand" label="CLI 命令路径">
                    <Input placeholder="例如：/opt/homebrew/bin/codex 或 codex" />
                  </Form.Item>
                  <Form.Item
                    name="cliArgsTemplate"
                    label="CLI 参数模板"
                    tooltip="支持 {{instruction}}。多参数可用空格分隔；复杂参数建议每行一个参数。"
                  >
                    <Input.TextArea rows={3} placeholder="{{instruction}}" />
                  </Form.Item>
                </>
              )}
            </>
          )}
          
          <Form.Item
            name="configPath"
            label={selectedType === 'agent-desktop' ? '应用路径 / 配置路径' : '配置路径'}
            rules={[{ required: true, message: '请输入配置路径' }]}
            initialValue="~/Lingshu/openclaw.json"
          >
            <Input placeholder={selectedType === 'agent-desktop' ? '/Applications/Codex.app' : '~/Lingshu/openclaw.json'} />
          </Form.Item>
          
          <Form.Item
            name="workspacePath"
            label="工作目录"
            rules={[{ required: true, message: '请输入工作目录' }]}
            initialValue="~/Lingshu/workspace"
          >
            <Input placeholder="~/Lingshu/workspace" />
          </Form.Item>
          
          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea placeholder="实例描述信息" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default InstanceManager
