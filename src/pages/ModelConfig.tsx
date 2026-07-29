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
  keyPlaceholder: string
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
    keyPlaceholder: 'sk-ant-xxxxxxxx'
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
    keyPlaceholder: 'tp-xxxxxxxx'
  },
}

const ModelConfig: React.FC = () => {
  const [form] = Form.useForm()
  const [currentProvider, setCurrentProvider] = useState('stepfun')
  const [configs, setConfigs] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)

  // 加载配置
  useEffect(() => {
    loadConfigs()
  }, [])

  // 切换提供商时加载对应配置
  useEffect(() => {
    const config = configs[currentProvider]
    if (config) {
      form.setFieldsValue({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || PROVIDERS[currentProvider].baseUrl,
        model: config.model
      })
    } else {
      form.setFieldsValue({
        apiKey: '',
        baseUrl: PROVIDERS[currentProvider].baseUrl,
        model: PROVIDERS[currentProvider].models[0]?.value
      })
    }
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
      throw new Error(result.error || `HTTP ${response.status}`)
    }
    
    return true
  }

  // 保存配置
  const handleSave = async () => {
    const values = await form.validateFields()
    setLoading(true)
    
    try {
      // 获取现有配置
      const response = await fetch('/api/config')
      const config = await response.json()
      
      // 更新 providers
      config.providers = config.providers || {}
      config.providers[currentProvider] = {
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

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {/* 左侧提供商列表 */}
      <Sider 
        width={280} 
        theme="light"
        style={{ 
          borderRight: '1px solid #e8e8e8',
          background: '#fff'
        }}
      >
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e8e8e8' }}>
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
      <Content style={{ padding: 24 }}>
        <Card
          title={
            <Space>
              <span style={{ fontSize: 24 }}>{currentConfig.icon}</span>
              <Title level={4} style={{ margin: 0 }}>{currentConfig.name}</Title>
              {configs[currentProvider]?.apiKey && (
                <Tag color="success" icon={<CheckCircleOutlined />}>已配置</Tag>
              )}
            </Space>
          }
          extra={
            <Button 
              type="link" 
              icon={<LinkOutlined />}
              href={currentConfig.docUrl}
              target="_blank"
            >
              获取 API Key
            </Button>
          }
          style={{ maxWidth: 800 }}
        >
          {/* 配置说明 */}
          <Alert
            message="配置说明"
            description={`在 ${currentConfig.docUrl} 注册账号并创建 API Key，填入下方配置。支持 ${currentConfig.models.length} 款模型。`}
            type="info"
            showIcon
            style={{ marginBottom: 24 }}
          />

          <Form
            form={form}
            layout="vertical"
            initialValues={{
              baseUrl: currentConfig.baseUrl,
              model: currentConfig.models[0]?.value
            }}
          >
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
