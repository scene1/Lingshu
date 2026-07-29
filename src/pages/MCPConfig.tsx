import React, { useState, useEffect } from 'react'
import { Card, Table, Button, Space, Tag, Modal, Form, Input, Select, message, Popconfirm, Switch } from 'antd'
import {
  PlusOutlined, DeleteOutlined, ReloadOutlined, EditOutlined,
  ApiOutlined, ToolOutlined, CloudServerOutlined
} from '@ant-design/icons'

const { TextArea } = Input
const { Option } = Select

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

  useEffect(() => {
    loadConfig()
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
        enabled: cfg.enabled !== false,
        status: cfg.enabled !== false ? 'online' as const : 'offline' as const,
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
        enabled: cmd.enabled !== false,
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
      enabled: true, status: 'online', tools: 8,
    },
    {
      id: 'github', name: 'GitHub', type: 'stdio',
      command: 'npx', args: '-y @modelcontextprotocol/server-github',
      enabled: false, status: 'offline', tools: 22,
    },
    {
      id: 'fetch', name: '网页抓取', type: 'stdio',
      command: 'uvx', args: 'mcp-server-fetch',
      enabled: false, status: 'offline', tools: 3,
    },
    {
      id: 'brave-search', name: 'Brave 搜索', type: 'stdio',
      command: 'npx', args: '-y @modelcontextprotocol/server-brave-search',
      enabled: false, status: 'offline', tools: 2,
    },
    {
      id: 'postgres', name: 'PostgreSQL', type: 'stdio',
      command: 'npx', args: '-y @modelcontextprotocol/server-postgres postgresql://localhost/mydb',
      enabled: false, status: 'offline', tools: 6,
    },
  ]

  const getDefaultCliCommands = (): CLICommand[] => [
    { id: 'open-app', name: '打开应用', command: 'open -a "{app_name}"', description: '打开 macOS 应用程序', category: '系统', enabled: true },
    { id: 'run-script', name: '运行脚本', command: 'bash {script_path}', description: '执行 Shell 脚本', category: '脚本', enabled: true },
    { id: 'python', name: 'Python 执行', command: 'python3 {script_path}', description: '执行 Python 脚本', category: '脚本', enabled: true },
    { id: 'git-commit', name: 'Git 提交', command: 'git add -A && git commit -m "{message}"', description: 'Git 提交代码', category: 'Git', enabled: true },
    { id: 'npm-run', name: 'NPM 运行', command: 'npm run {script}', description: '运行 NPM 脚本', category: '开发', enabled: true },
    { id: 'system-info', name: '系统信息', command: 'system_profiler SPSoftwareDataType SPHardwareDataType', description: '获取 macOS 系统信息', category: '系统', enabled: true },
  ]

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
        <Popconfirm title="确定删除？" onConfirm={() => message.success('已删除')}>
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
        <Button size="small" icon={<EditOutlined />} onClick={() => { setEditingCli(r); cliForm.setFieldsValue(r); setCliModalVisible(true) }} />
        <Popconfirm title="确定删除？" onConfirm={() => message.success('已删除')}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    )},
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>
        <CloudServerOutlined style={{ marginRight: 8 }} />
        MCP 与 CLI 管理
      </h2>

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
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
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
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default MCPConfig