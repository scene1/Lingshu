import React, { useState, useEffect, useMemo, Suspense } from 'react'
import { Layout, Menu, theme, ConfigProvider, Button, Spin } from 'antd'
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
  FileTextOutlined
} from '@ant-design/icons'
import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom'
// 路由懒加载：首屏只加载当前页面，其余按需加载
const RealChat = React.lazy(() => import('./pages/RealChat'))
const Dashboard = React.lazy(() => import('./pages/Dashboard'))
const AgentManager = React.lazy(() => import('./pages/AgentManager'))
const Skills = React.lazy(() => import('./pages/Skills'))
const InstanceManager = React.lazy(() => import('./pages/InstanceManager'))
const ModelConfig = React.lazy(() => import('./pages/ModelConfig'))
const Workflow = React.lazy(() => import('./pages/Workflow'))
const ChannelManager = React.lazy(() => import('./pages/ChannelManager'))
const MCPConfig = React.lazy(() => import('./pages/MCPConfig'))
const Settings = React.lazy(() => import('./pages/Settings'))
const GroupChat = React.lazy(() => import('./pages/GroupChat'))
const DocumentWorkbench = React.lazy(() => import('./pages/DocumentWorkbench'))
import { SettingsProvider, useSettings } from './contexts/SettingsContext'

const { Header, Sider, Content } = Layout

const AppInner: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false)
  const { appTheme, fontSize, locale, updateSettings } = useSettings()

  // 页面加载时从 /api/settings 读取设置并初始化全局状态
  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        const general = data.general || data
        updateSettings(general)
      })
      .catch(() => {})
  }, [updateSettings])

  const antdTheme = useMemo(() => ({
    algorithm: appTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: { fontSize }
  }), [appTheme, fontSize])

  const location = useLocation()
  const advancedPaths = ['/workflows', '/channels', '/mcp']

  const menuItems = [
    {
      key: '/',
      icon: <MessageOutlined />,
      label: <Link to="/">AI 对话</Link>
    },
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: <Link to="/dashboard">系统概览</Link>
    },
    {
      key: '/agents',
      icon: <RobotOutlined />,
      label: <Link to="/agents">Agent 角色库</Link>
    },
    {
      key: '/instances',
      icon: <CloudOutlined />,
      label: <Link to="/instances">运行实例</Link>
    },
    {
      key: '/skills',
      icon: <AppstoreOutlined />,
      label: <Link to="/skills">Skills 管理</Link>
    },
    {
      key: '/model-config',
      icon: <RobotOutlined />,
      label: <Link to="/model-config">模型配置</Link>
    },
    {
      key: '/group-chat',
      icon: <TeamOutlined />,
      label: <Link to="/group-chat">多 Agent 群聊</Link>
    },
    {
      key: '/documents',
      icon: <FileTextOutlined />,
      label: <Link to="/documents">文档工作台</Link>
    },
    {
      key: 'advanced',
      icon: <BranchesOutlined />,
      label: '实验室',
      children: [
        {
          key: '/channels',
          icon: <ApiOutlined />,
          label: <Link to="/channels">集成渠道（实验）</Link>
        },
        {
          key: '/mcp',
          icon: <CloudOutlined />,
          label: <Link to="/mcp">工具运行时（实验）</Link>
        },
        {
          key: '/workflows',
          icon: <BranchesOutlined />,
          label: <Link to="/workflows">自动化流程（实验）</Link>
        }
      ]
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: <Link to="/settings">设置</Link>
    }
  ]

  return (
    <ConfigProvider theme={antdTheme} locale={locale}>
      <Layout style={{ height: '100vh' }}>
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          breakpoint="lg"
          collapsedWidth={80}
          onBreakpoint={setCollapsed}
          theme="light"
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
            selectedKeys={[location.pathname]}
            defaultOpenKeys={advancedPaths.includes(location.pathname) ? ['advanced'] : []}
            inlineCollapsed={collapsed}
            items={menuItems}
          />
        </Sider>
        <Layout style={{ height: '100vh', overflow: 'hidden' }}>
          <Header className="app-shell-header" style={{
            padding: '0 24px',
            background: appTheme === 'dark' ? '#141414' : '#fff',
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
            <span className="app-shell-version" style={{ color: '#999' }}>v1.0.0</span>
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
              background: appTheme === 'dark' ? '#141414' : '#f5f7fa',
              minHeight: 0
            } : {
              margin: '24px 16px',
              padding: 24,
              minHeight: 280,
              background: appTheme === 'dark' ? '#1f1f1f' : '#fff',
              borderRadius: 8,
              overflow: 'auto'
            }}
          >
            <Routes>
              <Route path="/" element={<RealChat />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/agents" element={<AgentManager />} />
              <Route path="/instances" element={<InstanceManager />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/model-config" element={<ModelConfig />} />
              <Route path="/system-status" element={<Navigate to="/dashboard" replace />} />
              <Route path="/workflows" element={<Workflow />} />
              <Route path="/channels" element={<ChannelManager />} />
              <Route path="/mcp" element={<MCPConfig />} />
              <Route path="/group-chat" element={<GroupChat />} />
              <Route path="/documents" element={<DocumentWorkbench />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/config" element={<Navigate to="/settings" replace />} />
              <Route path="/location-picker" element={<Navigate to="/settings" replace />} />
              <Route path="/notifications" element={<Navigate to="/settings" replace />} />
              <Route path="/ai-compare" element={<Navigate to="/dashboard" replace />} />
              <Route path="/chat-demo" element={<Navigate to="/" replace />} />
              <Route path="/chat-home" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Content>
          </Suspense>
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}

const App: React.FC = () => (
  <SettingsProvider>
    <AppInner />
  </SettingsProvider>
)

export default App
