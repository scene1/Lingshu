import React, { useState, useEffect } from 'react'
import { 
  Layout, 
  Card, 
  Form, 
  Input, 
  Button, 
  Select, 
  message, 
  Space,
  Tag,
  Alert,
  Typography,
  Menu,
  Badge,
  Divider
} from 'antd'

import { 
  SaveOutlined, 
  KeyOutlined,
  CheckCircleOutlined,
  LinkOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  GlobalOutlined
} from '@ant-design/icons'

const { Text, Title } = Typography
const { Sider, Content } = Layout

export interface ProviderConfig {
  id: string
  name: string
  icon: string
  baseUrl: string
  models: { value: string; label: string; desc: string }[]
  docUrl: string
  keyUrl: string
  keyPlaceholder: string
  mode?: 'api-key' | 'local-cli'
}

// 主流模型提供商配置
export const PROVIDERS: Record<string, ProviderConfig> = {
  stepfun: {
    id: 'stepfun',
    name: 'StepFun (阶跃星辰)',
    icon: '🚀',
    baseUrl: 'https://api.stepfun.com/step_plan/v1',
    models: [
      { value: 'step-3.7-flash', label: 'Step-3.7 Flash', desc: '最新旗舰，极速响应' },
      { value: 'step-3.5-flash-2603', label: 'Step-3.5 Flash 2603', desc: '稳定版本，当前可用' },
      { value: 'step-3.5-flash', label: 'Step-3.5 Flash', desc: '轻量极速' },
    ],
    docUrl: 'https://platform.stepfun.com/',
    keyUrl: 'https://platform.stepfun.com/account/accesskey',
    keyPlaceholder: 'your-api-key'
  },
  zhipu: {
    id: 'zhipu',
    name: '智谱 AI (GLM)',
    icon: '🧠',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { value: 'glm-4', label: 'GLM-4', desc: '旗舰模型，最强性能' },
      { value: 'glm-3-turbo', label: 'GLM-3 Turbo', desc: '快速响应，经济实惠' },
      { value: 'glm-4v', label: 'GLM-4V', desc: '多模态，支持图像' },
    ],
    docUrl: 'https://open.bigmodel.cn/',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    keyPlaceholder: 'your-api-key'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    icon: '🌐',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { value: 'gpt-5', label: 'GPT-5', desc: '旗舰通用模型' },
      { value: 'gpt-5-mini', label: 'GPT-5 Mini', desc: '平衡性能与成本' },
      { value: 'gpt-4.1', label: 'GPT-4.1', desc: '强通用能力，适合复杂任务' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', desc: '轻量高效' },
      { value: 'gpt-4o', label: 'GPT-4o', desc: '多模态通用模型' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini', desc: '经济快速' },
    ],
    docUrl: 'https://platform.openai.com/',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-xxxxxxxx'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    icon: '📚',
    baseUrl: 'http://192.168.51.10:8080',
    models: [
      { value: 'claude-fable-5', label: 'Claude Fable 5', desc: '最新一代旗舰' },
      { value: 'claude-opus-4-8', label: 'Claude Opus 4.8（推荐）', desc: '最新旗舰' },
      { value: 'claude-opus-4-7', label: 'Claude Opus 4.7', desc: '高性能推理' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', desc: '平衡性能与速度' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', desc: '极速响应（当前可用）' },
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', desc: '强推理能力' },
      { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5', desc: '稳定版本' },
      { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', desc: '经典版本' },
      { value: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1', desc: '上一代旗舰' },
    ],
    docUrl: 'https://console.anthropic.com/',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-xxxxxxxx'
  },
  'claude-cli': {
    id: 'claude-cli',
    name: 'Claude CLI (本地命令行)',
    icon: '⚡',
    baseUrl: 'local://claude-cli',
    models: [
      { value: 'sonnet', label: 'Sonnet [claude-sonnet-5]', desc: '平衡性能与速度，日常首选' },
      { value: 'opus', label: 'Opus [claude-opus-4-8]', desc: '最强推理能力，复杂任务推荐' },
      { value: 'haiku', label: 'Haiku [claude-haiku-4-5]', desc: '极速响应，轻量任务' },
      { value: 'fable', label: 'Fable [claude-fable-5]', desc: '旗舰模型别名' },
    ],
    docUrl: 'https://docs.anthropic.com/',
    keyUrl: 'https://docs.anthropic.com/',
    keyPlaceholder: '无需填写，由 claude CLI 自身管理认证',
    mode: 'local-cli'
  },
  doubao: {
    id: 'doubao',
    name: '豆包 (火山引擎)',
    icon: '🔥',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { value: 'doubao-pro-128k', label: '豆包 Pro 128K', desc: '专业版，长上下文' },
      { value: 'doubao-lite-128k', label: '豆包 Lite 128K', desc: '轻量版，经济实惠' },
      { value: 'doubao-vision', label: '豆包 Vision', desc: '多模态版本' },
    ],
    docUrl: 'https://console.volcengine.com/',
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    keyPlaceholder: 'your-api-key'
  },
  qwen: {
    id: 'qwen',
    name: '通义千问 (阿里云)',
    icon: '☁️',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { value: 'qwen-max', label: 'Qwen Max', desc: '最强模型' },
      { value: 'qwen-plus', label: 'Qwen Plus', desc: '平衡性能' },
      { value: 'qwen-turbo', label: 'Qwen Turbo', desc: '极速响应' },
    ],
    docUrl: 'https://dashscope.aliyun.com/',
    keyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    keyPlaceholder: 'sk-xxxxxxxx'
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: '🐋',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', desc: '最新旗舰（推荐）' },
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', desc: '极速响应' },
      { value: 'deepseek-chat', label: 'DeepSeek Chat (V3.2)', desc: '通用对话，即将废弃' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (V3.2)', desc: '推理增强，即将废弃' },
    ],
    docUrl: 'https://platform.deepseek.com/',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-xxxxxxxx'
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot (月之暗面)',
    icon: '🌙',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { value: 'moonshot-v1-8k', label: 'Moonshot 8K', desc: '轻量级' },
      { value: 'moonshot-v1-32k', label: 'Moonshot 32K', desc: '标准版' },
      { value: 'moonshot-v1-128k', label: 'Moonshot 128K', desc: '长上下文' },
    ],
    docUrl: 'https://platform.moonshot.cn/',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    keyPlaceholder: 'sk-xxxxxxxx'
  },
  xiaomi: {
    id: 'xiaomi',
    name: '小米 MiMo',
    icon: '📱',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    models: [
      { value: 'mimo-v2.5-pro', label: 'MiMo-V2.5 Pro', desc: '旗舰 MoE，1020B/42B 活跃，1M 上下文' },
      { value: 'mimo-v2.5', label: 'MiMo-V2.5', desc: '稀疏 MoE 310B/15B 活跃，原生多模态' },
      { value: 'mimo-v2-pro', label: 'MiMo-V2 Pro', desc: '上一代旗舰，1M 上下文' },
      { value: 'mimo-v2-omni', label: 'MiMo-V2 Omni', desc: '多模态（文本+图像）' },
    ],
    docUrl: 'https://platform.xiaomimimo.com/',
    keyUrl: 'https://platform.xiaomimimo.com/',
    keyPlaceholder: 'tp-xxxxxxxx'
  },
}

const ModelConfig: React.FC = () => {
  const [form] = Form.useForm()
  const [currentProvider, setCurrentProvider] = useState('stepfun')
  const [configs, setConfigs] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [claudeCliStatus, setClaudeCliStatus] = useState<{ available: boolean; path?: string; candidates?: string[] } | null>(null)

  // 加载配置
  useEffect(() => {
    loadConfigs()
  }, [])

  // 切换提供商时加载对应配置
  useEffect(() => {
    const config = configs[currentProvider]
    const provider = PROVIDERS[currentProvider]
    if (config) {
      form.setFieldsValue({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || provider.baseUrl,
        model: config.model
      })
    } else {
      form.setFieldsValue({
        apiKey: '',
        baseUrl: provider.baseUrl,
        model: provider.models[0]?.value
      })
    }
    if (provider.mode === 'local-cli') loadClaudeCliStatus()
  }, [currentProvider, configs])

  const loadConfigs = async () => {
    try {
      const response = await fetch('/api/config')
      if (response.ok) {
        const data = await response.json()
        setConfigs(data.providers || {})
      }
    } catch (error) {
      console.error('加载配置失败:', error)
    }
  }

  const loadClaudeCliStatus = async () => {
    try {
      const response = await fetch('/api/claude-cli/status')
      if (response.ok) {
        setClaudeCliStatus(await response.json())
      }
    } catch (error) {
      console.error('加载 Claude CLI 状态失败:', error)
      setClaudeCliStatus({ available: false })
    }
  }

  // 验证 API Key（通过后端代理，避免浏览器限制自定义 User-Agent）
  const validateApiKey = async (apiKey: string, baseUrl: string, model: string) => {
    const provider = PROVIDERS[currentProvider]
    
    const response = await fetch('/api/config/test-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        baseUrl,
        model: model || provider.models[0]?.value,
        provider: currentProvider
      })
    })
    
    const result = await response.json()
    if (!result.success) {
      throw new Error(result.error || result.message || `HTTP ${response.status}`)
    }
    
    return true
  }

  // 保存配置
  const handleSave = async () => {
    const values = await form.validateFields()
    const provider = PROVIDERS[currentProvider]
    setLoading(true)
    
    try {
      // 获取现有配置
      const response = await fetch('/api/config')
      const config = await response.json()
      
      // 更新 providers
      config.providers = config.providers || {}
      config.providers[currentProvider] = provider.mode === 'local-cli'
        ? { apiKey: '', baseUrl: provider.baseUrl, model: values.model, mode: 'local-cli' }
        : {
            apiKey: values.apiKey,
            baseUrl: values.baseUrl,
            model: values.model
          }
      
      // 保存
      const saveResponse = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      
      if (!saveResponse.ok) {
        throw new Error('保存失败')
      }
      
      message.success(`${PROVIDERS[currentProvider].name} 配置已保存`)
      loadConfigs()
    } catch (error: any) {
      message.error('保存失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  // 测试连接
  const handleTest = async () => {
    const values = await form.validateFields()
    setTesting(true)
    
    message.loading({ content: '正在测试连接...', key: 'test', duration: 0 })
    
    try {
      await validateApiKey(values.apiKey, values.baseUrl, values.model)
      message.success({ content: '✅ 连接成功', key: 'test' })
    } catch (error: any) {
      message.error({ content: '❌ 连接失败: ' + error.message, key: 'test', duration: 5 })
    } finally {
      setTesting(false)
    }
  }

  // 左侧菜单项
  const menuItems = Object.entries(PROVIDERS).map(([key, provider]) => ({
    key,
    icon: <span style={{ fontSize: 18 }}>{provider.icon}</span>,
    label: (
      <Space>
        <span>{provider.name}</span>
        {configs[key]?.apiKey && (
          <Badge status="success" size="small" />
        )}
      </Space>
    ),
  }))

  const currentConfig = PROVIDERS[currentProvider]
  const isLocalCliProvider = currentConfig.mode === 'local-cli'

  return (
    <Layout className="model-config-page" style={{ minHeight: '100vh' }}>
      {/* 左侧提供商列表 */}
      <Sider 
        className="model-config-sider"
        width={280} 
        theme="light"
      >
        <div className="model-config-provider-head">
          <Title level={4} style={{ margin: 0 }}>
            <SettingOutlined style={{ marginRight: 8 }} />
            模型配置
          </Title>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[currentProvider]}
          items={menuItems}
          onClick={({ key }) => setCurrentProvider(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>

      {/* 右侧配置表单 */}
      <Content className="model-config-content">
        <Card
          className="model-config-card"
          title={
            <Space>
              <span style={{ fontSize: 24 }}>{currentConfig.icon}</span>
              <Title level={4} style={{ margin: 0 }}>{currentConfig.name}</Title>
              {isLocalCliProvider && claudeCliStatus?.available && (
                <Tag color="success" icon={<CheckCircleOutlined />}>CLI 已安装</Tag>
              )}
              {isLocalCliProvider && claudeCliStatus && !claudeCliStatus.available && (
                <Tag color="error">CLI 未安装</Tag>
              )}
              {!isLocalCliProvider && configs[currentProvider]?.apiKey && (
                <Tag color="success" icon={<CheckCircleOutlined />}>已配置</Tag>
              )}
            </Space>
          }
          extra={
            <Button 
              type="link" 
              icon={<LinkOutlined />}
              href={currentConfig.keyUrl}
              target="_blank"
            >
              {isLocalCliProvider ? '查看文档' : '获取 API Key'}
            </Button>
          }
          style={{ maxWidth: 800 }}
        >
          {/* 配置说明 */}
          {isLocalCliProvider ? (
            <Alert
              message={claudeCliStatus?.available ? 'Claude CLI 可用' : 'Claude CLI 未检测到'}
              description={claudeCliStatus?.available
                ? `已检测到本地 CLI：${claudeCliStatus.path}。灵枢会通过 claude -p 复用 CLI 自身认证，不需要 API Key。`
                : '请先安装并登录 claude CLI，例如 npm install -g @anthropic-ai/claude-code，然后在终端运行 claude 完成认证。'}
              type={claudeCliStatus?.available ? 'success' : 'warning'}
              showIcon
              action={<Button size="small" onClick={loadClaudeCliStatus}>重新检测</Button>}
              style={{ marginBottom: 24 }}
            />
          ) : (
            <Alert
              message="配置说明"
              description={`在 ${currentConfig.docUrl} 注册账号并创建 API Key，填入下方配置。支持 ${currentConfig.models.length} 款模型。`}
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />
          )}

          <Form
            form={form}
            layout="vertical"
            initialValues={{
              baseUrl: currentConfig.baseUrl,
              model: currentConfig.models[0]?.value
            }}
          >
            {!isLocalCliProvider && (
              <>
                {/* API Key */}
                <Form.Item
                  name="apiKey"
                  label={<Text strong>API Key</Text>}
                  rules={[{ required: true, message: '请输入 API Key' }]}
                >
                  <Input.Password
                    placeholder={currentConfig.keyPlaceholder}
                    prefix={<KeyOutlined />}
                    size="large"
                  />
                </Form.Item>

                {/* Base URL */}
                <Form.Item
                  name="baseUrl"
                  label={<Text strong>Base URL</Text>}
                  rules={[{ required: true, message: '请输入 Base URL' }]}
                >
                  <Input
                    placeholder={currentConfig.baseUrl}
                    prefix={<GlobalOutlined />}
                    size="large"
                  />
                </Form.Item>
              </>
            )}

            {/* 默认模型 */}
            <Form.Item
              name="model"
              label={<Text strong>默认模型</Text>}
              rules={[{ required: true, message: '请选择模型' }]}
            >
              <Select 
                size="large" 
                placeholder="选择模型"
                options={currentConfig.models.map(m => ({
                  value: m.value,
                  label: `${m.label} - ${m.desc}`
                }))}
              />
            </Form.Item>

            <Divider />

            {/* 操作按钮 */}
            <Form.Item>
              <Space size="large">
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  size="large"
                  onClick={handleSave}
                  loading={loading}
                >
                  保存配置
                </Button>
                <Button
                  icon={<ThunderboltOutlined />}
                  size="large"
                  onClick={handleTest}
                  loading={testing}
                >
                  测试连接
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>
      </Content>
    </Layout>
  )
}

export default ModelConfig
