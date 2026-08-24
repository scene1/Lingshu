import React, { useState, useEffect, useMemo, Suspense } from 'react'
import { Layout, Menu, MenuProps, theme, ConfigProvider, Button, Spin, Tooltip, Modal, Input, List, Tag, Typography, Empty, Space, Badge } from 'antd'
import {
  DashboardOutlined,
  AppstoreOutlined,
  MessageOutlined,
  CloudOutlined,
  RobotOutlined,
  BranchesOutlined,
  ApiOutlined,
  SettingOutlined,
  TeamOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  FileTextOutlined,
  InboxOutlined,
  SearchOutlined,
  BellOutlined,
  ExperimentOutlined
} from '@ant-design/icons'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import packageJson from '../package.json'
// 路由懒加载：首屏只加载当前页面，其余按需加载
const RealChat = React.lazy(() => import('./pages/RealChat'))
const SystemOverview = React.lazy(() => import('./pages/Dashboard'))
const Projects = React.lazy(() => import('./pages/Projects'))
const AgentManager = React.lazy(() => import('./pages/AgentManager'))
const Skills = React.lazy(() => import('./pages/Skills'))
const InstanceManager = React.lazy(() => import('./pages/InstanceManager'))
const ModelConfig = React.lazy(() => import('./pages/ModelConfig'))
const Workflow = React.lazy(() => import('./pages/Workflow'))
const ChannelManager = React.lazy(() => import('./pages/ChannelManager'))
const ToolRegistry = React.lazy(() => import('./pages/ToolRegistry'))
const Automations = React.lazy(() => import('./pages/Automations'))
const LabOverview = React.lazy(() => import('./pages/LabOverview'))
const GitIntegrations = React.lazy(() => import('./pages/GitIntegrations'))
const AIFrameworkCompare = React.lazy(() => import('./pages/AIFrameworkCompare'))
const Settings = React.lazy(() => import('./pages/Settings'))
const Notifications = React.lazy(() => import('./pages/Notifications'))
const GroupChat = React.lazy(() => import('./pages/GroupChat'))
const DocumentWorkbench = React.lazy(() => import('./pages/DocumentWorkbench'))
const KnowledgeInbox = React.lazy(() => import('./pages/KnowledgeInbox'))
const ConversationQuality = React.lazy(() => import('./pages/ConversationQuality'))
import { SettingsProvider, useSettings } from './contexts/SettingsContext'
import { initProviderRegistry } from './core'
import { showDesktopNotification } from './utils/electron'

const { Header, Sider, Content } = Layout
const { Text } = Typography
const appVersion = packageJson.version

interface GlobalSearchResult {
  id: string
  type: string
  title: string
  snippet?: string
  route: string
  targetId?: string
  updatedAt?: string
  meta?: Record<string, unknown>
}

interface AppNotification {
  id: string
  title: string
  content: string
  type: 'success' | 'info' | 'warning' | 'error'
  route?: string
  read: boolean
  timestamp: string
}

const SEARCH_TYPE_META: Record<string, { label: string; color: string }> = {
  chat: { label: 'AI 对话', color: 'blue' },
  group_chat: { label: '多 Agent', color: 'purple' },
  agent: { label: 'Agent', color: 'green' },
  tool: { label: '工具', color: 'orange' },
  document: { label: '文档', color: 'cyan' },
  workflow: { label: 'Workflow', color: 'geekblue' },
  automation: { label: 'Automation', color: 'gold' },
}

const AppInner: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false)
  const [openMenuKeys, setOpenMenuKeys] = useState<string[]>([])
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalSearchResults, setGlobalSearchResults] = useState<GlobalSearchResult[]>([])
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0)
  const [backgroundTone, setBackgroundTone] = useState<'light' | 'dark'>('dark')
  const { appTheme, fontSize, locale, appearance, updateSettings } = useSettings()

  // 页面加载时从 /api/settings 读取设置并初始化全局状态
  useEffect(() => {
    // 初始化 Provider Registry
    initProviderRegistry()

    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        const general = data.general || data
        updateSettings(general, data.appearance || {})
      })
      .catch(() => {})
  }, [updateSettings])

  const antdTheme = useMemo(() => ({
    algorithm: appTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: { fontSize }
  }), [appTheme, fontSize])

  const location = useLocation()
  const navigate = useNavigate()

  const loadNotificationSummary = async (notifyNew = false) => {
    try {
      const response = await fetch('/api/notifications')
      if (!response.ok) return
      const data = await response.json()
      const notifications: AppNotification[] = Array.isArray(data.notifications) ? data.notifications : []
      setNotificationUnreadCount(Number(data.unreadCount || 0))

      const storageKey = 'lingshu-known-notification-ids'
      const knownIds = new Set<string>(JSON.parse(localStorage.getItem(storageKey) || '[]'))
      const newImportant = notifications
        .filter(item => !item.read && !knownIds.has(item.id) && ['error', 'warning'].includes(item.type))
        .slice(0, 3)
      notifications.slice(0, 200).forEach(item => knownIds.add(item.id))
      localStorage.setItem(storageKey, JSON.stringify([...knownIds].slice(-300)))

      if (notifyNew) {
        for (const item of newImportant) {
          await showDesktopNotification({
            title: item.title,
            body: item.content,
            route: item.route || '/notifications',
          }).catch(() => ({ success: false }))
        }
      }
    } catch (_) {}
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setGlobalSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    loadNotificationSummary(false)
    const timer = window.setInterval(() => loadNotificationSummary(true), 30000)
    const onFocus = () => loadNotificationSummary(false)
    const onNotificationsUpdated = () => loadNotificationSummary(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('lingshu:notifications-updated', onNotificationsUpdated)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('lingshu:notifications-updated', onNotificationsUpdated)
    }
  }, [])

  useEffect(() => {
    const query = globalSearchQuery.trim()
    if (!globalSearchOpen || !query) {
      setGlobalSearchResults([])
      setGlobalSearchLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setGlobalSearchLoading(true)
      try {
        const response = await fetch(`/api/global-search?q=${encodeURIComponent(query)}&limit=30`, {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`搜索失败: ${response.status}`)
        const data = await response.json()
        setGlobalSearchResults(Array.isArray(data.results) ? data.results : [])
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          setGlobalSearchResults([])
        }
      } finally {
        if (!controller.signal.aborted) setGlobalSearchLoading(false)
      }
    }, 180)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [globalSearchOpen, globalSearchQuery])

  const openGlobalSearchResult = (result: GlobalSearchResult) => {
    setGlobalSearchOpen(false)
    setGlobalSearchQuery('')
    setGlobalSearchResults([])
    navigate(result.route || '/')
  }

  const selectedMenuKey = location.pathname === '/dashboard' ? '/system-overview' : location.pathname
  const routeMenuGroup: Record<string, string> = {
    '/documents': 'knowledge-group',
    '/knowledge-inbox': 'knowledge-group',
    '/agents': 'intelligence-group',
    '/skills': 'intelligence-group',
    '/model-config': 'intelligence-group',
    '/instances': 'intelligence-group',
    '/automations': 'tools-automation-group',
    '/workflows': 'tools-automation-group',
    '/conversation-quality': 'quality-group',
    '/system-overview': 'quality-group',
    '/notifications': 'quality-group',
    '/lab': 'tools-automation-group',
    '/git-integrations': 'tools-automation-group',
    '/channels': 'tools-automation-group',
    '/tool-registry': 'tools-automation-group',
    '/ai-compare': 'tools-automation-group',
  }
  useEffect(() => {
    const parentKey = routeMenuGroup[selectedMenuKey]
    if (!parentKey) return
    setOpenMenuKeys(keys => keys.includes(parentKey) ? keys : [...keys, parentKey])
  }, [selectedMenuKey])
  const background = appearance?.background || {}
  const hasCustomBackground = !!(background.enabled && background.url)
  useEffect(() => {
    if (!hasCustomBackground || !background.url) {
      setBackgroundTone('dark')
      return
    }
    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (cancelled) return
      try {
        const canvas = document.createElement('canvas')
        const size = 24
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(image, 0, 0, size, size)
        const pixels = ctx.getImageData(0, 0, size, size).data
        let luminance = 0
        for (let i = 0; i < pixels.length; i += 4) {
          luminance += (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255
        }
        luminance /= pixels.length / 4
        setBackgroundTone(luminance > 0.52 ? 'light' : 'dark')
      } catch (_) {
        setBackgroundTone('dark')
      }
    }
    image.onerror = () => !cancelled && setBackgroundTone('dark')
    image.src = background.url
    return () => { cancelled = true }
  }, [hasCustomBackground, background.url])
  const shellPanelBackground = hasCustomBackground
    ? appTheme === 'dark'
      ? 'rgba(20, 20, 20, 0.88)'
      : 'rgba(255, 255, 255, 0.9)'
    : undefined
  const appShellStyle = {
    height: '100vh',
    overflow: 'hidden',
    ...(hasCustomBackground ? {
      '--app-bg-image': `url("${background.url}")`,
      '--app-bg-size': background.fit || 'cover',
      '--app-bg-position': background.position || 'center',
      '--app-bg-repeat': background.repeat || 'no-repeat',
      '--app-bg-opacity': String(background.opacity ?? 0.18),
      '--app-shell-panel-bg': shellPanelBackground,
    } : {})
  } as React.CSSProperties
  const fullscreenContentBackground = hasCustomBackground
    ? 'transparent'
    : appTheme === 'dark'
      ? '#141414'
      : '#f5f7fa'
  const panelContentBackground = hasCustomBackground
    ? 'transparent'
    : appTheme === 'dark'
      ? '#1f1f1f'
      : '#fff'

  const menuItems: MenuProps['items'] = [
    { type: 'group', label: '工作台', children: [] },
    {
      key: '/',
      icon: <MessageOutlined />,
      label: <Tooltip title="与 AI 对话并处理文件、图片和任务">AI 对话</Tooltip>
    },
    {
      key: 'knowledge-group',
      icon: <FileTextOutlined />,
      label: <Tooltip title="查看知识库和待整理内容">知识与文档</Tooltip>,
      children: [
        {
          key: '/documents',
          icon: <FileTextOutlined />,
          label: <Tooltip title="浏览、编辑和检索知识文档">知识库</Tooltip>
        },
        {
          key: '/knowledge-inbox',
          icon: <InboxOutlined />,
          label: <Tooltip title="整理对话、粘贴和外部渠道收集的内容">待整理内容</Tooltip>
        },
      ]
    },
    {
      key: '/projects',
      icon: <BranchesOutlined />,
      label: <Tooltip title="管理项目、任务和相关资料">项目</Tooltip>
    },
    {
      key: '/group-chat',
      icon: <TeamOutlined />,
      label: <Tooltip title="让多个智能体分工讨论和协作">团队协作</Tooltip>
    },
    { type: 'group', label: '配置与运行', children: [] },
    {
      key: 'intelligence-group',
      icon: <RobotOutlined />,
      label: <Tooltip title="配置智能体、技能、模型和运行连接">智能体与模型</Tooltip>,
      children: [
        { key: '/agents', icon: <RobotOutlined />, label: '智能体角色' },
        { key: '/skills', icon: <AppstoreOutlined />, label: '技能管理' },
        { key: '/model-config', icon: <RobotOutlined />, label: '模型服务' },
        { key: '/instances', icon: <CloudOutlined />, label: '运行连接' },
      ]
    },
    {
      key: 'tools-automation-group',
      icon: <BranchesOutlined />,
      label: <Tooltip title="管理工具、集成渠道和自动化流程">工具与自动化</Tooltip>,
      children: [
        { key: '/tool-registry', icon: <CloudOutlined />, label: '工具管理' },
        { key: '/automations', icon: <BranchesOutlined />, label: '定时任务' },
        { key: '/workflows', icon: <BranchesOutlined />, label: '工作流程' },
        { key: '/channels', icon: <ApiOutlined />, label: '外部渠道' },
        { key: '/git-integrations', icon: <BranchesOutlined />, label: '代码仓库' },
        { key: '/lab', icon: <ExperimentOutlined />, label: '扩展总览' },
        { key: '/ai-compare', icon: <ExperimentOutlined />, label: '方法参考' },
      ]
    },
    { type: 'group', label: '系统', children: [] },
    {
      key: 'quality-group',
      icon: <DashboardOutlined />,
      label: <Tooltip title="查看对话质量、运行状态和通知">质量与状态</Tooltip>,
      children: [
        { key: '/conversation-quality', icon: <ExperimentOutlined />, label: '对话质量' },
        { key: '/system-overview', icon: <DashboardOutlined />, label: '系统状态' },
        {
          key: '/notifications',
          icon: <Badge count={notificationUnreadCount} size="small" offset={[4, -2]}><BellOutlined /></Badge>,
          label: '通知中心',
        },
      ]
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: <Tooltip title="调整外观、工作目录和数据设置">设置</Tooltip>
    },
  ]

  return (
    <ConfigProvider theme={antdTheme} locale={locale}>
      <Layout
        className={`app-shell-root${hasCustomBackground ? ` app-shell-root--custom-bg app-bg-tone-${backgroundTone}` : ''}`}
        style={appShellStyle}
      >
        <Sider
          className="app-shell-sidebar"
          trigger={null}
          collapsible
          collapsed={collapsed}
          breakpoint="lg"
          collapsedWidth={80}
          onBreakpoint={setCollapsed}
          theme="light"
          style={{ height: '100vh', overflow: 'hidden' }}
        >
          <div style={{ 
            height: 64, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            fontSize: collapsed ? 14 : 18,
            fontWeight: 'bold',
            color: '#1890ff'
          }}>
            {collapsed ? '灵' : '灵枢'}
          </div>
          <Menu
            mode="inline"
            selectedKeys={[selectedMenuKey]}
            openKeys={collapsed ? undefined : openMenuKeys}
            onOpenChange={keys => setOpenMenuKeys(keys.map(String))}
            inlineCollapsed={collapsed}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
          />
        </Sider>
        <Layout style={{ height: '100vh', overflow: 'hidden' }}>
          <Header className="app-shell-header" style={{
            padding: '0 24px',
            background: shellPanelBackground || (appTheme === 'dark' ? '#141414' : '#fff'),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div className="app-shell-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                style={{ fontSize: 16 }}
              />
              <h1 style={{ margin: 0, fontSize: 20 }}>灵枢</h1>
            </div>
            <Space size={12}>
              <Badge count={notificationUnreadCount} size="small">
                <Button
                  type="text"
                  icon={<BellOutlined />}
                  onClick={() => navigate('/notifications')}
                />
              </Badge>
              <Button
                icon={<SearchOutlined />}
                onClick={() => setGlobalSearchOpen(true)}
                style={{ minWidth: 180, justifyContent: 'flex-start', color: '#666' }}
              >
                全局搜索 <Text type="secondary" style={{ marginLeft: 8 }}>⌘K</Text>
              </Button>
              <span className="app-shell-version" style={{ color: '#999' }}>v{appVersion}</span>
            </Space>
          </Header>
          {/* 页面加载指示器 */}
          <Suspense fallback={
            <div className="app-loading">
              <Spin size="large" />
              <span>加载中...</span>
            </div>
          }>
          <Content
            style={location.pathname === '/' || location.pathname === '/group-chat' || location.pathname === '/documents' ? {
              height: 'calc(100vh - 64px)',
              overflow: 'hidden',
              margin: 0,
              padding: 0,
              background: fullscreenContentBackground,
              minHeight: 0
            } : {
              margin: '24px 16px',
              padding: 24,
              minHeight: 280,
              background: panelContentBackground,
              borderRadius: hasCustomBackground ? 0 : 8,
              overflow: 'auto'
            }}
          >
            <Routes>
              <Route path="/" element={<RealChat />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/system-overview" element={<SystemOverview />} />
              <Route path="/conversation-quality" element={<ConversationQuality />} />
              <Route path="/dashboard" element={<Navigate to="/system-overview" replace />} />
              <Route path="/lab" element={<LabOverview />} />
              <Route path="/git-integrations" element={<GitIntegrations />} />
              <Route path="/agents" element={<AgentManager />} />
              <Route path="/instances" element={<InstanceManager />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/model-config" element={<ModelConfig />} />
              <Route path="/system-status" element={<Navigate to="/system-overview" replace />} />
              <Route path="/workflows" element={<Workflow />} />
              <Route path="/channels" element={<ChannelManager />} />
              <Route path="/mcp" element={<Navigate to="/tool-registry" replace />} />
              <Route path="/tool-registry" element={<ToolRegistry />} />
              <Route path="/automations" element={<Automations />} />
              <Route path="/group-chat" element={<GroupChat />} />
              <Route path="/knowledge-inbox" element={<KnowledgeInbox />} />
              <Route path="/documents" element={<DocumentWorkbench />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/config" element={<Navigate to="/settings" replace />} />
              <Route path="/location-picker" element={<Navigate to="/settings" replace />} />
              <Route path="/ai-compare" element={<AIFrameworkCompare />} />
              <Route path="/chat-demo" element={<Navigate to="/" replace />} />
              <Route path="/chat-home" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Content>
          </Suspense>
        </Layout>
      </Layout>
      <Modal
        title="全局搜索"
        open={globalSearchOpen}
        onCancel={() => setGlobalSearchOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <Input
          autoFocus
          size="large"
          prefix={<SearchOutlined />}
          placeholder="搜索会话、Agent、工具、文档、Workflow、自动化..."
          value={globalSearchQuery}
          onChange={event => setGlobalSearchQuery(event.target.value)}
          allowClear
          style={{ marginBottom: 12 }}
        />
        {globalSearchQuery.trim() ? (
          <List
            loading={globalSearchLoading}
            dataSource={globalSearchResults}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到匹配结果" /> }}
            renderItem={item => {
              const meta = SEARCH_TYPE_META[item.type] || { label: item.type || '结果', color: 'default' }
              return (
                <List.Item
                  style={{ cursor: 'pointer', padding: '10px 4px' }}
                  onClick={() => openGlobalSearchResult(item)}
                >
                  <List.Item.Meta
                    title={
                      <Space size={6} wrap>
                        <Tag color={meta.color}>{meta.label}</Tag>
                        <Text strong>{item.title}</Text>
                        {item.updatedAt && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {new Date(item.updatedAt).toLocaleString('zh-CN')}
                          </Text>
                        )}
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        {item.snippet && (
                          <Text type="secondary" ellipsis={{ tooltip: item.snippet }}>
                            {item.snippet}
                          </Text>
                        )}
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.targetId || item.route}
                        </Text>
                      </Space>
                    }
                  />
                </List.Item>
              )
            }}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="输入关键词开始搜索" />
        )}
      </Modal>
    </ConfigProvider>
  )
}

const App: React.FC = () => (
  <SettingsProvider>
    <AppInner />
  </SettingsProvider>
)

export default App
