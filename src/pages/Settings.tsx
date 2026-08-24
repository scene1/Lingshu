import React, { useState, useEffect } from 'react'
import {
  Layout, Tabs, Card, Form, Select, Switch, Button,
  Typography, Space, Tag, Divider, message, Modal, Input,
  List, Spin, Statistic, InputNumber, Checkbox, Alert, Upload, Slider
} from 'antd'
import {
  SettingOutlined, RobotOutlined, DatabaseOutlined,
  ThunderboltOutlined, InfoCircleOutlined, ExportOutlined,
  ImportOutlined, DeleteOutlined, ClearOutlined, KeyOutlined,
  GlobalOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  SaveOutlined, FolderOpenOutlined, SearchOutlined,
  GithubOutlined, BugOutlined, SyncOutlined, PictureOutlined, UploadOutlined
} from '@ant-design/icons'
import packageJson from '../../package.json'
import {
  AppUpdateState,
  checkForUpdates,
  downloadUpdate,
  getDesktopCapabilities,
  getElectronAPI,
  getUpdateState,
  installUpdate,
  openExternal
} from '../utils/electron'
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
  const [memorySyncItems, setMemorySyncItems] = useState<any[]>([])
  const [selectedMemoryKeys, setSelectedMemoryKeys] = useState<string[]>([])
  const [loadingMemorySync, setLoadingMemorySync] = useState(false)
  const [syncingMemory, setSyncingMemory] = useState(false)
  const [memorySyncQuery, setMemorySyncQuery] = useState('')
  const [memorySyncAgentFilter, setMemorySyncAgentFilter] = useState('all')
  const [memorySyncStatusFilter, setMemorySyncStatusFilter] = useState<'all' | 'unsynced' | 'synced'>('unsynced')
  const [includeSyncedMemory, setIncludeSyncedMemory] = useState(false)
  const [memorySyncPreviewVisible, setMemorySyncPreviewVisible] = useState(false)
  const [pendingMemorySyncKeys, setPendingMemorySyncKeys] = useState<string[]>([])
  const [archivingConversations, setArchivingConversations] = useState(false)
  const [conversationArchiveResult, setConversationArchiveResult] = useState<any>(null)
  const [agentWorkspace, setAgentWorkspace] = useState('')
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [isolationStatus, setIsolationStatus] = useState<any>(null)
  const [savingIsolation, setSavingIsolation] = useState(false)
  const [desktopCapabilities, setDesktopCapabilities] = useState<any>(null)
  const [uploadingBackground, setUploadingBackground] = useState(false)
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null)
  const [updateActionLoading, setUpdateActionLoading] = useState(false)
  const [form] = Form.useForm()
  const { updateSettings } = useSettings()
  const defaultBackgroundSettings = {
    enabled: false,
    url: '',
    fit: 'cover',
    opacity: 0.82,
    position: 'center',
    repeat: 'no-repeat'
  }
  const backgroundSettings = {
    ...defaultBackgroundSettings,
    ...(settings?.appearance?.background || {})
  }
  const filteredMemorySyncItems = memorySyncItems.filter(item => {
    const synced = !!item.syncedToObsidian?.relativePath
    if (memorySyncStatusFilter === 'unsynced' && synced) return false
    if (memorySyncStatusFilter === 'synced' && !synced) return false
    if (memorySyncAgentFilter !== 'all' && item.agent !== memorySyncAgentFilter) return false
    const query = memorySyncQuery.trim().toLowerCase()
    if (!query) return true
    const text = [
      item.key,
      item.agent,
      item.timestamp,
      typeof item.value === 'string' ? item.value : JSON.stringify(item.value || {})
    ].join('\n').toLowerCase()
    return text.includes(query)
  })
  const unsyncedMemoryItems = filteredMemorySyncItems.filter(item => !item.syncedToObsidian?.relativePath)
  const shownMemorySyncItems = filteredMemorySyncItems.slice(0, 12)
  const memorySyncAgentOptions = [
    { label: '全部 Agent', value: 'all' },
    ...[...new Set(memorySyncItems.map(item => item.agent).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
      .map(agent => ({ label: agent, value: agent }))
  ]

  useEffect(() => {
    loadSettings()
    loadModels()
    loadConfigs()
    loadObsidianStatus()
    loadMemorySyncStatus()
    loadIsolationStatus()
    loadDesktopCapabilities()
    getUpdateState().then(state => state && setUpdateState(state)).catch(() => {})
    const disposeUpdateListener = getElectronAPI()?.onUpdateState?.(setUpdateState)
    return () => disposeUpdateListener?.()
  }, [])

  const handleCheckForUpdates = async () => {
    setUpdateActionLoading(true)
    try {
      const state = await checkForUpdates()
      if (state) setUpdateState(state)
      else message.info('网页版不支持应用内更新，请从 GitHub Releases 下载桌面版')
    } finally {
      setUpdateActionLoading(false)
    }
  }

  const handleDownloadUpdate = async () => {
    setUpdateActionLoading(true)
    try {
      const state = await downloadUpdate()
      if (state) setUpdateState(state)
    } finally {
      setUpdateActionLoading(false)
    }
  }

  const handleInstallUpdate = async () => {
    setUpdateActionLoading(true)
    try {
      const result = await installUpdate()
      if (!result?.success) message.warning('更新尚未下载完成')
    } finally {
      setUpdateActionLoading(false)
    }
  }

  const loadSettings = async () => {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
        form.setFieldsValue(data.general || {})
        updateSettings(data.general || {}, data.appearance || {})
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
        const saved = await res.json()
        setSettings(saved)
        updateSettings(saved.general || general, saved.appearance || updated.appearance || {})
        // 从服务器重新拉取，确保 dataDir / cacheSize 等动态字段正确
        await loadSettings()
      } else {
        message.error('保存失败')
      }
    } catch (e) { console.warn('保存失败:', e); message.error('保存失败') }
    setSaving(false)
  }

  const updateBackgroundDraft = (patch: Record<string, any>) => {
    setSettings((prev: any) => ({
      ...prev,
      appearance: {
        ...(prev?.appearance || {}),
        background: {
          ...defaultBackgroundSettings,
          ...(prev?.appearance?.background || {}),
          ...patch
        }
      }
    }))
  }

  const saveAppearanceSettings = async (nextBackground = backgroundSettings, showSuccess = true) => {
    setSaving(true)
    try {
      const updated = {
        ...settings,
        appearance: {
          ...(settings?.appearance || {}),
          background: {
            ...defaultBackgroundSettings,
            ...nextBackground
          }
        }
      }
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      })
      if (!res.ok) throw new Error('保存失败')
      const saved = await res.json()
      setSettings(saved)
      updateSettings(saved.general || updated.general || {}, saved.appearance || updated.appearance)
      if (showSuccess) message.success('外观背景已保存')
      return true
    } catch (e) {
      console.warn('保存外观背景失败:', e)
      message.error('保存外观背景失败')
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleBackgroundUpload = async (file: File) => {
    setUploadingBackground(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/appearance/background/upload', {
        method: 'POST',
        body: formData
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '上传失败')
      const nextBackground = {
        enabled: true,
        url: data.url,
        fit: 'cover',
        opacity: 0.82,
        position: 'center',
        repeat: 'no-repeat'
      }
      updateBackgroundDraft(nextBackground)
      await saveAppearanceSettings(nextBackground, false)
      message.success('背景图片已上传')
    } catch (e: any) {
      console.warn('上传背景图片失败:', e)
      message.error(e.message || '上传背景图片失败')
    } finally {
      setUploadingBackground(false)
    }
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

  const loadMemorySyncStatus = async () => {
    setLoadingMemorySync(true)
    try {
      const res = await fetch('/api/memory/sync-to-obsidian')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || data.error || '读取失败')
      setMemorySyncItems(Array.isArray(data.memories) ? data.memories : [])
    } catch (error: any) {
      console.warn('读取记忆同步状态失败:', error)
    } finally {
      setLoadingMemorySync(false)
    }
  }

  const loadIsolationStatus = async () => {
    try {
      const res = await fetch('/api/security/isolation')
      if (res.ok) setIsolationStatus(await res.json())
    } catch (e) {
      console.warn('读取隔离策略失败:', e)
    }
  }

  const loadDesktopCapabilities = async () => {
    try {
      const capabilities = await getDesktopCapabilities()
      setDesktopCapabilities(capabilities)
    } catch (_) {
      setDesktopCapabilities(null)
    }
  }

  const updateIsolationPolicy = (patch: Record<string, any>) => {
    setIsolationStatus((prev: any) => ({
      ...prev,
      policy: {
        ...(prev?.policy || {}),
        ...patch,
      }
    }))
  }

  const saveIsolationPolicy = async () => {
    setSavingIsolation(true)
    try {
      const res = await fetch('/api/security/isolation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isolationStatus?.policy || {})
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || data.error || '保存失败')
      setIsolationStatus(data)
      message.success('权限与隔离策略已保存')
    } catch (error: any) {
      message.error(error.message || '保存隔离策略失败')
    } finally {
      setSavingIsolation(false)
    }
  }

  const syncMemoryToObsidian = async (keys: string[], includeSynced = false) => {
    setSyncingMemory(true)
    try {
      const res = await fetch('/api/memory/sync-to-obsidian', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys, includeSynced })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || data.error || '同步失败')
      message.success(`已同步 ${data.synced?.length || 0} 条记忆${data.skipped?.length ? `，跳过 ${data.skipped.length} 条` : ''}`)
      setSelectedMemoryKeys([])
      setPendingMemorySyncKeys([])
      setMemorySyncPreviewVisible(false)
      await loadMemorySyncStatus()
    } catch (error: any) {
      message.error(error.message || '同步记忆失败')
    } finally {
      setSyncingMemory(false)
    }
  }

  const getMemorySyncKeys = (mode: 'filtered' | 'selected') => {
    const source = mode === 'selected'
      ? memorySyncItems.filter(item => selectedMemoryKeys.includes(item.key))
      : filteredMemorySyncItems
    return source
      .filter(item => includeSyncedMemory || !item.syncedToObsidian?.relativePath)
      .map(item => item.key)
  }

  const openMemorySyncPreview = (mode: 'filtered' | 'selected') => {
    const keys = getMemorySyncKeys(mode)
    if (keys.length === 0) {
      message.info(includeSyncedMemory ? '没有符合筛选条件的记忆。' : '没有符合筛选条件的未同步记忆。')
      return
    }
    setPendingMemorySyncKeys(keys)
    setMemorySyncPreviewVisible(true)
  }

  const archiveConversationsToObsidian = async () => {
    setArchivingConversations(true)
    try {
      const res = await fetch('/api/conversations/archive-to-obsidian', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeEmpty: false })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || data.error || '归档失败')
      setConversationArchiveResult(data)
      message.success(`已归档 ${data.archived?.length || 0} 个会话，跳过 ${data.skipped?.length || 0} 个`)
    } catch (error: any) {
      message.error(error.message || '归档会话失败')
    } finally {
      setArchivingConversations(false)
    }
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
      a.href = url; a.download = `lingshu-backup-${new Date().toISOString().slice(0, 10)}.json`
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
          { value: 'system-overview', label: '显示系统概览' }
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
            placeholder="例如：~/Lingshu/workspace"
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
          <Divider style={{ margin: '8px 0' }} />
          <Card size="small" title="手动同步记忆到知识库">
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Space wrap>
                <Input.Search
                  allowClear
                  size="small"
                  placeholder="按 key / 内容搜索"
                  value={memorySyncQuery}
                  onChange={event => setMemorySyncQuery(event.target.value)}
                  style={{ width: 220 }}
                />
                <Select
                  size="small"
                  value={memorySyncAgentFilter}
                  onChange={setMemorySyncAgentFilter}
                  options={memorySyncAgentOptions}
                  style={{ width: 160 }}
                />
                <Select
                  size="small"
                  value={memorySyncStatusFilter}
                  onChange={setMemorySyncStatusFilter}
                  options={[
                    { label: '仅未同步', value: 'unsynced' },
                    { label: '仅已同步', value: 'synced' },
                    { label: '全部状态', value: 'all' }
                  ]}
                  style={{ width: 120 }}
                />
                <Checkbox
                  checked={includeSyncedMemory}
                  onChange={event => setIncludeSyncedMemory(event.target.checked)}
                >
                  允许重复同步已同步项
                </Checkbox>
              </Space>
              <Space wrap>
                <Tag color="blue">筛选 {filteredMemorySyncItems.length} / 共 {memorySyncItems.length} 条</Tag>
                <Tag color={unsyncedMemoryItems.length ? 'gold' : 'green'}>未同步 {unsyncedMemoryItems.length} 条</Tag>
                <Button size="small" onClick={loadMemorySyncStatus} loading={loadingMemorySync}>刷新</Button>
                <Button
                  size="small"
                  type="primary"
                  disabled={getMemorySyncKeys('filtered').length === 0}
                  loading={syncingMemory}
                  onClick={() => openMemorySyncPreview('filtered')}
                >
                  同步当前筛选
                </Button>
                <Button
                  size="small"
                  disabled={selectedMemoryKeys.length === 0}
                  loading={syncingMemory}
                  onClick={() => openMemorySyncPreview('selected')}
                >
                  同步选中
                </Button>
              </Space>
              <Spin spinning={loadingMemorySync}>
                {shownMemorySyncItems.length > 0 ? (
                  <List
                    size="small"
                    dataSource={shownMemorySyncItems}
                    renderItem={item => {
                      const checked = selectedMemoryKeys.includes(item.key)
                      const synced = !!item.syncedToObsidian?.relativePath
                      return (
                        <List.Item>
                          <Space align="start" style={{ width: '100%' }}>
                            <Checkbox
                              checked={checked}
                              onChange={event => {
                                setSelectedMemoryKeys(prev => event.target.checked
                                  ? [...new Set([...prev, item.key])]
                                  : prev.filter(key => key !== item.key))
                              }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Space size={6} wrap>
                                <Text strong ellipsis style={{ maxWidth: 260 }}>{item.key}</Text>
                                {item.agent && <Tag>{item.agent}</Tag>}
                                {synced ? <Tag color="green">已同步</Tag> : <Tag color="gold">未同步</Tag>}
                              </Space>
                              <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: '4px 0 0' }}>
                                {typeof item.value === 'string' ? item.value : JSON.stringify(item.value)}
                              </Paragraph>
                              {synced && (
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {item.syncedToObsidian.relativePath}
                                </Text>
                              )}
                            </div>
                          </Space>
                        </List.Item>
                      )
                    }}
                  />
                ) : (
                  <Paragraph type="secondary" style={{ margin: 0 }}>暂无可同步记忆。</Paragraph>
                )}
              </Spin>
              {filteredMemorySyncItems.length > shownMemorySyncItems.length && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  仅展示当前筛选的最近 {shownMemorySyncItems.length} 条；“同步当前筛选”会处理全部匹配项。
                </Text>
              )}
              <Modal
                title="确认同步记忆到知识库"
                open={memorySyncPreviewVisible}
                onCancel={() => setMemorySyncPreviewVisible(false)}
                onOk={() => syncMemoryToObsidian(pendingMemorySyncKeys, includeSyncedMemory)}
                confirmLoading={syncingMemory}
                okText="确认同步"
                cancelText="取消"
              >
                <Paragraph type="secondary">
                  将同步 {pendingMemorySyncKeys.length} 条记忆到 Obsidian Vault 的 灵枢/Memory/Facts 目录。
                </Paragraph>
                <List
                  size="small"
                  dataSource={pendingMemorySyncKeys.slice(0, 20)}
                  renderItem={key => <List.Item><Text code>{key}</Text></List.Item>}
                />
                {pendingMemorySyncKeys.length > 20 && (
                  <Text type="secondary">还有 {pendingMemorySyncKeys.length - 20} 条未展示。</Text>
                )}
              </Modal>
            </Space>
          </Card>
          <Card size="small" title="对话归档到知识库">
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Paragraph type="secondary" style={{ margin: 0 }}>
                新对话在保存或更新时会同步写入本地 JSON 和 Obsidian Markdown，不按固定时间延迟归档；也可以手动把历史会话补归档到 灵枢/Conversations/AI对话。旧的 Codex/对话存档 会继续兼容读取。
              </Paragraph>
              <Space wrap>
                <Button
                  size="small"
                  type="primary"
                  loading={archivingConversations}
                  onClick={archiveConversationsToObsidian}
                >
                  归档全部历史对话
                </Button>
                {conversationArchiveResult?.index?.relativePath && (
                  <Tag color="green">{conversationArchiveResult.index.relativePath}</Tag>
                )}
              </Space>
              {conversationArchiveResult && (
                <Space wrap>
                  <Tag color="blue">已归档 {conversationArchiveResult.archived?.length || 0}</Tag>
                  <Tag color="default">跳过 {conversationArchiveResult.skipped?.length || 0}</Tag>
                  <Tag color={(conversationArchiveResult.failed?.length || 0) > 0 ? 'red' : 'green'}>
                    失败 {conversationArchiveResult.failed?.length || 0}
                  </Tag>
                </Space>
              )}
            </Space>
          </Card>
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

  const isolationPolicy = isolationStatus?.policy || {}
  const isolationContent = (
    <div>
      <Alert
        type={isolationStatus?.summary?.isolated ? 'success' : 'warning'}
        showIcon
        style={{ marginBottom: 16 }}
        message={isolationStatus?.summary?.isolated ? '本地空间隔离已启用' : '隔离策略需要确认'}
        description="这里控制灵枢本地运行时、工具执行、Vault 写入和上传目录的权限边界。关闭某项写入权限后，对应同步/归档/API 会被策略拦截。"
      />
      <Card size="small" title="空间标识" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap>
            <Input
              addonBefore="Space ID"
              value={isolationPolicy.spaceId || 'local'}
              onChange={event => updateIsolationPolicy({ spaceId: event.target.value })}
              style={{ width: 260 }}
            />
            <Input
              addonBefore="名称"
              value={isolationPolicy.spaceName || '本地个人空间'}
              onChange={event => updateIsolationPolicy({ spaceName: event.target.value })}
              style={{ width: 320 }}
            />
            <Select
              value={isolationPolicy.mode || 'local-only'}
              onChange={value => updateIsolationPolicy({ mode: value })}
              style={{ width: 160 }}
              options={[
                { label: '本地优先', value: 'local-only' },
                { label: '团队预留', value: 'team-ready' }
              ]}
            />
          </Space>
          <Text type="secondary">
            当前基础版仅启用本地空间，后续接入团队/多空间时会用 Space ID 做数据隔离维度。
          </Text>
        </Space>
      </Card>
      <Card size="small" title="权限开关" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap>
            <Switch
              checked={isolationPolicy.enforceToolWorkspaceBoundary !== false}
              onChange={checked => updateIsolationPolicy({ enforceToolWorkspaceBoundary: checked })}
            />
            <Text>工具命令只能引用受控根目录内的绝对路径</Text>
          </Space>
          <Space wrap>
            <Switch
              checked={isolationPolicy.allowVaultWrite !== false}
              onChange={checked => updateIsolationPolicy({ allowVaultWrite: checked })}
            />
            <Text>允许写入 Markdown Vault</Text>
          </Space>
          <Space wrap>
            <Switch
              checked={isolationPolicy.allowMemoryWrite !== false}
              onChange={checked => updateIsolationPolicy({ allowMemoryWrite: checked })}
            />
            <Text>允许同步记忆到 Vault</Text>
          </Space>
          <Space wrap>
            <Switch
              checked={isolationPolicy.allowConversationArchive !== false}
              onChange={checked => updateIsolationPolicy({ allowConversationArchive: checked })}
            />
            <Text>允许归档 AI 对话到 Vault</Text>
          </Space>
          <Space wrap>
            <Switch
              checked={isolationPolicy.allowUploads !== false}
              onChange={checked => updateIsolationPolicy({ allowUploads: checked })}
            />
            <Text>允许上传目录写入</Text>
          </Space>
        </Space>
      </Card>
      <Card size="small" title="受控根目录" style={{ marginBottom: 16 }}>
        <List
          size="small"
          dataSource={isolationStatus?.roots || []}
          locale={{ emptyText: '暂无隔离目录状态' }}
          renderItem={(root: any) => (
            <List.Item>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space wrap>
                  <Tag color={root.exists && root.directory ? 'success' : 'warning'}>
                    {root.exists && root.directory ? '可用' : '待检查'}
                  </Tag>
                  <Tag color={root.writable ? 'blue' : 'default'}>
                    {root.writable ? '可写' : '只读/禁写'}
                  </Tag>
                  <Text strong>{root.label}</Text>
                  <Text type="secondary">{root.source}</Text>
                </Space>
                <Text code ellipsis={{ tooltip: root.path }}>{root.path}</Text>
              </Space>
            </List.Item>
          )}
        />
      </Card>
      <Card size="small" title="额外受控目录" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Input.TextArea
            rows={3}
            value={(isolationPolicy.allowedExtraRoots || []).join('\n')}
            onChange={event => updateIsolationPolicy({
              allowedExtraRoots: event.target.value.split('\n').map(item => item.trim()).filter(Boolean)
            })}
            placeholder="一行一个目录，例如 ~/Projects/lingshu-shared"
            style={{ fontFamily: 'monospace' }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            需要允许工具读取/写入其它本地项目目录时，把目录加入这里；保存后会进入工具路径边界检查。
          </Text>
        </Space>
      </Card>
      <Space>
        <Button type="primary" icon={<SaveOutlined />} loading={savingIsolation} onClick={saveIsolationPolicy}>
          保存隔离策略
        </Button>
        <Button icon={<SyncOutlined />} onClick={loadIsolationStatus}>
          刷新状态
        </Button>
      </Space>
    </div>
  )

  const shortcutsContent = (
    <div>
      <Alert
        type={desktopCapabilities?.isElectron ? 'success' : 'info'}
        showIcon
        style={{ marginBottom: 16 }}
        message={desktopCapabilities?.isElectron ? '桌面快捷键已启用' : '当前在浏览器环境中，桌面级快捷键不可用'}
        description={desktopCapabilities?.screenshotDir ? `截图会保存到：${desktopCapabilities.screenshotDir}` : undefined}
      />
      {desktopCapabilities?.shortcuts && (
        <Card size="small" title="桌面全局快捷键" style={{ marginBottom: 16 }}>
          <List
            size="small"
            dataSource={[
              { key: desktopCapabilities.shortcuts.focus, action: '唤起灵枢主窗口' },
              { key: desktopCapabilities.shortcuts.screenshotAsk, action: '截取主屏幕并插入 AI 对话输入框' },
              { key: desktopCapabilities.shortcuts.newChatWindow, action: '新开一个 AI 对话窗口' },
            ]}
            renderItem={item => (
              <List.Item>
                <Space>
                  <Tag color="green">{item.key}</Tag>
                  <span>{item.action}</span>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}
      <Card size="small" title="应用内快捷键">
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
      </Card>
    </div>
  )

  const appearanceContent = (
    <div>
      <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 820 }}>
        <Alert
          type="info"
          showIcon
          message="全局背景会应用到整个应用外壳"
          description="建议使用浅色或低对比图片，并把透明度控制在 10% 到 25%，避免影响文字和按钮可读性。"
        />
        <Card size="small" title="自定义背景">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div
              style={{
                height: 180,
                borderRadius: 8,
                border: '1px solid #e5e7eb',
                backgroundColor: '#f8fafc',
                backgroundImage: backgroundSettings.url ? `url("${backgroundSettings.url}")` : undefined,
                backgroundSize: backgroundSettings.fit,
                backgroundPosition: backgroundSettings.position,
                backgroundRepeat: backgroundSettings.repeat,
                opacity: backgroundSettings.url ? Math.max(0.25, backgroundSettings.opacity) : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}
            >
              {!backgroundSettings.url && (
                <Space direction="vertical" align="center">
                  <PictureOutlined style={{ fontSize: 36, color: '#94a3b8' }} />
                  <Text type="secondary">尚未上传背景图片</Text>
                </Space>
              )}
            </div>
            <Space wrap>
              <Upload
                showUploadList={false}
                accept="image/*"
                beforeUpload={(file) => {
                  handleBackgroundUpload(file)
                  return false
                }}
              >
                <Button icon={<UploadOutlined />} loading={uploadingBackground}>
                  上传图片
                </Button>
              </Upload>
              <Button
                icon={<DeleteOutlined />}
                disabled={!backgroundSettings.url}
                onClick={() => {
                  const nextBackground = { ...defaultBackgroundSettings }
                  updateBackgroundDraft(nextBackground)
                  saveAppearanceSettings(nextBackground)
                }}
              >
                清除背景
              </Button>
              <Button
                disabled={!backgroundSettings.url}
                onClick={() => {
                  updateBackgroundDraft({
                    fit: 'cover',
                    position: 'center',
                    repeat: 'no-repeat',
                    opacity: 0.82
                  })
                }}
              >
                推荐适配
              </Button>
              <Switch
                checked={!!backgroundSettings.enabled}
                disabled={!backgroundSettings.url}
                checkedChildren="启用"
                unCheckedChildren="关闭"
                onChange={(checked) => updateBackgroundDraft({ enabled: checked })}
              />
            </Space>
            <Form layout="vertical">
              <Form.Item label={<Text strong>图片适配</Text>}>
                <Select
                  value={backgroundSettings.fit}
                  style={{ maxWidth: 260 }}
                  onChange={(value) => updateBackgroundDraft({ fit: value })}
                  options={[
                    { value: 'cover', label: '自适应填充' },
                    { value: 'contain', label: '完整显示' },
                    { value: '100% 100%', label: '拉伸铺满（不推荐）' },
                    { value: 'auto', label: '原始尺寸' }
                  ]}
                />
              </Form.Item>
              <Form.Item label={<Text strong>对齐位置</Text>}>
                <Select
                  value={backgroundSettings.position}
                  style={{ maxWidth: 260 }}
                  onChange={(value) => updateBackgroundDraft({ position: value })}
                  options={[
                    { value: 'center', label: '居中' },
                    { value: 'top', label: '顶部' },
                    { value: 'bottom', label: '底部' },
                    { value: 'left', label: '左侧' },
                    { value: 'right', label: '右侧' }
                  ]}
                />
              </Form.Item>
              <Form.Item label={<Text strong>重复方式</Text>}>
                <Select
                  value={backgroundSettings.repeat}
                  style={{ maxWidth: 260 }}
                  onChange={(value) => updateBackgroundDraft({ repeat: value })}
                  options={[
                    { value: 'no-repeat', label: '不重复' },
                    { value: 'repeat', label: '平铺' },
                    { value: 'repeat-x', label: '横向平铺' },
                    { value: 'repeat-y', label: '纵向平铺' }
                  ]}
                />
              </Form.Item>
              <Form.Item label={<Text strong>壁纸强度</Text>}>
                <Slider
                  min={0.2}
                  max={1}
                  step={0.01}
                  value={backgroundSettings.opacity}
                  onChange={(value) => updateBackgroundDraft({ opacity: value })}
                  tooltip={{ formatter: value => `${Math.round((value || 0) * 100)}%` }}
                />
              </Form.Item>
            </Form>
            <Space>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={saving}
                onClick={() => saveAppearanceSettings()}
              >
                保存外观
              </Button>
              <Text type="secondary">
                图片会保存到本机上传目录，换电脑后需要重新上传或同步该文件。
              </Text>
            </Space>
          </Space>
        </Card>
      </Space>
    </div>
  )

  const aboutContent = (
    <div>
      <Card style={{ maxWidth: 500 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RobotOutlined style={{ fontSize: 48, color: '#1890ff' }} />
            <div>
              <Title level={3} style={{ margin: 0 }}>灵枢</Title>
              <Tag color="blue">v{updateState?.currentVersion || packageJson.version}</Tag>
            </div>
          </div>
          <Divider />
          <Space>
            <Button
              type="primary"
              icon={<SyncOutlined />}
              loading={updateActionLoading || updateState?.status === 'checking'}
              disabled={updateState?.status === 'downloading'}
              onClick={handleCheckForUpdates}
            >
              检查更新
            </Button>
            {updateState?.status === 'available' && (
              <Button loading={updateActionLoading} onClick={handleDownloadUpdate}>下载 v{updateState.availableVersion}</Button>
            )}
            {updateState?.status === 'downloaded' && (
              <Button type="primary" loading={updateActionLoading} onClick={handleInstallUpdate}>重启并安装</Button>
            )}
            <Button
              icon={<GithubOutlined />}
              onClick={() => openExternal('https://github.com/scene1/Lingshu')}
            >
              GitHub
            </Button>
            <Button
              icon={<BugOutlined />}
              onClick={() => openExternal('https://github.com/scene1/Lingshu/issues')}
            >
              问题反馈
            </Button>
          </Space>
          <Alert
            type={updateState?.status === 'error' ? 'error' : updateState?.status === 'available' || updateState?.status === 'downloaded' ? 'info' : 'success'}
            showIcon
            message={updateState?.message || '桌面版支持从 GitHub Releases 检查更新'}
            description={updateState?.status === 'downloading' ? `下载进度 ${Math.round(updateState.progress || 0)}%` : undefined}
          />
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
    { key: 'appearance', label: '外观背景', icon: <PictureOutlined />, children: appearanceContent },
    { key: 'models', label: '模型配置', icon: <RobotOutlined />, children: modelConfigContent },
    { key: 'data', label: '数据与存储', icon: <DatabaseOutlined />, children: dataStorageContent },
    { key: 'isolation', label: '权限与隔离', icon: <KeyOutlined />, children: isolationContent },
    { key: 'shortcuts', label: '快捷键', icon: <ThunderboltOutlined />, children: shortcutsContent },
    { key: 'about', label: '关于', icon: <InfoCircleOutlined />, children: aboutContent },
  ]

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />

  return (
    <Layout style={{ minHeight: '100%', background: 'transparent' }}>
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
