import React, { useState, useEffect } from 'react'
import {
  Layout,
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
  Tooltip,
  Badge,
  Descriptions,
  Tabs,
  List,
  Typography,
  Alert,
  Row,
  Col
} from 'antd'
import {
  RobotOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  MessageOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { PROVIDERS } from './ModelConfig'
import { getAgentListFromConfig, normalizeAgentsFromConfig, type AgentStatus } from '../utils/agents'

const { Title, Text } = Typography

interface Agent {
  id: string
  name: string
  description: string
  model: string | { primary?: string }
  status: AgentStatus
  createdAt: string
  lastActive: string
  messageCount: number
  uptime: string
  default?: boolean
  config: {
    temperature: number
    maxTokens: number
    systemPrompt: string
    skills: string[]
  }
}

const AgentManager: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [detailModalVisible, setDetailModalVisible] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [form] = Form.useForm()
  const [availableModels, setAvailableModels] = useState<{key: string; label: string; provider: string}[]>([])
  const [rawConfig, setRawConfig] = useState<any>(null)

  useEffect(() => {
    loadAgents()
    loadModelList()
  }, [])

  const loadAgents = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/config')
      if (response.ok) {
        const config = await response.json()
        setRawConfig(config)
        setAgents(normalizeAgentsFromConfig(config))
      } else {
        setAgents([])
        message.error('加载 Agent 失败')
      }
    } catch (error) {
      setAgents([])
      message.error('加载 Agent 失败')
    } finally {
      setLoading(false)
    }
  }

  const loadModelList = async () => {
    try {
      const response = await fetch('/api/config')
      if (!response.ok) return
      const config = await response.json()
      const models: {key: string; label: string; provider: string}[] = []

      // 系统配置的 providers（models.providers）
      if (config.models?.providers) {
        for (const [providerId, providerData] of Object.entries(config.models.providers) as [string, any][]) {
          const providerName = providerId.charAt(0).toUpperCase() + providerId.slice(1)
          if (providerData.models && Array.isArray(providerData.models)) {
            for (const m of providerData.models) {
              models.push({ key: `${providerId}/${m.id}`, label: `${providerName} - ${m.name || m.id}`, provider: providerId })
            }
          }
        }
      }

      // 用户自定义的 providers
      if (config.providers) {
        for (const [providerId, providerData] of Object.entries(config.providers) as [string, any][]) {
          if (!providerData.apiKey) continue
          const providerDef = PROVIDERS[providerId]
          if (providerDef && providerDef.models) {
            for (const m of providerDef.models) {
              const dupKey = `${providerId}/${m.value}`
              if (!models.find(m2 => m2.key === dupKey)) {
                models.push({ key: dupKey, label: `${providerDef.name} - ${m.label}`, provider: providerId })
              }
            }
          } else {
            const modelId = providerData.model || `${providerId}-chat`
            const dupKey = `${providerId}/${modelId}`
            if (!models.find(m => m.key === dupKey)) {
              models.push({ key: dupKey, label: providerId.charAt(0).toUpperCase() + providerId.slice(1) + ' - ' + modelId, provider: providerId })
            }
          }
        }
      }

      if (models.length > 0) {
        setAvailableModels(models)
      }
    } catch (error) {
      console.error('加载模型列表失败:', error)
    }
  }

  const handleCreate = () => {
    setEditingAgent(null)
    form.resetFields()
    setModalVisible(true)
  }

  const handleEdit = (agent: Agent) => {
    setEditingAgent(agent)
    form.setFieldsValue(agent)
    setModalVisible(true)
  }

  const loadEditableConfig = async () => {
    if (rawConfig) return JSON.parse(JSON.stringify(rawConfig))
    const response = await fetch('/api/config')
    if (!response.ok) throw new Error('读取配置失败')
    return response.json()
  }

  const saveEditableConfig = async (config: any) => {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    })
    if (!response.ok) throw new Error('保存配置失败')
    setRawConfig(config)
    setAgents(normalizeAgentsFromConfig(config))
  }

  const findAgentIndex = (list: any[], agentId: string) => (
    list.findIndex((agent, index) => (agent.id || agent.name || `agent-${index}`) === agentId)
  )

  const handleDelete = async (agentId: string) => {
    try {
      const config = await loadEditableConfig()
      const list = getAgentListFromConfig(config)
      const index = findAgentIndex(list, agentId)
      if (index === -1) throw new Error('Agent 不存在')
      if (list[index].default) {
        message.warning('默认 Agent 不能删除')
        return
      }
      list.splice(index, 1)
      await saveEditableConfig(config)
      message.success('删除成功')
    } catch (error) {
      message.error('删除失败')
    }
  }

  const handleStart = async (agentId: string) => {
    message.info(`Agent ${agentId} 的运行状态由灵枢运行时控制，已保留配置不变`)
  }

  const handleStop = async (agentId: string) => {
    message.info(`Agent ${agentId} 的运行状态由灵枢运行时控制，已保留配置不变`)
  }

  const handleSave = async (values: any) => {
    try {
      const config = await loadEditableConfig()
      const list = getAgentListFromConfig(config)
      const nextAgent = {
        id: editingAgent?.id || values.id || `agent-${Date.now()}`,
        name: values.name,
        description: values.description,
        model: values.model,
        config: {
          temperature: values.config?.temperature ?? 0.7,
          maxTokens: values.config?.maxTokens ?? 4000,
          systemPrompt: values.config?.systemPrompt || '',
          skills: values.config?.skills || []
        }
      }

      if (editingAgent) {
        const index = findAgentIndex(list, editingAgent.id)
        if (index === -1) throw new Error('Agent 不存在')
        const { config: _oldConfig, status: _oldStatus, ...rest } = list[index]
        list[index] = { ...rest, ...nextAgent }
      } else {
        list.push(nextAgent)
      }

      await saveEditableConfig(config)
      
      message.success(editingAgent ? '更新成功' : '创建成功')
      setModalVisible(false)
    } catch (error) {
      message.error('保存失败')
    }
  }

  const handleViewDetail = (agent: Agent) => {
    setSelectedAgent(agent)
    setDetailModalVisible(true)
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <Badge status="success" text="运行中" />
      case 'stopped':
        return <Badge status="default" text="已停止" />
      case 'error':
        return <Badge status="error" text="错误" />
      case 'unknown':
        return <Badge status="warning" text="未设置" />
      default:
        return <Badge status="default" text={status} />
    }
  }

  const columns = [
    {
      title: 'Agent',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Agent) => (
        <Space>
          <RobotOutlined style={{ fontSize: 20, color: record.status === 'running' ? '#52c41a' : '#999' }} />
          <div>
            <Text strong style={{ fontSize: 16 }}>{text}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>{record.description}</Text>
          </div>
        </Space>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => getStatusBadge(status)
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      render: (model: string | { primary?: string }) => {
        const text = typeof model === 'object' ? (model?.primary || JSON.stringify(model)) : (model || '-')
        return <Tag color="blue">{text}</Tag>
      }
    },
    {
      title: '消息数',
      dataIndex: 'messageCount',
      key: 'messageCount',
      render: (count: number) => count.toLocaleString()
    },
    {
      title: '最后活跃',
      dataIndex: 'lastActive',
      key: 'lastActive',
      render: (time: string) => <Text type="secondary">{time}</Text>
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: any, record: Agent) => (
        <Space>
          {record.status === 'running' ? (
            <Tooltip title="停止">
              <Button 
                type="primary" 
                danger 
                icon={<PauseCircleOutlined />} 
                size="small"
                onClick={() => handleStop(record.id)}
              >
                停止
              </Button>
            </Tooltip>
          ) : (
            <Tooltip title="启动">
              <Button 
                type="primary" 
                icon={<PlayCircleOutlined />} 
                size="small"
                onClick={() => handleStart(record.id)}
              >
                启动
              </Button>
            </Tooltip>
          )}
          <Tooltip title="对话">
            <Button 
              icon={<MessageOutlined />} 
              size="small"
              onClick={() => window.open(`/chat/${record.id}`, '_blank')}
            >
              对话
            </Button>
          </Tooltip>
          <Tooltip title="配置">
            <Button 
              icon={<SettingOutlined />} 
              size="small"
              onClick={() => handleEdit(record)}
            >
              配置
            </Button>
          </Tooltip>
          <Tooltip title="详情">
            <Button 
              icon={<EditOutlined />} 
              size="small"
              onClick={() => handleViewDetail(record)}
            >
              详情
            </Button>
          </Tooltip>
          <Popconfirm
            title="确定删除这个 Agent 吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button danger icon={<DeleteOutlined />} size="small" disabled={record.default} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5', padding: '24px' }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Agent 是角色与能力配置，不是一个独立运行进程"
        description="这里管理的是灵枢内部可被对话、文档工作台、群聊和自动化流程引用的 Agent 角色：包括默认模型、系统提示词、采样参数和技能声明。真正承载运行、配置文件和连接状态的是“运行实例”。"
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Text strong>角色定位</Text>
            <div style={{ color: '#666', marginTop: 6 }}>定义 Agent 要扮演什么角色、默认用哪个模型。</div>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Text strong>能力边界</Text>
            <div style={{ color: '#666', marginTop: 6 }}>沉淀系统提示词、Skills 和文档/群聊中的使用策略。</div>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Text strong>被谁调用</Text>
            <div style={{ color: '#666', marginTop: 6 }}>AI 对话、文档 Agent、多 Agent 群聊和后续工作流都会引用这里的角色。</div>
          </Card>
        </Col>
      </Row>

      <Card
        title={<Title level={3}><RobotOutlined style={{ marginRight: 12 }} />Agent 角色库</Title>}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadAgents}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新建 Agent 角色
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={agents}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* 创建/编辑 Agent 弹窗 */}
      <Modal
        title={editingAgent ? '编辑 Agent 角色' : '新建 Agent 角色'}
        open={modalVisible}
        onOk={() => form.submit()}
        onCancel={() => setModalVisible(false)}
        width={700}
      >
        <Form form={form} onFinish={handleSave} layout="vertical">
          {!editingAgent && (
            <Form.Item
              name="id"
              label="Agent ID"
              tooltip="可选。留空时自动生成，用作群聊、文档 Agent 和工作流引用的稳定标识。"
            >
              <Input placeholder="例如: researcher-agent" />
            </Form.Item>
          )}
          <Form.Item
            name="name"
            label="Agent 名称"
            rules={[{ required: true, message: '请输入 Agent 名称' }]}
          >
            <Input placeholder="例如: my-agent" />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea placeholder="描述这个 Agent 的用途" rows={2} />
          </Form.Item>
          <Form.Item
            name="model"
            label="默认模型"
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              placeholder="选择模型"
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
              options={availableModels.map(m => ({
                value: m.key,
                label: m.label
              }))}
            />
          </Form.Item>
          <Form.Item
            name={['config', 'temperature']}
            label="Temperature"
            initialValue={0.7}
          >
          <Select
              options={[
                { value: 0, label: '精确 (0.0)' },
                { value: 0.3, label: '保守 (0.3)' },
                { value: 0.5, label: '平衡 (0.5)' },
                { value: 0.7, label: '创意 (0.7)' },
                { value: 1, label: '随机 (1.0)' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name={['config', 'maxTokens']}
            label="Max Tokens"
            initialValue={4000}
          >
          <Select
              options={[
                { value: 1000, label: '1K' },
                { value: 2000, label: '2K' },
                { value: 4000, label: '4K' },
                { value: 8000, label: '8K' },
                { value: 16000, label: '16K' },
                { value: 32000, label: '32K' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name={['config', 'systemPrompt']}
            label="System Prompt"
          >
            <Input.TextArea 
              placeholder="定义这个 Agent 的行为和角色" 
              rows={4}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Agent 详情弹窗 */}
      <Modal
        title="Agent 详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={800}
      >
        {selectedAgent && (
          <Tabs
            defaultActiveKey="1"
            items={[
              {
                key: '1',
                label: '基本信息',
                children: (
                  <Descriptions bordered column={2}>
                    <Descriptions.Item label="ID">{selectedAgent.id}</Descriptions.Item>
                    <Descriptions.Item label="名称">{selectedAgent.name}</Descriptions.Item>
                    <Descriptions.Item label="状态">{getStatusBadge(selectedAgent.status)}</Descriptions.Item>
                    <Descriptions.Item label="模型">
                      <Tag color="blue">{typeof selectedAgent.model === 'object' ? (selectedAgent.model?.primary || JSON.stringify(selectedAgent.model)) : (selectedAgent.model || '-')}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="创建时间">{selectedAgent.createdAt}</Descriptions.Item>
                    <Descriptions.Item label="最后活跃">{selectedAgent.lastActive}</Descriptions.Item>
                    <Descriptions.Item label="消息数">{selectedAgent.messageCount}</Descriptions.Item>
                    <Descriptions.Item label="描述">{selectedAgent.description}</Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: '2',
                label: '配置',
                children: (
                  <Descriptions bordered column={1}>
                    <Descriptions.Item label="Temperature">{selectedAgent.config.temperature}</Descriptions.Item>
                    <Descriptions.Item label="Max Tokens">{selectedAgent.config.maxTokens}</Descriptions.Item>
                    <Descriptions.Item label="System Prompt">
                      <Text style={{ whiteSpace: 'pre-wrap' }}>{selectedAgent.config.systemPrompt}</Text>
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: '3',
                label: 'Skills',
                children: (
                  <List
                    dataSource={selectedAgent.config.skills}
                    renderItem={(skill) => (
                      <List.Item>
                        <Tag icon={<ThunderboltOutlined />} color="purple">{skill}</Tag>
                      </List.Item>
                    )}
                  />
                ),
              },
            ]}
          />
        )}
      </Modal>
    </Layout>
  )
}

export default AgentManager
