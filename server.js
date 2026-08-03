import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import os from 'os'
import multer from 'multer'

const app = express()
const PORT = process.env.PORT || 3002

app.use(cors())
app.use(express.json())

// 全局错误处理中间件
app.use((err, req, res, next) => {
  console.error('未捕获的请求错误:', err)
  res.status(500).json({ error: 'Internal Server Error', message: err.message })
})

// 文件上传配置
const uploadDir = path.join(os.homedir(), 'Lingshu', 'workspace', 'uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}
const upload = multer({ dest: uploadDir })

// 会话存储目录
const CHAT_DIR = path.join(os.homedir(), 'Lingshu', 'workspace', 'chat-history')
if (!fs.existsSync(CHAT_DIR)) {
  fs.mkdirSync(CHAT_DIR, { recursive: true })
}

// OpenClaw 配置路径
const OPENCLAW_CONFIG = process.env.OPENCLAW_CONFIG || '~/Lingshu/openclaw.json'
const SKILLS_DIR = process.env.SKILLS_DIR || '~/Lingshu/skills'

// ====== 模型供应商定义（与前端 ModelConfig.tsx 保持同步） ======
const PROVIDERS = {
  stepfun: {
    id: 'stepfun',
    name: 'StepFun (阶跃星辰)',
    baseUrl: 'https://api.stepfun.com/step_plan/v1',
    chatUrl: 'https://api.stepfun.com/step_plan/v1/chat/completions',
    models: [
      { value: 'step-3.7-flash', label: 'Step-3.7 Flash' },
      { value: 'step-3.5-flash-2603', label: 'Step-3.5 Flash 2603' },
      { value: 'step-3.5-flash', label: 'Step-3.5 Flash' },
    ],
  },
  zhipu: {
    id: 'zhipu',
    name: '智谱 AI (GLM)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    chatUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    models: [
      { value: 'glm-4', label: 'GLM-4' },
      { value: 'glm-3-turbo', label: 'GLM-3 Turbo' },
      { value: 'glm-4v', label: 'GLM-4V' },
    ],
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    chatUrl: 'https://api.openai.com/v1/chat/completions',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'http://192.168.51.10:8080',
    chatUrl: (process.env.ANTHROPIC_BASE_URL || 'http://192.168.51.10:8080') + '/v1/messages',
    models: [
      { value: 'claude-fable-5', label: 'Claude Fable 5' },
      { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
      { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
      { value: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1' },
    ],
  },
  doubao: {
    id: 'doubao',
    name: '豆包 (火山引擎)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    chatUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    models: [
      { value: 'doubao-pro-128k', label: '豆包 Pro 128K' },
      { value: 'doubao-lite-128k', label: '豆包 Lite 128K' },
      { value: 'doubao-vision', label: '豆包 Vision' },
    ],
  },
  qwen: {
    id: 'qwen',
    name: '通义千问 (阿里云)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    chatUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    models: [
      { value: 'qwen-max', label: 'Qwen Max' },
      { value: 'qwen-plus', label: 'Qwen Plus' },
      { value: 'qwen-turbo', label: 'Qwen Turbo' },
    ],
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    chatUrl: 'https://api.deepseek.com/v1/chat/completions',
    models: [
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { value: 'deepseek-chat', label: 'DeepSeek Chat (V3.2)' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (V3.2)' },
    ],
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot (月之暗面)',
    baseUrl: 'https://api.moonshot.cn/v1',
    chatUrl: 'https://api.moonshot.cn/v1/chat/completions',
    models: [
      { value: 'moonshot-v1-8k', label: 'Moonshot 8K' },
      { value: 'moonshot-v1-32k', label: 'Moonshot 32K' },
      { value: 'moonshot-v1-128k', label: 'Moonshot 128K' },
    ],
  },
  xiaomi: {
    id: 'xiaomi',
    name: '小米 MiMo',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    chatUrl: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
    models: [
      { value: 'mimo-v2.5-pro', label: 'MiMo-V2.5 Pro' },
      { value: 'mimo-v2.5', label: 'MiMo-V2.5' },
      { value: 'mimo-v2-pro', label: 'MiMo-V2 Pro' },
      { value: 'mimo-v2-omni', label: 'MiMo-V2 Omni' },
    ],
  },
}

// 读取 openclaw.json 配置
function readConfig() {
  const configPath = OPENCLAW_CONFIG.replace('~', os.homedir())
  return JSON.parse(fs.readFileSync(configPath, 'utf8'))
}

function writeConfig(config) {
  const configPath = OPENCLAW_CONFIG.replace('~', os.homedir())
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

// 获取所有已配置 API Key 的供应商
function getConfiguredProviders() {
  try {
    const config = readConfig()
    const savedProviders = config.providers || {}
    const configured = {}
    for (const [id, data] of Object.entries(savedProviders)) {
      if (data.apiKey && PROVIDERS[id]) {
        configured[id] = { ...PROVIDERS[id], ...data }
      }
    }
    return configured
  } catch {
    return {}
  }
}

// 启动时检查已配置的供应商数量
const configuredProviders = getConfiguredProviders()
if (Object.keys(configuredProviders).length === 0) {
  console.log('⚠️  未配置任何 API Key，将使用本地回复')
  console.log('💡 请在 OpenClaw UI → 模型配置 页面添加供应商 API Key')
} else {
  console.log(`✅ 已配置 ${Object.keys(configuredProviders).length} 个供应商: ${Object.keys(configuredProviders).join(', ')}`)
}

// 根据 model key（格式: provider/modelValue）获取供应商配置
function resolveProviderFromModel(modelKey) {
  if (!modelKey || !modelKey.includes('/')) return null
  const [providerId, modelValue] = modelKey.split('/')
  const configured = getConfiguredProviders()
  const provider = configured[providerId]
  if (!provider) return null
  return {
    providerId,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    chatUrl: provider.chatUrl || `${provider.baseUrl}/chat/completions`,
    model: modelValue,
    isAnthropic: providerId === 'anthropic',
  }
}

// 本地回复生成函数
function generateLocalReply(message, history) {
  const lowerMsg = message.toLowerCase()
  
  // 根据关键词返回不同的回复
  if (lowerMsg.includes('你好') || lowerMsg.includes('hello')) {
    return '你好！我是 OpenClaw 助手，很高兴为你服务。有什么我可以帮助你的吗？'
  }
  if (lowerMsg.includes('help') || lowerMsg.includes('帮助')) {
    return '我可以帮你：\n\n1. **开发 Skills** - 创建自定义技能\n2. **管理配置** - 编辑 openclaw.json\n3. **处理文档** - Excel/PDF/Word\n4. **编写代码** - 各种编程语言\n5. **查询信息** - 天气、搜索等\n\n直接输入你的需求即可！'
  }
  if (lowerMsg.includes('skill') || lowerMsg.includes('技能')) {
    return '当前已安装 37 个 skills，包括：\n• code - 代码编写\n• weather - 天气查询\n• xlsx/pdf/docx - 文档处理\n• memory-guardian - 内存管理\n\n你可以在 Skills 管理页面查看全部。'
  }
  if (lowerMsg.includes('config') || lowerMsg.includes('配置')) {
    return 'OpenClaw 配置文件位于 `~/Lingshu/openclaw.json`\n\n主要配置项：\n• agents - 模型配置\n• skills - 技能加载路径\n• channels - 渠道配置\n\n你可以在配置管理页面编辑。'
  }
  if (lowerMsg.includes('weather') || lowerMsg.includes('天气')) {
    return '我可以帮你查询天气。请告诉我你想查询哪个城市的天气？'
  }
  if (lowerMsg.includes('code') || lowerMsg.includes('代码')) {
    return '我可以帮你编写代码。请告诉我：\n1. 使用什么编程语言？\n2. 需要实现什么功能？'
  }
  if (lowerMsg.includes('谢谢') || lowerMsg.includes('感谢')) {
    return '不客气！如果还有其他问题，随时告诉我。'
  }
  
  // 通用回复
  return `收到你的消息："${message}"\n\n这是一个本地生成的回复。要获得更智能的 AI 回复，请在「模型配置」页面添加至少一个供应商的 API Key（支持 StepFun、DeepSeek、OpenAI、Claude、豆包、通义千问、小米 MiMo 等）。\n\n当前历史消息数：${history.length} 条`
}

// 获取系统状态
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    uptime: '3天 12小时',
    version: '1.0.0',
    skills_count: 35,
    memory_usage: 45,
    cpu_usage: 12
  })
})

// 获取 skills 列表
app.get('/api/skills', (req, res) => {
  try {
    const skillsDir = SKILLS_DIR.replace('~', os.homedir())
    const skills = []

    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(skillsDir, entry.name)
          const skillMdPath = path.join(skillPath, 'SKILL.md')

          if (fs.existsSync(skillMdPath)) {
            const skillContent = fs.readFileSync(skillMdPath, 'utf8')
            const nameMatch = skillContent.match(/#\s*(.+)/)
            const descMatch = skillContent.match(/##?\s*Description\s*\n+(.+?)(?=\n##|\n*$)/s)
            const versionMatch = skillContent.match(/version[:\s]*([\d.]+)/i)

            let category = '其他'
            if (skillContent.includes('weather') || skillContent.includes('天气')) category = '工具'
            else if (skillContent.includes('code') || skillContent.includes('开发')) category = '开发'
            else if (skillContent.includes('xlsx') || skillContent.includes('pdf') || skillContent.includes('docx')) category = '文档'
            else if (skillContent.includes('channel') || skillContent.includes('渠道')) category = '配置'
            else if (skillContent.includes('memory') || skillContent.includes('guardian')) category = '系统'

            skills.push({
              id: entry.name,
              name: entry.name,
              version: versionMatch ? versionMatch[1] : '1.0.0',
              description: descMatch ? descMatch[1].trim().substring(0, 100) : (nameMatch ? nameMatch[1] : entry.name),
              status: 'active',
              category: category,
              installedAt: fs.statSync(skillPath).birthtime.toISOString().split('T')[0]
            })
          }
        }
      }
    }

    res.json(skills)
  } catch (error) {
    console.error('读取 skills 失败:', error)
    res.status(500).json({ error: '读取 skills 失败', message: error.message })
  }
})

// 安装 skill
app.post('/api/skills/install', (req, res) => {
  const { name } = req.body
  res.json({ success: true, message: `Skill ${name} 安装成功` })
})

// 卸载 skill
app.delete('/api/skills/:id', (req, res) => {
  const { id } = req.params
  res.json({ success: true, message: `Skill ${id} 卸载成功` })
})

// 获取配置
app.get('/api/config', (req, res) => {
  try {
    const configPath = OPENCLAW_CONFIG.replace('~', os.homedir())
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    res.json(config)
  } catch (error) {
    res.status(500).json({ error: '读取配置失败', message: error.message })
  }
})

// 保存配置
app.post('/api/config', (req, res) => {
  try {
    const configPath = OPENCLAW_CONFIG.replace('~', os.homedir())
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2))
    res.json({ success: true, message: '配置已保存' })
  } catch (error) {
    res.status(500).json({ error: '保存配置失败', message: error.message })
  }
})

// 获取日志
app.get('/api/logs', (req, res) => {
  const logs = [
    { id: '1', timestamp: '2024-05-21 10:30:15', level: 'info', source: 'skill:weather', message: '天气查询成功' },
    { id: '2', timestamp: '2024-05-21 10:25:30', level: 'info', source: 'channel:feishu', message: '收到消息' },
    { id: '3', timestamp: '2024-05-21 10:20:45', level: 'debug', source: 'system', message: '定时任务执行完成' },
    { id: '4', timestamp: '2024-05-21 10:15:00', level: 'warn', source: 'skill:memory-guardian', message: '内存使用超过阈值' },
    { id: '5', timestamp: '2024-05-21 10:10:20', level: 'error', source: 'channel:weixin', message: '连接失败' }
  ]
  res.json(logs)
})

// 获取会话列表
app.get('/api/sessions', (req, res) => {
  try {
    const sessions = []
    const files = fs.readdirSync(CHAT_DIR)
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const sessionId = file.replace('.json', '')
        const filePath = path.join(CHAT_DIR, file)
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        
        sessions.push({
          id: sessionId,
          title: data.title || '新会话',
          model: data.model || 'step-alpha',
          lastMessage: data.messages?.length > 0 ? data.messages[data.messages.length - 1].content.substring(0, 50) : '',
          timestamp: data.updatedAt || data.createdAt,
          messageCount: data.messages?.length || 0,
          isFavorite: data.isFavorite || false
        })
      }
    }
    
    // 按更新时间排序
    sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    
    res.json(sessions)
  } catch (error) {
    console.error('读取会话失败:', error)
    res.json([])
  }
})

// 获取单个会话
app.get('/api/sessions/:id', (req, res) => {
  try {
    const { id } = req.params
    const filePath = path.join(CHAT_DIR, `${id}.json`)
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '会话不存在' })
    }
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: '读取会话失败', message: error.message })
  }
})

// 创建新会话
app.post('/api/sessions', (req, res) => {
  try {
    const sessionId = `session-${Date.now()}`
    const sessionData = {
      id: sessionId,
      title: req.body.title || '新会话',
      model: req.body.model || 'step-alpha',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isFavorite: false
    }
    
    const filePath = path.join(CHAT_DIR, `${sessionId}.json`)
    fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2))
    
    res.json(sessionData)
  } catch (error) {
    res.status(500).json({ error: '创建会话失败', message: error.message })
  }
})

// 删除会话
app.delete('/api/sessions/:id', (req, res) => {
  try {
    const { id } = req.params
    const filePath = path.join(CHAT_DIR, `${id}.json`)
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: '删除会话失败', message: error.message })
  }
})

// 更新会话收藏状态
app.patch('/api/sessions/:id', (req, res) => {
  try {
    const { id } = req.params
    const filePath = path.join(CHAT_DIR, `${id}.json`)
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '会话不存在' })
    }
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    
    if (req.body.isFavorite !== undefined) {
      data.isFavorite = req.body.isFavorite
    }
    if (req.body.title) {
      data.title = req.body.title
    }
    
    data.updatedAt = new Date().toISOString()
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: '更新会话失败', message: error.message })
  }
})

// ====== 通用聊天函数 ======
async function chatWithProvider(modelKey, messages) {
  const resolved = resolveProviderFromModel(modelKey)
  if (!resolved) return null
  
  const { chatUrl, apiKey, model, isAnthropic } = resolved
  
  const headers = { 'Content-Type': 'application/json' }
  if (isAnthropic) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  
  const body = isAnthropic
    ? JSON.stringify({
        model,
        max_tokens: 2000,
        system: `你是一个在 OpenClaw 平台上运行的 AI 助手。当前使用的模型是 ${model}。当用户询问你的模型时请如实告知。`,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      })
    : JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `你是一个在 OpenClaw 平台上运行的 AI 助手。当前使用的模型是 ${model}。当用户询问你的模型时请如实告知。` },
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.7,
        max_tokens: 2000,
      })
  
  const response = await fetch(chatUrl, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(60000),
  })
  
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`)
  }
  
  const data = await response.json()
  
  if (isAnthropic) {
    return data.content?.[0]?.text || '抱歉，我没有理解你的问题。'
  }
  return data.choices?.[0]?.message?.content || '抱歉，我没有理解你的问题。'
}

// ====== Agent 管理 API ======

// 获取所有 agents
app.get('/api/instances/local/agents', (req, res) => {
  try {
    const config = readConfig()
    const agents = (config.agents?.list || []).map(a => ({
      ...a,
      description: a.description || '',
      lastActive: a.lastActive || '-',
      messageCount: a.messageCount || 0,
      createdAt: a.createdAt || new Date().toISOString(),
      config: {
        temperature: a.config?.temperature ?? 0.7,
        maxTokens: a.config?.maxTokens ?? 4000,
        systemPrompt: a.config?.systemPrompt || '',
        skills: a.config?.skills || []
      }
    }))
    res.json(agents)
  } catch (error) {
    res.status(500).json({ error: '获取 Agent 列表失败', message: error.message })
  }
})

// 创建新 agent
app.post('/api/instances/local/agents', (req, res) => {
  try {
    const config = readConfig()
    if (!config.agents) config.agents = {}
    if (!config.agents.list) config.agents.list = []

    const now = new Date().toISOString()
    const newAgent = {
      id: `agent-${Date.now()}`,
      name: req.body.name,
      description: req.body.description || '',
      model: req.body.model,
      status: 'stopped',
      createdAt: now,
      lastActive: now,
      messageCount: 0,
      config: {
        temperature: req.body.config?.temperature ?? 0.7,
        maxTokens: req.body.config?.maxTokens ?? 4000,
        systemPrompt: req.body.config?.systemPrompt || '',
        skills: req.body.config?.skills || []
      }
    }

    config.agents.list.push(newAgent)
    writeConfig(config)
    res.status(201).json(newAgent)
  } catch (error) {
    res.status(500).json({ error: '创建 Agent 失败', message: error.message })
  }
})

// 更新 agent
app.put('/api/instances/local/agents/:id', (req, res) => {
  try {
    const config = readConfig()
    const agents = config.agents?.list || []
    const idx = agents.findIndex(a => a.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Agent 不存在' })

    const existing = agents[idx]
    agents[idx] = {
      ...existing,
      name: req.body.name ?? existing.name,
      description: req.body.description ?? existing.description,
      model: req.body.model ?? existing.model,
      config: {
        ...existing.config,
        ...(req.body.config || {})
      }
    }

    writeConfig(config)
    res.json(agents[idx])
  } catch (error) {
    res.status(500).json({ error: '更新 Agent 失败', message: error.message })
  }
})

// 删除 agent
app.delete('/api/instances/local/agents/:id', (req, res) => {
  try {
    const config = readConfig()
    if (!config.agents?.list) return res.status(404).json({ error: 'Agent 不存在' })

    const agent = config.agents.list.find(a => a.id === req.params.id)
    if (!agent) return res.status(404).json({ error: 'Agent 不存在' })
    if (agent.default) return res.status(400).json({ error: '不能删除默认主 Agent' })

    config.agents.list = config.agents.list.filter(a => a.id !== req.params.id)
    writeConfig(config)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: '删除 Agent 失败', message: error.message })
  }
})

// 启动 agent
app.post('/api/instances/local/agents/:id/start', (req, res) => {
  try {
    const config = readConfig()
    const agent = config.agents?.list?.find(a => a.id === req.params.id)
    if (!agent) return res.status(404).json({ error: 'Agent 不存在' })

    agent.status = 'running'
    agent.lastActive = new Date().toISOString()
    writeConfig(config)
    res.json({ success: true, status: 'running' })
  } catch (error) {
    res.status(500).json({ error: '启动 Agent 失败', message: error.message })
  }
})

// 停止 agent
app.post('/api/instances/local/agents/:id/stop', (req, res) => {
  try {
    const config = readConfig()
    const agent = config.agents?.list?.find(a => a.id === req.params.id)
    if (!agent) return res.status(404).json({ error: 'Agent 不存在' })

    agent.status = 'stopped'
    agent.lastActive = new Date().toISOString()
    writeConfig(config)
    res.json({ success: true, status: 'stopped' })
  } catch (error) {
    res.status(500).json({ error: '停止 Agent 失败', message: error.message })
  }
})

// ====== 多 Agent 群聊 API ======
const GROUP_CHAT_DIR = path.join(os.homedir(), 'Lingshu', 'workspace', 'group-chat')
if (!fs.existsSync(GROUP_CHAT_DIR)) {
  fs.mkdirSync(GROUP_CHAT_DIR, { recursive: true })
}

// 获取所有群聊会话
app.get('/api/group-chat/sessions', (req, res) => {
  try {
    const files = fs.readdirSync(GROUP_CHAT_DIR).filter(f => f.endsWith('.json'))
    const sessions = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(GROUP_CHAT_DIR, f), 'utf8'))
      return {
        id: data.id,
        name: data.name || '群聊',
        participants: data.participants || [],
        messageCount: (data.messages || []).length,
        updatedAt: data.updatedAt || data.createdAt
      }
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    res.json(sessions)
  } catch (error) {
    res.status(500).json({ error: '获取群聊列表失败', message: error.message })
  }
})

// 获取单个群聊会话详情
app.get('/api/group-chat/sessions/:sessionId', (req, res) => {
  try {
    const filePath = path.join(GROUP_CHAT_DIR, `${req.params.sessionId}.json`)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '会话不存在' })
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: '获取群聊详情失败', message: error.message })
  }
})

// 创建新群聊会话
app.post('/api/group-chat/sessions', (req, res) => {
  try {
    const id = `group-${Date.now()}`
    const now = new Date().toISOString()
    const session = {
      id,
      name: req.body.name || '新群聊',
      participants: req.body.participants || [],
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    const filePath = path.join(GROUP_CHAT_DIR, `${id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8')
    res.status(201).json(session)
  } catch (error) {
    res.status(500).json({ error: '创建群聊失败', message: error.message })
  }
})

// 更新群聊会话（PATCH）
app.patch('/api/group-chat/sessions/:sessionId', (req, res) => {
  try {
    const filePath = path.join(GROUP_CHAT_DIR, `${req.params.sessionId}.json`)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '会话不存在' })
    }
    const session = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (req.body.name !== undefined) session.name = req.body.name
    if (req.body.participants !== undefined) session.participants = req.body.participants
    session.updatedAt = new Date().toISOString()
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8')
    res.json(session)
  } catch (error) {
    res.status(500).json({ error: '更新群聊失败', message: error.message })
  }
})

// 删除群聊会话
app.delete('/api/group-chat/sessions/:sessionId', (req, res) => {
  try {
    const filePath = path.join(GROUP_CHAT_DIR, `${req.params.sessionId}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      res.json({ success: true })
    } else {
      res.status(404).json({ error: '会话不存在' })
    }
  } catch (error) {
    res.status(500).json({ error: '删除群聊失败', message: error.message })
  }
})

// 发送群聊消息
app.post('/api/group-chat', async (req, res) => {
  const { participants, message, mentionAgent, mode, sessionId } = req.body
  if (!message) return res.status(400).json({ error: '消息不能为空' })
  if (!participants?.length) return res.status(400).json({ error: '至少需要一个参与者' })

  try {
    const responseMessages = []
    const now = new Date().toISOString()

    if (mode === 'round-robin' || mode === 'collaborative' || mode === 'free' || mode === 'all' || mode === 'sequential') {
      // 收集所有需要调用的 AI 参与者
      const aiParticipants = participants.filter(p => p.model)
      
      // 确定发送顺序：mentionAgent 优先，否则所有 AI 参与者
      let ordered = aiParticipants
      if (mentionAgent) {
        const mentioned = aiParticipants.find(p => p.agentId === mentionAgent)
        ordered = mentioned ? [mentioned] : aiParticipants
      }

      for (const p of ordered) {
        try {
          const reply = await chatWithProvider(p.model, [
            { role: 'user', content: message }
          ])
          responseMessages.push({
            id: `${Date.now()}-${p.agentId}`,
            role: 'assistant',
            sender: p.agentId,
            content: reply || `[${p.agentId}] 未能生成回复`,
            timestamp: new Date().toISOString()
          })
        } catch {
          responseMessages.push({
            id: `${Date.now()}-${p.agentId}`,
            role: 'assistant',
            sender: p.agentId,
            content: `[${p.agentId}] 调用失败`,
            timestamp: new Date().toISOString()
          })
        }
      }
    }

    // 保存到会话文件
    if (sessionId) {
      const filePath = path.join(GROUP_CHAT_DIR, `${sessionId}.json`)
      if (fs.existsSync(filePath)) {
        const session = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        session.messages = session.messages || []
        session.messages.push({
          id: Date.now().toString(),
          role: 'user',
          sender: 'You',
          content: message,
          timestamp: now
        })
        session.messages.push(...responseMessages)
        session.updatedAt = now
        fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8')
      }
    }

    res.json({ messages: responseMessages })
  } catch (error) {
    res.status(500).json({ error: '发送群聊消息失败', message: error.message })
  }
})

// 聊天 API
app.post('/api/chat', async (req, res) => {
  const { message, sessionId, model: modelKey } = req.body
  
  if (!message) {
    return res.status(400).json({ error: '消息不能为空' })
  }

  const effectiveModel = modelKey || 'stepfun/step-3.5-flash-2603'
  console.log('Chat request:', { model: effectiveModel, messageLength: message.length })

  try {
    const filePath = path.join(CHAT_DIR, `${sessionId}.json`)
    let sessionData = { 
      id: sessionId, 
      title: '新会话', 
      model: effectiveModel, 
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    
    if (fs.existsSync(filePath)) {
      sessionData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    }

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    }
    sessionData.messages.push(userMessage)

    let reply = ''
    
    try {
      reply = await chatWithProvider(effectiveModel, sessionData.messages)
      if (!reply) throw new Error('No provider configured')
    } catch (apiError) {
      console.error('API 调用失败:', apiError.message)
      reply = generateLocalReply(message, sessionData.messages)
    }

    const assistantMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: reply,
      timestamp: new Date().toISOString(),
      model: effectiveModel
    }
    sessionData.messages.push(assistantMessage)
    
    sessionData.updatedAt = new Date().toISOString()
    if (sessionData.messages.length === 2) {
      sessionData.title = message.substring(0, 20) + (message.length > 20 ? '...' : '')
    }
    
    fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2))

    res.json({
      reply: reply,
      model: effectiveModel,
      sessionId: sessionId,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Chat API error:', error)
    res.status(500).json({ error: '处理消息失败', message: error.message })
  }
})

// ====== 模型列表（从 openclaw.json providers 动态读取） ======
app.get('/api/models', (req, res) => {
  try {
    const configured = getConfiguredProviders()
    const models = []
    
    for (const [providerId, provider] of Object.entries(configured)) {
      for (const model of provider.models) {
        models.push({
          key: `${providerId}/${model.value}`,
          label: `${provider.name} - ${model.label}`,
          provider: providerId,
          providerName: provider.name,
          modelValue: model.value,
        })
      }
    }
    
    // 如果没有任何已配置的供应商，返回空列表
    if (models.length === 0) {
      return res.json({ models: [], warning: '请先在模型配置页面配置至少一个 API Key' })
    }
    
    res.json({ models })
  } catch (error) {
    console.error('读取模型列表失败:', error)
    res.status(500).json({ error: '读取模型列表失败', message: error.message })
  }
})

// ====== 测试供应商连接 ======
app.post('/api/config/test-provider', async (req, res) => {
  const { apiKey, baseUrl, model, provider: providerId } = req.body
  
  if (!apiKey) {
    return res.json({ success: false, error: '请先填写 API Key' })
  }
  
  try {
    const providerDef = PROVIDERS[providerId]
    if (!providerDef) {
      return res.json({ success: false, error: `未知供应商: ${providerId}` })
    }
    
    const chatUrl = providerDef.chatUrl || `${baseUrl}/chat/completions`
    
    // Anthropic 使用不同的 API 格式
    const isAnthropic = providerId === 'anthropic'
    const body = isAnthropic
      ? JSON.stringify({
          model: model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }]
        })
      : JSON.stringify({
          model: model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }]
        })
    
    const headers = {
      'Content-Type': 'application/json',
    }
    if (isAnthropic) {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
    
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    })
    
    if (response.ok) {
      res.json({ success: true })
    } else {
      const text = await response.text()
      const preview = text.substring(0, 300)
      res.json({ success: false, error: `HTTP ${response.status}: ${preview}` })
    }
  } catch (error) {
    res.json({ success: false, error: error.message || '连接超时或网络错误' })
  }
})

// ====== 系统设置 ======
app.get('/api/settings', (req, res) => {
  res.json({
    general: {
      language: 'zh',
      theme: 'light',
      fontSize: 14,
      autoScroll: true
    }
  })
})

// ====== 实例级会话路由（兼容前端 /api/instances/:instanceId/... 路径） ======
app.get('/api/instances/:instanceId/sessions', (req, res) => {
  try {
    const sessions = []
    const files = fs.readdirSync(CHAT_DIR)
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const sessionId = file.replace('.json', '')
        const filePath = path.join(CHAT_DIR, file)
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        
        sessions.push({
          id: sessionId,
          title: data.title || '新会话',
          model: data.model || 'step-alpha',
          lastMessage: data.messages?.length > 0 ? data.messages[data.messages.length - 1].content.substring(0, 50) : '',
          timestamp: data.updatedAt || data.createdAt,
          messageCount: data.messages?.length || 0,
          isFavorite: data.isFavorite || false
        })
      }
    }
    
    sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    res.json(sessions)
  } catch (error) {
    console.error('读取会话失败:', error)
    res.json([])
  }
})

app.post('/api/instances/:instanceId/sessions', (req, res) => {
  try {
    const sessionId = `session-${Date.now()}`
    const sessionData = {
      id: sessionId,
      title: req.body.title || '新会话',
      model: req.body.model || 'step-alpha',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isFavorite: false
    }
    
    const filePath = path.join(CHAT_DIR, `${sessionId}.json`)
    fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2))
    res.json(sessionData)
  } catch (error) {
    res.status(500).json({ error: '创建会话失败', message: error.message })
  }
})

app.get('/api/instances/:instanceId/sessions/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params
    const filePath = path.join(CHAT_DIR, `${sessionId}.json`)
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '会话不存在' })
    }
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: '读取会话失败', message: error.message })
  }
})

app.delete('/api/instances/:instanceId/sessions/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params
    const filePath = path.join(CHAT_DIR, `${sessionId}.json`)
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: '删除会话失败', message: error.message })
  }
})

app.patch('/api/instances/:instanceId/sessions/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params
    const filePath = path.join(CHAT_DIR, `${sessionId}.json`)
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '会话不存在' })
    }
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    
    if (req.body.isFavorite !== undefined) {
      data.isFavorite = req.body.isFavorite
    }
    if (req.body.title) {
      data.title = req.body.title
    }
    
    data.updatedAt = new Date().toISOString()
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: '更新会话失败', message: error.message })
  }
})

app.post('/api/instances/:instanceId/sessions/:sessionId/chat', async (req, res) => {
  const { message, model: modelKey } = req.body
  const { sessionId } = req.params
  
  if (!message) {
    return res.status(400).json({ error: '消息不能为空' })
  }

  const effectiveModel = modelKey || 'stepfun/step-3.5-flash-2603'

  try {
    const filePath = path.join(CHAT_DIR, `${sessionId}.json`)
    let sessionData = { 
      id: sessionId, 
      title: '新会话', 
      model: effectiveModel, 
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    
    if (fs.existsSync(filePath)) {
      sessionData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    }

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    }
    sessionData.messages.push(userMessage)

    let reply = ''
    
    try {
      reply = await chatWithProvider(effectiveModel, sessionData.messages)
      if (!reply) throw new Error('No provider configured')
    } catch (apiError) {
      console.error('API 调用失败:', apiError.message)
      reply = generateLocalReply(message, sessionData.messages)
    }

    const assistantMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: reply,
      timestamp: new Date().toISOString(),
      model: effectiveModel
    }
    sessionData.messages.push(assistantMessage)
    
    sessionData.updatedAt = new Date().toISOString()
    if (sessionData.messages.length === 2) {
      sessionData.title = message.substring(0, 20) + (message.length > 20 ? '...' : '')
    }
    
    fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2))

    res.json({
      reply: reply,
      model: effectiveModel,
      sessionId: sessionId,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Chat API error:', error)
    res.status(500).json({ error: '处理消息失败', message: error.message })
  }
})

// ====== 文件上传 ======
app.post('/api/instances/:instanceId/files/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未上传文件' })
  }
  res.json({
    url: `/uploads/${req.file.filename}`,
    filePath: req.file.path,
    originalName: req.file.originalname,
    size: req.file.size
  })
})

// ====== 原 /api/chat 路由（兼容旧版） ======
app.post('/api/restart', (req, res) => {
  exec('openclaw gateway restart', (error, stdout, stderr) => {
    if (error) {
      res.status(500).json({ error: '重启失败', message: error.message })
    } else {
      res.json({ success: true, message: 'OpenClaw 已重启' })
    }
  })
})

// 静态文件托管：端口 3005 可直接访问前端（生产构建）
const distDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'dist')
app.use(express.static(distDir))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  const indexPath = path.join(distDir, 'index.html')
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath)
  } else {
    next()
  }
})

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 OpenClaw API Server running on port ${PORT}`)
  console.log(`📱 API: http://localhost:${PORT}/api`)
  console.log(`💬 Chat history: ${CHAT_DIR}`)
})
// ====== 获取供应商定义（前端可调用，避免前后端重复维护） ======
app.get('/api/providers', (req, res) => {
  const configured = getConfiguredProviders()
  const result = {}
  for (const [id, p] of Object.entries(PROVIDERS)) {
    result[id] = {
      ...p,
      hasApiKey: !!configured[id]?.apiKey,
    }
  }
  res.json(result)
})
