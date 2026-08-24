import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Descriptions, Form, Input, Modal, Row, Space, Statistic, Switch, Tag, Typography, message } from 'antd'
import {
  ApiOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  EditOutlined,
  GithubOutlined,
  LinkOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { openExternal } from '../utils/electron'

const { Paragraph, Text, Title } = Typography

interface GitIntegration {
  id: string
  name: string
  provider: string
  baseUrl: string
  apiUrl: string
  enabled: boolean
  username?: string
  organization?: string
  token?: string
  authConfigured?: boolean
  defaultBranch?: string
  repositories: string[]
  repositoryCount?: number
  webhookSecret?: string
  updatedAt?: string
}

interface TestCheck {
  key: string
  label: string
  ok: boolean
  value: string
}

const providerHints: Record<string, string> = {
  github: '适合 Issue、PR、Actions、Release 与代码仓库自动化。',
  gitlab: '适合企业 GitLab、Merge Request、Pipeline 与自托管项目。',
  gitee: '适合国内代码托管、企业仓库和国产化环境。',
  bitbucket: '适合 Atlassian 体系、Jira 与团队工作区。',
  'azure-devops': '适合 Azure Repos、Boards、Pipeline 与企业组织。',
  'self-hosted': '适合 Gitea、Forgejo、内网 GitLab 或任意自托管 Git 服务。',
}

const providerDocs: Record<string, string> = {
  github: 'https://github.com/settings/tokens',
  gitlab: 'https://gitlab.com/-/user_settings/personal_access_tokens',
  gitee: 'https://gitee.com/profile/personal_access_tokens',
  bitbucket: 'https://bitbucket.org/account/settings/app-passwords/',
  'azure-devops': 'https://dev.azure.com/',
}

const GitIntegrations: React.FC = () => {
  const [integrations, setIntegrations] = useState<GitIntegration[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState<string | null>(null)
  const [editing, setEditing] = useState<GitIntegration | null>(null)
  const [testChecks, setTestChecks] = useState<TestCheck[]>([])
  const [form] = Form.useForm()

  const enabledCount = integrations.filter(item => item.enabled).length
  const repoCount = integrations.reduce((sum, item) => sum + (item.repositories?.length || 0), 0)
  const tokenCount = integrations.filter(item => item.authConfigured).length

  const activeRepos = useMemo(() => integrations
    .filter(item => item.enabled)
    .flatMap(item => (item.repositories || []).map(repo => ({ integration: item, repo })))
    .slice(0, 12), [integrations])

  const loadIntegrations = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/git-integrations')
      if (!response.ok) throw new Error('读取 Git 集成失败')
      const data = await response.json()
      setIntegrations(Array.isArray(data.integrations) ? data.integrations : [])
    } catch (error: any) {
      message.error(error.message || '读取 Git 集成失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadIntegrations()
  }, [])

  const openEdit = (integration: GitIntegration) => {
    setEditing(integration)
    setTestChecks([])
    form.setFieldsValue({
      enabled: integration.enabled,
      name: integration.name,
      baseUrl: integration.baseUrl,
      apiUrl: integration.apiUrl,
      username: integration.username,
      organization: integration.organization,
      token: integration.token,
      defaultBranch: integration.defaultBranch || 'main',
      repositories: (integration.repositories || []).join('\n'),
      webhookSecret: integration.webhookSecret,
    })
  }

  const saveIntegration = async (values: any) => {
    if (!editing) return
    setSaving(true)
    try {
      const payload = {
        ...values,
        repositories: String(values.repositories || '').split(/[\n,]/).map(item => item.trim()).filter(Boolean),
      }
      const response = await fetch(`/api/git-integrations/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error('保存 Git 集成失败')
      const data = await response.json()
      setIntegrations(prev => prev.map(item => item.id === editing.id ? data.integration : item))
      setEditing(data.integration)
      message.success('Git 集成已保存')
    } catch (error: any) {
      message.error(error.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleIntegration = async (integration: GitIntegration, enabled: boolean) => {
    try {
      const response = await fetch(`/api/git-integrations/${integration.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...integration, enabled }),
      })
      if (!response.ok) throw new Error('更新失败')
      const data = await response.json()
      setIntegrations(prev => prev.map(item => item.id === integration.id ? data.integration : item))
      message.success(enabled ? `已启用 ${integration.name}` : `已停用 ${integration.name}`)
    } catch (error: any) {
      message.error(error.message || '更新失败')
    }
  }

  const testIntegration = async (integration: GitIntegration) => {
    setTesting(integration.id)
    setTestChecks([])
    try {
      const response = await fetch(`/api/git-integrations/${integration.id}/test`, { method: 'POST' })
      const data = await response.json()
      setTestChecks(Array.isArray(data.checks) ? data.checks : [])
      if (data.success) message.success(data.message || '连接检查通过')
      else message.warning(data.message || '配置未完整')
    } catch (error: any) {
      message.error(error.message || '测试失败')
    } finally {
      setTesting(null)
    }
  }

  const openRepository = async (integration: GitIntegration, repo: string) => {
    try {
      const response = await fetch(`/api/git-integrations/${integration.id}/repository-url?repo=${encodeURIComponent(repo)}`)
      const data = await response.json()
      if (data.url) await openExternal(data.url)
    } catch {
      if (integration.baseUrl) await openExternal(`${integration.baseUrl.replace(/\/+$/, '')}/${repo}`)
    }
  }

  const discoverRepositories = async (integration: GitIntegration) => {
    setDiscovering(integration.id)
    try {
      const response = await fetch(`/api/git-integrations/${integration.id}/repositories`)
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || data?.error || '读取仓库失败')
      const repositories = (data.repositories || []).map((item: any) => item.fullName).filter(Boolean)
      const saveResponse = await fetch(`/api/git-integrations/${integration.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...integration, repositories }),
      })
      const saved = await saveResponse.json().catch(() => null)
      if (!saveResponse.ok) throw new Error(saved?.message || saved?.error || '保存仓库失败')
      setIntegrations(prev => prev.map(item => item.id === integration.id ? saved.integration : item))
      if (editing?.id === integration.id) {
        setEditing(saved.integration)
        form.setFieldValue('repositories', repositories.join('\n'))
      }
      message.success(`已同步 ${repositories.length} 个 GitHub 仓库`)
    } catch (error: any) {
      message.error(error.message || '同步 GitHub 仓库失败')
    } finally {
      setDiscovering(null)
    }
  }

  return (
    <div>
      <Space align="start" size={14} style={{ marginBottom: 20 }}>
        <div style={{
          display: 'grid',
          placeItems: 'center',
          width: 44,
          height: 44,
          borderRadius: 8,
          background: '#eef6ff',
          color: '#2563eb',
          fontSize: 22,
        }}>
          <GithubOutlined />
        </div>
        <div>
          <Title level={3} style={{ margin: 0 }}>代码仓库</Title>
          <Text type="secondary">接入常用 Git 服务，集中维护仓库、凭证和后续自动化触发入口。</Text>
        </div>
      </Space>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card size="small"><Statistic title="已启用服务" value={enabledCount} suffix={`/ ${integrations.length}`} /></Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small"><Statistic title="常用仓库" value={repoCount} /></Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small"><Statistic title="已配置 Token" value={tokenCount} /></Card>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="建议先接 GitHub、GitLab、Gitee"
        description="连接测试会验证真实账号身份；GitHub 可自动读取当前 Token 有权访问的仓库。仓库内容不会自动下载，后续动作仍需由用户或 Workflow 明确触发。"
      />

      <Card
        title="Git 服务"
        extra={<Button icon={<ReloadOutlined />} onClick={loadIntegrations} loading={loading}>刷新</Button>}
        style={{ marginBottom: 16 }}
      >
        <Row gutter={[12, 12]}>
          {integrations.map(item => (
            <Col xs={24} lg={12} xl={8} key={item.id}>
              <Card
                size="small"
                style={{ height: '100%', borderRadius: 8 }}
                title={
                  <Space>
                    <GithubOutlined />
                    <Text strong>{item.name}</Text>
                    <Tag color={item.enabled ? 'blue' : 'default'}>{item.enabled ? '已启用' : '未启用'}</Tag>
                  </Space>
                }
                extra={<Switch size="small" checked={item.enabled} onChange={(checked) => toggleIntegration(item, checked)} />}
              >
                <Paragraph type="secondary" style={{ minHeight: 44, marginBottom: 12 }}>
                  {providerHints[item.provider] || '通用 Git 托管服务。'}
                </Paragraph>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="地址">{item.baseUrl || '未配置'}</Descriptions.Item>
                  <Descriptions.Item label="Token">{item.authConfigured ? '已配置' : '未配置'}</Descriptions.Item>
                  <Descriptions.Item label="仓库">{item.repositoryCount || 0} 个</Descriptions.Item>
                </Descriptions>
                <Space style={{ marginTop: 12 }}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(item)}>配置</Button>
                  <Button size="small" icon={<LinkOutlined />} loading={testing === item.id} onClick={() => testIntegration(item)}>测试</Button>
                  {item.provider === 'github' && (
                    <Button size="small" icon={<ReloadOutlined />} loading={discovering === item.id} onClick={() => discoverRepositories(item)}>同步仓库</Button>
                  )}
                  {item.baseUrl && <Button size="small" type="link" onClick={() => openExternal(item.baseUrl)}>打开</Button>}
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Card title="常用仓库">
        {activeRepos.length > 0 ? (
          <Space wrap>
            {activeRepos.map(({ integration, repo }) => (
              <Button key={`${integration.id}:${repo}`} icon={<CodeOutlined />} onClick={() => openRepository(integration, repo)}>
                {integration.name} / {repo}
              </Button>
            ))}
          </Space>
        ) : (
          <Text type="secondary">启用 Git 服务并添加常用仓库后，会在这里出现快捷入口。</Text>
        )}
      </Card>

      <Modal
        title={`配置 ${editing?.name || 'Git 服务'}`}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        width={720}
        footer={[
          editing && providerDocs[editing.provider] ? (
            <Button key="token-help" onClick={() => openExternal(providerDocs[editing.provider])}>
              Token 页面
            </Button>
          ) : null,
          editing ? (
            <Button key="test" icon={<LinkOutlined />} loading={testing === editing.id} onClick={() => testIntegration(editing)}>
              测试连接
            </Button>
          ) : null,
          <Button key="cancel" onClick={() => setEditing(null)}>取消</Button>,
          <Button key="save" type="primary" loading={saving} onClick={() => form.submit()}>保存</Button>,
        ]}
      >
        <Form form={form} layout="vertical" onFinish={saveIntegration}>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="名称">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="defaultBranch" label="默认分支">
                <Input placeholder="main / master" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="baseUrl" label="服务地址">
            <Input placeholder="https://github.com 或你的自托管地址" />
          </Form.Item>
          <Form.Item name="apiUrl" label="API 地址">
            <Input placeholder="https://api.github.com" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="username" label="用户名">
                <Input placeholder="可选" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="organization" label="组织 / 工作区">
                <Input placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="token" label="访问 Token">
            <Input.Password placeholder="用于 Issue、PR、Webhook、仓库读取；保存后列表仅显示掩码" />
          </Form.Item>
          <Form.Item name="repositories" label="常用仓库">
            <Input.TextArea rows={5} placeholder="每行一个仓库，例如：owner/repo 或完整 https:// 地址" />
          </Form.Item>
          <Form.Item name="webhookSecret" label="Webhook Secret">
            <Input.Password placeholder="可选，后续用于校验 Git 事件回调" />
          </Form.Item>
        </Form>

        {testChecks.length > 0 && (
          <Card size="small" title="连接检查" style={{ marginTop: 12 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              {testChecks.map(item => (
                <Space key={item.key}>
                  {item.ok ? <CheckCircleOutlined style={{ color: '#16a34a' }} /> : <ApiOutlined style={{ color: '#d97706' }} />}
                  <Text>{item.label}</Text>
                  <Text type="secondary">{item.value}</Text>
                </Space>
              ))}
            </Space>
          </Card>
        )}
      </Modal>
    </div>
  )
}

export default GitIntegrations
