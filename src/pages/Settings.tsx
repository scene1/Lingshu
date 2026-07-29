import React, { useState, useEffect } from 'react'
import {
  Layout, Tabs, Card, Form, Select, Switch, Button,
  Typography, Space, Tag, Divider, message, Modal, Input,
  List, Spin, Statistic, InputNumber
} from 'antd'
import {
  SettingOutlined, RobotOutlined, DatabaseOutlined,
  ThunderboltOutlined, InfoCircleOutlined, ExportOutlined,
  ImportOutlined, DeleteOutlined, ClearOutlined, KeyOutlined,
  GlobalOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  SaveOutlined, FolderOpenOutlined, SearchOutlined
} from '@ant-design/icons'
import { PROVIDERS } from './ModelConfig'
import { useSettings } from '../contexts/SettingsContext'

const { Title, Text, Paragraph } = Typography
const { Content } = Layout

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [models, setModels] = useState<any[]>([])
  const [configs, setConfigs] = useState<Record<string, any>>({})
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [clearConfirmVisible, setClearConfirmVisible] = useState(false)
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false)
  const [obsidianStatus, setObsidianStatus] = useState<any>(null)
  const [testingObsidian, setTestingObsidian] = useState(false)
  const [agentWorkspace, setAgentWorkspace] = useState('')
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [form] = Form.useForm()
  const { updateSettings } = useSettings()

  useEffect(() => {
    loadSettings()
    loadModels()
    loadConfigs()
    loadObsidianStatus()
  }, [])

  const loadSettings = async () => {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
        form.setFieldsValue(data.general || {})
      }
    } catch (e) { console.warn('加载设置失败:', e) }
    setLoading(false)
  }

  const loadModels = async () => {
    try {
      const res = await fetch('/api/models')
      if (res.ok) {
        const data = await res.json()
        setModels(data.models || [])
      }
    } catch (e) { console.warn('加载设置失败:', e) }
  }

  const loadConfigs = async () => {
    try {
      const res = await fetch('/api/config')
      if (res.ok) {
        const data = await res.json()
        setConfigs(data.providers || {})
        setAgentWorkspace(data?.agents?.defaults?.workspace || '')
      }
    } catch (e) { console.warn('加载设置失败:', e) }
  }

  const saveAgentWorkspace = async () => {
    setSavingWorkspace(true)
    try {
      const res = await fetch('/api/config')
      if (!res.ok) throw new Error('读取配置失败')
      const config = await res.json()

      if (!config.agents) config.agents = {}
      if (!config.agents.defaults) config.agents.defaults = {}
      const workspace = agentWorkspace.trim()
      config.agents.defaults.workspace = workspace || undefined

      if (workspace && Array.isArray(config.agents.list)) {
        config.agents.list = config.agents.list.map((agent: any) => ({
          ...agent,
          workspace
        }))
      }

      const saveRes = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      if (!saveRes.ok) throw new Error('保存配置失败')
      message.success('Agent 工作目录已保存')
      await loadConfigs()
    } catch (e) {
      console.warn('保存 Agent 工作目录失败:', e)
      message.error('保存 Agent 工作目录失败')
    } finally {
      setSavingWorkspace(false)
    }
  }

  const loadObsidianStatus = async () => {
    try {
      const res = await fetch('/api/obsidian/status')
      if (res.ok) setObsidianStatus(await res.json())
    } catch (e) { console.warn('检查 Obsidian 状态失败:', e) }
  }

  const saveSettings = async (values?: any) => {
    setSaving(true)
    try {
      const general = values || form.getFieldsValue()
      const updated = { ...settings, general }
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      })
      if (res.ok) {
        message.success('设置已保存')
        updateSettings(general)
        // 从服务器重新拉取，确保 dataDir / cacheSize 等动态字段正确
        await loadSettings()
      } else {
        message.error('保存失败')
      }
    } catch (e) { console.warn('保存失败:', e); message.error('保存失败') }
    setSaving(false)
  }

  const updateObsidianSetting = (key: string, value: any) => {
    setSettings((prev: any) => ({
      ...prev,
      obsidian: { ...prev?.obsidian, [key]: value }
    }))
  }

  const getObsidianSettings = () => {
    const obsidian = settings?.obsidian || {}
    return {
      enabled: !!obsidian.enabled,
      vaultPath: obsidian.vaultPath || '',
      includeFolders: Array.isArray(obsidian.includeFolders) ? obsidian.includeFolders : [''],
      excludeFolders: Array.isArray(obsidian.excludeFolders)
        ? obsidian.excludeFolders
        : ['.obsidian', '.git', 'node_modules', '.trash'],
      maxResults: obsidian.maxResults || 5,
      writeMemoryEnabled: obsidian.writeMemoryEnabled !== false
    }
  }

  const saveObsidianSettings = async (showSuccess = true) => {
    const obsidian = getObsidianSettings()
    setSaving(true)
    try {
      const updated = { ...settings, obsidian }
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      })
      if (!res.ok) throw new Error('保存失败')
      setSettings(await res.json())
      if (showSuccess) message.success('Obsidian 设置已保存')
      await loadObsidianStatus()
      return true
    } catch (e) {
      console.warn('保存 Obsidian 设置失败:', e)
      message.error('保存 Obsidian 设置失败')
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleTestObsidian = async () => {
    setTestingObsidian(true)
    const saved = await saveObsidianSettings(false)
    if (saved) {
      try {
        const res = await fetch('/api/obsidian/status')
        const data = await res.json()
        setObsidianStatus(data)
        if (data.valid) message.success(`已连接 Obsidian Vault，共 ${data.noteCount || 0} 篇笔记`)
        else message.warning(data.reason || 'Obsidian Vault 不可用')
      } catch (_) { message.error('检查 Obsidian 失败') }
    }
    setTestingObsidian(false)
  }

  // 清除缓存
  const handleClearCache = async () => {
    try {
      const res = await fetch('/api/settings/clear-cache', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        message.success(`已清除 ${data.deletedFiles || 0} 个文件`)
        setClearConfirmVisible(false)
        loadSettings()
      }
    } catch (_) { message.error('清除失败') }
  }

  // 导出数据
  const handleExport = async () => {
    try {
      const [settingsRes, memoryRes] = await Promise.all([
        fetch('/api/settings'), fetch('/api/memory')
      ])
      const settingsData = await settingsRes.json()
      const memoryData = await memoryRes.json()
      const exportData = { settings: settingsData, memory: memoryData, exportTime: new Date().toISOString() }
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `openclaw-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click(); URL.revokeObjectURL(url)
      message.success('导出成功')
    } catch (_) { message.error('导出失败') }
  }

  // 导入数据
  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (data.settings) {
          await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data.settings)
          })
        }
        if (data.memory?.memories) {
          for (const [key, val] of Object.entries(data.memory.memories) as [string, any][]) {
            await fetch('/api/memory', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key, value: val.value, agent: val.agent })
            })
          }
        }
        message.success('数据导入成功')
        loadSettings()
      } catch (_) { message.error('导入失败，请检查文件格式') }
    }
    input.click()
  }

  // 重置设置
  const handleReset = async () => {
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          general: { language: 'zh', theme: 'light', startup: 'last', fontSize: 14, autoScroll: true },
          models: { defaultModel: '', defaultProvider: '' }
        })
      })
      message.success('设置已重置')
      setResetConfirmVisible(false)
      loadSettings()
    } catch (_) { message.error('重置失败') }
  }

  // 保存单个 provider 配置（M-03 fix：使用 PUT 而非 GET→修改→POST 全量覆写）
  const saveProviderConfig = async (providerId: string, values: any) => {
    try {
      const response = await fetch(`/api/config/providers/${providerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: values.apiKey,
          baseUrl: values.baseUrl
        })
      })
      if (!response.ok) throw new Error('保存失败')
      message.success(`${providerId} 配置已保存`)
      loadConfigs()
      loadModels()
    } catch (e) { console.warn('保存失败:', e); message.error('保存失败') }
  }

  // 更新默认模型设置
  const updateDefaultModel = async (modelKey: string) => {
    const parts = modelKey.split('/')
    const provider = parts[0]
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, models: { defaultModel: modelKey, defaultProvider: provider } })
    })
    message.success('默认模型已更新')
    loadSettings()
  }

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const generalFormContent = (
    <Form form={form} layout="vertical" style={{ maxWidth: 500 }}
      initialValues={{ language: 'zh', theme: 'light', startup: 'last', fontSize: 14, autoScroll: true }}>
      <Form.Item name="language" label={<Text strong>语言 Language</Text>}>
        <Select options={[
          { value: 'zh', label: '中文 (Chinese)' },
          { value: 'en', label: 'English' }
        ]} />
      </Form.Item>
      <Form.Item name="theme" label={<Text strong>主题 Theme</Text>}>
        <Select options={[
          { value: 'light', label: '浅色 Light' },
          { value: 'dark', label: '深色 Dark' },
          { value: 'system', label: '跟随系统 Follow System' }
        ]} />
      </Form.Item>
      <Form.Item name="startup" label={<Text strong>启动行为 Startup Behavior</Text>}>
        <Select options={[
          { value: 'last', label: '打开上次会话' },
          { value: 'new', label: '新建会话' },
          { value: 'dashboard', label: '显示 Dashboard' }
        ]} />
      </Form.Item>
      <Form.Item name="fontSize" label={<Text strong>消息字体大小 Font Size</Text>}>
        <Select options={[
          { value: 12, label: '12px' },
          { value: 14, label: '14px (默认)' },
          { value: 16, label: '16px' }
        ]} />
      </Form.Item>
      <Form.Item name="autoScroll" label={<Text strong>自动滚动到最新消息</Text>} valuePropName="checked">
        <Switch />
      </Form.Item>
      <Button type="primary" icon={<SaveOutlined />} onClick={() => saveSettings()} loading={saving}>
        保存设置
      </Button>
    </Form>
  )

  const modelConfigContent = (
    <div>
      <Title level={5}>已配置的 Provider</Title>
      <List
        dataSource={Object.entries(PROVIDERS)}
        renderItem={([providerId, provider]) => {
          const hasKey = !!(configs[providerId]?.apiKey)
          const isExpanded = expandedProvider === providerId
          return (
            <Card
              size="small"
              style={{ marginBottom: 12 }}
              title={
                <Space>
                  <span>{provider.icon}</span>
                  <span>{provider.name}</span>
                  {hasKey ? (
                    <Tag color="success" icon={<CheckCircleOutlined />}>已配置</Tag>
                  ) : (
                    <Tag color="default" icon={<ExclamationCircleOutlined />}>未配置</Tag>
                  )}
                </Space>
              }
              extra={
                <Button type="link" size="small" onClick={() => setExpandedProvider(isExpanded ? null : providerId)}>
                  {isExpanded ? '收起' : '编辑'}
                </Button>
              }
            >
              {isExpanded && (
                <ProviderEditForm
                  providerId={providerId}
                  provider={provider}
                  initialValues={configs[providerId] || {}}
                  onSave={saveProviderConfig}
                />
              )}
            </Card>
          )
        }}
      />

      <Divider />
      <Title level={5}>默认模型</Title>
      <Paragraph type="secondary">新会话将默认使用此模型</Paragraph>
      <Select
        style={{ width: 400 }}
        value={settings?.models?.defaultModel || undefined}
        placeholder="选择默认模型"
        options={[
          { label: '智能选择（推荐）', value: '' },
          ...models.map(m => ({
            value: m.key,
            label: `${m.label} ${m.hasApiKey ? '✓' : '(未配置 Key)'}`
          }))
        ]}
        onChange={updateDefaultModel}
      />
    </div>
  )

  const obsidianSettings = getObsidianSettings()
  const obsidianIncludeText = obsidianSettings.includeFolders.join('\n')
  const obsidianExcludeText = obsidianSettings.excludeFolders.join('\n')

  const dataStorageContent = (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>数据目录</Text>
        <Input
          value={settings?.data?.dataDir || ''}
          onChange={e => {
            setSettings((prev: any) => ({
              ...prev,
              data: { ...prev?.data, dataDir: e.target.value }
            }))
          }}
          placeholder="输入数据目录路径"
        />
      </Card>
      <Card
        size="small"
        style={{ marginBottom: 16 }}
        title={(
          <Space>
            <FolderOpenOutlined />
            <span>Agent 工作目录</span>
          </Space>
        )}
      >
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Input
            value={agentWorkspace}
            onChange={e => setAgentWorkspace(e.target.value)}
            placeholder="例如：/Users/xxx/.stepclaw/workspace"
            style={{ fontFamily: 'monospace' }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            保存到 openclaw.json 的 agents.defaults.workspace。Agent 生成的文件会默认写入这个工作目录。
          </Text>
          <Button type="primary" icon={<SaveOutlined />} onClick={saveAgentWorkspace} loading={savingWorkspace}>
            保存工作目录
          </Button>
        </Space>
      </Card>
      <Card
        size="small"
        style={{ marginBottom: 16 }}
        title={(
          <Space>
            <FolderOpenOutlined />
            <span>Obsidian 知识库</span>
            {obsidianStatus?.valid ? (
              <Tag color="success" icon={<CheckCircleOutlined />}>已连接</Tag>
            ) : (
              <Tag color={obsidianSettings.enabled ? 'warning' : 'default'} icon={<ExclamationCircleOutlined />}>
                {obsidianSettings.enabled ? '待检查' : '未启用'}
              </Tag>
            )}
          </Space>
        )}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space>
            <Switch
              checked={obsidianSettings.enabled}
              onChange={checked => updateObsidianSetting('enabled', checked)}
            />
            <Text>启用 Obsidian 作为知识库和记忆存储</Text>
          </Space>
          <Input
            value={obsidianSettings.vaultPath}
            onChange={e => updateObsidianSetting('vaultPath', e.target.value)}
            placeholder="例如 ~/Documents/Obsidian/MyVault"
            prefix={<FolderOpenOutlined />}
          />
          <Space wrap>
            <Text type="secondary">每次注入</Text>
            <InputNumber
              min={1}
              max={12}
              value={obsidianSettings.maxResults}
              onChange={value => updateObsidianSetting('maxResults', value || 5)}
            />
            <Text type="secondary">条相关笔记</Text>
            <Switch
              checked={obsidianSettings.writeMemoryEnabled}
              onChange={checked => updateObsidianSetting('writeMemoryEnabled', checked)}
            />
            <Text type="secondary">允许写入记忆</Text>
          </Space>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>纳入目录</Text>
            <Input.TextArea
              rows={2}
              value={obsidianIncludeText}
              onChange={e => updateObsidianSetting('includeFolders', e.target.value.split('\n'))}
              placeholder="留空表示整个 Vault"
            />
          </div>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>排除目录</Text>
            <Input.TextArea
              rows={2}
              value={obsidianExcludeText}
              onChange={e => updateObsidianSetting('excludeFolders', e.target.value.split('\n'))}
            />
          </div>
          <Space>
            <Button type="primary" icon={<SaveOutlined />} onClick={() => saveObsidianSettings()} loading={saving}>
              保存 Obsidian 设置
            </Button>
            <Button icon={<SearchOutlined />} onClick={handleTestObsidian} loading={testingObsidian}>
              保存并测试
            </Button>
          </Space>
          {obsidianStatus && (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {obsidianStatus.valid
                ? `Vault 可用，当前可检索 ${obsidianStatus.noteCount || 0} 篇 Markdown 笔记。`
                : obsidianStatus.reason || '尚未连接 Obsidian Vault。'}
            </Paragraph>
          )}
        </Space>
      </Card>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Statistic title="缓存大小" value={formatBytes(settings?.data?.cacheSize || 0)} />
        <Button
          danger icon={<ClearOutlined />}
          style={{ marginTop: 12 }}
          onClick={() => setClearConfirmVisible(true)}
        >
          清除缓存
        </Button>
      </Card>
      <Space>
        <Button icon={<ExportOutlined />} onClick={handleExport}>导出所有数据</Button>
        <Button icon={<ImportOutlined />} onClick={handleImport}>导入数据</Button>
      </Space>
      <Divider />
      <Button danger icon={<DeleteOutlined />} onClick={() => setResetConfirmVisible(true)}>
        重置所有设置
      </Button>
    </div>
  )

  const shortcutsContent = (
    <div>
      <List
        dataSource={[
          { key: 'Cmd + K', action: '搜索 / 命令面板' },
          { key: 'Cmd + N', action: '新建会话' },
          { key: 'Cmd + Enter', action: '发送消息' },
          { key: 'Shift + Enter', action: '换行（在输入框中）' },
          { key: 'Cmd + /', action: '切换侧边栏' },
          { key: 'Cmd + ,', action: '打开设置' },
          { key: 'Esc', action: '关闭弹窗 / 取消操作' },
        ]}
        renderItem={item => (
          <List.Item>
            <Space>
              <Tag color="blue">{item.key}</Tag>
              <span>{item.action}</span>
            </Space>
          </List.Item>
        )}
      />
    </div>
  )

  const aboutContent = (
    <div>
      <Card style={{ maxWidth: 500 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RobotOutlined style={{ fontSize: 48, color: '#1890ff' }} />
            <div>
              <Title level={3} style={{ margin: 0 }}>Lingshu</Title>
              <Tag color="blue">v1.0.0</Tag>
            </div>
          </div>
          <Divider />
          <div>
            <Text strong>技术栈</Text>
            <List size="small" dataSource={[
              { label: 'React', value: '18.x' },
              { label: 'Ant Design', value: '5.x' },
              { label: 'Express', value: '4.x' },
              { label: 'Vite', value: '5.x' },
              { label: 'TypeScript', value: '5.x' },
            ]} renderItem={item => (
              <List.Item style={{ padding: '4px 0' }}>
                <Text type="secondary">{item.label}</Text>
                <Text style={{ marginLeft: 16 }}>{item.value}</Text>
              </List.Item>
            )} />
          </div>
          <Divider />
          <div>
            <Text strong>开源协议</Text>
            <Paragraph style={{ marginTop: 8 }}>MIT License</Paragraph>
            <Paragraph type="secondary">灵枢 — AI 路由与知识中枢</Paragraph>
          </div>
        </Space>
      </Card>
    </div>
  )

  const tabItems = [
    { key: 'general', label: '通用设置', icon: <SettingOutlined />, children: generalFormContent },
    { key: 'models', label: '模型配置', icon: <RobotOutlined />, children: modelConfigContent },
    { key: 'data', label: '数据与存储', icon: <DatabaseOutlined />, children: dataStorageContent },
    { key: 'shortcuts', label: '快捷键', icon: <ThunderboltOutlined />, children: shortcutsContent },
    { key: 'about', label: '关于', icon: <InfoCircleOutlined />, children: aboutContent },
  ]

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />

  return (
    <Layout style={{ minHeight: '100%', background: '#f5f5f5' }}>
      <Content style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
          <SettingOutlined style={{ fontSize: 24, color: '#1890ff', marginRight: 12 }} />
          <Title level={3} style={{ margin: 0 }}>应用设置</Title>
        </div>
        <Card>
          <Tabs defaultActiveKey="general" tabPosition="left" items={tabItems} style={{ minHeight: 400 }} />
        </Card>
      </Content>

      <Modal
        title="确认清除缓存"
        open={clearConfirmVisible}
        onOk={handleClearCache}
        onCancel={() => setClearConfirmVisible(false)}
        okText="确认清除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <Paragraph>清除缓存将删除所有聊天历史、记忆和群聊数据。此操作不可恢复。</Paragraph>
      </Modal>

      <Modal
        title="确认重置设置"
        open={resetConfirmVisible}
        onOk={handleReset}
        onCancel={() => setResetConfirmVisible(false)}
        okText="确认重置"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <Paragraph>重置将恢复所有设置为默认值。此操作不可恢复。</Paragraph>
      </Modal>
    </Layout>
  )
}

// Provider 编辑表单子组件
const ProviderEditForm: React.FC<{
  providerId: string
  provider: any
  initialValues: any
  onSave: (providerId: string, values: any) => Promise<void>
}> = ({ providerId, provider, initialValues, onSave }) => {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    form.setFieldsValue({
      apiKey: initialValues?.apiKey || '',
      baseUrl: initialValues?.baseUrl || provider.baseUrl
    })
  }, [initialValues])

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    await onSave(providerId, values)
    setSaving(false)
  }

  const handleTest = async () => {
    const values = await form.validateFields()
    setTesting(true)
    try {
      const res = await fetch(`${values.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${values.apiKey}` },
        body: JSON.stringify({
          model: provider.models[0]?.value || 'default',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        })
      })
      if (res.ok) message.success('连接成功')
      else {
        const err = await res.json().catch(() => ({}))
        message.error(`连接失败: ${err.error?.message || res.status}`)
      }
    } catch (e: any) { message.error(`连接失败: ${e.message}`) }
    setTesting(false)
  }

  return (
    <Form form={form} layout="vertical">
      <Form.Item name="apiKey" label="API Key" rules={[{ required: true, message: '请输入 API Key' }]}>
        <Input.Password placeholder={provider.keyPlaceholder} prefix={<KeyOutlined />} />
      </Form.Item>
      <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: '请输入 Base URL' }]}>
        <Input placeholder={provider.baseUrl} prefix={<GlobalOutlined />} />
      </Form.Item>
      <Space>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
        <Button icon={<ThunderboltOutlined />} onClick={handleTest} loading={testing}>测试连接</Button>
      </Space>
    </Form>
  )
}

export default Settings
