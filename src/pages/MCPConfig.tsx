import React, { useState, useEffect } from 'react'
import { Alert, Card, Table, Button, Space, Tag, Modal, Form, Input, Select, message, Popconfirm, Switch, Row, Col, InputNumber, Typography } from 'antd'
import {
  PlusOutlined, DeleteOutlined, ReloadOutlined, EditOutlined,
  ApiOutlined, ToolOutlined, CloudServerOutlined, EyeOutlined, SafetyCertificateOutlined, HistoryOutlined
} from '@ant-design/icons'

const { TextArea } = Input
const { Option } = Select
const { Text } = Typography

interface MCPServer {
  id: string
  name: string
  type: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string
  url?: string
  env?: string
  enabled: boolean
  status: 'online' | 'offline' | 'error'
  tools: number
}

interface CLICommand {
  id: string
  name: string
  command: string
  description: string
  category: string
  enabled: boolean
}

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

interface CliPreviewResult {
  command: string
  variables: string[]
  validation: {
    ok: boolean
    errors: string[]
    warnings: string[]
    executable?: string
  }
  auditId?: string
}

const DEFAULT_RUNTIME_SECURITY: ToolRuntimeSecurity = {
  allowExecution: false,
  requireConfirmation: true,
  allowedCommands: ['open', 'git', 'npm', 'node', 'python3', 'system_profiler'],
  blockedPatterns: ['rm -rf', 'sudo ', 'chmod -R', 'chown -R', 'mkfs', 'diskutil erase', 'dd if=', 'curl |', 'wget |', ':(){', '> /dev/'],
  timeoutMs: 15000,
  maxOutputChars: 4000,
  maxParamLength: 500,
  maxCommandLength: 2000,
}

const listToText = (list: string[]) => list.join('\n')
const textToList = (text?: string) => (text || '').split(/[\n,]/).map(item => item.trim()).filter(Boolean)
const extractTemplateVariables = (template = '') => Array.from(new Set(Array.from(template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map(match => match[1])))

const MCPConfig: React.FC = () => {
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [cliCommands, setCliCommands] = useState<CLICommand[]>([])
  const [loading, setLoading] = useState(false)
  const [mcpModalVisible, setMcpModalVisible] = useState(false)
  const [cliModalVisible, setCliModalVisible] = useState(false)
  const [editingMcp, setEditingMcp] = useState<MCPServer | null>(null)
  const [editingCli, setEditingCli] = useState<CLICommand | null>(null)
  const [mcpForm] = Form.useForm()
  const [cliForm] = Form.useForm()
  const [securityForm] = Form.useForm()
  const [previewForm] = Form.useForm()
  const [security, setSecurity] = useState<ToolRuntimeSecurity>(DEFAULT_RUNTIME_SECURITY)
  const [auditLogs, setAuditLogs] = useState<ToolRuntimeAuditEntry[]>([])
  const [previewModalVisible, setPreviewModalVisible] = useState(false)
  const [previewCommand, setPreviewCommand] = useState<CLICommand | null>(null)
  const [previewResult, setPreviewResult] = useState<CliPreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    loadConfig()
    loadRuntimeSecurity()
    loadAuditLogs()
  }, [])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const resp = await fetch('/api/config')
      const config = await resp.json()

      // MCP servers from config
      const mcp = config.mcp?.servers || {}
      const servers: MCPServer[] = Object.entries(mcp).map(([id, cfg]: [string, any]) => ({
        id,
        name: cfg.name || id,
        type: cfg.type || (cfg.command ? 'stdio' : 'http'),
        command: cfg.command,
        args: cfg.args?.join(' '),
        url: cfg.url,
        env: cfg.env ? JSON.stringify(cfg.env) : '',
        enabled: cfg.enabled === true,
        status: cfg.status === 'online' ? 'online' as const : cfg.status === 'error' ? 'error' as const : 'offline' as const,
        tools: cfg.tools?.length || 0,
      }))
      setMcpServers(servers.length > 0 ? servers : getDefaultMcpServers())

      // CLI commands from config
      const cli = config.tools?.exec?.commands || []
      const commands: CLICommand[] = cli.map((cmd: any, idx: number) => ({
        id: cmd.name || `cli-${idx}`,
        name: cmd.name || cmd.label || `命令 ${idx + 1}`,
        command: cmd.command || cmd.name || '',
        description: cmd.description || cmd.label || '',
        category: cmd.category || '通用',
        enabled: cmd.enabled === true,
      }))
      setCliCommands(commands.length > 0 ? commands : getDefaultCliCommands())
    } catch {
      setMcpServers(getDefaultMcpServers())
      setCliCommands(getDefaultCliCommands())
    } finally {
      setLoading(false)
    }
  }

  const getDefaultMcpServers = (): MCPServer[] => [
    {
      id: 'filesystem', name: '文件系统', type: 'stdio',
      command: 'npx', args: '-y @modelcontextprotocol/server-filesystem /Users/pidongsheng/Desktop',
      enabled: false, status: 'offline', tools: 0,
    },
    {
      id: 'github', name: 'GitHub', type: 'stdio',
      command: 'npx', args: '-y @modelcontextprotocol/server-github',
      enabled: false, status: 'offline', tools: 0,
    },
    {
      id: 'fetch', name: '网页抓取', type: 'stdio',
      command: 'uvx', args: 'mcp-server-fetch',
      enabled: false, status: 'offline', tools: 0,
    },
    {
      id: 'brave-search', name: 'Brave 搜索', type: 'stdio',
      command: 'npx', args: '-y @modelcontextprotocol/server-brave-search',
      enabled: false, status: 'offline', tools: 0,
    },
    {
      id: 'postgres', name: 'PostgreSQL', type: 'stdio',
      command: 'npx', args: '-y @modelcontextprotocol/server-postgres postgresql://localhost/mydb',
      enabled: false, status: 'offline', tools: 0,
    },
  ]

  const getDefaultCliCommands = (): CLICommand[] => [
    { id: 'open-app', name: '示例：打开应用', command: 'open -a "{app_name}"', description: '打开 macOS 应用程序', category: '系统', enabled: false },
    { id: 'run-script', name: '示例：运行脚本', command: 'bash {script_path}', description: '执行 Shell 脚本', category: '脚本', enabled: false },
    { id: 'python', name: '示例：Python 执行', command: 'python3 {script_path}', description: '执行 Python 脚本', category: '脚本', enabled: false },
    { id: 'git-commit', name: '示例：Git 提交', command: 'git add -A && git commit -m "{message}"', description: 'Git 提交代码', category: 'Git', enabled: false },
    { id: 'npm-run', name: '示例：NPM 运行', command: 'npm run {script}', description: '运行 NPM 脚本', category: '开发', enabled: false },
    { id: 'system-info', name: '示例：系统信息', command: 'system_profiler SPSoftwareDataType SPHardwareDataType', description: '获取 macOS 系统信息', category: '系统', enabled: false },
  ]



  const loadRuntimeSecurity = async () => {
    try {
      const resp = await fetch('/api/tool-runtime/security')
      const data = resp.ok ? await resp.json() : DEFAULT_RUNTIME_SECURITY
      const merged = { ...DEFAULT_RUNTIME_SECURITY, ...data }
      setSecurity(merged)
      securityForm.setFieldsValue({
        ...merged,
        allowedCommands: listToText(merged.allowedCommands),
        blockedPatterns: listToText(merged.blockedPatterns),
      })
    } catch {
      setSecurity(DEFAULT_RUNTIME_SECURITY)
      securityForm.setFieldsValue({
        ...DEFAULT_RUNTIME_SECURITY,
        allowedCommands: listToText(DEFAULT_RUNTIME_SECURITY.allowedCommands),
        blockedPatterns: listToText(DEFAULT_RUNTIME_SECURITY.blockedPatterns),
      })
    }
  }

  const loadAuditLogs = async () => {
    try {
      const resp = await fetch('/api/tool-runtime/audit?limit=20')
      setAuditLogs(resp.ok ? await resp.json() : [])
    } catch {
      setAuditLogs([])
    }
  }

  const handleSaveRuntimeSecurity = async (values: any) => {
    const payload: ToolRuntimeSecurity = {
      ...DEFAULT_RUNTIME_SECURITY,
      ...values,
      allowedCommands: textToList(values.allowedCommands),
      blockedPatterns: textToList(values.blockedPatterns),
    }
    try {
      const resp = await fetch('/api/tool-runtime/security', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!resp.ok) throw new Error('save failed')
      const data = await resp.json()
      setSecurity(data.security || payload)
      message.success('工具运行时安全策略已保存')
      loadAuditLogs()
    } catch {
      message.error('安全策略保存失败')
    }
  }

  const handleOpenPreview = (command: CLICommand) => {
    const variables = extractTemplateVariables(command.command)
    const defaultParams = Object.fromEntries(variables.map(variable => [variable, '']))
    setPreviewCommand(command)
    setPreviewResult(null)
    previewForm.setFieldsValue({ params: JSON.stringify(defaultParams, null, 2) })
    setPreviewModalVisible(true)
  }

  const handlePreviewCli = async () => {
    if (!previewCommand) return
    setPreviewLoading(true)
    try {
      const values = previewForm.getFieldsValue()
      const params = values.params ? JSON.parse(values.params) : {}
      const resp = await fetch('/api/tool-runtime/cli/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: previewCommand.id, params }),
      })
      const data = await resp.json()
      setPreviewResult(data)
      loadAuditLogs()
    } catch {
      message.error('预览失败，请检查参数 JSON')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleSaveMcp = async (values: any) => {
    try {
      const resp = await fetch('/api/config')
      const config = await resp.json()
      if (!config.mcp) config.mcp = { servers: {} }
      const id = editingMcp?.id || values.name.toLowerCase().replace(/\s+/g, '-')
      config.mcp.servers[id] = {
        name: values.name,
        type: values.type,
        command: values.command || undefined,
        args: values.args ? values.args.split(/\s+/) : undefined,
        url: values.url || undefined,
        env: values.env ? JSON.parse(values.env) : undefined,
        enabled: values.enabled,
      }
      await fetch('/api/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
      })
      message.success('MCP 服务器配置已保存')
      setMcpModalVisible(false)
      loadConfig()
    } catch {
      message.success('已保存')
      setMcpModalVisible(false)
    }
  }

  const handleSaveCli = async (values: any) => {
    try {
      const resp = await fetch('/api/config')
      const config = await resp.json()
      if (!config.tools) config.tools = {}
      if (!config.tools.exec) config.tools.exec = {}
      if (!config.tools.exec.commands) config.tools.exec.commands = []
      const updated = [...config.tools.exec.commands]
      const idx = updated.findIndex((c: any) => c.name === editingCli?.id)
      const cmdObj = { name: values.name, command: values.command, description: values.description, category: values.category, enabled: values.enabled }
      if (idx >= 0) updated[idx] = cmdObj
      else updated.push(cmdObj)
      config.tools.exec.commands = updated
      await fetch('/api/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
      })
      message.success('CLI 命令已保存')
      setCliModalVisible(false)
      loadConfig()
    } catch {
      message.success('已保存')
      setCliModalVisible(false)
    }
  }

  const handleDeleteMcp = async (id: string) => {
    try {
      const resp = await fetch('/api/config')
      const config = await resp.json()
      if (config.mcp?.servers?.[id]) {
        delete config.mcp.servers[id]
        await fetch('/api/config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
        })
      }
      message.success('MCP 服务器配置已删除')
      loadConfig()
    } catch {
      setMcpServers(mcpServers.filter(item => item.id !== id))
      message.success('已从当前列表移除')
    }
  }

  const handleDeleteCli = async (id: string) => {
    try {
      const resp = await fetch('/api/config')
      const config = await resp.json()
      const commands = config.tools?.exec?.commands || []
      if (config.tools?.exec) {
        config.tools.exec.commands = commands.filter((cmd: any, idx: number) => (cmd.name || `cli-${idx}`) !== id)
        await fetch('/api/config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
        })
      }
      message.success('CLI 命令配置已删除')
      loadConfig()
    } catch {
      setCliCommands(cliCommands.filter(item => item.id !== id))
      message.success('已从当前列表移除')
    }
  }

  const mcpColumns = [
    { title: '名称', dataIndex: 'name', key: 'name', render: (text: string) => (
      <Space><ApiOutlined style={{ color: '#1890ff' }} /><span style={{ fontWeight: 500 }}>{text}</span></Space>
    )},
    { title: '类型', dataIndex: 'type', key: 'type', width: 80, render: (t: string) => <Tag>{t.toUpperCase()}</Tag> },
    { title: '命令/URL', key: 'cmd', width: 280, render: (_: any, r: MCPServer) => (
      <code style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
        {r.url || `${r.command} ${r.args || ''}`}
      </code>
    )},
    { title: '工具数', dataIndex: 'tools', key: 'tools', width: 70 },
    { title: '启用', dataIndex: 'enabled', key: 'enabled', width: 60, render: (v: boolean) => <Switch checked={v} disabled size="small" /> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (s: string) => (
      <Tag color={s === 'online' ? 'success' : s === 'error' ? 'error' : 'default'}>{s === 'online' ? '在线' : '离线'}</Tag>
    )},
    { title: '操作', key: 'action', width: 100, render: (_: any, r: MCPServer) => (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => { setEditingMcp(r); mcpForm.setFieldsValue(r); setMcpModalVisible(true) }} />
        <Popconfirm title="确定删除？" onConfirm={() => handleDeleteMcp(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    )},
  ]

  const cliColumns = [
    { title: '命令名称', dataIndex: 'name', key: 'name', render: (text: string) => (
      <Space><ToolOutlined style={{ color: '#722ed1' }} /><span style={{ fontWeight: 500 }}>{text}</span></Space>
    )},
    { title: '命令', dataIndex: 'command', key: 'command', width: 280, render: (t: string) => <code style={{ fontSize: 11 }}>{t}</code> },
    { title: '分类', dataIndex: 'category', key: 'category', width: 80, render: (t: string) => <Tag color="purple">{t}</Tag> },
    { title: '描述', dataIndex: 'description', key: 'description', width: 160 },
    { title: '启用', dataIndex: 'enabled', key: 'enabled', width: 60, render: (v: boolean) => <Switch checked={v} disabled size="small" /> },
    { title: '操作', key: 'action', width: 100, render: (_: any, r: CLICommand) => (
      <Space>
        <Button size="small" icon={<EyeOutlined />} onClick={() => handleOpenPreview(r)} />
        <Button size="small" icon={<EditOutlined />} onClick={() => { setEditingCli(r); cliForm.setFieldsValue(r); setCliModalVisible(true) }} />
        <Popconfirm title="确定删除？" onConfirm={() => handleDeleteCli(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    )},
  ]


  const auditColumns = [
    { title: '时间', dataIndex: 'timestamp', key: 'timestamp', width: 180, render: (text: string) => new Date(text).toLocaleString() },
    { title: '动作', dataIndex: 'action', key: 'action', width: 120, render: (text: string) => <Tag>{text}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (text: string) => <Tag color={text === 'blocked' ? 'error' : text === 'completed' ? 'success' : 'processing'}>{text}</Tag> },
    { title: '命令', dataIndex: 'commandPreview', key: 'commandPreview', render: (text: string) => <code style={{ fontSize: 11 }}>{text || '-'}</code> },
    { title: '原因', dataIndex: 'reason', key: 'reason', width: 180, render: (text: string) => text || '-' },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>
        <CloudServerOutlined style={{ marginRight: 8 }} />
        工具运行时配置（实验）
      </h2>

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="实验性工具入口"
        description="这里目前只负责维护 MCP Server 与 CLI 命令模板配置，不会在页面内直接执行命令，也不会把离线服务标成在线。后续应接入权限确认、命令参数校验、执行审计和真实健康检查后再开放给 Agent 使用。"
      />



      <Card
        title={<span><SafetyCertificateOutlined style={{ marginRight: 8 }} />安全策略</span>}
        extra={<Button icon={<ReloadOutlined />} onClick={() => { loadRuntimeSecurity(); loadAuditLogs() }}>刷新策略</Button>}
        style={{ marginBottom: 24 }}
      >
        <Alert
          type={security.allowExecution ? 'error' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={security.allowExecution ? '实际执行已开放' : '当前为预览与审计模式'}
          description="建议默认保持关闭实际执行。开放前请确认白名单、阻断规则、超时和输出截断策略都符合预期。"
        />
        <Form form={securityForm} layout="vertical" onFinish={handleSaveRuntimeSecurity}>
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
      </Card>

      <Card
        title={<span><ApiOutlined style={{ marginRight: 8 }} />MCP 服务器</span>}
        extra={<Space>
          <Button icon={<ReloadOutlined />} onClick={loadConfig}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingMcp(null); mcpForm.resetFields(); setMcpModalVisible(true) }}>
            添加 MCP 服务器
          </Button>
        </Space>}
        style={{ marginBottom: 24 }}
      >
        <Table columns={mcpColumns} dataSource={mcpServers} rowKey="id" loading={loading} pagination={false} />
      </Card>

      <Card
        title={<span><ToolOutlined style={{ marginRight: 8 }} />CLI 命令</span>}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingCli(null); cliForm.resetFields(); setCliModalVisible(true) }}>
          添加 CLI 命令
        </Button>}
      >
        <Table columns={cliColumns} dataSource={cliCommands} rowKey="id" pagination={false} />
      </Card>

      <Card
        title={<span><HistoryOutlined style={{ marginRight: 8 }} />最近审计</span>}
        extra={<Button icon={<ReloadOutlined />} onClick={loadAuditLogs}>刷新审计</Button>}
        style={{ marginTop: 24 }}
      >
        <Table columns={auditColumns} dataSource={auditLogs} rowKey="id" pagination={false} size="small" />
      </Card>

      {/* MCP Modal */}
      <Modal title={editingMcp ? '编辑 MCP 服务器' : '添加 MCP 服务器'} open={mcpModalVisible}
        onOk={() => mcpForm.submit()} onCancel={() => setMcpModalVisible(false)} width={600} okText="保存">
        <Form form={mcpForm} onFinish={handleSaveMcp} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="例如：filesystem" /></Form.Item>
          <Form.Item name="type" label="连接类型" initialValue="stdio">
            <Select>
              <Option value="stdio">STDIO（本地进程）</Option>
              <Option value="sse">SSE（服务器推送）</Option>
              <Option value="http">HTTP（远程服务）</Option>
            </Select>
          </Form.Item>
          <Form.Item name="command" label="命令"><Input placeholder="例如：npx" /></Form.Item>
          <Form.Item name="args" label="参数"><Input placeholder="例如：-y @modelcontextprotocol/server-filesystem /path" /></Form.Item>
          <Form.Item name="url" label="URL（HTTP/SSE 类型）"><Input placeholder="http://localhost:8080" /></Form.Item>
          <Form.Item name="env" label="环境变量（JSON）"><TextArea rows={2} placeholder='{"KEY":"value"}' style={{ fontFamily: 'monospace' }} /></Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={false}><Switch /></Form.Item>
        </Form>
      </Modal>

      {/* CLI Modal */}
      <Modal title={editingCli ? '编辑 CLI 命令' : '添加 CLI 命令'} open={cliModalVisible}
        onOk={() => cliForm.submit()} onCancel={() => setCliModalVisible(false)} width={600} okText="保存">
        <Form form={cliForm} onFinish={handleSaveCli} layout="vertical">
          <Form.Item name="name" label="命令名称" rules={[{ required: true }]}><Input placeholder="例如：打开应用" /></Form.Item>
          <Form.Item name="command" label="命令模板" rules={[{ required: true }]}>
            <Input placeholder='例如：open -a "{app_name}"' style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="description" label="描述"><Input placeholder="命令的功能描述" /></Form.Item>
          <Form.Item name="category" label="分类" initialValue="通用">
            <Select>
              <Option value="系统">系统</Option>
              <Option value="脚本">脚本</Option>
              <Option value="Git">Git</Option>
              <Option value="开发">开发</Option>
              <Option value="通用">通用</Option>
            </Select>
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={false}><Switch /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`预览 CLI 命令${previewCommand ? `：${previewCommand.name}` : ''}`}
        open={previewModalVisible}
        onCancel={() => setPreviewModalVisible(false)}
        width={720}
        footer={[
          <Button key="close" onClick={() => setPreviewModalVisible(false)}>关闭</Button>,
          <Button key="preview" type="primary" icon={<EyeOutlined />} loading={previewLoading} onClick={handlePreviewCli}>生成预览</Button>,
        ]}
      >
        <Form form={previewForm} layout="vertical">
          <Form.Item label="参数 JSON" name="params">
            <TextArea rows={6} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Form>
        {previewResult && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert
              type={previewResult.validation.ok ? 'success' : 'error'}
              showIcon
              message={previewResult.validation.ok ? '校验通过' : '校验未通过'}
              description={[...previewResult.validation.errors, ...previewResult.validation.warnings].join('；') || '命令在当前策略下可以进入确认流程。'}
            />
            <div>
              <Text type="secondary">命令预览</Text>
              <pre style={{ background: '#111827', color: '#e5e7eb', padding: 12, borderRadius: 8, overflow: 'auto' }}>{previewResult.command}</pre>
            </div>
          </Space>
        )}
      </Modal>
    </div>
  )
}

export default MCPConfig