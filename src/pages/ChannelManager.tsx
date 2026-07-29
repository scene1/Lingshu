import React, { useState, useEffect } from 'react'
import { Card, Table, Button, Space, Tag, Modal, Form, Input, Switch, message } from 'antd'
import {
  ReloadOutlined, EditOutlined, ApiOutlined,
  CheckCircleOutlined, CloseCircleOutlined, LinkOutlined
} from '@ant-design/icons'

// === Types ===
interface ChannelBase {
  id: string
  name: string
  icon: string
  enabled: boolean
  status: 'connected' | 'disconnected' | 'error'
  lastActive: string
  messageCount: number
  type: 'generic' | 'wechat' | 'wecom'
}

interface GenericChannel extends ChannelBase {
  type: 'generic'
  appId: string
  appSecret: string
  webhook: string
}

interface WeChatChannel extends ChannelBase {
  type: 'wechat' | 'wecom'
  corpId: string
  agentId: string
  secret: string
  token: string
  aesKey: string
}

type Channel = GenericChannel | WeChatChannel

const isWeChat = (c: Channel): c is WeChatChannel => c.type === 'wechat' || c.type === 'wecom'

const CHANNEL_DEFAULTS: Channel[] = [
  {
    id: 'weixin', name: '微信', icon: '💬', enabled: true,
    status: 'connected', lastActive: '5分钟前', messageCount: 856,
    type: 'wechat', corpId: '', agentId: '', secret: '', token: '', aesKey: '',
  },
  {
    id: 'wecom', name: '企业微信', icon: '🏢', enabled: false,
    status: 'disconnected', lastActive: '从未连接', messageCount: 0,
    type: 'wecom', corpId: '', agentId: '', secret: '', token: '', aesKey: '',
  },
  {
    id: 'feishu', name: '飞书', icon: '📨', enabled: true,
    appId: 'cli_a939d4facc395bef', appSecret: '••••••••••••••••',
    webhook: '', status: 'connected', lastActive: '2分钟前', messageCount: 1240,
    type: 'generic',
  },
  {
    id: 'qqbot', name: 'QQ', icon: '🐧', enabled: true,
    appId: '1903749752', appSecret: '••••••••••••••••',
    webhook: '', status: 'connected', lastActive: '10分钟前', messageCount: 332,
    type: 'generic',
  },
  {
    id: 'dingtalk', name: '钉钉', icon: '📋', enabled: false,
    appId: '', appSecret: '',
    webhook: '', status: 'disconnected', lastActive: '从未连接', messageCount: 0,
    type: 'generic',
  },
  {
    id: 'telegram', name: 'Telegram', icon: '✈️', enabled: false,
    appId: '', appSecret: '',
    webhook: '', status: 'disconnected', lastActive: '从未连接', messageCount: 0,
    type: 'generic',
  },
]

const ChannelManager: React.FC = () => {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [testingChannel, setTestingChannel] = useState<string | null>(null)
  const [form] = Form.useForm()

  useEffect(() => { loadChannels() }, [])

  const loadChannels = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/config')
      if (response.ok) {
        const config = await response.json()
        const merged = CHANNEL_DEFAULTS.map(ch => {
          const cfgChannel = config.channels?.[ch.id === 'weixin' ? 'openclaw-weixin' : ch.id]
          if (cfgChannel) {
            if (isWeChat(ch)) {
              return {
                ...ch,
                enabled: cfgChannel.enabled ?? ch.enabled,
                corpId: cfgChannel.corpId || ch.corpId,
                agentId: cfgChannel.agentId || ch.agentId,
                secret: cfgChannel.secret ? '••••••••••••••••' : ch.secret,
                token: cfgChannel.token || ch.token,
                aesKey: cfgChannel.aesKey || ch.aesKey,
                status: cfgChannel.enabled ? 'connected' as const : 'disconnected' as const,
              }
            }
            return {
              ...ch,
              enabled: cfgChannel.enabled ?? ch.enabled,
              appId: cfgChannel.appId || ch.appId,
              appSecret: cfgChannel.appSecret ? '••••••••••••••••' : ch.appSecret,
              webhook: cfgChannel.webhook || ch.webhook,
              status: cfgChannel.enabled ? 'connected' as const : 'disconnected' as const,
            }
          }
          return ch
        })
        setChannels(merged)
      } else {
        setChannels(CHANNEL_DEFAULTS)
      }
    } catch {
      setChannels(CHANNEL_DEFAULTS)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (channel: Channel) => {
    setEditingChannel(channel)
    if (isWeChat(channel)) {
      form.setFieldsValue({
        enabled: channel.enabled,
        corpId: channel.corpId,
        agentId: channel.agentId,
        secret: channel.secret,
        token: channel.token,
        aesKey: channel.aesKey,
      })
    } else {
      form.setFieldsValue({
        enabled: channel.enabled,
        appId: channel.appId,
        appSecret: channel.appSecret,
        webhook: channel.webhook,
      })
    }
    setModalVisible(true)
  }

  const handleToggle = async (channelId: string, enabled: boolean) => {
    try {
      const resp = await fetch('/api/config')
      const config = await resp.json()
      if (!config.channels) config.channels = {}
      const configKey = channelId === 'weixin' ? 'openclaw-weixin' : channelId
      if (!config.channels[configKey]) config.channels[configKey] = {}
      config.channels[configKey].enabled = enabled
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      message.success(`${enabled ? '已启用' : '已停用'} ${channelId}`)
      loadChannels()
    } catch {
      setChannels(channels.map(c => c.id === channelId ? { ...c, enabled, status: enabled ? 'connected' as const : 'disconnected' as const } : c))
      message.success('已更新')
    }
  }

  const handleSave = async (values: any) => {
    if (!editingChannel?.id) return
    try {
      const resp = await fetch('/api/config')
      const config = await resp.json()
      if (!config.channels) config.channels = {}
      const configKey = editingChannel.id === 'weixin' ? 'openclaw-weixin' : editingChannel.id
      if (!config.channels[configKey]) config.channels[configKey] = {}

      if (isWeChat(editingChannel)) {
        Object.assign(config.channels[configKey], {
          enabled: values.enabled,
          corpId: values.corpId,
          agentId: values.agentId,
          secret: values.secret,
          token: values.token,
          aesKey: values.aesKey,
        })
      } else {
        Object.assign(config.channels[configKey], {
          enabled: values.enabled,
          appId: values.appId,
          appSecret: values.appSecret,
          webhook: values.webhook,
        })
      }

      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      message.success('配置已保存')
      setModalVisible(false)
      loadChannels()
    } catch {
      setChannels(channels.map(c => c.id === editingChannel?.id ? { ...c, ...values } : c))
      setModalVisible(false)
      message.success('已保存（仅本地）')
    }
  }

  const handleTestConnection = async () => {
    if (!editingChannel) return
    setTestingChannel(editingChannel.id)
    try {
      const response = await fetch(`/api/channels/${editingChannel.id}/test`, { method: 'POST' })
      const result = await response.json()
      if (result.success) {
        message.success(`测试连接成功：${result.message || '连通性正常'}`)
      } else {
        message.error(`测试失败：${result.error || '无法连接到服务器'}`)
      }
    } catch {
      message.error('测试请求失败，请检查网络或后端服务')
    } finally {
      setTestingChannel(null)
    }
  }

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'connected': return <Tag icon={<CheckCircleOutlined />} color="success">已连接</Tag>
      case 'disconnected': return <Tag icon={<CloseCircleOutlined />} color="default">未连接</Tag>
      case 'error': return <Tag icon={<CloseCircleOutlined />} color="error">错误</Tag>
      default: return <Tag>{status}</Tag>
    }
  }

  const columns = [
    {
      title: '渠道',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Channel) => (
        <Space>
          <span style={{ fontSize: 24 }}>{record.icon}</span>
          <span style={{ fontWeight: 500, fontSize: 15 }}>{text}</span>
        </Space>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (enabled: boolean, record: Channel) => (
        <Switch checked={enabled} onChange={(v) => handleToggle(record.id, v)} />
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: getStatusTag,
    },
    {
      title: '标识',
      key: 'identifier',
      width: 180,
      render: (_: any, record: Channel) => {
        if (isWeChat(record)) {
          return record.corpId ? <code style={{ fontSize: 12 }}>{record.corpId}</code> : <span style={{ color: '#999' }}>未配置</span>
        }
        return record.appId ? <code style={{ fontSize: 12 }}>{record.appId}</code> : <span style={{ color: '#999' }}>未配置</span>
      },
    },
    {
      title: '消息数',
      dataIndex: 'messageCount',
      key: 'messageCount',
      width: 80,
      render: (count: number) => count.toLocaleString(),
    },
    {
      title: '最后活跃',
      dataIndex: 'lastActive',
      key: 'lastActive',
      width: 100,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: any, record: Channel) => (
        <Button icon={<EditOutlined />} size="small" onClick={() => handleEdit(record)}>
          配置
        </Button>
      ),
    },
  ]

  const renderFormFields = () => {
    if (!editingChannel) return null

    if (isWeChat(editingChannel)) {
      return (
        <>
          <Form.Item name="corpId" label="企业 ID (Corp ID)" rules={[{ required: true, message: '请输入企业 ID' }]}>
            <Input placeholder="企业微信后台 → 我的企业 → 企业信息" />
          </Form.Item>
          <Form.Item name="agentId" label="应用 ID (Agent ID)">
            <Input placeholder="应用管理 → 应用详情 → AgentId" />
          </Form.Item>
          <Form.Item name="secret" label="应用密钥 (Secret)">
            <Input.Password placeholder="应用管理 → 应用详情 → Secret" />
          </Form.Item>
          <Form.Item name="token" label="回调 Token">
            <Input placeholder="接收消息验证 Token" />
          </Form.Item>
          <Form.Item name="aesKey" label="加密密钥 (EncodingAESKey)">
            <Input placeholder="消息加解密密钥" />
          </Form.Item>
        </>
      )
    }

    if (editingChannel.id === 'wecom') {
      return (
        <>
          <Form.Item name="corpId" label="企业 ID (Corp ID)" rules={[{ required: true, message: '请输入企业 ID' }]}>
            <Input placeholder="企业微信后台 → 我的企业 → 企业 ID" />
          </Form.Item>
          <Form.Item name="agentId" label="应用 AgentId">
            <Input placeholder="自建应用 → AgentId" />
          </Form.Item>
          <Form.Item name="secret" label="应用 Secret">
            <Input.Password placeholder="自建应用 → Secret" />
          </Form.Item>
          <Form.Item name="token" label="回调 Token">
            <Input placeholder="企业微信后台回调配置 Token" />
          </Form.Item>
          <Form.Item name="aesKey" label="EncodingAESKey">
            <Input placeholder="消息加解密密钥" />
          </Form.Item>
        </>
      )
    }

    return (
      <>
        <Form.Item name="appId" label="App ID" rules={[{ required: true, message: '请输入 App ID' }]}>
          <Input placeholder="从开放平台获取" />
        </Form.Item>
        <Form.Item name="appSecret" label="App Secret">
          <Input.Password placeholder="从开放平台获取" />
        </Form.Item>
        <Form.Item name="webhook" label="Webhook URL（可选）">
          <Input placeholder="https://..." />
        </Form.Item>
      </>
    )
  }

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>
        <ApiOutlined style={{ marginRight: 8 }} />
        渠道接入管理
      </h2>

      <Card style={{ marginBottom: 16 }} size="small">
        <Space direction="vertical" style={{ width: '100%' }}>
          <div style={{ fontWeight: 500 }}>一键接入说明</div>
          <span style={{ color: '#666', fontSize: 13 }}>
            OpenClaw 支持将 AI Agent 一键接入飞书、微信、QQ、钉钉、企业微信、Telegram 等多个即时通讯平台。
            配置正确的凭证后，用户即可在这些平台上与你的 Agent 对话。所有渠道共享同一套 Agent 和 Skills 配置。
          </span>
        </Space>
      </Card>

      <Card
        extra={
          <Button icon={<ReloadOutlined />} onClick={loadChannels}>刷新</Button>
        }
      >
        <Table
          columns={columns}
          dataSource={channels}
          rowKey="id"
          loading={loading}
          pagination={false}
        />
      </Card>

      <Modal
        title={`配置 ${editingChannel?.name || ''} 渠道`}
        open={modalVisible}
        onOk={() => form.submit()}
        onCancel={() => setModalVisible(false)}
        footer={[
          <Button
            key="test"
            icon={<LinkOutlined />}
            loading={testingChannel === editingChannel?.id}
            onClick={handleTestConnection}
          >
            测试连接
          </Button>,
          <Button key="cancel" onClick={() => setModalVisible(false)}>
            取消
          </Button>,
          <Button key="save" type="primary" onClick={() => form.submit()}>
            保存
          </Button>,
        ]}
        width={600}
      >
        <Form form={form} onFinish={handleSave} layout="vertical">
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          {renderFormFields()}
        </Form>
      </Modal>
    </div>
  )
}

export default ChannelManager
