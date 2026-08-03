const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const os = require('os')

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const app = express()
const PORT = process.env.PORT || 3005

app.use(cors())
app.use(express.json())

const DATA_DIR = path.join(os.homedir(), 'Lingshu', 'workspace', 'openclaw-web-ui-data')
const INSTANCES_FILE = path.join(DATA_DIR, 'instances.json')
const CHAT_DIR = path.join(DATA_DIR, 'chat-history')

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
if (!fs.existsSync(CHAT_DIR)) fs.mkdirSync(CHAT_DIR, { recursive: true })

const DEFAULT_INSTANCES = [
  {
    id: 'local', name: '本地灵枢运行时', type: 'local', status: 'connected',
    configPath: '~/Lingshu/openclaw.json', workspacePath: '~/Lingshu/workspace',
    description: '当前机器上的灵枢运行实例', lastConnected: new Date().toISOString()
  },
  {
    id: 'agent-desktop', name: 'Agent 桌面端', type: 'agent-desktop', status: 'disconnected',
    configPath: '~/Lingshu/openclaw.json', workspacePath: '~/Lingshu/workspace',
    description: '本机 Agent 桌面端连接', lastConnected: ''
  }
]

function loadInstances() {
  try {
    if (fs.existsSync(INSTANCES_FILE)) {
      const data = JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf8'))
      return data.instances || DEFAULT_INSTANCES
    }
  } catch (e) { console.error('加载实例失败:', e) }
  return DEFAULT_INSTANCES
}

function saveInstances(instances) {
  try {
    fs.writeFileSync(INSTANCES_FILE, JSON.stringify({ instances, updatedAt: new Date().toISOString() }, null, 2))
  } catch (e) { console.error('保存实例失败:', e) }
}

let instances = loadInstances()

// ==================== Skills 扫描 ====================

function parseSkillFrontmatter(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return null
    const fm = match[1]
    let name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim()
    let desc = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim()
    // 回退：如果 YAML 头部没有 name，从正文标题和第一段提取
    if (!name) {
      const afterFm = content.slice(match[0].length).trim()
      const headingMatch = afterFm.match(/^#\s+(.+)$/m)
      if (headingMatch) name = headingMatch[1].trim()
      if (!desc) {
        // 取标题后第一段非空文字作为描述
        const bodyStart = afterFm.indexOf(headingMatch[0]) + headingMatch[0].length
        const paraMatch = afterFm.slice(bodyStart).match(/\n\s*\n(.+)/)
        if (paraMatch) desc = paraMatch[1].trim().replace(/\n/g, ' ')
      }
    }
    const descFinal = desc?.replace(/^>\s*/, '').trim() || ''
    return name ? { name, description: descFinal } : null
  } catch { return null }
}

// 从技能目录中找到 SKILL.md 或 *.skill.md 文件
function findSkillMd(dirPath) {
  const standard = path.join(dirPath, 'SKILL.md')
  if (fs.existsSync(standard)) return standard
  try {
    const entries = fs.readdirSync(dirPath)
    const alt = entries.find(f => f.endsWith('.skill.md'))
    if (alt) return path.join(dirPath, alt)
  } catch {}
  return null
}

function collectSkills() {
  const skillsMap = new Map()
  try {
    const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
    if (!fs.existsSync(configPath)) return []
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const extraDirs = config?.skills?.load?.extraDirs || []
    // 始终包含用户 skills 目录
    const userSkillsDir = path.join(os.homedir(), 'Lingshu', 'skills')
    if (fs.existsSync(userSkillsDir) && !extraDirs.includes(userSkillsDir)) {
      extraDirs.push(userSkillsDir)
    }
    for (const dir of extraDirs) {
      if (!fs.existsSync(dir)) continue
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const mdPath = findSkillMd(path.join(dir, entry.name))
        if (!mdPath) continue
        const parsed = parseSkillFrontmatter(mdPath)
        if (parsed && !skillsMap.has(parsed.name)) skillsMap.set(parsed.name, parsed)
      }
    }
    const entriesObj = config?.skills?.entries || {}
    for (const [name, entry] of Object.entries(entriesObj)) {
      if (entry.enabled === false) skillsMap.delete(name)
      else if (!skillsMap.has(name)) skillsMap.set(name, { name, description: '' })
    }
  } catch (e) { console.error('collectSkills error:', e.message) }
  return Array.from(skillsMap.values())
}

function buildSystemPrompt(modelName, provider) {
  const skills = collectSkills()
  let prompt = ''
  if (modelName) {
    const providerMap = { deepseek: 'DeepSeek', xiaomi: '小米', stepfun: '阶跃星辰', anthropic: 'Anthropic', openai: 'OpenAI', qwen: '阿里云', glm: '智谱AI', doubao: '火山引擎' }
    const providerName = providerMap[provider] || provider
    prompt += `你是 ${modelName} 模型，由 ${providerName} 提供。\n\n`
  }
  if (skills.length > 0) {
    const skillLines = skills.map(s =>
      `- **${s.name}**${s.description ? ': ' + s.description : ''}`
    ).join('\n')
    prompt += `当前挂载了以下 Skills（技能）。当用户询问你的能力或技能时，必须严格列出这些实际挂载的 Skills，不要编造不存在的能力。

## 已挂载的 Skills

${skillLines}

你可以使用这些 Skills 来协助用户完成任务。对于不涉及 Skills 的常规问题，按正常方式回答即可。`
  }
  return prompt
}

// ==================== API 路由 ====================

// GET /api/instances
app.get('/api/instances', (req, res) => { res.json(instances) })

// POST /api/instances
app.post('/api/instances', (req, res) => {
  const { name, type, host, port, configPath, description } = req.body
  const newInstance = {
    id: `instance-${Date.now()}`, name, type, host, port, configPath, description,
    status: 'disconnected', createdAt: new Date().toISOString()
  }
  instances.push(newInstance)
  saveInstances(instances)
  res.json(newInstance)
})

// PATCH /api/instances/:id
app.patch('/api/instances/:id', (req, res) => {
  const index = instances.findIndex(i => i.id === req.params.id)
  if (index === -1) return res.status(404).json({ error: '实例不存在' })
  instances[index] = { ...instances[index], ...req.body, updatedAt: new Date().toISOString() }
  saveInstances(instances)
  res.json(instances[index])
})

// DELETE /api/instances/:id
app.delete('/api/instances/:id', (req, res) => {
  instances = instances.filter(i => i.id !== req.params.id)
  saveInstances(instances)
  res.json({ success: true })
})

// POST /api/instances/:id/test
app.post('/api/instances/:id/test', (req, res) => {
  const instance = instances.find(i => i.id === req.params.id)
  if (!instance) return res.status(404).json({ error: '实例不存在' })
  try {
    if (instance.type === 'local' || instance.type === 'agent-desktop' || instance.type === 'stepfun-desktop') {
      const configPath = instance.configPath.replace('~', os.homedir())
      if (fs.existsSync(configPath)) {
        instance.status = 'connected'
        instance.lastConnected = new Date().toISOString()
        saveInstances(instances)
        res.json({ success: true, status: 'connected' })
      } else {
        instance.status = 'error'; saveInstances(instances)
        res.json({ success: false, status: 'error', message: '配置文件不存在' })
      }
    } else if (instance.type === 'remote') {
      res.json({ success: true, status: 'connected' })
    } else {
      res.json({ success: false, status: 'unknown', message: '未知实例类型' })
    }
  } catch (error) {
    res.status(500).json({ error: '测试连接失败', message: error.message })
  }
})

// GET /api/instances/:id/config
app.get('/api/instances/:id/config', (req, res) => {
  const instance = instances.find(i => i.id === req.params.id)
  if (!instance) return res.status(404).json({ error: '实例不存在' })
  try {
    const configPath = instance.configPath.replace('~', os.homedir())
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    res.json(config)
  } catch (error) {
    res.status(500).json({ error: '读取配置失败', message: error.message })
  }
})

// POST /api/instances/:id/config
app.post('/api/instances/:id/config', (req, res) => {
  const instance = instances.find(i => i.id === req.params.id)
  if (!instance) return res.status(404).json({ error: '实例不存在' })
  try {
    const configPath = instance.configPath.replace('~', os.homedir())
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2))
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: '保存配置失败', message: error.message })
  }
})

// POST /api/instances/:id/restart
app.post('/api/instances/:id/restart', (req, res) => {
  const instance = instances.find(i => i.id === req.params.id)
  if (!instance) return res.status(404).json({ error: '实例不存在' })
  if (instance.type === 'local' || instance.type === 'agent-desktop' || instance.type === 'stepfun-desktop') {
    exec('openclaw gateway restart', (error, stdout, stderr) => {
      if (error) res.status(500).json({ error: '重启失败', message: error.message })
      else res.json({ success: true, message: 'OpenClaw 已重启' })
    })
  } else {
    res.json({ success: false, message: '远程实例重启暂未实现' })
  }
})

// GET /api/instances/:id/logs — 读取真实日志文件
app.get('/api/instances/:id/logs', (req, res) => {
  try {
    const logPaths = [
      path.join(os.homedir(), 'Lingshu', 'logs', 'openclaw.log'),
      path.join(os.homedir(), 'Lingshu', 'logs', 'gateway.log')
    ]
    const logEntries = []
    for (const logPath of logPaths) {
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf8')
        const lines = content.split('\n').filter(Boolean)
        for (const line of lines) {
          const match = line.match(/\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})[^\]]*\]\s*\[?(\w+)\]?\s*(.+)/i)
          if (match) {
            logEntries.push({
              id: `log-${logEntries.length + 1}`, timestamp: match[1].replace('T', ' '),
              level: match[2].toLowerCase(), source: path.basename(logPath, '.log'), message: match[3].trim()
            })
          } else {
            logEntries.push({
              id: `log-${logEntries.length + 1}`, timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
              level: 'info', source: path.basename(logPath, '.log'), message: line.substring(0, 200)
            })
          }
        }
      }
    }
    logEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    res.json(logEntries.length > 0 ? logEntries.slice(0, 500) : [])
  } catch (error) { res.json([]) }
})

// GET /api/logs（兼容旧版）
app.get('/api/logs', (req, res) => {
  try {
    const logPaths = [
      path.join(os.homedir(), 'Lingshu', 'logs', 'openclaw.log'),
      path.join(os.homedir(), 'Lingshu', 'logs', 'gateway.log')
    ]
    const logEntries = []
    for (const logPath of logPaths) {
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf8')
        const lines = content.split('\n').filter(Boolean)
        for (const line of lines) {
          const match = line.match(/\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})[^\]]*\]\s*\[?(\w+)\]?\s*(.+)/i)
          if (match) {
            logEntries.push({
              id: `log-${logEntries.length + 1}`, timestamp: match[1].replace('T', ' '),
              level: match[2].toLowerCase(), source: path.basename(logPath, '.log'), message: match[3].trim()
            })
          } else {
            logEntries.push({
              id: `log-${logEntries.length + 1}`, timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
              level: 'info', source: path.basename(logPath, '.log'), message: line.substring(0, 200)
            })
          }
        }
      }
    }
    logEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    res.json(logEntries.slice(0, 500))
  } catch (error) { res.json([]) }
})

// DELETE /api/logs — 清空日志文件（C-03 fix）
app.delete('/api/logs', (req, res) => {
  const logPaths = [
    path.join(os.homedir(), 'Lingshu', 'logs', 'openclaw.log'),
    path.join(os.homedir(), 'Lingshu', 'logs', 'gateway.log')
  ]
  let clearedFiles = 0
  for (const logPath of logPaths) {
    try {
      if (fs.existsSync(logPath)) {
        fs.truncateSync(logPath, 0)
        clearedFiles++
      }
    } catch (_) {}
  }
  res.json({ success: true, clearedFiles })
})

// GET /api/config（兼容旧版）
app.get('/api/config', (req, res) => {
  const localInstance = instances.find(i => i.id === 'local') || DEFAULT_INSTANCES.find(i => i.id === 'local')
  if (!localInstance) return res.status(404).json({ error: '本地实例不存在' })
  try {
    const configPath = localInstance.configPath.replace('~', os.homedir())
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    res.json(config)
  } catch (error) {
    res.status(500).json({ error: '读取配置失败', message: error.message })
  }
})

// POST /api/config（兼容旧版）
app.post('/api/config', (req, res) => {
  const localInstance = instances.find(i => i.id === 'local') || DEFAULT_INSTANCES.find(i => i.id === 'local')
  if (!localInstance) return res.status(404).json({ error: '本地实例不存在' })
  try {
    const configPath = localInstance.configPath.replace('~', os.homedir())
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2))
    res.json({ success: true, message: '配置已保存' })
  } catch (error) {
    res.status(500).json({ error: '保存配置失败', message: error.message })
  }
})

// PUT /api/config/providers/:providerId — PATCH 语义，仅更新单个 provider
app.put('/api/config/providers/:providerId', (req, res) => {
  const localInstance = instances.find(i => i.id === 'local') || DEFAULT_INSTANCES.find(i => i.id === 'local')
  if (!localInstance) return res.status(404).json({ error: '本地实例不存在' })
  try {
    const configPath = localInstance.configPath.replace('~', os.homedir())
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    if (!config.providers) config.providers = {}
    config.providers[req.params.providerId] = {
      ...(config.providers[req.params.providerId] || {}),
      ...req.body
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    res.json({ success: true, provider: config.providers[req.params.providerId] })
  } catch (error) {
    res.status(500).json({ error: '保存配置失败', message: error.message })
  }
})

// ==================== Provider Test 缓存与辅助函数 ====================

const crypto = require('crypto')
const providerModelCache = new Map() // key: hash(baseUrl+apiKey), value: { models, timestamp }

function getCacheKey(baseUrl, apiKey) {
  return crypto.createHash('sha256').update(baseUrl + '\x00' + apiKey).digest('hex')
}

function getCachedModels(cacheKey, ttlMs = 5 * 60 * 1000) {
  const entry = providerModelCache.get(cacheKey)
  if (!entry) return null
  if (Date.now() - entry.timestamp > ttlMs) {
    providerModelCache.delete(cacheKey)
    return null
  }
  return entry.models
}

function setCachedModels(cacheKey, models) {
  providerModelCache.set(cacheKey, { models, timestamp: Date.now() })
}

// ==================== 统一 Provider 适配层 ====================

/**
 * 统一 AI Provider 调用：封装 Anthropic 协议与 OpenAI 兼容协议的差异
 * @param {object} params
 * @param {string} params.provider - 'anthropic' | 'openai' | 其他
 * @param {string} params.apiKey
 * @param {string} params.baseUrl
 * @param {string} params.model
 * @param {array}  params.messages - [{role, content}]
 * @param {object} [params.options] - {maxTokens, temperature, ...}
 * @returns {{success: boolean, data?: {text: string, raw: object}, error?: string, statusCode?: number}}
 */
function callProviderAI(params) {
  const { provider, apiKey, baseUrl, model, messages, options = {} } = params
  const { execSync } = require('child_process')
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '')
  const isAnthropic = provider === 'anthropic'
  const maxTokens = options.maxTokens || 4000
  const temperature = options.temperature ?? 0.7

  let curlCmd

  if (isAnthropic) {
    // Anthropic Messages API: 分离 system 消息，转换 content 为 [{type:'text', text}] 结构
    const systemMessages = messages.filter(m => m.role === 'system')
    const conversationMessages = messages.filter(m => m.role !== 'system')
    // 转换 OpenAI vision format → Anthropic image format
    const convertContent = (content) => {
      if (typeof content === 'string') return [{ type: 'text', text: content }]
      if (!Array.isArray(content)) return content
      return content.map(part => {
        if (part.type === 'image_url' && part.image_url?.url?.startsWith('data:')) {
          const [header, data] = part.image_url.url.split(',')
          const mediaType = (header.match(/data:(.+);base64/) || [])[1] || 'image/jpeg'
          return { type: 'image', source: { type: 'base64', media_type: mediaType, data } }
        }
        return part
      })
    }
    const anthropicMessages = conversationMessages.map(m => ({
      role: m.role,
      content: convertContent(m.content)
    }))
    const bodyObj = { model, messages: anthropicMessages, max_tokens: maxTokens }
    if (systemMessages.length > 0) {
      bodyObj.system = systemMessages.map(m => m.content).join('\n\n')
    }
    const escapedBody = JSON.stringify(bodyObj).replace(/'/g, "'\\''")
    const authHeader = apiKey.startsWith('gw-') ? `Authorization: Bearer ${apiKey}` : `x-api-key: ${apiKey}`
    curlCmd = `curl -s -w '\\n%{http_code}' -X POST '${cleanBaseUrl}/v1/messages' -H 'Content-Type: application/json' -H '${authHeader}' -H 'anthropic-version: 2023-06-01' -H 'User-Agent: claude-cli/1.0.0' -d '${escapedBody}' --max-time 60`
  } else {
    // OpenAI 兼容协议: /chat/completions + Bearer
    const bodyObj = { model, messages, max_tokens: maxTokens, temperature }
    const escapedBody = JSON.stringify(bodyObj).replace(/'/g, "'\\''")
    curlCmd = `curl -s -w '\\n%{http_code}' -X POST '${cleanBaseUrl}/chat/completions' -H 'Content-Type: application/json' -H 'Authorization: Bearer ${apiKey}' -H 'User-Agent: OpenClaw/1.0' -d '${escapedBody}' --max-time 60`
  }

  try {
    console.log('[callProviderAI] provider:', provider, 'model:', model)
    const output = execSync(curlCmd, { timeout: 65000, encoding: 'utf8' })
    const lines = output.trim().split('\n')
    const statusCode = parseInt(lines[lines.length - 1], 10)
    const bodyStr = lines.slice(0, -1).join('\n')
    let data
    try { data = JSON.parse(bodyStr) } catch { data = bodyStr }

    if (statusCode >= 200 && statusCode < 300) {
      // 统一解析两种响应格式 → {text: '...'}
      const text = isAnthropic
        ? (data?.content?.[0]?.text || '')
        : (data?.choices?.[0]?.message?.content || '')
      return { success: true, data: { text, raw: data }, statusCode }
    }
    return {
      success: false,
      error: (typeof data === 'object' ? data?.error?.message : null) || `HTTP ${statusCode}`,
      statusCode,
      data: { raw: data }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 获取 Provider 可用模型列表（带 5 分钟缓存）
 * @param {object} params
 * @param {string} params.provider
 * @param {string} params.apiKey
 * @param {string} params.baseUrl
 * @returns {string[] | null} 模型 ID 数组
 */
function fetchProviderModels(params) {
  const { provider, apiKey, baseUrl } = params
  if (!baseUrl || !apiKey) return null

  const cacheKey = getCacheKey(baseUrl, apiKey)
  const cached = getCachedModels(cacheKey)
  if (cached !== null) {
    console.log('[fetchProviderModels] cache hit, count:', cached.length)
    return cached
  }

  const { execSync } = require('child_process')
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '')
  const isAnthropic = provider === 'anthropic'

  try {
    let cmd
    if (isAnthropic) {
      const authHeader = apiKey.startsWith('gw-') ? `Authorization: Bearer ${apiKey}` : `x-api-key: ${apiKey}`
      cmd = `curl -s -X GET '${cleanBaseUrl}/v1/models' -H '${authHeader}' -H 'anthropic-version: 2023-06-01' -H 'User-Agent: claude-cli/1.0.0' --max-time 10`
    } else {
      cmd = `curl -s -X GET '${cleanBaseUrl}/models' -H 'Authorization: Bearer ${apiKey}' --max-time 10`
    }
    const output = execSync(cmd, { timeout: 12000, encoding: 'utf8' })
    const data = JSON.parse(output)
    if (data.data && Array.isArray(data.data)) {
      const models = data.data.map(m => m.id).filter(id => typeof id === 'string')
      setCachedModels(cacheKey, models)
      console.log('[fetchProviderModels] fetched', models.length, 'models, cached')
      return models
    }
    console.log('[fetchProviderModels] unexpected response format')
  } catch (e) {
    console.log('[fetchProviderModels] failed:', e.message)
  }
  return null
}

// POST /api/config/test-provider — 后端代理测试连接（M-02 fix，重构为统一 ProviderClient）
app.post('/api/config/test-provider', (req, res) => {
  const { baseUrl, apiKey, model, provider } = req.body
  console.log('[test-provider HIT]', JSON.stringify({baseUrl, model, provider, apiKeyLen: apiKey?.length}))
  if (!baseUrl || !apiKey) {
    return res.status(400).json({ error: '缺少 baseUrl 或 apiKey' })
  }

  let availableModels = null
  let overallSuccess = false
  let overallMessage = ''
  let testMessageResult = null

  try {
    const isAnthropic = provider === 'anthropic'
    const requestedModel = model || (isAnthropic ? 'claude-sonnet-4-20250514' : 'default')

    // ── 第 1 步：获取可用模型列表 ──
    availableModels = fetchProviderModels({ provider, apiKey, baseUrl })

    // ── 第 2 步：基于模型列表判定 overall success ──
    if (isAnthropic && availableModels !== null) {
      if (availableModels.includes(requestedModel)) {
        overallSuccess = true
        overallMessage = '连接成功（模型已在可用列表中）'
      } else {
        overallSuccess = false
        overallMessage = `模型 "${requestedModel}" 不在可用列表中`
      }
    } else if (!isAnthropic && availableModels === null) {
      overallSuccess = null // 待定，等测试消息结果
    } else {
      overallSuccess = null
    }

    // ── 第 3 步：发送测试消息 ──
    const tmResult = callProviderAI({
      provider,
      apiKey,
      baseUrl,
      model: requestedModel,
      messages: [{ role: 'user', content: 'Hi' }],
      options: { maxTokens: 5 }
    })

    testMessageResult = tmResult.success
      ? { status: 'ok', reply: tmResult.data.text }
      : { status: 'error', statusCode: tmResult.statusCode, error: tmResult.error }

    // ── 第 4 步：合并判定 ──
    if (overallSuccess === null) {
      overallSuccess = testMessageResult.status === 'ok'
      overallMessage = overallSuccess ? '连接成功' : (testMessageResult.error || '连接失败')
    }

    res.json({
      success: overallSuccess,
      message: overallMessage,
      availableModels,
      testMessageResult
    })
  } catch (e) {
    res.json({
      success: false,
      error: e.message,
      availableModels,
      testMessageResult
    })
  }
})

// ==================== 聊天 API ====================

// 文件上传（M-01 fix：支持 multipart 上传替代 base64 嵌入）
const multer = require('multer')
const uploadDir = path.join(os.homedir(), 'Lingshu', 'chat-attachments')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `upload-${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`)
  }
})
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } })

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' })
  const url = `/uploads/${req.file.filename}`
  res.json({ success: true, url, filename: req.file.originalname })
})

app.use('/uploads', express.static(uploadDir))

app.get('/api/instances/:id/sessions', (req, res) => {
  const sessions = []
  try {
    const instanceChatDir = path.join(CHAT_DIR, req.params.id)
    if (fs.existsSync(instanceChatDir)) {
      const files = fs.readdirSync(instanceChatDir)
      for (const file of files) {
        if (file.endsWith('.json')) {
          const sessionId = file.replace('.json', '')
          const data = JSON.parse(fs.readFileSync(path.join(instanceChatDir, file), 'utf8'))
          sessions.push({
            id: sessionId, title: data.title || '新会话', model: data.model || 'step-alpha',
            lastMessage: data.messages?.length > 0 ? data.messages[data.messages.length - 1].content.substring(0, 50) : '',
            timestamp: data.updatedAt || data.createdAt, messageCount: data.messages?.length || 0,
            isFavorite: data.isFavorite || false
          })
        }
      }
    }
    sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    res.json(sessions)
  } catch (error) { res.json([]) }
})

app.post('/api/instances/:id/sessions', (req, res) => {
  const sessionId = `session-${Date.now()}`
  const sessionData = {
    id: sessionId, instanceId: req.params.id, title: req.body.title || '新会话',
    model: req.body.model || 'step-alpha', messages: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isFavorite: false
  }
  const instanceChatDir = path.join(CHAT_DIR, req.params.id)
  if (!fs.existsSync(instanceChatDir)) fs.mkdirSync(instanceChatDir, { recursive: true })
  fs.writeFileSync(path.join(instanceChatDir, `${sessionId}.json`), JSON.stringify(sessionData, null, 2))
  res.json(sessionData)
})

app.get('/api/instances/:instanceId/sessions/:sessionId', (req, res) => {
  const filePath = path.join(CHAT_DIR, req.params.instanceId, `${req.params.sessionId}.json`)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '会话不存在' })
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')))
})

app.delete('/api/instances/:instanceId/sessions/:sessionId', (req, res) => {
  const filePath = path.join(CHAT_DIR, req.params.instanceId, `${req.params.sessionId}.json`)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '会话不存在' })
  try { fs.unlinkSync(filePath); res.json({ success: true }) }
  catch (error) { res.status(500).json({ error: '删除会话失败', message: error.message }) }
})

app.patch('/api/instances/:instanceId/sessions/:sessionId', (req, res) => {
  const filePath = path.join(CHAT_DIR, req.params.instanceId, `${req.params.sessionId}.json`)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '会话不存在' })
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const updated = { ...data, ...req.body, updatedAt: new Date().toISOString() }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2))
    res.json(updated)
  } catch (error) { res.status(500).json({ error: '更新会话失败', message: error.message }) }
})

// POST /api/instances/:instanceId/sessions/:sessionId/chat（核心端点）
app.post('/api/instances/:instanceId/sessions/:sessionId/chat', async (req, res) => {
  const { instanceId, sessionId } = req.params
  const { message, model, provider } = req.body
  if (!message) return res.status(400).json({ error: '消息不能为空' })

  const instance = instances.find(i => i.id === instanceId)
  if (!instance) return res.status(404).json({ error: '实例不存在' })

  const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  const filePath = path.join(CHAT_DIR, instanceId, `${sessionId}.json`)
  let sessionData
  if (fs.existsSync(filePath)) {
    sessionData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (model) sessionData.model = model
    if (provider) sessionData.provider = provider
  } else {
    sessionData = {
      id: sessionId, instanceId, title: '新会话',
      model: model || 'step-alpha', provider: provider || 'stepfun',
      messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
  }

  const userMessage = { id: Date.now().toString(), role: 'user', content: message, timestamp: new Date().toISOString() }
  sessionData.messages.push(userMessage)

  let reply = ''
  let modelName = sessionData.model || 'step-alpha'
  const providerId = sessionData.provider || 'stepfun'
  const modelParts = modelName.split('/')
  const actualProvider = modelParts.length > 1 ? modelParts[0] : providerId
  const actualModel = modelParts.length > 1 ? modelParts[1] : modelName

  try {
    let apiKey = null, baseUrl = null
    if (config.providers && config.providers[actualProvider]) {
      apiKey = config.providers[actualProvider].apiKey
      baseUrl = config.providers[actualProvider].baseUrl
    }
    if (config.models?.providers && config.models.providers[actualProvider]) {
      const sysConfig = config.models.providers[actualProvider]
      if (!apiKey) apiKey = sysConfig.apiKey
      if (!baseUrl) baseUrl = sysConfig.baseUrl
    }
    if (!apiKey) {
      reply = `[${instance.name}] 未配置 ${actualProvider} API Key\n\n请在模型配置页面配置 API Key。`
    } else {
      const systemPrompt = buildSystemPrompt(modelName, actualProvider)
      const knowledgeContext = getKnowledgeContext(message)
      let fullSystemPrompt = systemPrompt || ''
      if (knowledgeContext) {
        fullSystemPrompt += `\n\n${knowledgeContext}`
      }
      const messages = sessionData.messages.map(m => ({ role: m.role, content: m.content }))
      if (fullSystemPrompt) messages.unshift({ role: 'system', content: fullSystemPrompt })

      baseUrl = baseUrl || 'https://api.openai.com/v1'

      // 预处理消息：将 Markdown 图片语法替换为 base64 vision content
      const processedMessages = messages.map(m => {
        if (m.role !== 'user' || typeof m.content !== 'string') return m
        const imgRegex = /!\[[^\]]*\]\(\/uploads\/([^)]+)\)/g
        const matches = [...m.content.matchAll(imgRegex)]
        if (matches.length === 0) return m
        // 构建 vision content 数组
        const content = []
        let lastIdx = 0
        const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
        for (const match of matches) {
          if (match.index > lastIdx) {
            content.push({ type: 'text', text: m.content.slice(lastIdx, match.index).trim() })
          }
          const filename = match[1]
          const ext = path.extname(filename).toLowerCase()
          // 非图片文件：尝试提取内容（zip/tar 等），避免模型盲猜路径
          if (!imageExts.includes(ext)) {
            const filePath = path.join(uploadDir, filename)
            if (ext === '.zip' && fs.existsSync(filePath)) {
              try {
                // 用 Python 提取 zip 内文本文件内容
                const { execSync: syncExec } = require('child_process')
                const escPath = filePath.replace(/'/g, "'\\''")
                const pyScript = `
import zipfile, os
z = zipfile.ZipFile('${escPath}')
parts = []
for name in z.namelist():
    if not name.endswith('/') and (name.endswith('.md') or name.endswith('.json') or name.endswith('.yaml') or name.endswith('.yml') or name.endswith('.txt')):
        try:
            data = z.read(name).decode('utf-8')[:3000]
            ext = name.rsplit('.',1)[-1] if '.' in name else ''
            parts.append(f"### {name}\n\`\`\`{ext}\n{data}\n\`\`\`")
        except: pass
if parts:
    print(f"\\n--- ZIP 文件内容: ${filename} ---")
    print("\\n".join(parts))
else:
    print(f"\\n[ZIP 文件: ${filename}，未找到可读文本]")
`
                const output = syncExec(`python3 -c "${pyScript.replace(/"/g, '\\"')}"`, { timeout: 10000, encoding: 'utf8', maxBuffer: 512 * 1024 })
                content.push({ type: 'text', text: output.substring(0, 8000) })
              } catch (e) {
                console.error('ZIP 提取失败:', e.message)
                content.push({ type: 'text', text: `[文件: ${filename}]` })
              }
            } else {
              content.push({ type: 'text', text: `[文件: ${filename}]` })
            }
            lastIdx = match.index + match[0].length
            continue
          }
          const imgPath = path.join(uploadDir, filename)
          if (fs.existsSync(imgPath)) {
            try {
              const imgData = fs.readFileSync(imgPath)
              const base64 = imgData.toString('base64')
              const mimeType = filename.endsWith('.png') ? 'image/png' : filename.endsWith('.gif') ? 'image/gif' : filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
              content.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } })
            } catch (e) { console.error('图片读取失败:', imgPath, e.message) }
          }
          lastIdx = match.index + match[0].length
        }
        if (lastIdx < m.content.length) {
          content.push({ type: 'text', text: m.content.slice(lastIdx).trim() })
        }
        return content.length > 0 ? { role: 'user', content: content.length === 1 ? content[0].text || content[0] : content } : m
      })

      const result = callProviderAI({
        provider: actualProvider,
        apiKey,
        baseUrl,
        model: actualModel,
        messages: processedMessages,
        options: { maxTokens: 4000, temperature: 0.7 }
      })

      if (result.success) {
        let rawReply = result.data.text || '无回复'
        // 检测 XML 格式工具调用（如 <tool_call>），拦截避免泄露给用户
        if (/<tool_call>/.test(rawReply)) {
          console.log('[chat] 拦截 XML 工具调用')
          // 尝试提取并执行 Python 代码
          const codeMatch = rawReply.match(/<parameter=code>([\s\S]*?)<\/parameter>/)
          if (codeMatch && codeMatch[1]) {
            const pythonCode = codeMatch[1].trim()
            const { execSync: syncExec } = require('child_process')
            const tmpFile = path.join(os.tmpdir(), `oc-tool-${Date.now()}.py`)
            try {
              fs.writeFileSync(tmpFile, pythonCode, 'utf8')
              const output = syncExec(`python3 "${tmpFile}"`, { timeout: 15000, encoding: 'utf8', maxBuffer: 512 * 1024, cwd: uploadDir })
              rawReply = `执行结果：\n\`\`\`\n${output.trim().substring(0, 3000)}\n\`\`\``
            } catch (cmdErr) {
              rawReply = `命令执行失败：${cmdErr.stderr || cmdErr.message}`
            } finally {
              try { fs.unlinkSync(tmpFile) } catch {}
            }
          } else {
            rawReply = '当前模型尝试使用了不支持的调用方式，已过滤。请尝试换个方式提问。'
          }
        }
        // 检测模型是否返回了工具调用 JSON（而非自然语言回复），避免泄露给用户
        else if (/^\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"/.test(rawReply)) {
          try {
            const toolCall = JSON.parse(rawReply.trim())
            console.log('[chat] 模型返回工具调用:', toolCall.name)
            // 尝试用 shell_executor 执行 bash 命令
            if (toolCall.name === 'bash' && toolCall.arguments?.command) {
              const { execSync: syncExec } = require('child_process')
              try {
                const cmdOutput = syncExec(toolCall.arguments.command, { timeout: 30000, encoding: 'utf8', maxBuffer: 1024 * 1024 })
                rawReply = `执行结果：\n\`\`\`\n${cmdOutput.trim().substring(0, 3000)}\n\`\`\``
              } catch (cmdErr) {
                rawReply = `命令执行失败：${cmdErr.message}`
              }
            } else {
              rawReply = `模型尝试调用工具「${toolCall.name}」，但该工具当前不可用。请尝试换个方式提问。`
            }
          } catch {
            rawReply = '模型返回了无法处理的调用格式，请尝试重新提问。'
          }
        }
        reply = rawReply
        modelName = actualModel
      } else {
        console.error(`${actualProvider} API 错误:`, result.error)
        reply = `[${actualProvider}] 调用失败：${result.statusCode || ''}\n\n${result.error}\n\n请检查：\n1. API Key 是否正确\n2. Base URL 是否正确（${baseUrl}）\n3. 模型名称是否正确（${actualModel}）`
      }
    }
  } catch (error) {
    console.error('调用 AI 失败:', error)
    let errorHint = ''
    if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED') || error.message?.includes('connect ECONNREFUSED')) {
      errorHint = '本地服务未运行，请确保 OpenClaw 已启动'
    } else if (error.cause?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || error.cause?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error.message?.includes('SSL') || error.message?.includes('certificate')) {
      errorHint = 'SSL 证书验证失败，请检查网络代理或证书配置'
    } else if (error.cause?.code === 'ENOTFOUND' || error.message?.includes('ENOTFOUND')) {
      errorHint = '无法解析域名，请检查网络连接和 DNS 配置'
    } else if (error.cause?.code === 'ETIMEDOUT' || error.message?.includes('ETIMEDOUT')) {
      errorHint = '连接超时，请检查网络状况或防火墙设置'
    } else {
      errorHint = `网络连接失败：${error.message}`
    }
    reply = `[${instance.name}] 调用失败\n\n${errorHint}`
  }
  const assistantMessage = {
    id: (Date.now() + 1).toString(), role: 'assistant', content: reply,
    timestamp: new Date().toISOString(), model: modelName
  }
  sessionData.messages.push(assistantMessage)
  sessionData.updatedAt = new Date().toISOString()
  if (sessionData.messages.length === 2) {
    sessionData.title = message.substring(0, 20) + (message.length > 20 ? '...' : '')
  }
  fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2))

  res.json({
    reply, model: modelName, provider: actualProvider, requestedModel: sessionData.model,
    instance: { id: instance.id, name: instance.name, type: instance.type },
    usage: { totalMessages: sessionData.messages.length },
    timestamp: new Date().toISOString()
  })
})

// ==================== Skills 管理 ====================

app.get('/api/skills', (req, res) => {
  try {
    const skillsDir = path.join(os.homedir(), 'Lingshu', 'skills')
    const skills = []
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillMdPath = findSkillMd(path.join(skillsDir, entry.name))
          if (skillMdPath) {
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
              id: entry.name, name: entry.name,
              version: versionMatch ? versionMatch[1] : '1.0.0',
              description: descMatch ? descMatch[1].trim().substring(0, 100) : (nameMatch ? nameMatch[1] : entry.name),
              status: 'active', category,
              installedAt: fs.statSync(path.join(skillsDir, entry.name)).birthtime.toISOString().split('T')[0]
            })
          }
        }
      }
    }
    res.json(skills)
  } catch (error) { res.status(500).json({ error: '读取 skills 失败', message: error.message }) }
})

app.get('/api/instances/:id/skills', (req, res) => {
  try {
    const skillsDir = path.join(os.homedir(), 'Lingshu', 'skills')
    const skills = []
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillMdPath = findSkillMd(path.join(skillsDir, entry.name))
          if (skillMdPath) {
            const skillContent = fs.readFileSync(skillMdPath, 'utf8')
            const nameMatch = skillContent.match(/#\s*(.+)/)
            skills.push({ id: entry.name, name: entry.name, description: nameMatch ? nameMatch[1] : entry.name, status: 'active' })
          }
        }
      }
    }
    res.json(skills)
  } catch (error) { res.status(500).json({ error: '读取 skills 失败', message: error.message }) }
})

// POST /api/skills/install — 安装 Skill（支持输入名称/URL + 文件上传）
const skillsUpload = multer({ dest: path.join(os.homedir(), 'Lingshu', 'tmp') })
app.post('/api/skills/install', skillsUpload.single('file'), (req, res) => {
  try {
    const input = req.body.input || ''
    const file = req.file
    const skillsDir = path.join(os.homedir(), 'Lingshu', 'skills')

    // 如果上传了文件，解压到 skills 目录
    if (file) {
      const { execSync } = require('child_process')
      const skillName = path.basename(file.originalname, path.extname(file.originalname)).replace('.tar', '')
      const destDir = path.join(skillsDir, skillName)
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
      try {
        execSync(`tar -xzf "${file.path}" -C "${destDir}"`, { stdio: 'pipe' })
        fs.unlinkSync(file.path)
        return res.json({ success: true, name: skillName })
      } catch (tarErr) {
        // 尝试 zip 解压
        try {
          execSync(`unzip -o "${file.path}" -d "${destDir}"`, { stdio: 'pipe' })
          fs.unlinkSync(file.path)
          return res.json({ success: true, name: skillName })
        } catch (zipErr) {
          fs.unlinkSync(file.path)
          return res.status(400).json({ error: '无法解压文件，仅支持 .zip / .tar.gz' })
        }
      }
    }

    // 处理输入字符串：GitHub repo 或内置 skill 名称
    if (!input) return res.status(400).json({ error: '请输入 Skill 名称或上传文件' })

    if (input.includes('github.com') || input.includes('/')) {
      // GitHub 仓库
      const { execSync } = require('child_process')
      const repoName = input.split('/').pop() || 'skill'
      const destDir = path.join(skillsDir, repoName)
      if (fs.existsSync(destDir)) return res.status(409).json({ error: 'Skill 已存在' })
      try {
        execSync(`git clone ${input} "${destDir}"`, { stdio: 'pipe' })
        return res.json({ success: true, name: repoName, source: input })
      } catch (gitErr) {
        return res.status(400).json({ error: 'Git 克隆失败，请检查仓库地址' })
      }
    }

    // 内置 skill 名称
    const skillPath = path.join(os.homedir(), 'Lingshu', 'skills', input)
    if (fs.existsSync(skillPath)) return res.status(409).json({ error: 'Skill 已存在' })

    // 检查内置 skills 模板
    const templates = {
      weather: { name: '天气预报', description: '查询各地天气信息' },
      calculator: { name: '计算器', description: '执行数学计算' },
      translator: { name: '翻译', description: '多语言翻译服务' },
      websearch: { name: '网页搜索', description: '搜索互联网信息' },
      fileops: { name: '文件操作', description: '本地文件读写管理' },
    }

    const template = templates[input.toLowerCase()]
    if (!template) return res.status(400).json({ error: `未知的内置 Skill: ${input}。支持: ${Object.keys(templates).join(', ')}` })

    const destDir = path.join(skillsDir, input)
    fs.mkdirSync(destDir, { recursive: true })
    writeFile(path.join(destDir, 'SKILL.md'), `# ${template.name}\n\nversion: 1.0.0\n\n## Description\n\n${template.description}\n\n## Usage\n\n待配置...\n`)
    return res.json({ success: true, name: input })
  } catch (error) {
    res.status(500).json({ error: '安装失败', message: error.message })
  }
})

// POST /api/instances/:id/skills/:skillName/execute
app.post('/api/instances/:id/skills/:skillName/execute', (req, res) => {
  const instance = instances.find(i => i.id === req.params.id)
  if (!instance) return res.status(404).json({ error: '实例不存在' })
  if (instance.type !== 'local' && instance.type !== 'agent-desktop' && instance.type !== 'stepfun-desktop') {
    return res.status(403).json({ error: '只有本地运行时或 Agent 桌面端可以执行技能' })
  }
  const { params = '' } = req.body
  const command = `export OPENCLAW_STATE_DIR=${os.homedir()}/Lingshu && export PATH=${os.homedir()}/Lingshu/bin:$PATH && openclaw skills run ${req.params.skillName} "${params}"`
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Skill 执行失败:', error)
      res.status(500).json({ success: false, error: error.message, stderr })
    } else {
      res.json({ success: true, output: stdout, skill: req.params.skillName, params })
    }
  })
})

// DELETE /api/skills/:id — 卸载 skill（C-01 fix）
app.delete('/api/skills/:id', (req, res) => {
  const skillsDir = path.join(os.homedir(), 'Lingshu', 'skills')
  const skillDir = path.join(skillsDir, req.params.id)
  if (!fs.existsSync(skillDir)) return res.status(404).json({ error: 'Skill 不存在' })
  try {
    fs.rmSync(skillDir, { recursive: true, force: true })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: '卸载失败', message: error.message })
  }
})

// POST /api/skills/:id/reload — 重新加载 skill（C-02 fix）
app.post('/api/skills/:id/reload', (req, res) => {
  const skillsDir = path.join(os.homedir(), 'Lingshu', 'skills')
  const skillDir = path.join(skillsDir, req.params.id)
  if (!fs.existsSync(skillDir)) return res.status(404).json({ error: 'Skill 不存在' })
  exec(`export OPENCLAW_STATE_DIR=${os.homedir()}/Lingshu && export PATH=${os.homedir()}/Lingshu/bin:$PATH && openclaw skills reload ${req.params.id}`, (error, stdout, stderr) => {
    if (error) {
      res.status(500).json({ success: false, error: error.message, stderr })
    } else {
      res.json({ success: true, skill: req.params.id, output: stdout })
    }
  })
})

// POST /api/instances/:id/apps/:appName/open
app.post('/api/instances/:id/apps/:appName/open', (req, res) => {
  const instance = instances.find(i => i.id === req.params.id)
  if (!instance) return res.status(404).json({ error: '实例不存在' })
  const commands = {
    feishu: 'open -a "Lark" || open -a "飞书"', wechat: 'open -a "WeChat" || open -a "微信"',
    chrome: 'open -a "Google Chrome"', safari: 'open -a "Safari"',
    terminal: 'open -a "Terminal"', finder: 'open -a "Finder"', vscode: 'open -a "Visual Studio Code"'
  }
  const command = commands[req.params.appName] || `open -a "${req.params.appName}"`
  exec(command, (error) => {
    if (error) res.status(500).json({ success: false, error: error.message })
    else res.json({ success: true, app: req.params.appName })
  })
})

// ==================== 系统指标 ====================

// CPU 使用率：基于两次采样差值计算（真实 CPU 占用百分比）
function getCPUUsage() {
  const cpus = os.cpus()
  let totalIdle = 0, totalTick = 0
  cpus.forEach(cpu => {
    for (const type in cpu.times) totalTick += cpu.times[type]
    totalIdle += cpu.times.idle
  })
  return { idle: totalIdle, total: totalTick }
}

let lastCPUMeasure = getCPUUsage()

// GET /api/system/stats — 返回真实系统指标
app.get('/api/system/stats', (req, res) => {
  const current = getCPUUsage()
  const idleDelta = current.idle - lastCPUMeasure.idle
  const totalDelta = current.total - lastCPUMeasure.total
  lastCPUMeasure = current
  const cpuUsagePercent = totalDelta > 0 ? Math.round(((totalDelta - idleDelta) / totalDelta) * 100) : 0

  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem

  res.json({
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    cpuUsage: cpuUsagePercent,
    memoryTotal: totalMem,
    memoryUsed: usedMem,
    memoryUsagePercent: Math.round((usedMem / totalMem) * 100),
    uptime: os.uptime(),
    platform: os.platform(),
    hostname: os.hostname()
  })
})

// ==================== Dashboard API ====================

app.get('/api/dashboard/stats', (req, res) => {
  try {
    const skillsDir = path.join(os.homedir(), 'Lingshu', 'skills')
    let totalSkills = 0, activeSkills = 0
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      totalSkills = entries.filter(e => e.isDirectory()).length
      activeSkills = totalSkills
    }
    let totalSessions = 0, activeSessions = 0
    const now = Date.now(), oneDayMs = 24 * 60 * 60 * 1000
    if (fs.existsSync(CHAT_DIR)) {
      const instanceDirs = fs.readdirSync(CHAT_DIR, { withFileTypes: true }).filter(e => e.isDirectory())
      for (const dir of instanceDirs) {
        const instanceChatDir = path.join(CHAT_DIR, dir.name)
        const files = fs.readdirSync(instanceChatDir).filter(f => f.endsWith('.json'))
        totalSessions += files.length
        for (const file of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(instanceChatDir, file), 'utf8'))
            if (now - new Date(data.updatedAt || data.createdAt).getTime() < oneDayMs) activeSessions++
          } catch (_) {}
        }
      }
    }
    const connectedInstances = instances.filter(i => i.status === 'connected')
    const agents = loadAgentsFromConfig() || []
    const totalAgents = agents.length
    const runningAgents = agents.filter(a => a.status === 'running').length
    const uptimeSeconds = os.uptime()
    const days = Math.floor(uptimeSeconds / 86400), hours = Math.floor((uptimeSeconds % 86400) / 3600), minutes = Math.floor((uptimeSeconds % 3600) / 60)
    const systemUptime = days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`

    // 使用双采样差值法计算真实 CPU 使用率
    const currentCPU = getCPUUsage()
    const idleDelta = currentCPU.idle - lastCPUMeasure.idle
    const totalDelta = currentCPU.total - lastCPUMeasure.total
    lastCPUMeasure = currentCPU
    const cpuUsage = totalDelta > 0 ? Math.round(((totalDelta - idleDelta) / totalDelta) * 100) : 0

    const memoryUsage = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
    res.json({
      totalAgents, runningAgents,
      totalSessions, activeSessions, totalSkills, activeSkills,
      systemUptime, cpuUsage, memoryUsage
    })
  } catch (error) { res.status(500).json({ error: '获取统计信息失败', message: error.message }) }
})

app.get('/api/dashboard/activity', (req, res) => {
  try {
    const activities = []
    if (fs.existsSync(CHAT_DIR)) {
      const instanceDirs = fs.readdirSync(CHAT_DIR, { withFileTypes: true }).filter(e => e.isDirectory())
      for (const dir of instanceDirs) {
        const instanceChatDir = path.join(CHAT_DIR, dir.name)
        if (!fs.existsSync(instanceChatDir)) continue
        const files = fs.readdirSync(instanceChatDir).filter(f => f.endsWith('.json'))
        for (const file of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(instanceChatDir, file), 'utf8'))
            if (data.messages && data.messages.length > 0) {
              activities.push({
                id: `${dir.name}-${file.replace('.json', '')}`, type: 'info',
                message: `${data.title || '会话'}: ${data.messages[data.messages.length - 1].content.substring(0, 80)}`,
                time: data.updatedAt || data.createdAt
              })
            }
          } catch (_) {}
        }
      }
    }
    activities.sort((a, b) => new Date(b.time) - new Date(a.time))
    res.json(activities.slice(0, 10))
  } catch (error) { res.status(500).json({ error: '获取活动记录失败', message: error.message }) }
})

// ==================== Agents API ====================

function loadAgentsFromConfig() {
  try {
    const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
    if (!fs.existsSync(configPath)) return null
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    if (config.agents) {
      const defaultModel = config.models?.defaults?.model || 'step-alpha'
      // 优先解析 agents.list 数组（OpenClaw 标准格式）
      if (config.agents.list && Array.isArray(config.agents.list)) {
        return config.agents.list.map((a, i) => ({
          id: a.id || a.name || `agent-${i}`,
          name: a.name || a.id || `Agent ${i + 1}`,
          status: a.status || 'stopped',
          model: a.model || defaultModel,
          lastActive: a.lastActive || null, messageCount: a.messageCount || 0, uptime: a.uptime || '0h'
        }))
      }
      if (Array.isArray(config.agents)) {
        return config.agents.map((a, i) => ({
          id: a.id || a.name || `agent-${i}`,
          name: a.name || a.id || `Agent ${i + 1}`,
          status: a.status || 'stopped',
          model: a.model || defaultModel,
          lastActive: a.lastActive || null, messageCount: a.messageCount || 0, uptime: a.uptime || '0h'
        }))
      } else if (typeof config.agents === 'object') {
        // 旧格式：agents 对象（排除内部元数据键如 defaults/list）
        return Object.entries(config.agents)
          .filter(([key, val]) => typeof val === 'object' && val !== null && !Array.isArray(val) && key !== 'defaults')
          .map(([key, val]) => ({
            id: key, name: val.name || key, status: val.status || 'stopped',
            model: val.model || defaultModel,
            lastActive: val.lastActive || null, messageCount: val.messageCount || 0, uptime: val.uptime || '0h'
          }))
      }
    }
  } catch (_) {}
  return null
}

app.get('/api/instances/:id/agents', (req, res) => {
  if (!instances.find(i => i.id === req.params.id)) return res.status(404).json({ error: '实例不存在' })
  const agents = loadAgentsFromConfig()
  if (agents !== null) return res.json(agents)
  res.json([])
})

app.put('/api/instances/:id/agents/:agentId', (req, res) => {
  if (!instances.find(i => i.id === req.params.id)) return res.status(404).json({ error: '实例不存在' })
  try {
    const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
    if (!fs.existsSync(configPath)) return res.status(404).json({ error: '配置文件不存在' })
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    let found = false
    // 优先更新 agents.list 数组中的条目
    if (config.agents?.list && Array.isArray(config.agents.list)) {
      for (let i = 0; i < config.agents.list.length; i++) {
        const agentId = config.agents.list[i].id || config.agents.list[i].name || `agent-${i}`
        if (agentId === req.params.agentId) {
          config.agents.list[i] = { ...config.agents.list[i], ...req.body }
          found = true
          break
        }
      }
    }
    if (!found && config.agents && Array.isArray(config.agents)) {
      for (let i = 0; i < config.agents.length; i++) {
        if ((config.agents[i].id || config.agents[i].name || `agent-${i}`) === req.params.agentId) {
          config.agents[i] = { ...config.agents[i], ...req.body }; found = true; break
        }
      }
    }
    if (!found && config.agents && typeof config.agents === 'object') {
      if (config.agents[req.params.agentId]) {
        config.agents[req.params.agentId] = { ...config.agents[req.params.agentId], ...req.body }; found = true
      }
    }
    if (!found) return res.status(404).json({ error: 'Agent 不存在' })
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: '更新 Agent 失败', message: error.message }) }
})

// POST /api/instances/:id/agents — 新增 Agent
app.post('/api/instances/:id/agents', (req, res) => {
  if (!instances.find(i => i.id === req.params.id)) return res.status(404).json({ error: '实例不存在' })
  try {
    const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
    if (!fs.existsSync(configPath)) return res.status(404).json({ error: '配置文件不存在' })
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    // 确保 agents 和 agents.list 结构存在
    if (!config.agents) config.agents = {}
    if (!config.agents.list) config.agents.list = []
    const newAgent = {
      id: req.body.id || `agent-${Date.now()}`,
      name: req.body.name || 'New Agent',
      model: req.body.model || config.models?.defaults?.model || 'step-alpha',
      status: req.body.status || 'stopped',
      ...req.body
    }
    config.agents.list.push(newAgent)
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    res.json(newAgent)
  } catch (error) { res.status(500).json({ error: '创建 Agent 失败', message: error.message }) }
})

app.post('/api/instances/:id/agents/:agentId/start', (req, res) => {
  if (!instances.find(i => i.id === req.params.id)) return res.status(404).json({ error: '实例不存在' })
  res.json({ success: true, agentId: req.params.agentId, status: 'running', message: `Agent ${req.params.agentId} 已启动` })
})

app.post('/api/instances/:id/agents/:agentId/stop', (req, res) => {
  if (!instances.find(i => i.id === req.params.id)) return res.status(404).json({ error: '实例不存在' })
  res.json({ success: true, agentId: req.params.agentId, status: 'stopped', message: `Agent ${req.params.agentId} 已停止` })
})

app.delete('/api/instances/:id/agents/:agentId', (req, res) => {
  if (!instances.find(i => i.id === req.params.id)) return res.status(404).json({ error: '实例不存在' })
  try {
    const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
    if (!fs.existsSync(configPath)) return res.status(404).json({ error: '配置文件不存在' })
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    let found = false
    if (config.agents && Array.isArray(config.agents)) {
      config.agents = config.agents.filter((a, i) => {
        if ((a.id || a.name || `agent-${i}`) === req.params.agentId) { found = true; return false }
        return true
      })
    } else if (config.agents && typeof config.agents === 'object') {
      if (config.agents[req.params.agentId]) { delete config.agents[req.params.agentId]; found = true }
    }
    if (!found) return res.status(404).json({ error: 'Agent 不存在' })
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: '删除 Agent 失败', message: error.message }) }
})

// ==================== 兼容旧 API ====================

app.get('/api/agents', (req, res) => {
  const agents = loadAgentsFromConfig()
  if (agents !== null) return res.json(agents)
  res.json([{
    id: 'default-agent', name: 'OpenClaw Agent', status: 'running', model: 'step-alpha',
    lastActive: new Date().toISOString(),
    messageCount: instances.reduce((sum, i) => sum + (i.messageCount || 0), 0), uptime: '24h'
  }])
})

app.get('/api/sessions/active', (req, res) => {
  try {
    const activeSessions = []
    const now = Date.now(), oneDayMs = 24 * 60 * 60 * 1000
    if (fs.existsSync(CHAT_DIR)) {
      const instanceDirs = fs.readdirSync(CHAT_DIR, { withFileTypes: true }).filter(e => e.isDirectory())
      for (const dir of instanceDirs) {
        const instanceChatDir = path.join(CHAT_DIR, dir.name)
        if (!fs.existsSync(instanceChatDir)) continue
        const files = fs.readdirSync(instanceChatDir).filter(f => f.endsWith('.json'))
        for (const file of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(instanceChatDir, file), 'utf8'))
            if (now - new Date(data.updatedAt || data.createdAt).getTime() < oneDayMs) {
              activeSessions.push({
                id: file.replace('.json', ''), agentId: data.instanceId || dir.name,
                agentName: data.title || '会话', status: 'active', startTime: data.createdAt,
                lastMessage: data.messages?.length > 0 ? data.messages[data.messages.length - 1].content.substring(0, 80) : '',
                messageCount: data.messages?.length || 0
              })
            }
          } catch (_) {}
        }
      }
    }
    activeSessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    res.json(activeSessions)
  } catch (error) { res.json([]) }
})

// ==================== 工作流管理 API ====================

const WORKFLOWS_FILE = path.join(DATA_DIR, 'workflows.json')

const DEFAULT_WORKFLOWS = [{
  id: 'wf-daily-report', name: '每日报告生成',
  description: '每天定时采集数据 → Agent 分析 → 生成报告 → 推送飞书',
  status: 'draft', mode: 'sequential',
  nodes: [
    { id: 'n1', type: 'input', name: '定时触发', config: { cron: '0 8 * * *' } },
    { id: 'n2', type: 'agent', name: '数据采集 Agent', config: { agentId: 'main', prompt: '采集今日数据' } },
    { id: 'n3', type: 'agent', name: '报告生成 Agent', config: { agentId: 'main', prompt: '生成分析报告' } },
    { id: 'n4', type: 'skill', name: '飞书推送', config: { skillId: 'feishu', params: {} } },
    { id: 'n5', type: 'output', name: '输出报告', config: { format: 'markdown' } }
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' }, { id: 'e2', source: 'n2', target: 'n3' },
    { id: 'e3', source: 'n3', target: 'n4' }, { id: 'e4', source: 'n4', target: 'n5' }
  ],
  createdAt: '2026-06-01', updatedAt: '2026-06-10'
}]

function loadWorkflows() {
  try {
    if (fs.existsSync(WORKFLOWS_FILE)) return JSON.parse(fs.readFileSync(WORKFLOWS_FILE, 'utf8'))
  } catch (_) {}
  return DEFAULT_WORKFLOWS
}

function saveWorkflows(workflows) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(workflows, null, 2), 'utf8')
}

function executeNode(node, context) {
  return new Promise(resolve => {
    setTimeout(() => resolve({
      nodeId: node.id, nodeName: node.name, type: node.type,
      status: 'completed', output: `${node.name} 执行完成`, timestamp: new Date().toISOString()
    }), node.type === 'delay' ? (node.config.ms || 1000) : 200 + Math.random() * 800)
  })
}

async function executeWorkflow(workflow) {
  const results = [], startTime = Date.now()
  try {
    if (workflow.mode === 'parallel') {
      const sourceSet = new Set(workflow.edges.map(e => e.source))
      const targetSet = new Set(workflow.edges.map(e => e.target))
      const roots = workflow.nodes.filter(n => sourceSet.has(n.id) && !targetSet.has(n.id))
      const leafs = workflow.nodes.filter(n => targetSet.has(n.id) && !sourceSet.has(n.id))
      const middleNodes = workflow.nodes.filter(n => !roots.includes(n) && !leafs.includes(n))
      const middleResults = await Promise.all(middleNodes.map(n => executeNode(n, results)))
      results.push(...middleResults.filter(Boolean))
      for (const leaf of leafs) { const r = await executeNode(leaf, results); if (r) results.push(r) }
    } else if (workflow.mode === 'conditional') {
      for (const node of workflow.nodes) {
        if (node.type === 'condition') {
          const outgoing = workflow.edges.filter(e => e.source === node.id)
          const matchedEdge = outgoing.find(e => e.condition) || outgoing[0]
          if (matchedEdge) {
            const nextNode = workflow.nodes.find(n => n.id === matchedEdge.target)
            if (nextNode) { const r = await executeNode(nextNode, results); if (r) results.push(r) }
          }
        } else if (node.type === 'output') {
          const r = await executeNode(node, results); if (r) results.push(r)
        }
      }
    } else {
      const edgeMap = {}; workflow.edges.forEach(e => { edgeMap[e.source] = e.target })
      let currentNodeId = workflow.nodes.find(n => n.type === 'input')?.id || workflow.nodes[0]?.id
      while (currentNodeId) {
        const node = workflow.nodes.find(n => n.id === currentNodeId)
        if (!node) break
        const r = await executeNode(node, results); if (r) results.push(r)
        currentNodeId = edgeMap[currentNodeId]
      }
    }
    return { success: true, results, duration: Date.now() - startTime }
  } catch (error) {
    return { success: false, error: error.message, results, duration: Date.now() - startTime }
  }
}

app.get('/api/workflows', (req, res) => { res.json(loadWorkflows()) })

app.post('/api/workflows', (req, res) => {
  const workflows = loadWorkflows()
  const newWorkflow = { ...req.body, updatedAt: new Date().toISOString().split('T')[0] }
  workflows.unshift(newWorkflow); saveWorkflows(workflows)
  res.json(newWorkflow)
})

app.put('/api/workflows/:id', (req, res) => {
  const workflows = loadWorkflows()
  const idx = workflows.findIndex(w => w.id === req.params.id)
  if (idx >= 0) {
    workflows[idx] = { ...workflows[idx], ...req.body, updatedAt: new Date().toISOString().split('T')[0] }
    saveWorkflows(workflows); res.json(workflows[idx])
  } else { res.status(404).json({ error: '未找到工作流' }) }
})

app.delete('/api/workflows/:id', (req, res) => {
  saveWorkflows(loadWorkflows().filter(w => w.id !== req.params.id))
  res.json({ success: true })
})

app.post('/api/workflows/:id/run', (req, res) => {
  const workflows = loadWorkflows()
  const wf = workflows.find(w => w.id === req.params.id)
  if (!wf) return res.status(404).json({ error: '未找到工作流' })
  wf.status = 'running'; wf.lastRunAt = new Date().toISOString().split('T')[0]; saveWorkflows(workflows)
  executeWorkflow(wf).then(result => {
    const updated = loadWorkflows(); const target = updated.find(w => w.id === wf.id)
    if (target) { target.status = result.success ? 'completed' : 'failed'; saveWorkflows(updated) }
  }).catch(() => {
    const updated = loadWorkflows(); const target = updated.find(w => w.id === wf.id)
    if (target) { target.status = 'failed'; saveWorkflows(updated) }
  })
  res.json({ success: true, message: '工作流已启动' })
})

// ==================== 记忆系统 API ====================

const MEMORY_DIR = path.join(DATA_DIR, 'memory')
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.json')

if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true })
if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, JSON.stringify({ memories: {} }, null, 2))

function loadMemory() {
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) }
  catch (_) { return { memories: {} } }
}

function saveMemory(data) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2))
}

// ==================== Obsidian 知识库集成 ====================

const DEFAULT_OBSIDIAN_SETTINGS = {
  enabled: false,
  vaultPath: '',
  includeFolders: [''],
  excludeFolders: ['.obsidian', '.git', 'node_modules', '.trash'],
  maxResults: 5,
  writeMemoryEnabled: true
}

function expandHome(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return ''
  if (inputPath === '~') return os.homedir()
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2))
  return inputPath
}

function isPathInside(parent, target) {
  const relative = path.relative(parent, target)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function normalizeFolderList(value, fallback = []) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split('\n').map(v => v.trim()).filter(Boolean)
  return fallback
}

function getObsidianConfig() {
  const settings = loadSettings()
  const raw = { ...DEFAULT_OBSIDIAN_SETTINGS, ...(settings.obsidian || {}) }
  const vaultPath = raw.vaultPath ? path.resolve(expandHome(raw.vaultPath)) : ''
  return {
    ...raw,
    vaultPath,
    includeFolders: normalizeFolderList(raw.includeFolders, DEFAULT_OBSIDIAN_SETTINGS.includeFolders),
    excludeFolders: normalizeFolderList(raw.excludeFolders, DEFAULT_OBSIDIAN_SETTINGS.excludeFolders),
    maxResults: Math.min(Math.max(Number(raw.maxResults) || 5, 1), 12),
    writeMemoryEnabled: raw.writeMemoryEnabled !== false
  }
}

function validateObsidianVault(config = getObsidianConfig()) {
  if (!config.enabled) return { ok: false, reason: '未启用 Obsidian 集成' }
  if (!config.vaultPath) return { ok: false, reason: '未配置 Vault 路径' }
  if (!fs.existsSync(config.vaultPath)) return { ok: false, reason: 'Vault 路径不存在' }
  const stat = fs.statSync(config.vaultPath)
  if (!stat.isDirectory()) return { ok: false, reason: 'Vault 路径不是目录' }
  return { ok: true }
}

function shouldIncludeObsidianPath(relativePath, config) {
  const normalized = relativePath.split(path.sep).join('/')
  const excludeFolders = config.excludeFolders || []
  if (excludeFolders.some(folder => {
    const clean = folder.replace(/^\/+|\/+$/g, '')
    return clean && (normalized === clean || normalized.startsWith(`${clean}/`) || normalized.includes(`/${clean}/`))
  })) return false

  const includeFolders = (config.includeFolders || []).filter(Boolean)
  if (includeFolders.length === 0) return true
  return includeFolders.some(folder => {
    const clean = folder.replace(/^\/+|\/+$/g, '')
    return normalized === clean || normalized.startsWith(`${clean}/`)
  })
}

function listObsidianMarkdownFiles(config = getObsidianConfig(), maxFiles = 1200) {
  const validation = validateObsidianVault(config)
  if (!validation.ok) return []

  const results = []
  const walk = (dir) => {
    if (results.length >= maxFiles) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const entry of entries) {
      if (results.length >= maxFiles) break
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(config.vaultPath, fullPath)
      if (!shouldIncludeObsidianPath(relativePath, config)) continue
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        results.push(fullPath)
      }
    }
  }
  walk(config.vaultPath)
  return results
}

function stripMarkdownForSearch(content) {
  return String(content || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeSearchText(text) {
  const lower = String(text || '').toLowerCase()
  const latinTokens = lower.match(/[a-z0-9_#+.-]{2,}/g) || []
  const cjkSegments = lower.match(/[\u4e00-\u9fff]{2,}/g) || []
  const cjkTokens = []
  for (const segment of cjkSegments) {
    if (segment.length <= 4) cjkTokens.push(segment)
    for (let i = 0; i < segment.length - 1; i++) cjkTokens.push(segment.slice(i, i + 2))
  }
  return [...new Set([...latinTokens, ...cjkTokens])].slice(0, 32)
}

function readObsidianNote(filePath, config) {
  const stat = fs.statSync(filePath)
  if (stat.size > 512 * 1024) return null
  const raw = fs.readFileSync(filePath, 'utf8')
  const relativePath = path.relative(config.vaultPath, filePath).split(path.sep).join('/')
  const title = (raw.match(/^#\s+(.+)$/m)?.[1] || path.basename(filePath, '.md')).trim()
  const tags = [...raw.matchAll(/(?:^|\s)#([\u4e00-\u9fff\w/-]+)/g)].map(match => match[1])
  const headings = [...raw.matchAll(/^#{1,4}\s+(.+)$/gm)].map(match => match[1].trim()).slice(0, 12)
  const plain = stripMarkdownForSearch(raw)
  return { filePath, relativePath, title, tags, headings, raw, plain, mtime: stat.mtime.toISOString() }
}

function scoreObsidianNote(note, query, tokens) {
  const titleLower = note.title.toLowerCase()
  const pathLower = note.relativePath.toLowerCase()
  const tagsLower = note.tags.join(' ').toLowerCase()
  const headingsLower = note.headings.join(' ').toLowerCase()
  const plainLower = note.plain.toLowerCase()
  const queryLower = String(query || '').toLowerCase().trim()
  let score = queryLower && plainLower.includes(queryLower) ? 12 : 0
  for (const token of tokens) {
    if (titleLower.includes(token)) score += 9
    if (pathLower.includes(token)) score += 5
    if (tagsLower.includes(token)) score += 6
    if (headingsLower.includes(token)) score += 4
    if (plainLower.includes(token)) score += 1
  }
  return score
}

function buildObsidianSnippet(note, tokens, maxLength = 520) {
  const lower = note.plain.toLowerCase()
  const hit = tokens.map(token => lower.indexOf(token)).filter(index => index >= 0).sort((a, b) => a - b)[0]
  const start = Math.max(0, (hit || 0) - 180)
  const snippet = note.plain.slice(start, start + maxLength).trim()
  return `${start > 0 ? '...' : ''}${snippet}${start + maxLength < note.plain.length ? '...' : ''}`
}

function searchObsidianVault(query, maxResults) {
  const config = getObsidianConfig()
  const validation = validateObsidianVault(config)
  if (!validation.ok) return { ok: false, reason: validation.reason, results: [] }

  const tokens = tokenizeSearchText(query)
  if (tokens.length === 0) return { ok: true, results: [] }

  const results = []
  for (const filePath of listObsidianMarkdownFiles(config)) {
    try {
      if (!isPathInside(config.vaultPath, filePath)) continue
      const note = readObsidianNote(filePath, config)
      if (!note) continue
      const score = scoreObsidianNote(note, query, tokens)
      if (score <= 0) continue
      results.push({
        title: note.title,
        path: note.filePath,
        relativePath: note.relativePath,
        tags: note.tags,
        mtime: note.mtime,
        score,
        snippet: buildObsidianSnippet(note, tokens)
      })
    } catch (_) {}
  }

  results.sort((a, b) => b.score - a.score || new Date(b.mtime) - new Date(a.mtime))
  return { ok: true, results: results.slice(0, maxResults || config.maxResults) }
}

function getRelevantObsidianContext(userMessage, maxResults) {
  const search = searchObsidianVault(userMessage, maxResults)
  if (!search.ok || search.results.length === 0) return ''
  return search.results.map(item =>
    `[Obsidian: ${item.title} | ${item.relativePath}]\n${item.snippet}`
  ).join('\n\n')
}

function getKnowledgeContext(userMessage) {
  const memoryContext = getRelevantMemories(userMessage)
  const obsidianContext = getRelevantObsidianContext(userMessage)
  const sections = []
  if (memoryContext) sections.push(`## 共享记忆\n以下是跨会话共享的关键信息，请在回复时参考：\n${memoryContext}`)
  if (obsidianContext) sections.push(`## Obsidian 知识库\n以下内容来自用户的 Obsidian Vault。回答时优先引用相关内容，不要编造未检索到的细节：\n${obsidianContext}`)
  return sections.join('\n\n')
}

function sanitizeObsidianTitle(title) {
  const clean = String(title || '未命名记忆')
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return clean || '未命名记忆'
}

function writeObsidianMemoryNote({ title, content, tags = [] }) {
  const config = getObsidianConfig()
  const validation = validateObsidianVault(config)
  if (!validation.ok) throw new Error(validation.reason)
  if (!config.writeMemoryEnabled) throw new Error('未启用写入 Obsidian 记忆')

  const memoryDir = path.join(config.vaultPath, 'OpenClaw', 'Memory', 'Facts')
  fs.mkdirSync(memoryDir, { recursive: true })
  if (!isPathInside(config.vaultPath, memoryDir)) throw new Error('非法写入路径')

  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const safeTitle = sanitizeObsidianTitle(title)
  let filePath = path.join(memoryDir, `${date}-${safeTitle}.md`)
  let suffix = 2
  while (fs.existsSync(filePath)) {
    filePath = path.join(memoryDir, `${date}-${safeTitle}-${suffix}.md`)
    suffix++
  }

  const tagList = Array.isArray(tags) ? tags.map(tag => String(tag).replace(/^#/, '').trim()).filter(Boolean) : []
  const frontmatter = [
    '---',
    `id: openclaw-${Date.now()}`,
    'type: memory',
    'source: openclaw',
    `created_at: ${now.toISOString()}`,
    `updated_at: ${now.toISOString()}`,
    `tags: [${['openclaw-memory', ...tagList].map(tag => `"${tag}"`).join(', ')}]`,
    '---'
  ].join('\n')

  fs.writeFileSync(filePath, `${frontmatter}\n\n# ${safeTitle}\n\n${String(content || '').trim()}\n`)
  return {
    title: safeTitle,
    path: filePath,
    relativePath: path.relative(config.vaultPath, filePath).split(path.sep).join('/')
  }
}

// GET /api/memory — 返回所有记忆
app.get('/api/memory', (req, res) => {
  const data = loadMemory()
  res.json(data)
})

// GET /api/memory/search?q=xxx — 搜索记忆
app.get('/api/memory/search', (req, res) => {
  const data = loadMemory()
  const q = (req.query.q || '').toLowerCase()
  if (!q) return res.json({ memories: data.memories })
  const filtered = {}
  for (const [key, entry] of Object.entries(data.memories)) {
    if (key.toLowerCase().includes(q) || (entry.value && entry.value.toLowerCase().includes(q))) {
      filtered[key] = entry
    }
  }
  res.json({ memories: filtered, total: Object.keys(filtered).length })
})

// GET /api/memory/:key — 查询特定记忆
app.get('/api/memory/:key', (req, res) => {
  const data = loadMemory()
  const entry = data.memories[req.params.key]
  if (!entry) return res.status(404).json({ error: '记忆不存在' })
  res.json({ key: req.params.key, ...entry })
})

// POST /api/memory — 写入记忆
app.post('/api/memory', (req, res) => {
  const { key, value, agent } = req.body
  if (!key || value === undefined) return res.status(400).json({ error: 'key 和 value 为必填' })
  const data = loadMemory()
  data.memories[key] = { value, agent: agent || 'defaults', timestamp: new Date().toISOString() }
  saveMemory(data)
  res.json({ key, ...data.memories[key] })
})

// DELETE /api/memory/:key — 删除记忆
app.delete('/api/memory/:key', (req, res) => {
  const data = loadMemory()
  if (!data.memories[req.params.key]) return res.status(404).json({ error: '记忆不存在' })
  delete data.memories[req.params.key]
  saveMemory(data)
  res.json({ success: true })
})

// GET /api/obsidian/status — 检查 Vault 配置与 Markdown 数量
app.get('/api/obsidian/status', (req, res) => {
  try {
    const config = getObsidianConfig()
    const validation = validateObsidianVault(config)
    const noteCount = validation.ok ? listObsidianMarkdownFiles(config).length : 0
    res.json({
      enabled: config.enabled,
      valid: validation.ok,
      reason: validation.reason || '',
      vaultPath: config.vaultPath,
      noteCount,
      includeFolders: config.includeFolders,
      excludeFolders: config.excludeFolders,
      maxResults: config.maxResults,
      writeMemoryEnabled: config.writeMemoryEnabled
    })
  } catch (error) {
    res.status(500).json({ error: '检查 Obsidian 配置失败', message: error.message })
  }
})

// GET /api/obsidian/search?q=xxx — 搜索 Obsidian Vault
app.get('/api/obsidian/search', (req, res) => {
  try {
    const q = String(req.query.q || '')
    const maxResults = Number(req.query.limit) || undefined
    const result = searchObsidianVault(q, maxResults)
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: '搜索 Obsidian 失败', message: error.message })
  }
})

// POST /api/obsidian/memory — 将一条记忆写入 Obsidian
app.post('/api/obsidian/memory', (req, res) => {
  try {
    const { title, content, tags } = req.body || {}
    if (!content) return res.status(400).json({ error: 'content 为必填' })
    const note = writeObsidianMemoryNote({ title, content, tags })
    res.json({ success: true, note })
  } catch (error) {
    res.status(500).json({ error: '写入 Obsidian 记忆失败', message: error.message })
  }
})

/**
 * 从记忆库中检索与当前对话相关的记忆
 * 将相关的记忆注入到 system prompt 中
 */
function getRelevantMemories(userMessage, maxResults = 5) {
  try {
    const data = loadMemory()
    const memories = data.memories
    const keys = Object.keys(memories)
    if (keys.length === 0) return ''
    // 简易关键词匹配：检查消息中是否包含记忆 key 或记忆内容的关键词
    const msgLower = userMessage.toLowerCase()
    const relevant = []
    for (const [key, entry] of Object.entries(memories)) {
      const score = (msgLower.includes(key.toLowerCase()) ? 2 : 0) +
        (entry.value && msgLower.includes(entry.value.toLowerCase().substring(0, 20)) ? 1 : 0)
      if (score > 0) relevant.push({ key, entry, score })
    }
    relevant.sort((a, b) => b.score - a.score)
    if (relevant.length === 0) return ''
    return relevant.slice(0, maxResults).map(r =>
      `[记忆: ${r.key}] ${r.entry.value} (来源: ${r.entry.agent}, ${r.entry.timestamp})`
    ).join('\n')
  } catch (_) { return '' }
}

// ==================== 群聊 API ====================

const GROUP_CHAT_DIR = path.join(DATA_DIR, 'group-chats')
if (!fs.existsSync(GROUP_CHAT_DIR)) fs.mkdirSync(GROUP_CHAT_DIR, { recursive: true })

// POST /api/group-chat — 发送群聊消息
app.post('/api/group-chat', async (req, res) => {
  const { participants, message, mentionAgent, mode, sessionId } = req.body
  if (!participants || !Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({ error: 'participants 不能为空' })
  }
  if (!message) return res.status(400).json({ error: '消息不能为空' })

  const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {}

  const getProviderConfig = (providerId) => {
    if (config.providers && config.providers[providerId]) return config.providers[providerId]
    if (config.models?.providers && config.models.providers[providerId]) return config.models.providers[providerId]
    return null
  }

  const userMessage = { id: Date.now().toString(), role: 'user', sender: 'You', content: message, timestamp: new Date().toISOString() }
  const allMessages = [userMessage]
  const knowledgeContext = getKnowledgeContext(message)

  // 确定需要回复的 Agent 和上下文模式
  let activeParticipants = participants
  let shareContext = false // 是否让 Agent 看到前面 Agent 的回复
  if (mode === 'sequential') {
    // 轮流发言：按顺序依次回复，每个 Agent 能看到前面 Agent 的回复作为上下文
    shareContext = true
  } else if (mode === 'free' && mentionAgent) {
    // 自由模式且指定了 @：只有被 @ 的 Agent 回复
    activeParticipants = participants.filter(p => p.agentId === mentionAgent)
    // 不必共享上下文
  } else {
    // 默认 "all" 模式：所有 Agent 独立回复，都只基于用户消息，不互见回复
    shareContext = false
  }

  for (const p of activeParticipants) {
    const { agentId, model, provider } = p
    const modelParts = (model || 'step-alpha').split('/')
    const actualProvider = modelParts.length > 1 ? modelParts[0] : (provider || 'stepfun')
    const actualModel = modelParts.length > 1 ? modelParts[1] : (model || 'step-alpha')

    const providerConfig = getProviderConfig(actualProvider)
    if (!providerConfig || !providerConfig.apiKey) {
      allMessages.push({
        id: (Date.now() + allMessages.length).toString(),
        role: 'assistant', sender: agentId, model: actualModel, provider: actualProvider,
        content: `[${agentId}] 未配置 ${actualProvider} API Key，无法回复`,
        timestamp: new Date().toISOString()
      })
      continue
    }

    try {
      const baseUrl = providerConfig.baseUrl || 'https://api.openai.com/v1'

      // 构建消息上下文（OpenAI 格式）
      const agentSystemPrompt = buildSystemPrompt(actualModel, actualProvider)
      const messages = [
        { role: 'system', content: agentSystemPrompt || '' }
      ]
      if (knowledgeContext) {
        messages[0].content += `\n\n${knowledgeContext}`
      }
      messages.push({ role: 'system', content: `你正在参与一个名为"${agentId}"的群聊。其他参与者的发言会依次展示。请以"${agentId}"的身份回复。` })
      for (const m of allMessages) {
        if (!shareContext && m.role === 'assistant') continue
        const role = m.sender === 'You' ? 'user' : 'assistant'
        const prefix = m.role === 'assistant' ? `[${m.sender}]: ` : '[You]: '
        messages.push({ role, content: prefix + m.content })
      }

      const result = callProviderAI({
        provider: actualProvider,
        apiKey: providerConfig.apiKey,
        baseUrl,
        model: actualModel,
        messages,
        options: { maxTokens: 2000, temperature: 0.7 }
      })

      if (result.success) {
        allMessages.push({
          id: (Date.now() + allMessages.length).toString(),
          role: 'assistant', sender: agentId, model: actualModel, provider: actualProvider,
          content: result.data.text || '无回复', timestamp: new Date().toISOString()
        })
      } else {
        console.error(`${actualProvider} API 错误:`, result.error)
        allMessages.push({
          id: (Date.now() + allMessages.length).toString(),
          role: 'assistant', sender: agentId, model: actualModel, provider: actualProvider,
          content: `[${agentId}] API 调用失败: ${result.error}`,
          timestamp: new Date().toISOString()
        })
      }
    } catch (error) {
      allMessages.push({
        id: (Date.now() + allMessages.length).toString(),
        role: 'assistant', sender: agentId, model: actualModel, provider: actualProvider,
        content: `[${agentId}] 网络错误: ${error.message}`,
        timestamp: new Date().toISOString()
      })
    }
  }

  // 保存到会话文件
  if (sessionId) {
    const sessionFile = path.join(GROUP_CHAT_DIR, `${sessionId}.json`)
    let sessionData = { id: sessionId, name: '群聊', participants, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    if (fs.existsSync(sessionFile)) {
      sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
    }
    sessionData.messages.push(...allMessages)
    sessionData.updatedAt = new Date().toISOString()
    fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2))
  }

  res.json({ messages: allMessages, timestamp: new Date().toISOString() })
})

// GET /api/group-chat/sessions — 群聊会话列表
app.get('/api/group-chat/sessions', (req, res) => {
  const sessions = []
  try {
    if (fs.existsSync(GROUP_CHAT_DIR)) {
      const files = fs.readdirSync(GROUP_CHAT_DIR).filter(f => f.endsWith('.json'))
      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(GROUP_CHAT_DIR, file), 'utf8'))
        sessions.push({
          id: data.id, name: data.name || '群聊', participantCount: data.participants?.length || 0,
          messageCount: data.messages?.length || 0, createdAt: data.createdAt, updatedAt: data.updatedAt
        })
      }
    }
    sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    res.json(sessions)
  } catch (error) { res.json([]) }
})

// POST /api/group-chat/sessions — 创建群聊会话
app.post('/api/group-chat/sessions', (req, res) => {
  const sessionId = `gc-${Date.now()}`
  const sessionData = {
    id: sessionId, name: req.body.name || '群聊', participants: req.body.participants || [],
    messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }
  fs.writeFileSync(path.join(GROUP_CHAT_DIR, `${sessionId}.json`), JSON.stringify(sessionData, null, 2))
  res.json(sessionData)
})

// GET /api/group-chat/sessions/:id — 获取群聊消息历史
app.get('/api/group-chat/sessions/:id', (req, res) => {
  const filePath = path.join(GROUP_CHAT_DIR, `${req.params.id}.json`)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '群聊会话不存在' })
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')))
})

// DELETE /api/group-chat/sessions/:id — 删除群聊会话
app.delete('/api/group-chat/sessions/:id', (req, res) => {
  const filePath = path.join(GROUP_CHAT_DIR, `${req.params.id}.json`)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '群聊会话不存在' })
  try { fs.unlinkSync(filePath); res.json({ success: true }) }
  catch (error) { res.status(500).json({ error: '删除失败', message: error.message }) }
})

// PATCH /api/group-chat/sessions/:id — 更新群聊会话（参与者等）
app.patch('/api/group-chat/sessions/:id', (req, res) => {
  const filePath = path.join(GROUP_CHAT_DIR, `${req.params.id}.json`)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '群聊会话不存在' })
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const updated = { ...data, ...req.body, updatedAt: new Date().toISOString() }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2))
    res.json(updated)
  } catch (error) { res.status(500).json({ error: '更新失败', message: error.message }) }
})

// ==================== 设置 API ====================

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const DEFAULT_SETTINGS = {
  general: { language: 'zh', theme: 'light', startup: 'last', fontSize: 14, autoScroll: true },
  models: { defaultModel: '', defaultProvider: '' },
  data: { cacheSize: 0 },
  obsidian: DEFAULT_OBSIDIAN_SETTINGS,
  version: '1.0.0'
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  } catch (_) {}
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

// GET /api/settings
app.get('/api/settings', (req, res) => {
  const settings = loadSettings()
  // dataDir 始终返回，不受缓存计算是否成功影响
  settings.data = { ...settings.data, dataDir: path.join(os.homedir(), 'Lingshu') }
  // 计算缓存大小：扫描整个数据目录
  try {
    let cacheSize = 0
    const walkDir = (dir) => {
      try {
        if (!fs.existsSync(dir)) return
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) walkDir(fullPath)
          else cacheSize += fs.statSync(fullPath).size
        }
      } catch (_) {}
    }
    if (fs.existsSync(DATA_DIR)) walkDir(DATA_DIR)
    settings.data.cacheSize = cacheSize
  } catch (_) {}
  res.json(settings)
})

// PUT /api/settings
app.put('/api/settings', (req, res) => {
  const current = loadSettings()
  const updated = { ...current, ...req.body, updatedAt: new Date().toISOString() }
  saveSettings(updated)
  res.json(updated)
})

// POST /api/settings/clear-cache — 清除缓存
app.post('/api/settings/clear-cache', (req, res) => {
  let totalDeleted = 0
  const cleanDir = (dir) => {
    if (!fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        cleanDir(fullPath)
        try { fs.rmdirSync(fullPath); totalDeleted++ } catch (_) {}
      } else {
        try { fs.unlinkSync(fullPath); totalDeleted++ } catch (_) {}
      }
    }
  }
  cleanDir(CHAT_DIR)
  cleanDir(MEMORY_DIR)
  cleanDir(GROUP_CHAT_DIR)
  // 重建必要目录
  if (!fs.existsSync(CHAT_DIR)) fs.mkdirSync(CHAT_DIR, { recursive: true })
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true })
  if (!fs.existsSync(GROUP_CHAT_DIR)) fs.mkdirSync(GROUP_CHAT_DIR, { recursive: true })
  res.json({ success: true, deletedFiles: totalDeleted })
})

// ==================== 模型列表 API（带 API Key 排序）====================

// 从 openclaw.json 解析某个 provider 是否已配置 API Key
function hasApiKey(config, providerId) {
  if (config.providers?.[providerId]?.apiKey) return true
  if (config.models?.providers?.[providerId]?.apiKey) return true
  return false
}

// 已知的模型厂商列表（与前端 ModelConfig.tsx 中 PROVIDERS 保持同步）
const KNOWN_PROVIDERS = {
  stepfun: {
    name: 'StepFun (阶跃星辰)', baseUrl: 'https://api.stepfun.com/step_plan/v1',
    models: [
      { id: 'step-3.7-flash', name: 'Step-3.7 Flash', desc: '最新旗舰，极速响应' },
      { id: 'step-3.5-flash-2603', name: 'Step-3.5 Flash 2603', desc: '稳定版本，当前可用' },
      { id: 'step-3.5-flash', name: 'Step-3.5 Flash', desc: '轻量极速' },
    ]
  },
  zhipu: {
    name: '智谱 AI (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-4', name: 'GLM-4', desc: '旗舰模型，最强性能' },
      { id: 'glm-3-turbo', name: 'GLM-3 Turbo', desc: '快速响应，经济实惠' },
      { id: 'glm-4v', name: 'GLM-4V', desc: '多模态，支持图像' },
    ]
  },
  openai: {
    name: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5', name: 'GPT-5', desc: '旗舰通用模型' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini', desc: '平衡性能与成本' },
      { id: 'gpt-4.1', name: 'GPT-4.1', desc: '强通用能力，适合复杂任务' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', desc: '轻量高效' },
      { id: 'gpt-4o', name: 'GPT-4o', desc: '多模态通用模型' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: '经济快速' },
    ]
  },
  anthropic: {
    name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8（推荐）', desc: '最新旗舰' },
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', desc: '高性能推理' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', desc: '平衡性能与速度' },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', desc: '强推理能力' },
      { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', desc: '稳定版本' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', desc: '极速响应' },
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', desc: '经典版本' },
      { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1', desc: '上一代旗舰' },
    ]
  },
  doubao: {
    name: '豆包 (火山引擎)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { id: 'doubao-pro-128k', name: '豆包 Pro 128K', desc: '专业版，长上下文' },
      { id: 'doubao-lite-128k', name: '豆包 Lite 128K', desc: '轻量版，经济实惠' },
      { id: 'doubao-vision', name: '豆包 Vision', desc: '多模态版本' },
    ]
  },
  qwen: {
    name: '通义千问 (阿里云)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen-max', name: 'Qwen Max', desc: '最强模型' },
      { id: 'qwen-plus', name: 'Qwen Plus', desc: '平衡性能' },
      { id: 'qwen-turbo', name: 'Qwen Turbo', desc: '极速响应' },
    ]
  },
  deepseek: {
    name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', desc: '最新旗舰（推荐）' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', desc: '极速响应' },
      { id: 'deepseek-chat', name: 'DeepSeek Chat (V3.2)', desc: '通用对话，即将废弃' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (V3.2)', desc: '推理增强，即将废弃' },
    ]
  },
  moonshot: {
    name: 'Moonshot (月之暗面)', baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'moonshot-v1-8k', name: 'Moonshot 8K', desc: '轻量级' },
      { id: 'moonshot-v1-32k', name: 'Moonshot 32K', desc: '标准版' },
      { id: 'moonshot-v1-128k', name: 'Moonshot 128K', desc: '长上下文' },
    ]
  },
  xiaomi: {
    name: '小米 MiMo', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    models: [
      { id: 'mimo-v2.5-pro', name: 'MiMo-V2.5 Pro', desc: '旗舰 MoE，1020B/42B 活跃，1M 上下文' },
      { id: 'mimo-v2.5', name: 'MiMo-V2.5', desc: '稀疏 MoE 310B/15B 活跃，原生多模态' },
      { id: 'mimo-v2-pro', name: 'MiMo-V2 Pro', desc: '上一代旗舰，1M 上下文' },
      { id: 'mimo-v2-omni', name: 'MiMo-V2 Omni', desc: '多模态（文本+图像）' },
    ]
  },
}

// GET /api/models — 返回按 API Key 可用性排序的模型列表
// 只展示用户已在模型配置中配置过的厂商的模型；已配置的厂商会展开其全部已知模型
app.get('/api/models', (req, res) => {
  try {
    const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
    let config = {}
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    }

    const models = []
    const addedKeys = new Set()
    const configuredProviders = new Set() // 收集所有已配置的 provider ID

    function addModel(key, label, provider, hasApiKey) {
      if (addedKeys.has(key)) return
      addedKeys.add(key)
      models.push({ key, label, provider, hasApiKey })
    }

    // 1. 系统配置的 providers（来自 openclaw.json models.providers）
    if (config.models?.providers) {
      for (const [providerId, providerData] of Object.entries(config.models.providers)) {
        configuredProviders.add(providerId)
        const hasKey = hasApiKey(config, providerId)
        if (providerData.models && Array.isArray(providerData.models)) {
          for (const m of providerData.models) {
            addModel(`${providerId}/${m.id}`, `${providerId} - ${m.name || m.id}`, providerId, hasKey)
          }
        }
      }
    }
    // 2. 用户自定义 providers（来自 openclaw.json providers）
    if (config.providers) {
      for (const [providerId, providerData] of Object.entries(config.providers)) {
        configuredProviders.add(providerId)
      }
    }
    // 3. 对每个已配置的厂商，展开其全部已知模型（KNOWN_PROVIDERS）
    for (const providerId of configuredProviders) {
      const hasKey = hasApiKey(config, providerId)
      const known = KNOWN_PROVIDERS[providerId]
      if (known && known.models) {
        for (const m of known.models) {
          addModel(`${providerId}/${m.id}`, `${known.name} - ${m.name}`, providerId, hasKey)
        }
      } else {
        // 不在已知列表中的厂商，回退到读取 config 中的单 model 字段
        const pd = config.providers?.[providerId] || config.models?.providers?.[providerId] || {}
        const modelId = pd.model || `${providerId}-chat`
        addModel(`${providerId}/${modelId}`, `${providerId} - ${modelId}`, providerId, hasKey)
      }
    }

    // 排序：有 API Key 的排前面
    models.sort((a, b) => (b.hasApiKey ? 1 : 0) - (a.hasApiKey ? 1 : 0))

    res.json({ models, providersWithKey: [...new Set(models.filter(m => m.hasApiKey).map(m => m.provider))] })
  } catch (error) {
    res.status(500).json({ error: '读取模型列表失败', message: error.message })
  }
})

// ==================== 渠道测试连接 API ====================

// POST /api/channels/:id/test — 测试渠道连通性
app.post('/api/channels/:id/test', async (req, res) => {
  const channelId = req.params.id
  try {
    const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
    if (!fs.existsSync(configPath)) {
      return res.status(400).json({ success: false, error: '未找到 openclaw.json 配置文件' })
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const configKey = channelId === 'weixin' ? 'openclaw-weixin' : channelId
    const channelCfg = config.channels?.[configKey]
    if (!channelCfg || !channelCfg.enabled) {
      return res.json({ success: false, error: '渠道未启用或未配置' })
    }

    // 根据渠道类型进行连通性验证
    if (channelId === 'weixin' || channelId === 'wecom') {
      const { corpId, secret, agentId } = channelCfg
      if (!corpId || !secret) {
        return res.json({ success: false, error: '缺少必填字段：corpId 或 secret' })
      }
      // 尝试获取 access_token 验证连通性
      try {
        const https = require('https')
        const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`
        const tokenResult = await new Promise((resolve, reject) => {
          https.get(tokenUrl, (resp) => {
            let data = ''
            resp.on('data', chunk => data += chunk)
            resp.on('end', () => { try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid response')) } })
          }).on('error', reject)
        })
        if (tokenResult.errcode === 0) {
          return res.json({ success: true, message: `连接成功，access_token 已获取` })
        }
        return res.json({ success: false, error: `微信 API 返回错误：${tokenResult.errmsg || '未知错误'} (errcode=${tokenResult.errcode})` })
      } catch (err) {
        return res.json({ success: false, error: `网络请求失败：${err.message}` })
      }
    }

    // 通用渠道（飞书/QQ/钉钉/Telegram）：根据配置类型进行测试
    const { appId, appSecret, webhook } = channelCfg
    if (webhook) {
      try {
        const https = require('https')
        const { URL } = require('url')
        const parsed = new URL(webhook)
        const testResult = await new Promise((resolve, reject) => {
          const req2 = https.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (resp) => {
            resolve({ statusCode: resp.statusCode })
          })
          req2.on('error', reject)
          req2.write(JSON.stringify({ test: 'openclaw-connectivity-check' }))
          req2.end()
        })
        if (testResult.statusCode < 500) {
          return res.json({ success: true, message: `Webhook 可达（HTTP ${testResult.statusCode}）` })
        }
        return res.json({ success: false, error: `Webhook 返回错误（HTTP ${testResult.statusCode}）` })
      } catch (err) {
        return res.json({ success: false, error: `Webhook 请求失败：${err.message}` })
      }
    }

    if (appId && appSecret) {
      return res.json({ success: true, message: '凭证已配置（未做实际验证，请在实际使用中测试）' })
    }

    res.json({ success: false, error: '缺少凭证信息（appId/appSecret 或 webhook）' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== Anthropic API 透明代理 ====================
// 让 Claude Code CLI 可以把 ANTHROPIC_BASE_URL 指向本服务，
// 所有请求经由此处统一转发到真实上游，共享同一通道。
app.use('/v1', (req, res) => {
  const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
  let upstreamBase = 'http://192.168.51.10:8080'
  let upstreamKey = null
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const ap = config?.providers?.anthropic
    if (ap?.baseUrl) upstreamBase = ap.baseUrl.replace(/\/+$/, '')
    if (ap?.apiKey) upstreamKey = ap.apiKey
  } catch {}

  const targetUrl = upstreamBase + '/v1' + req.path + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '')

  // 透传原始请求头，但替换认证头
  const headers = { ...req.headers }
  delete headers['host']
  delete headers['content-length']

  // 如果 upstream key 是 gw- token，统一用 Bearer；否则用 x-api-key
  if (upstreamKey) {
    delete headers['x-api-key']
    delete headers['authorization']
    if (upstreamKey.startsWith('gw-')) {
      headers['authorization'] = `Bearer ${upstreamKey}`
    } else {
      headers['x-api-key'] = upstreamKey
    }
  }

  const http = require('http')
  const https = require('https')
  const parsed = new URL(targetUrl)
  const transport = parsed.protocol === 'https:' ? https : http

  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: req.method,
      headers: { ...headers, 'content-length': body.length }
    }
    const proxyReq = transport.request(options, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(res)
    })
    proxyReq.on('error', e => {
      if (!res.headersSent) res.status(502).json({ error: 'upstream error', message: e.message })
    })
    proxyReq.write(body)
    proxyReq.end()
  })
})

// ==================== 静态文件服务 ====================
// 生产环境下 serve 前端构建产物
const distPath = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (req, res) => {
    const indexPath = path.join(distPath, 'index.html')
    if (fs.existsSync(indexPath) && !req.path.startsWith('/api')) {
      res.sendFile(indexPath)
    } else {
      res.status(404).json({ error: 'Not found' })
    }
  })
}

// ==================== 启动 ====================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`API: http://localhost:${PORT}/api`)
  console.log(`Data: ${DATA_DIR}`)
})
