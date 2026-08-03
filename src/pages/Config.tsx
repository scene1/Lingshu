import React, { useState, useEffect } from 'react'
import { Card, Form, Input, Select, Switch, Button, message, Tabs, Alert, Spin } from 'antd'
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons'

const { TextArea } = Input
const { TabPane } = Tabs

const Config: React.FC = () => {
  const [form] = Form.useForm()
  const [activeTab, setActiveTab] = useState('general')
  const [loading, setLoading] = useState(true)
  const [rawConfig, setRawConfig] = useState<any>({})

  const loadConfig = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/config')
      if (res.ok) {
        const config = await res.json()
        setRawConfig(config)

        const general = {
          language: config.language || 'zh-CN',
          theme: config.theme || 'light',
          autoStart: config.autoStart !== undefined ? config.autoStart : true,
          logLevel: config.logLevel || 'info'
        }
        const models = {
          default: config.models?.defaults?.model || config.models?.default || 'stepfun/step-alpha',
          temperature: config.models?.defaults?.temperature || config.temperature || 0.7,
          maxTokens: config.models?.defaults?.maxTokens || config.maxTokens || 4096
        }
        const channels = {
          feishu: config.channels?.feishu?.enabled !== undefined ? config.channels.feishu.enabled : true,
          weixin: config.channels?.weixin?.enabled !== undefined ? config.channels.weixin.enabled : false,
          dingtalk: config.channels?.dingtalk?.enabled !== undefined ? config.channels.dingtalk.enabled : false
        }
        const skills = {
          autoUpdate: config.skills?.autoUpdate !== undefined ? config.skills.autoUpdate : true,
          loadPath: config.skills?.load?.extraDirs?.[0] || config.skills?.loadPath || '~/Lingshu/skills'
        }

        form.setFieldsValue({ ...general, ...models, ...channels, ...skills, rawJson: JSON.stringify(config, null, 2) })
      }
    } catch (error) {
      console.error('加载配置失败:', error)
      message.error('加载配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const updatedConfig: any = { ...rawConfig }

      updatedConfig.language = values.language
      updatedConfig.theme = values.theme
      updatedConfig.autoStart = values.autoStart
      updatedConfig.logLevel = values.logLevel

      if (!updatedConfig.models) updatedConfig.models = {}
      if (!updatedConfig.models.defaults) updatedConfig.models.defaults = {}
      updatedConfig.models.defaults.model = values.default
      updatedConfig.models.defaults.temperature = parseFloat(values.temperature)
      updatedConfig.models.defaults.maxTokens = parseInt(values.maxTokens, 10)

      if (!updatedConfig.channels) updatedConfig.channels = {}
      if (!updatedConfig.channels.feishu) updatedConfig.channels.feishu = {}
      updatedConfig.channels.feishu.enabled = values.feishu
      if (!updatedConfig.channels.weixin) updatedConfig.channels.weixin = {}
      updatedConfig.channels.weixin.enabled = values.weixin
      if (!updatedConfig.channels.dingtalk) updatedConfig.channels.dingtalk = {}
      updatedConfig.channels.dingtalk.enabled = values.dingtalk

      if (!updatedConfig.skills) updatedConfig.skills = {}
      updatedConfig.skills.autoUpdate = values.autoUpdate
      if (!updatedConfig.skills.load) updatedConfig.skills.load = {}
      updatedConfig.skills.load.extraDirs = [values.loadPath]

      if (values.rawJson) {
        try {
          const parsed = JSON.parse(values.rawJson)
          Object.assign(updatedConfig, parsed)
        } catch (_) {
          message.warning('高级配置 JSON 格式错误，已使用表单字段保存')
        }
      }

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig)
      })

      if (res.ok) {
        message.success('配置已保存')
        setRawConfig(updatedConfig)
      } else {
        const err = await res.json()
        message.error(err.error || '保存配置失败')
      }
    } catch (error) {
      console.error('保存配置失败:', error)
      message.error('保存配置失败')
    }
  }

  const handleReset = () => {
    loadConfig()
    message.info('配置已重新加载')
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spin size="large" tip="加载配置..." />
      </div>
    )
  }

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>配置管理</h2>
      
      <Alert
        message="修改配置后需要重启灵枢运行时才会生效"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Form form={form} layout="vertical">
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <TabPane tab="基本设置" key="general">
            <Card>
              <Form.Item name="language" label="语言">
                <Select>
                  <Select.Option value="zh-CN">简体中文</Select.Option>
                  <Select.Option value="en-US">English</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item name="theme" label="主题">
                <Select>
                  <Select.Option value="light">浅色</Select.Option>
                  <Select.Option value="dark">深色</Select.Option>
                  <Select.Option value="auto">自动</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item name="autoStart" label="开机启动" valuePropName="checked">
                <Switch />
              </Form.Item>

              <Form.Item name="logLevel" label="日志级别">
                <Select>
                  <Select.Option value="debug">Debug</Select.Option>
                  <Select.Option value="info">Info</Select.Option>
                  <Select.Option value="warn">Warning</Select.Option>
                  <Select.Option value="error">Error</Select.Option>
                </Select>
              </Form.Item>
            </Card>
          </TabPane>

          <TabPane tab="模型配置" key="models">
            <Card>
              <Form.Item name="default" label="默认模型">
                <Select>
                  <Select.Option value="stepfun/step-alpha">Step-Alpha</Select.Option>
                  <Select.Option value="stepfun/step-1-8k">Step-1-8k</Select.Option>
                  <Select.Option value="openai/gpt-4">GPT-4</Select.Option>
                  <Select.Option value="anthropic/claude-3">Claude-3</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item name="temperature" label="Temperature" extra="控制输出的随机性，0-2之间">
                <Input type="number" min={0} max={2} step={0.1} />
              </Form.Item>

              <Form.Item name="maxTokens" label="最大 Token 数">
                <Input type="number" min={1024} max={128000} step={1024} />
              </Form.Item>
            </Card>
          </TabPane>

          <TabPane tab="渠道配置" key="channels">
            <Card>
              <Form.Item name="feishu" label="飞书" valuePropName="checked">
                <Switch />
              </Form.Item>

              <Form.Item name="weixin" label="微信" valuePropName="checked">
                <Switch />
              </Form.Item>

              <Form.Item name="dingtalk" label="钉钉" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Card>
          </TabPane>

          <TabPane tab="Skills 配置" key="skills">
            <Card>
              <Form.Item name="autoUpdate" label="自动更新" valuePropName="checked" extra="自动检查并更新 skills">
                <Switch />
              </Form.Item>

              <Form.Item name="loadPath" label="Skills 加载路径">
                <Input />
              </Form.Item>
            </Card>
          </TabPane>

          <TabPane tab="高级配置" key="advanced">
            <Card>
              <Form.Item name="rawJson" label="配置文件 (JSON)">
                <TextArea rows={20} placeholder="直接编辑 openclaw.json" />
              </Form.Item>
            </Card>
          </TabPane>
        </Tabs>
      </Form>

      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <Button style={{ marginRight: 8 }} onClick={handleReset} icon={<ReloadOutlined />}>
          重置
        </Button>
        <Button type="primary" onClick={handleSave} icon={<SaveOutlined />}>
          保存配置
        </Button>
      </div>
    </div>
  )
}

export default Config
