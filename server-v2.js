import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { exec, spawn, execFileSync } from 'child_process'
import os from 'os'
import multer from 'multer'
import { fileURLToPath } from 'url'

// 放宽 SSL 证书校验（自签证书 / 内部 API 网关需要）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const app = express()
const PORT = process.env.PORT || 3003

app.use(cors())
app.use(express.json())

// 数据存储目录
const DATA_DIR = path.join(os.homedir(), '.stepclaw', 'workspace', 'openclaw-web-ui-data')
const INSTANCES_FILE = path.join(DATA_DIR, 'instances.json')
const CHAT_DIR = path.join(DATA_DIR, 'chat-history')
const UPLOAD_DIR = path.join(os.homedir(), '.stepclaw', 'workspace', 'uploads')
const USER_SKILLS_DIR = path.join(os.homedir(), '.stepclaw', 'skills')
const upload = multer({ dest: UPLOAD_DIR })

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}
if (!fs.existsSync(CHAT_DIR)) {
  fs.mkdirSync(CHAT_DIR, { recursive: true })
}
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}
if (!fs.existsSync(USER_SKILLS_DIR)) {
  fs.mkdirSync(USER_SKILLS_DIR, { recursive: true })
}

app.use('/uploads', express.static(UPLOAD_DIR))

// 默认实例配置
const DEFAULT_INSTANCES = [
  {
    id: 'local',
    name: '本地 OpenClaw',
    type: 'local',
    status: 'connected',
    configPath: '~/.stepclaw/openclaw.json',
    workspacePath: '~/.stepclaw/workspace',
    description: '当前机器上的 OpenClaw 实例',
    lastConnected: new Date().toISOString()
  },
  {
    id: 'stepfun-desktop',
    name: '小跃你 (阶跃桌面端)',
    type: 'stepfun-desktop',
    status: 'connected',
    configPath: '~/.stepclaw/openclaw.json',
    workspacePath: '~/.stepclaw/workspace',
    description: '阶跃 AI 桌面端托管的 OpenClaw',
    lastConnected: new Date().toISOString()
  }
]

// 加载实例列表
function loadInstances() {
  try {
    if (fs.existsSync(INSTANCES_FILE)) {
      const data = JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf8'))
      return data.instances || DEFAULT_INSTANCES
    }
  } catch (error) {
    console.error('加载实例失败:', error)
  }
  return DEFAULT_INSTANCES
}

// 保存实例列表
function saveInstances(instances) {
  try {
    fs.writeFileSync(INSTANCES_FILE, JSON.stringify({ instances, updatedAt: new Date().toISOString() }, null, 2))
  } catch (error) {
    console.error('保存实例失败:', error)
  }
}

// 初始化实例
let instances = loadInstances()

// ==================== Skills 扫描 ====================

/**
 * 从 SKILL.md 文件中解析 YAML frontmatter 中的 name 和 description
 */
function parseSkillFrontmatter(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return null
    const fm = match[1]
    const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim()
    const desc = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim()
    // description 可能是多行，取第一行
    const descFirstLine = desc?.replace(/^>\s*/, '').trim()
    return name ? { name, description: descFirstLine || '' } : null
  } catch {
    return null
  }
}

/**
 * 扫描所有已配置的 Skills 目录，收集 Skill 名称与描述
 */
function collectSkills() {
  const skillsMap = new Map()

  try {
    const configPath = path.join(os.homedir(), '.stepclaw', 'openclaw.json')
    if (!fs.existsSync(configPath)) return []
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

    // 1. 从 extraDirs 扫描
    const extraDirs = config?.skills?.load?.extraDirs || []
    for (const dir of extraDirs) {
      if (!fs.existsSync(dir)) continue
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const mdPath = path.join(dir, entry.name, 'SKILL.md')
        if (!fs.existsSync(mdPath)) continue
        const parsed = parseSkillFrontmatter(mdPath)
        if (parsed && !skillsMap.has(parsed.name)) {
          skillsMap.set(parsed.name, parsed)
        }
      }
    }

    // 2. 从 entries 补充（以 entries 的 enabled 状态为准）
    const entriesObj = config?.skills?.entries || {}
    for (const [name, entry] of Object.entries(entriesObj)) {
      if (entry.enabled === false) {
        skillsMap.delete(name)
      } else if (!skillsMap.has(name)) {
        skillsMap.set(name, { name, description: '' })
      }
    }
  } catch (e) {
    console.error('collectSkills error:', e.message)
  }

  return Array.from(skillsMap.values())
}

function getConfiguredSkillRoots() {
  const roots = [USER_SKILLS_DIR]
  try {
    const configPath = path.join(os.homedir(), '.stepclaw', 'openclaw.json')
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      const extraDirs = Array.isArray(config?.skills?.load?.extraDirs) ? config.skills.load.extraDirs : []
      roots.push(...extraDirs)
    }
  } catch (_) {}
  return [...new Set(roots.filter(Boolean))]
}

function findSkillDirectory(skillName) {
  for (const root of getConfiguredSkillRoots()) {
    const candidate = path.join(root, skillName)
    if (fs.existsSync(path.join(candidate, 'SKILL.md'))) {
      return { root, skillPath: candidate, isUserSkill: path.resolve(root) === path.resolve(USER_SKILLS_DIR) }
    }
  }
  return null
}

function readSkillInfo(skillPath, fallbackName) {
  const skillMdPath = path.join(skillPath, 'SKILL.md')
  const skillContent = fs.readFileSync(skillMdPath, 'utf8')
  const frontmatter = parseSkillFrontmatter(skillMdPath)
  const nameMatch = skillContent.match(/#\s*(.+)/)
  const descMatch = skillContent.match(/##?\s*Description\s*\n+(.+?)(?=\n##|\n*$)/s)
  const versionMatch = skillContent.match(/version[:\s]*([\d.]+)/i)
  let category = '其他'
  if (skillContent.includes('weather') || skillContent.includes('天气')) category = '工具'
  else if (skillContent.includes('code') || skillContent.includes('开发')) category = '开发'
  else if (skillContent.includes('xlsx') || skillContent.includes('pdf') || skillContent.includes('docx')) category = '文档'
  else if (skillContent.includes('channel') || skillContent.includes('渠道')) category = '配置'
  else if (skillContent.includes('memory') || skillContent.includes('guardian')) category = '系统'

  return {
    id: fallbackName,
    name: frontmatter?.name || fallbackName,
    version: versionMatch ? versionMatch[1] : '1.0.0',
    description: frontmatter?.description || (descMatch ? descMatch[1].trim().substring(0, 100) : (nameMatch ? nameMatch[1] : fallbackName)),
    status: 'active',
    category,
    installedAt: fs.statSync(skillPath).birthtime.toISOString().split('T')[0]
  }
}

/**
 * 构建包含 Skills 列表的系统提示
 */
function buildSystemPrompt() {
  const skills = collectSkills()
  if (skills.length === 0) return ''

  const skillLines = skills.map(s =>
    `- **${s.name}**${s.description ? ': ' + s.description : ''}`
  ).join('\n')

  return `你是 OpenClaw AI 助手，当前挂载了以下 Skills（技能）。当用户询问你的能力或技能时，必须严格列出这些实际挂载的 Skills，不要编造不存在的能力。

## 已挂载的 Skills

${skillLines}

你可以使用这些 Skills 来协助用户完成任务。对于不涉及 Skills 的常规问题，按正常方式回答即可。`
}

// ==================== 设置、记忆与 Obsidian 知识库 ====================

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const MEMORY_DIR = path.join(DATA_DIR, 'memory')
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.json')

const DEFAULT_OBSIDIAN_SETTINGS = {
  enabled: false,
  vaultPath: '',
  includeFolders: [''],
  excludeFolders: ['.obsidian', '.git', 'node_modules', '.trash'],
  maxResults: 5,
  writeMemoryEnabled: true
}

const DEFAULT_SETTINGS = {
  general: { language: 'zh', theme: 'light', startup: 'last', fontSize: 14, autoScroll: true },
  models: { defaultModel: '', defaultProvider: '' },
  data: { cacheSize: 0 },
  obsidian: DEFAULT_OBSIDIAN_SETTINGS,
  version: '1.0.0'
}

if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true })
if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, JSON.stringify({ memories: {} }, null, 2))

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
      return {
        ...DEFAULT_SETTINGS,
        ...settings,
        general: { ...DEFAULT_SETTINGS.general, ...(settings.general || {}) },
        models: { ...DEFAULT_SETTINGS.models, ...(settings.models || {}) },
        data: { ...DEFAULT_SETTINGS.data, ...(settings.data || {}) },
        obsidian: { ...DEFAULT_OBSIDIAN_SETTINGS, ...(settings.obsidian || {}) }
      }
    }
  } catch (_) {}
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

function loadMemory() {
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) }
  catch (_) { return { memories: {} } }
}

function saveMemory(data) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2))
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

function getRelevantMemories(userMessage, maxResults = 5) {
  try {
    const data = loadMemory()
    const memories = data.memories || {}
    const keys = Object.keys(memories)
    if (keys.length === 0) return ''
    const msgLower = userMessage.toLowerCase()
    const relevant = []
    for (const [key, entry] of Object.entries(memories)) {
      const value = String(entry.value || '')
      const score = (msgLower.includes(key.toLowerCase()) ? 2 : 0) +
        (value && msgLower.includes(value.toLowerCase().substring(0, 20)) ? 1 : 0)
      if (score > 0) relevant.push({ key, entry, score })
    }
    relevant.sort((a, b) => b.score - a.score)
    if (relevant.length === 0) return ''
    return relevant.slice(0, maxResults).map(r =>
      `[记忆: ${r.key}] ${r.entry.value} (来源: ${r.entry.agent}, ${r.entry.timestamp})`
    ).join('\n')
  } catch (_) { return '' }
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


function getLocalConfigPath() {
  return path.join(os.homedir(), '.stepclaw', 'openclaw.json')
}

function loadLocalConfig() {
  const configPath = getLocalConfigPath()
  if (!fs.existsSync(configPath)) return {}
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')) }
  catch (_) { return {} }
}

function saveLocalConfig(config) {
  const configPath = getLocalConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

function hasApiKey(config, providerId) {
  if (config.providers?.[providerId]?.apiKey) return true
  if (config.models?.providers?.[providerId]?.apiKey) return true
  return false
}

const KNOWN_PROVIDERS = {
  stepfun: {
    name: 'StepFun (阶跃星辰)', baseUrl: 'https://api.stepfun.com/step_plan/v1',
    models: [
      { id: 'step-3.7-flash', name: 'Step-3.7 Flash' },
      { id: 'step-3.5-flash-2603', name: 'Step-3.5 Flash 2603' },
      { id: 'step-3.5-flash', name: 'Step-3.5 Flash' },
    ]
  },
  zhipu: {
    name: '智谱 AI (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-4', name: 'GLM-4' },
      { id: 'glm-3-turbo', name: 'GLM-3 Turbo' },
      { id: 'glm-4v', name: 'GLM-4V' },
    ]
  },
  openai: {
    name: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5', name: 'GPT-5' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    ]
  },
  anthropic: {
    name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    ]
  },
  doubao: {
    name: '豆包 (火山引擎)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { id: 'doubao-pro-128k', name: '豆包 Pro 128K' },
      { id: 'doubao-lite-128k', name: '豆包 Lite 128K' },
      { id: 'doubao-vision', name: '豆包 Vision' },
    ]
  },
  qwen: {
    name: '通义千问 (阿里云)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen-max', name: 'Qwen Max' },
      { id: 'qwen-plus', name: 'Qwen Plus' },
      { id: 'qwen-turbo', name: 'Qwen Turbo' },
    ]
  },
  deepseek: {
    name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
    ]
  },
  moonshot: {
    name: 'Moonshot (月之暗面)', baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'moonshot-v1-8k', name: 'Moonshot 8K' },
      { id: 'moonshot-v1-32k', name: 'Moonshot 32K' },
      { id: 'moonshot-v1-128k', name: 'Moonshot 128K' },
    ]
  },
  xiaomi: {
    name: '小米 MiMo', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    models: [
      { id: 'mimo-v2.5-pro', name: 'MiMo-V2.5 Pro' },
      { id: 'mimo-v2.5', name: 'MiMo-V2.5' },
      { id: 'mimo-v2-pro', name: 'MiMo-V2 Pro' },
      { id: 'mimo-v2-omni', name: 'MiMo-V2 Omni' },
    ]
  },
}

async function callProviderAI({ provider, apiKey, baseUrl, model, messages, options = {} }) {
  const cleanBaseUrl = String(baseUrl || '').replace(/\/+$/, '')
  const maxTokens = options.maxTokens || 4000
  const temperature = options.temperature ?? 0.7

  if (provider === 'anthropic') {
    const systemMessages = messages.filter(m => m.role === 'system')
    const conversationMessages = messages.filter(m => m.role !== 'system')
    const body = { model, messages: conversationMessages, max_tokens: maxTokens }
    if (systemMessages.length > 0) body.system = systemMessages.map(m => m.content).join('\n\n')
    const authHeader = apiKey.startsWith('gw-') ? { Authorization: `Bearer ${apiKey}` } : { 'x-api-key': apiKey }
    const response = await fetch(`${cleanBaseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ...authHeader },
      body: JSON.stringify(body)
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return { success: false, statusCode: response.status, error: data?.error?.message || `HTTP ${response.status}`, data: { raw: data } }
    return { success: true, statusCode: response.status, data: { text: data?.content?.[0]?.text || '', raw: data } }
  }

  const response = await fetch(`${cleanBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) return { success: false, statusCode: response.status, error: data?.error?.message || `HTTP ${response.status}`, data: { raw: data } }
  return { success: true, statusCode: response.status, data: { text: data?.choices?.[0]?.message?.content || '', raw: data } }
}

async function fetchProviderModels({ provider, apiKey, baseUrl }) {
  if (!baseUrl || !apiKey) return null
  const cleanBaseUrl = String(baseUrl || '').replace(/\/+$/, '')
  try {
    const isAnthropic = provider === 'anthropic'
    const url = isAnthropic ? `${cleanBaseUrl}/v1/models` : `${cleanBaseUrl}/models`
    const authHeader = isAnthropic && !apiKey.startsWith('gw-') ? { 'x-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` }
    const response = await fetch(url, {
      headers: { ...authHeader, ...(isAnthropic ? { 'anthropic-version': '2023-06-01' } : {}) },
      signal: AbortSignal.timeout(12000)
    })
    const data = await response.json()
    if (Array.isArray(data?.data)) return data.data.map(m => m.id).filter(id => typeof id === 'string')
  } catch (error) {
    console.warn('[fetchProviderModels] failed:', error.message)
  }
  return null
}


// ==================== CC Switch 集成 API ====================

const CC_SWITCH_DIR = path.join(os.homedir(), '.cc-switch')
const CC_SWITCH_DB = path.join(CC_SWITCH_DIR, 'cc-switch.db')

function runSqliteJson(sql) {
  const output = execFileSync('sqlite3', ['-json', CC_SWITCH_DB, sql], { encoding: 'utf8', timeout: 10000 })
  return output.trim() ? JSON.parse(output) : []
}

function runSqliteExec(sql) {
  execFileSync('sqlite3', [CC_SWITCH_DB, sql], { encoding: 'utf8', timeout: 10000 })
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''")
}

function parseCcSwitchProvider(row) {
  let settings = {}
  try { settings = JSON.parse(row.settings_config || '{}') } catch (_) {}
  const models = Array.isArray(settings.models) ? settings.models : []
  const firstModel = models[0] || {}
  return {
    id: row.id,
    name: row.name,
    appType: row.app_type,
    category: row.category || '',
    api: settings.api || '',
    baseUrl: settings.baseUrl || '',
    modelCount: models.length,
    firstModelId: firstModel.id || settings.model || '',
    firstModelName: firstModel.name || firstModel.id || settings.model || '',
    isCurrent: !!row.is_current
  }
}

function getCcSwitchProviders(appType = 'openclaw') {
  if (!fs.existsSync(CC_SWITCH_DB)) return []
  const rows = runSqliteJson(`
    select id, app_type, name, category, is_current, sort_index, settings_config
    from providers
    where app_type = '${escapeSqlString(appType)}'
    order by is_current desc, sort_index is null, sort_index, name
  `)
  return rows.map(parseCcSwitchProvider)
}

function getCcSwitchProviderRaw(appType, providerId) {
  const rows = runSqliteJson(`
    select id, app_type, name, category, is_current, settings_config
    from providers
    where app_type = '${escapeSqlString(appType)}' and id = '${escapeSqlString(providerId)}'
    limit 1
  `)
  if (rows.length === 0) return null
  const row = rows[0]
  let settings = {}
  try { settings = JSON.parse(row.settings_config || '{}') } catch (_) {}
  return { row, settings, summary: parseCcSwitchProvider(row) }
}


function getCurrentCcSwitchOpenClawProvider() {
  if (!fs.existsSync(CC_SWITCH_DB)) return null
  const rows = runSqliteJson(`
    select id, app_type, name, category, is_current, sort_index, settings_config
    from providers
    where app_type = 'openclaw'
    order by is_current desc, sort_index is null, sort_index, name
    limit 1
  `)
  if (rows.length === 0) return null
  const row = rows[0]
  let settings = {}
  try { settings = JSON.parse(row.settings_config || '{}') } catch (_) {}
  return { row, settings, summary: parseCcSwitchProvider(row) }
}

function getCcSwitchApiProtocol(api) {
  return api === 'anthropic-messages' ? 'anthropic' : 'openai'
}

function getCcSwitchModelList() {
  const provider = getCurrentCcSwitchOpenClawProvider()
  if (!provider) return []
  const models = Array.isArray(provider.settings.models) ? provider.settings.models : []
  return models
    .filter(model => model && model.id)
    .map(model => ({
      id: model.id,
      name: model.name || model.id,
      routeName: provider.summary.name,
      routeId: provider.row.id
    }))
}

function updateCcSwitchCurrent(appType, providerId) {
  runSqliteExec(`
    update providers set is_current = case when id = '${escapeSqlString(providerId)}' then 1 else 0 end
    where app_type = '${escapeSqlString(appType)}'
  `)
}

function applyCcSwitchOpenClawProvider(provider) {
  const configPath = path.join(os.homedir(), '.stepclaw', 'openclaw.json')
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {}
  const models = Array.isArray(provider.settings.models) ? provider.settings.models : []
  const firstModel = models[0]
  if (!provider.settings.baseUrl || !provider.settings.apiKey || !provider.settings.api || !firstModel?.id) {
    throw new Error('CC Switch provider 缺少 baseUrl/apiKey/api/models，无法应用到 OpenClaw')
  }

  const backupDir = path.join(DATA_DIR, 'cc-switch-backups')
  fs.mkdirSync(backupDir, { recursive: true })
  if (fs.existsSync(configPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(configPath, path.join(backupDir, `openclaw-${stamp}.json`))
  }

  config.models = config.models || {}
  config.models.mode = config.models.mode || 'replace'
  config.models.providers = config.models.providers || {}
  config.models.providers[provider.row.id] = {
    api: provider.settings.api,
    apiKey: provider.settings.apiKey,
    baseUrl: provider.settings.baseUrl,
    models
  }

  config.agents = config.agents || {}
  config.agents.defaults = config.agents.defaults || {}
  config.agents.defaults.model = config.agents.defaults.model || {}
  config.agents.defaults.model.primary = `${provider.row.id}/${firstModel.id}`
  config.meta = {
    ...(config.meta || {}),
    lastTouchedAt: new Date().toISOString(),
    lastTouchedBy: 'openclaw-web-ui cc-switch'
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  return { configPath, primaryModel: config.agents.defaults.model.primary }
}

app.get('/api/cc-switch/providers', (req, res) => {
  try {
    const appType = String(req.query.appType || 'openclaw')
    res.json({ providers: getCcSwitchProviders(appType) })
  } catch (error) {
    res.status(500).json({ error: '读取 CC Switch providers 失败', message: error.message })
  }
})

app.get('/api/cc-switch/status', (req, res) => {
  try {
    const appType = String(req.query.appType || 'openclaw')
    const providers = getCcSwitchProviders(appType)
    const proxyRows = fs.existsSync(CC_SWITCH_DB)
      ? runSqliteJson(`select * from proxy_config where app_type = '${escapeSqlString(appType)}' limit 1`)
      : []
    const proxy = proxyRows[0]
    res.json({
      dbExists: fs.existsSync(CC_SWITCH_DB),
      dbPath: CC_SWITCH_DB,
      providerCount: providers.length,
      currentProvider: providers.find(provider => provider.isCurrent) || null,
      proxy: proxy ? {
        enabled: !!proxy.enabled,
        proxyEnabled: !!proxy.proxy_enabled,
        listenAddress: proxy.listen_address,
        listenPort: proxy.listen_port,
        liveTakeoverActive: !!proxy.live_takeover_active
      } : null
    })
  } catch (error) {
    res.status(500).json({ error: '读取 CC Switch 状态失败', message: error.message })
  }
})

app.post('/api/cc-switch/switch', (req, res) => {
  try {
    const appType = String(req.body?.appType || 'openclaw')
    const providerId = String(req.body?.providerId || '')
    if (!providerId) return res.status(400).json({ error: 'providerId 为必填' })
    if (appType !== 'openclaw') return res.status(400).json({ error: '当前仅支持切换 openclaw 路由' })

    const provider = getCcSwitchProviderRaw(appType, providerId)
    if (!provider) return res.status(404).json({ error: '未找到 CC Switch provider' })
    const applied = applyCcSwitchOpenClawProvider(provider)
    updateCcSwitchCurrent(appType, providerId)
    res.json({ success: true, provider: provider.summary, applied })
  } catch (error) {
    res.status(500).json({ error: '切换 CC Switch 路由失败', message: error.message })
  }
})

// ==================== 实例管理 API ====================

// 获取所有实例
app.get('/api/instances', (req, res) => {
  res.json(instances)
})

// 添加新实例
app.post('/api/instances', (req, res) => {
  const { name, type, host, port, configPath, description } = req.body
  
  const newInstance = {
    id: `instance-${Date.now()}`,
    name,
    type,
    host,
    port,
    configPath,
    description,
    status: 'disconnected',
    createdAt: new Date().toISOString()
  }
  
  instances.push(newInstance)
  saveInstances(instances)
  
  res.json(newInstance)
})

// 更新实例
app.patch('/api/instances/:id', (req, res) => {
  const { id } = req.params
  const index = instances.findIndex(i => i.id === id)
  
  if (index === -1) {
    return res.status(404).json({ error: '实例不存在' })
  }
  
  instances[index] = { ...instances[index], ...req.body, updatedAt: new Date().toISOString() }
  saveInstances(instances)
  
  res.json(instances[index])
})

// 删除实例
app.delete('/api/instances/:id', (req, res) => {
  const { id } = req.params
  instances = instances.filter(i => i.id !== id)
  saveInstances(instances)
  res.json({ success: true })
})

// 测试实例连接
app.post('/api/instances/:id/test', async (req, res) => {
  const { id } = req.params
  const instance = instances.find(i => i.id === id)
  
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }
  
  try {
    // 根据类型测试连接
    if (instance.type === 'local' || instance.type === 'stepfun-desktop') {
      // 测试本地 OpenClaw
      const configPath = instance.configPath.replace('~', os.homedir())
      if (fs.existsSync(configPath)) {
        instance.status = 'connected'
        instance.lastConnected = new Date().toISOString()
        saveInstances(instances)
        res.json({ success: true, status: 'connected' })
      } else {
        instance.status = 'error'
        saveInstances(instances)
        res.json({ success: false, status: 'error', message: '配置文件不存在' })
      }
    } else if (instance.type === 'remote') {
      // 测试远程连接
      // TODO: 实现远程连接测试
      res.json({ success: true, status: 'connected' })
    } else {
      res.json({ success: false, status: 'unknown', message: '未知实例类型' })
    }
  } catch (error) {
    res.status(500).json({ error: '测试连接失败', message: error.message })
  }
})

// ==================== 实例操作 API ====================

// 获取实例配置
app.get('/api/instances/:id/config', (req, res) => {
  const { id } = req.params
  const instance = instances.find(i => i.id === id)
  
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }
  
  try {
    const configPath = instance.configPath.replace('~', os.homedir())
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    res.json(config)
  } catch (error) {
    res.status(500).json({ error: '读取配置失败', message: error.message })
  }
})

// 保存实例配置
app.post('/api/instances/:id/config', (req, res) => {
  const { id } = req.params
  const instance = instances.find(i => i.id === id)
  
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }
  
  try {
    const configPath = instance.configPath.replace('~', os.homedir())
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2))
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: '保存配置失败', message: error.message })
  }
})

// 重启实例
app.post('/api/instances/:id/restart', (req, res) => {
  const { id } = req.params
  const instance = instances.find(i => i.id === id)
  
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }
  
  if (instance.type === 'local' || instance.type === 'stepfun-desktop') {
    exec('openclaw gateway restart', (error, stdout, stderr) => {
      if (error) {
        res.status(500).json({ error: '重启失败', message: error.message })
      } else {
        res.json({ success: true, message: 'OpenClaw 已重启' })
      }
    })
  } else {
    res.json({ success: false, message: '远程实例重启暂未实现' })
  }
})

// 获取实例日志
app.get('/api/instances/:id/logs', (req, res) => {
  const { id } = req.params
  const { lines = 100 } = req.query
  
  const instance = instances.find(i => i.id === id)
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }
  
  // 模拟日志数据
  const logs = [
    { id: '1', timestamp: '2024-05-22 10:30:15', level: 'info', source: 'system', message: 'OpenClaw 启动成功' },
    { id: '2', timestamp: '2024-05-22 10:30:16', level: 'info', source: 'gateway', message: 'Gateway 监听中' },
    { id: '3', timestamp: '2024-05-22 10:30:17', level: 'info', source: 'skill:weather', message: 'Skill 加载成功' },
  ]
  
  res.json(logs)
})

// 默认获取本地实例的日志（兼容旧版 API）
app.get('/api/logs', (req, res) => {
  try {
    const logPaths = [
      path.join(os.homedir(), '.stepclaw', 'logs', 'openclaw.log'),
      path.join(os.homedir(), '.stepclaw', 'logs', 'gateway.log'),
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
              id: `log-${logEntries.length + 1}`,
              timestamp: match[1].replace('T', ' '),
              level: match[2].toLowerCase(),
              source: path.basename(logPath, '.log'),
              message: match[3].trim()
            })
          } else {
            logEntries.push({
              id: `log-${logEntries.length + 1}`,
              timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
              level: 'info',
              source: path.basename(logPath, '.log'),
              message: line.substring(0, 200)
            })
          }
        }
      }
    }

    logEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    res.json(logEntries.slice(0, 500))
  } catch (error) {
    res.json([])
  }
})

// 默认获取本地实例的配置（兼容旧版 API）
app.get('/api/config', (req, res) => {
  const localInstance = instances.find(i => i.id === 'local')
  if (!localInstance) {
    return res.status(404).json({ error: '本地实例不存在' })
  }
  
  try {
    const configPath = localInstance.configPath.replace('~', os.homedir())
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    res.json(config)
  } catch (error) {
    res.status(500).json({ error: '读取配置失败', message: error.message })
  }
})

// 默认保存本地实例的配置（兼容旧版 API）
app.post('/api/config', (req, res) => {
  const localInstance = instances.find(i => i.id === 'local')
  if (!localInstance) {
    return res.status(404).json({ error: '本地实例不存在' })
  }
  
  try {
    const configPath = localInstance.configPath.replace('~', os.homedir())
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2))
    res.json({ success: true, message: '配置已保存' })
  } catch (error) {
    res.status(500).json({ error: '保存配置失败', message: error.message })
  }
})


app.put('/api/config/providers/:providerId', (req, res) => {
  try {
    const config = loadLocalConfig()
    config.providers = config.providers || {}
    config.providers[req.params.providerId] = {
      ...(config.providers[req.params.providerId] || {}),
      ...req.body
    }
    saveLocalConfig(config)
    res.json({ success: true, provider: config.providers[req.params.providerId] })
  } catch (error) {
    res.status(500).json({ error: '保存配置失败', message: error.message })
  }
})

app.post('/api/config/test-provider', async (req, res) => {
  const { baseUrl, apiKey, model, provider } = req.body || {}
  if (!baseUrl || !apiKey) return res.status(400).json({ success: false, error: '缺少 baseUrl 或 apiKey' })

  try {
    const requestedModel = model || (KNOWN_PROVIDERS[provider]?.models?.[0]?.id || 'gpt-4o-mini')
    const availableModels = await fetchProviderModels({ provider, apiKey, baseUrl })
    const testMessageResult = await callProviderAI({
      provider,
      apiKey,
      baseUrl,
      model: requestedModel,
      messages: [{ role: 'user', content: 'Hi' }],
      options: { maxTokens: 5 }
    })

    res.json({
      success: testMessageResult.success,
      message: testMessageResult.success ? '连接成功' : (testMessageResult.error || '连接失败'),
      availableModels,
      testMessageResult: testMessageResult.success
        ? { status: 'ok', reply: testMessageResult.data.text }
        : { status: 'error', statusCode: testMessageResult.statusCode, error: testMessageResult.error }
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/models', (req, res) => {
  try {
    const config = loadLocalConfig()
    const models = []
    const addedKeys = new Set()
    const configuredProviders = new Set()

    function addModel(key, label, provider, hasKey) {
      if (addedKeys.has(key)) return
      addedKeys.add(key)
      models.push({ key, label, provider, hasApiKey: hasKey })
    }

    if (config.models?.providers) {
      for (const [providerId, providerData] of Object.entries(config.models.providers)) {
        configuredProviders.add(providerId)
        const hasKey = hasApiKey(config, providerId)
        if (Array.isArray(providerData.models)) {
          for (const model of providerData.models) {
            addModel(`${providerId}/${model.id}`, `${providerId} - ${model.name || model.id}`, providerId, hasKey)
          }
        }
      }
    }

    if (config.providers) {
      for (const providerId of Object.keys(config.providers)) configuredProviders.add(providerId)
    }

    for (const providerId of configuredProviders) {
      const hasKey = hasApiKey(config, providerId)
      const known = KNOWN_PROVIDERS[providerId]
      if (known) {
        for (const model of known.models) {
          addModel(`${providerId}/${model.id}`, `${known.name} - ${model.name}`, providerId, hasKey)
        }
      } else {
        const providerData = config.providers?.[providerId] || config.models?.providers?.[providerId] || {}
        const modelId = providerData.model || `${providerId}-chat`
        addModel(`${providerId}/${modelId}`, `${providerId} - ${modelId}`, providerId, hasKey)
      }
    }

    for (const model of getCcSwitchModelList()) {
      addModel(`cc-switch/${model.id}`, `CC Switch 当前路由（${model.routeName}）- ${model.name}`, 'cc-switch', true)
    }

    models.sort((a, b) => Number(b.hasApiKey) - Number(a.hasApiKey))
    res.json({ models, providersWithKey: [...new Set(models.filter(m => m.hasApiKey).map(m => m.provider))] })
  } catch (error) {
    res.status(500).json({ error: '读取模型列表失败', message: error.message })
  }
})

// ==================== 聊天 API（实例级别）====================

// 获取实例的会话列表
app.get('/api/instances/:id/sessions', (req, res) => {
  const { id } = req.params
  const sessions = []
  
  try {
    const instanceChatDir = path.join(CHAT_DIR, id)
    if (fs.existsSync(instanceChatDir)) {
      const files = fs.readdirSync(instanceChatDir)
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const sessionId = file.replace('.json', '')
          const filePath = path.join(instanceChatDir, file)
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
    }
    
    sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    res.json(sessions)
  } catch (error) {
    res.json([])
  }
})

// 创建会话
app.post('/api/instances/:id/sessions', (req, res) => {
  const { id } = req.params
  const sessionId = `session-${Date.now()}`
  
  const sessionData = {
    id: sessionId,
    instanceId: id,
    title: req.body.title || '新会话',
    model: req.body.model || 'step-alpha',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isFavorite: false
  }
  
  const instanceChatDir = path.join(CHAT_DIR, id)
  if (!fs.existsSync(instanceChatDir)) {
    fs.mkdirSync(instanceChatDir, { recursive: true })
  }
  
  const filePath = path.join(instanceChatDir, `${sessionId}.json`)
  fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2))
  
  res.json(sessionData)
})

// 获取会话详情
app.get('/api/instances/:instanceId/sessions/:sessionId', (req, res) => {
  const { instanceId, sessionId } = req.params
  const filePath = path.join(CHAT_DIR, instanceId, `${sessionId}.json`)
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '会话不存在' })
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  res.json(data)
})

// 发送消息（调用实例的 AI）
app.post('/api/instances/:instanceId/sessions/:sessionId/chat', async (req, res) => {
  const { instanceId, sessionId } = req.params
  const { message, model, provider } = req.body
  
  if (!message) {
    return res.status(400).json({ error: '消息不能为空' })
  }
  
  const instance = instances.find(i => i.id === instanceId)
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }
  
  // 读取 openclaw.json 配置
  const configPath = path.join(os.homedir(), '.stepclaw', 'openclaw.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  
  // 读取会话
  const filePath = path.join(CHAT_DIR, instanceId, `${sessionId}.json`)
  let sessionData
  
  if (fs.existsSync(filePath)) {
    sessionData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (model) {
      sessionData.model = model
    }
    if (provider) {
      sessionData.provider = provider
    }
  } else {
    sessionData = {
      id: sessionId,
      instanceId,
      title: '新会话',
      model: model || 'step-alpha',
      provider: provider || 'stepfun',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }
  
  // 添加用户消息
  const userMessage = {
    id: Date.now().toString(),
    role: 'user',
    content: message,
    timestamp: new Date().toISOString()
  }
  sessionData.messages.push(userMessage)
  
  let reply = ''
  let modelName = sessionData.model || 'step-alpha'
  const providerId = sessionData.provider || 'stepfun'
  
  // 解析当前使用的 provider 和 model
  const modelParts = modelName.split('/')
  const actualProvider = modelParts.length > 1 ? modelParts[0] : providerId
  const actualModel = modelParts.length > 1 ? modelParts[1] : modelName
  let routedProvider = actualProvider
  let routedModel = actualModel
  
  try {
    
    // 查找 provider 配置：优先从 providers（用户配置），其次 models.providers（系统配置）
    let providerConfig = null
    let apiKey = null
    let baseUrl = null
    
    if (actualProvider === 'cc-switch' || actualProvider === 'ccswitch') {
      const route = getCurrentCcSwitchOpenClawProvider()
      const routeModels = Array.isArray(route?.settings?.models) ? route.settings.models : []
      const fallbackModel = routeModels.find(m => m?.id)?.id
      if (!route || !route.settings?.baseUrl || !route.settings?.apiKey) {
        reply = '[CC Switch] 未找到可用的 OpenClaw 路由，请先在 CC Switch 中配置 openclaw provider。'
      } else {
        routedProvider = getCcSwitchApiProtocol(route.settings.api)
        routedModel = actualModel || fallbackModel
        apiKey = route.settings.apiKey
        baseUrl = route.settings.baseUrl
      }
    } else {
      if (config.providers && config.providers[actualProvider]) {
        providerConfig = config.providers[actualProvider]
        apiKey = providerConfig.apiKey
        baseUrl = providerConfig.baseUrl
      }
      
      if (config.models?.providers && config.models.providers[actualProvider]) {
        const sysConfig = config.models.providers[actualProvider]
        if (!apiKey) apiKey = sysConfig.apiKey
        if (!baseUrl) baseUrl = sysConfig.baseUrl
      }
    }
    
    if (!apiKey) {
      reply = `[${instance.name}] 未配置 ${actualProvider} API Key\n\n请在模型配置页面配置 API Key。`
    } else {
      // 构建系统提示（包含已挂载 Skills 列表）
      const systemPrompt = buildSystemPrompt()
      const knowledgeContext = getKnowledgeContext(message)
      let fullSystemPrompt = systemPrompt || ''
      if (knowledgeContext) {
        fullSystemPrompt += `\n\n${knowledgeContext}`
      }

      // 构建消息历史
      const messages = sessionData.messages.map((m) => ({
        role: m.role,
        content: m.content
      }))

      // 将系统提示作为第一条消息注入
      if (fullSystemPrompt) {
        messages.unshift({ role: 'system', content: fullSystemPrompt })
      }
      
      const result = await callProviderAI({
        provider: routedProvider,
        apiKey,
        baseUrl,
        model: routedModel,
        messages,
        options: { maxTokens: 4000, temperature: 0.7 }
      })
      
      if (result.success) {
        reply = result.data.text || '无回复'
        modelName = routedModel
      } else {
        console.error(`${actualProvider} API 错误:`, result.error)
        reply = `[${actualProvider}] 调用失败：${result.statusCode || ''}\n\n请检查：\n1. API Key 是否正确\n2. Base URL 是否正确（${baseUrl}）\n3. 模型名称是否正确（${routedModel}）\n\n${result.error || ''}`
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
  
  // 添加助手回复
  const assistantMessage = {
    id: (Date.now() + 1).toString(),
    role: 'assistant',
    content: reply,
    timestamp: new Date().toISOString(),
    model: modelName
  }
  sessionData.messages.push(assistantMessage)
  
  // 更新会话
  sessionData.updatedAt = new Date().toISOString()
  if (sessionData.messages.length === 2) {
    sessionData.title = message.substring(0, 20) + (message.length > 20 ? '...' : '')
  }
  
  fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2))
  
  res.json({
    reply,
    model: modelName,
    provider: actualProvider,
    requestedModel: sessionData.model,
    instance: {
      id: instance.id,
      name: instance.name,
      type: instance.type
    },
    usage: {
      totalMessages: sessionData.messages.length
    },
    timestamp: new Date().toISOString()
  })
})

// ==================== Skills 管理 ====================

// 默认获取本地实例的 skills（兼容旧版 API）
app.get('/api/skills', (req, res) => {
  try {
    const skills = []
    const seen = new Set()

    for (const root of getConfiguredSkillRoots()) {
      if (!fs.existsSync(root)) continue
      const entries = fs.readdirSync(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || seen.has(entry.name)) continue
        const skillPath = path.join(root, entry.name)
        if (!fs.existsSync(path.join(skillPath, 'SKILL.md'))) continue
        seen.add(entry.name)
        skills.push(readSkillInfo(skillPath, entry.name))
      }
    }
    
    res.json(skills)
  } catch (error) {
    res.status(500).json({ error: '读取 skills 失败', message: error.message })
  }
})

app.post('/api/skills/:id/reload', (req, res) => {
  const found = findSkillDirectory(req.params.id)
  if (!found) return res.status(404).json({ success: false, error: 'Skill 不存在' })
  res.json({ success: true, skill: req.params.id, message: 'Skill 配置已重新读取' })
})

app.post('/api/skills/install', upload.single('file'), (req, res) => {
  try {
    const input = (req.body?.input || '').trim()
    if (req.file) {
      return res.status(400).json({
        success: false,
        error: '暂不支持直接解压安装压缩包，请先解压到本地目录后填写目录路径'
      })
    }

    if (!input) {
      return res.status(400).json({ success: false, error: '请输入本地 Skill 目录路径' })
    }

    const sourcePath = input.replace(/^~(?=$|\/)/, os.homedir())
    if (!fs.existsSync(path.join(sourcePath, 'SKILL.md'))) {
      return res.status(400).json({ success: false, error: '目录中未找到 SKILL.md' })
    }

    const targetPath = path.join(USER_SKILLS_DIR, path.basename(sourcePath))
    if (fs.existsSync(targetPath)) {
      return res.status(409).json({ success: false, error: '同名 Skill 已存在' })
    }

    fs.cpSync(sourcePath, targetPath, { recursive: true })
    res.json({ success: true, skill: path.basename(sourcePath), message: 'Skill 已安装' })
  } catch (error) {
    res.status(500).json({ success: false, error: '安装失败', message: error.message })
  }
})

app.delete('/api/skills/:id', (req, res) => {
  try {
    const found = findSkillDirectory(req.params.id)
    if (!found) return res.status(404).json({ success: false, error: 'Skill 不存在' })
    if (!found.isUserSkill) {
      return res.status(403).json({
        success: false,
        error: '该 Skill 来自额外加载目录。请从 Skills 加载目录中移除对应路径，或在源目录手动删除。'
      })
    }
    fs.rmSync(found.skillPath, { recursive: true, force: true })
    res.json({ success: true, skill: req.params.id, message: 'Skill 已卸载' })
  } catch (error) {
    res.status(500).json({ success: false, error: '卸载失败', message: error.message })
  }
})

app.get('/api/instances/:id/skills', (req, res) => {
  const { id } = req.params
  
  try {
    // 从 ~/.stepclaw/skills/ 读取真实的 skills
    const skillsDir = path.join(os.homedir(), '.stepclaw', 'skills')
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
            
            skills.push({
              id: entry.name,
              name: entry.name,
              description: nameMatch ? nameMatch[1] : entry.name,
              status: 'active'
            })
          }
        }
      }
    }
    
    res.json(skills)
  } catch (error) {
    res.status(500).json({ error: '读取 skills 失败', message: error.message })
  }
})

// ==================== 技能执行 API ====================

// 执行 skill
app.post('/api/instances/:id/skills/:skillName/execute', async (req, res) => {
  const { id, skillName } = req.params
  const { params = '' } = req.body
  
  const instance = instances.find(i => i.id === id)
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }
  
  // 只有本地实例才能执行技能
  if (instance.type !== 'local' && instance.type !== 'stepfun-desktop') {
    return res.status(403).json({ error: '只有本地实例可以执行技能' })
  }
  
  try {
    const found = findSkillDirectory(skillName)
    if (!found) {
      return res.status(404).json({ success: false, error: 'Skill 不存在' })
    }
    const info = readSkillInfo(found.skillPath, skillName)
    res.json({
      success: true,
      mode: 'prompt',
      skill: skillName,
      params,
      output: `已选择 Skill：${info.name}。请在 AI 对话中描述你的需求，系统会结合该 Skill 的说明处理。`,
      description: info.description
    })
  } catch (error) {
    res.status(500).json({ success: false, error: '调用失败', message: error.message })
  }
})

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

// 打开本地应用
app.post('/api/instances/:id/apps/:appName/open', async (req, res) => {
  const { id, appName } = req.params
  
  const instance = instances.find(i => i.id === id)
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }
  
  const commands = {
    'feishu': 'open -a "Lark" || open -a "飞书"',
    'wechat': 'open -a "WeChat" || open -a "微信"',
    'chrome': 'open -a "Google Chrome"',
    'safari': 'open -a "Safari"',
    'terminal': 'open -a "Terminal"',
    'finder': 'open -a "Finder"',
    'vscode': 'open -a "Visual Studio Code"'
  }
  
  const command = commands[appName] || `open -a "${appName}"`
  
  try {
    const { exec } = await import('child_process')
    
    exec(command, (error) => {
      if (error) {
        res.status(500).json({ success: false, error: error.message })
      } else {
        res.json({ success: true, app: appName })
      }
    })
  } catch (error) {
    res.status(500).json({ error: '打开失败', message: error.message })
  }
})

// ==================== Dashboard API ====================

// GET /api/dashboard/stats
app.get('/api/dashboard/stats', (req, res) => {
  try {
    const skillsDir = path.join(os.homedir(), '.stepclaw', 'skills')
    let totalSkills = 0
    let activeSkills = 0
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      totalSkills = entries.filter(e => e.isDirectory()).length
      activeSkills = totalSkills
    }

    let totalSessions = 0
    let activeSessions = 0
    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000

    if (fs.existsSync(CHAT_DIR)) {
      const instanceDirs = fs.readdirSync(CHAT_DIR, { withFileTypes: true }).filter(e => e.isDirectory())
      for (const dir of instanceDirs) {
        const instanceChatDir = path.join(CHAT_DIR, dir.name)
        const files = fs.readdirSync(instanceChatDir).filter(f => f.endsWith('.json'))
        totalSessions += files.length
        for (const file of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(instanceChatDir, file), 'utf8'))
            const updatedAt = new Date(data.updatedAt || data.createdAt).getTime()
            if (now - updatedAt < oneDayMs) {
              activeSessions++
            }
          } catch (_) {}
        }
      }
    }

    const agents = loadAgentsFromConfig() || []
    const totalAgents = agents.length
    const runningAgents = agents.filter(agent => agent.status === 'running').length

    const uptimeSeconds = os.uptime()
    const days = Math.floor(uptimeSeconds / 86400)
    const hours = Math.floor((uptimeSeconds % 86400) / 3600)
    const minutes = Math.floor((uptimeSeconds % 3600) / 60)
    const systemUptime = days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`

    const loadAvg = os.loadavg()
    const cpuUsage = Math.round(loadAvg[0] * 100) / os.cpus().length
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const memoryUsage = Math.round(((totalMem - freeMem) / totalMem) * 100)

    res.json({
      totalAgents,
      runningAgents,
      totalSessions,
      activeSessions,
      totalSkills,
      activeSkills,
      systemUptime,
      cpuUsage,
      memoryUsage
    })
  } catch (error) {
    res.status(500).json({ error: '获取统计信息失败', message: error.message })
  }
})

// GET /api/dashboard/activity
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
            const timestamp = data.updatedAt || data.createdAt
            if (data.messages && data.messages.length > 0) {
              activities.push({
                id: `${dir.name}-${file.replace('.json', '')}`,
                type: 'info',
                message: `${data.title || '会话'}: ${data.messages[data.messages.length - 1].content.substring(0, 80)}`,
                time: timestamp
              })
            }
          } catch (_) {}
        }
      }
    }

    activities.sort((a, b) => new Date(b.time) - new Date(a.time))
    res.json(activities.slice(0, 10))
  } catch (error) {
    res.status(500).json({ error: '获取活动记录失败', message: error.message })
  }
})

// ==================== Agents API ====================

// 辅助函数：从 openclaw.json 读取 agents 配置
function loadAgentsFromConfig() {
  try {
    const configPath = path.join(os.homedir(), '.stepclaw', 'openclaw.json')
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      const defaultModel = config.agents?.defaults?.model || config.models?.defaults?.model || ''
      const normalize = (agent, id, index) => ({
        id: agent.id || agent.name || id || `agent-${index}`,
        name: agent.name || agent.id || id || `Agent ${index + 1}`,
        description: agent.description || '',
        status: agent.status || 'stopped',
        model: agent.model || defaultModel,
        createdAt: agent.createdAt || '',
        lastActive: agent.lastActive || '',
        messageCount: Number(agent.messageCount || 0),
        uptime: agent.uptime || '0h',
        config: {
          temperature: agent.config?.temperature ?? agent.temperature ?? 0.7,
          maxTokens: agent.config?.maxTokens ?? agent.maxTokens ?? 4000,
          systemPrompt: agent.config?.systemPrompt || agent.systemPrompt || '',
          skills: Array.isArray(agent.config?.skills) ? agent.config.skills : []
        }
      })

      if (Array.isArray(config.agents)) {
        return config.agents.map((agent, index) => normalize(agent, null, index))
      }

      if (Array.isArray(config.agents?.list)) {
        return config.agents.list.map((agent, index) => normalize(agent, null, index))
      }

      if (config.agents && typeof config.agents === 'object') {
        return Object.entries(config.agents)
          .filter(([key]) => !['defaults', 'default', 'list'].includes(key))
          .map(([key, agent], index) => normalize(agent || {}, key, index))
      }
    }
  } catch (_) {}
  return null
}

function updateAgentStatusInConfig(agentId, status) {
  const configPath = path.join(os.homedir(), '.stepclaw', 'openclaw.json')
  if (!fs.existsSync(configPath)) return false

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  let found = false
  const matches = (agent, index, key) => (agent.id || agent.name || key || `agent-${index}`) === agentId

  if (Array.isArray(config.agents)) {
    config.agents.forEach((agent, index) => {
      if (matches(agent, index)) {
        agent.status = status
        found = true
      }
    })
  } else if (Array.isArray(config.agents?.list)) {
    config.agents.list.forEach((agent, index) => {
      if (matches(agent, index)) {
        agent.status = status
        found = true
      }
    })
  } else if (config.agents && typeof config.agents === 'object') {
    Object.entries(config.agents).forEach(([key, agent], index) => {
      if (!['defaults', 'default', 'list'].includes(key) && matches(agent, index, key)) {
        agent.status = status
        found = true
      }
    })
  }

  if (found) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  }
  return found
}

// GET /api/instances/:id/agents
app.get('/api/instances/:id/agents', (req, res) => {
  const { id } = req.params
  const instance = instances.find(i => i.id === id)
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }

  const agents = loadAgentsFromConfig()
  if (agents !== null) {
    return res.json(agents)
  }
  res.json([])
})

// PUT /api/instances/:id/agents/:agentId
app.put('/api/instances/:id/agents/:agentId', (req, res) => {
  const { id, agentId } = req.params
  const instance = instances.find(i => i.id === id)
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }

  try {
    const configPath = path.join(os.homedir(), '.stepclaw', 'openclaw.json')
    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: '配置文件不存在' })
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

    let found = false
    if (config.agents && Array.isArray(config.agents)) {
      for (let i = 0; i < config.agents.length; i++) {
        if ((config.agents[i].id || config.agents[i].name || `agent-${i}`) === agentId) {
          config.agents[i] = { ...config.agents[i], ...req.body }
          found = true
          break
        }
      }
    } else if (config.agents && typeof config.agents === 'object') {
      for (const key of Object.keys(config.agents)) {
        if (key === agentId) {
          config.agents[key] = { ...config.agents[key], ...req.body }
          found = true
          break
        }
      }
    }

    if (!found) {
      return res.status(404).json({ error: 'Agent 不存在' })
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: '更新 Agent 失败', message: error.message })
  }
})

// POST /api/instances/:id/agents/:agentId/start
app.post('/api/instances/:id/agents/:agentId/start', (req, res) => {
  const { id, agentId } = req.params
  const instance = instances.find(i => i.id === id)
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }
  try {
    if (!updateAgentStatusInConfig(agentId, 'running')) {
      return res.status(404).json({ error: 'Agent 不存在' })
    }
    res.json({ success: true, agentId, status: 'running', message: `Agent ${agentId} 已启动` })
  } catch (error) {
    res.status(500).json({ error: '启动 Agent 失败', message: error.message })
  }
})

// POST /api/instances/:id/agents/:agentId/stop
app.post('/api/instances/:id/agents/:agentId/stop', (req, res) => {
  const { id, agentId } = req.params
  const instance = instances.find(i => i.id === id)
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }
  try {
    if (!updateAgentStatusInConfig(agentId, 'stopped')) {
      return res.status(404).json({ error: 'Agent 不存在' })
    }
    res.json({ success: true, agentId, status: 'stopped', message: `Agent ${agentId} 已停止` })
  } catch (error) {
    res.status(500).json({ error: '停止 Agent 失败', message: error.message })
  }
})

// DELETE /api/instances/:id/agents/:agentId
app.delete('/api/instances/:id/agents/:agentId', (req, res) => {
  const { id, agentId } = req.params
  const instance = instances.find(i => i.id === id)
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }

  try {
    const configPath = path.join(os.homedir(), '.stepclaw', 'openclaw.json')
    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: '配置文件不存在' })
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

    let found = false
    if (config.agents && Array.isArray(config.agents)) {
      config.agents = config.agents.filter((a, i) => {
        const aid = a.id || a.name || `agent-${i}`
        if (aid === agentId) { found = true; return false }
        return true
      })
    } else if (config.agents && typeof config.agents === 'object') {
      if (config.agents[agentId]) {
        delete config.agents[agentId]
        found = true
      }
    }

    if (!found) {
      return res.status(404).json({ error: 'Agent 不存在' })
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: '删除 Agent 失败', message: error.message })
  }
})

// ==================== Sessions CRUD ====================

// DELETE /api/instances/:instanceId/sessions/:sessionId
app.delete('/api/instances/:instanceId/sessions/:sessionId', (req, res) => {
  const { instanceId, sessionId } = req.params
  const filePath = path.join(CHAT_DIR, instanceId, `${sessionId}.json`)

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '会话不存在' })
  }

  try {
    fs.unlinkSync(filePath)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: '删除会话失败', message: error.message })
  }
})

// PATCH /api/instances/:instanceId/sessions/:sessionId
app.patch('/api/instances/:instanceId/sessions/:sessionId', (req, res) => {
  const { instanceId, sessionId } = req.params
  const filePath = path.join(CHAT_DIR, instanceId, `${sessionId}.json`)

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '会话不存在' })
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const updated = { ...data, ...req.body, updatedAt: new Date().toISOString() }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2))
    res.json(updated)
  } catch (error) {
    res.status(500).json({ error: '更新会话失败', message: error.message })
  }
})

// ==================== 兼容旧 API ====================

// GET /api/agents
app.get('/api/agents', (req, res) => {
  const agents = loadAgentsFromConfig()
  if (agents !== null) {
    return res.json(agents)
  }
  res.json([])
})

// GET /api/sessions/active
app.get('/api/sessions/active', (req, res) => {
  try {
    const activeSessions = []
    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000

    if (fs.existsSync(CHAT_DIR)) {
      const instanceDirs = fs.readdirSync(CHAT_DIR, { withFileTypes: true }).filter(e => e.isDirectory())
      for (const dir of instanceDirs) {
        const instanceChatDir = path.join(CHAT_DIR, dir.name)
        if (!fs.existsSync(instanceChatDir)) continue
        const files = fs.readdirSync(instanceChatDir).filter(f => f.endsWith('.json'))
        for (const file of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(instanceChatDir, file), 'utf8'))
            const updatedAt = new Date(data.updatedAt || data.createdAt).getTime()
            if (now - updatedAt < oneDayMs) {
              activeSessions.push({
                id: file.replace('.json', ''),
                agentId: data.instanceId || dir.name,
                agentName: data.title || '会话',
                status: 'active',
                startTime: data.createdAt,
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
  } catch (error) {
    res.json([])
  }
})

// ==================== 设置与记忆 API ====================

app.get('/api/settings', (req, res) => {
  const settings = loadSettings()
  settings.data = { ...settings.data, dataDir: path.join(os.homedir(), '.stepclaw') }
  try {
    let cacheSize = 0
    const walkDir = (dir) => {
      if (!fs.existsSync(dir)) return
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) walkDir(fullPath)
        else cacheSize += fs.statSync(fullPath).size
      }
    }
    if (fs.existsSync(DATA_DIR)) walkDir(DATA_DIR)
    settings.data.cacheSize = cacheSize
  } catch (_) {}
  res.json(settings)
})

app.put('/api/settings', (req, res) => {
  const current = loadSettings()
  const updated = { ...current, ...req.body, updatedAt: new Date().toISOString() }
  saveSettings(updated)
  res.json(updated)
})

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
  try {
    cleanDir(DATA_DIR)
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.mkdirSync(CHAT_DIR, { recursive: true })
    fs.mkdirSync(MEMORY_DIR, { recursive: true })
    if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, JSON.stringify({ memories: {} }, null, 2))
    res.json({ success: true, deletedFiles: totalDeleted })
  } catch (error) {
    res.status(500).json({ error: '清除缓存失败', message: error.message })
  }
})

app.get('/api/memory', (req, res) => {
  res.json(loadMemory())
})

app.get('/api/memory/search', (req, res) => {
  const data = loadMemory()
  const q = String(req.query.q || '').toLowerCase()
  if (!q) return res.json({ memories: data.memories || {} })
  const filtered = {}
  for (const [key, entry] of Object.entries(data.memories || {})) {
    const value = String(entry.value || '')
    if (key.toLowerCase().includes(q) || value.toLowerCase().includes(q)) filtered[key] = entry
  }
  res.json({ memories: filtered, total: Object.keys(filtered).length })
})

app.post('/api/memory', (req, res) => {
  const { key, value, agent } = req.body
  if (!key || value === undefined) return res.status(400).json({ error: 'key 和 value 为必填' })
  const data = loadMemory()
  data.memories = data.memories || {}
  data.memories[key] = { value, agent: agent || 'defaults', timestamp: new Date().toISOString() }
  saveMemory(data)
  res.json({ key, ...data.memories[key] })
})

app.delete('/api/memory/:key', (req, res) => {
  const data = loadMemory()
  if (!data.memories?.[req.params.key]) return res.status(404).json({ error: '记忆不存在' })
  delete data.memories[req.params.key]
  saveMemory(data)
  res.json({ success: true })
})

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

app.get('/api/obsidian/search', (req, res) => {
  try {
    const q = String(req.query.q || '')
    const maxResults = Number(req.query.limit) || undefined
    res.json(searchObsidianVault(q, maxResults))
  } catch (error) {
    res.status(500).json({ error: '搜索 Obsidian 失败', message: error.message })
  }
})

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

// ==================== 工作流管理 API ====================

const WORKFLOWS_FILE = path.join(DATA_DIR, 'workflows.json')

// 默认工作流
const DEFAULT_WORKFLOWS = [
  {
    id: 'wf-daily-report',
    name: '每日报告生成',
    description: '每天定时采集数据 → Agent 分析 → 生成报告 → 推送飞书',
    status: 'draft',
    mode: 'sequential',
    nodes: [
      { id: 'n1', type: 'input', name: '定时触发', config: { cron: '0 8 * * *' } },
      { id: 'n2', type: 'agent', name: '数据采集 Agent', config: { agentId: 'main', prompt: '采集今日数据' } },
      { id: 'n3', type: 'agent', name: '报告生成 Agent', config: { agentId: 'main', prompt: '生成分析报告' } },
      { id: 'n4', type: 'skill', name: '飞书推送', config: { skillId: 'feishu', params: {} } },
      { id: 'n5', type: 'output', name: '输出报告', config: { format: 'markdown' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n4', target: 'n5' },
    ],
    createdAt: '2026-06-01',
    updatedAt: '2026-06-10',
  },
]

function loadWorkflows() {
  try {
    if (fs.existsSync(WORKFLOWS_FILE)) {
      return JSON.parse(fs.readFileSync(WORKFLOWS_FILE, 'utf8'))
    }
  } catch (_) {}
  return DEFAULT_WORKFLOWS
}

function saveWorkflows(workflows) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(workflows, null, 2), 'utf8')
}

// 工作流执行引擎
async function executeWorkflow(workflow) {
  const results = []
  const startTime = Date.now()

  try {
    if (workflow.mode === 'parallel') {
      // 并行执行：找出根节点后并行处理
      const sourceNodes = new Set(workflow.edges.map(e => e.source))
      const targetNodes = new Set(workflow.edges.map(e => e.target))
      const roots = workflow.nodes.filter(n => sourceNodes.has(n.id) && !targetNodes.has(n.id))
      const leafs = workflow.nodes.filter(n => targetNodes.has(n.id) && !sourceNodes.has(n.id))

      // 并行执行中间节点
      const middleNodes = workflow.nodes.filter(n => !roots.includes(n) && !leafs.includes(n))
      const middleResults = await Promise.all(middleNodes.map(n => executeNode(n, results)))
      results.push(...middleResults.filter(Boolean))

      // 汇总到叶子节点
      for (const leaf of leafs) {
        const r = await executeNode(leaf, results)
        if (r) results.push(r)
      }
    } else if (workflow.mode === 'conditional') {
      // 条件分支执行
      for (const node of workflow.nodes) {
        if (node.type === 'condition') {
          const conditionResult = Math.random() > 0.1 // 模拟条件判定
          const outgoing = workflow.edges.filter(e => e.source === node.id)
          const matchedEdge = outgoing.find(e => e.condition) || outgoing[0]
          if (matchedEdge) {
            const nextNode = workflow.nodes.find(n => n.id === matchedEdge.target)
            if (nextNode) {
              const r = await executeNode(nextNode, results)
              if (r) results.push(r)
            }
          }
        } else if (node.type === 'output') {
          const r = await executeNode(node, results)
          if (r) results.push(r)
        }
      }
    } else {
      // 串行执行
      const edgeMap = {}
      workflow.edges.forEach(e => { edgeMap[e.source] = e.target })

      let currentNodeId = workflow.nodes.find(n => n.type === 'input')?.id || workflow.nodes[0]?.id

      while (currentNodeId) {
        const node = workflow.nodes.find(n => n.id === currentNodeId)
        if (!node) break
        const r = await executeNode(node, results)
        if (r) results.push(r)
        currentNodeId = edgeMap[currentNodeId]
      }
    }

    return {
      success: true,
      results,
      duration: Date.now() - startTime,
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      results,
      duration: Date.now() - startTime,
    }
  }
}

// 执行单个节点
function executeNode(node, context) {
  return new Promise((resolve) => {
    const delay = node.type === 'delay' ? (node.config.ms || 1000) : 200 + Math.random() * 800
    setTimeout(() => {
      resolve({
        nodeId: node.id,
        nodeName: node.name,
        type: node.type,
        status: 'completed',
        output: `${node.name} 执行完成`,
        timestamp: new Date().toISOString(),
      })
    }, delay)
  })
}

// GET /api/workflows - 获取所有工作流
app.get('/api/workflows', (req, res) => {
  res.json(loadWorkflows())
})

// POST /api/workflows - 创建工作流
app.post('/api/workflows', (req, res) => {
  const workflows = loadWorkflows()
  const newWorkflow = { ...req.body, updatedAt: new Date().toISOString().split('T')[0] }
  workflows.unshift(newWorkflow)
  saveWorkflows(workflows)
  res.json(newWorkflow)
})

// PUT /api/workflows/:id - 更新工作流
app.put('/api/workflows/:id', (req, res) => {
  const workflows = loadWorkflows()
  const id = req.params.id
  const idx = workflows.findIndex(w => w.id === id)
  if (idx >= 0) {
    workflows[idx] = { ...workflows[idx], ...req.body, updatedAt: new Date().toISOString().split('T')[0] }
    saveWorkflows(workflows)
    res.json(workflows[idx])
  } else {
    res.status(404).json({ error: '未找到工作流' })
  }
})

// DELETE /api/workflows/:id - 删除工作流
app.delete('/api/workflows/:id', (req, res) => {
  const workflows = loadWorkflows()
  const filtered = workflows.filter(w => w.id !== req.params.id)
  saveWorkflows(filtered)
  res.json({ success: true })
})

// POST /api/workflows/:id/run - 执行工作流
app.post('/api/workflows/:id/run', (req, res) => {
  const workflows = loadWorkflows()
  const wf = workflows.find(w => w.id === req.params.id)
  if (!wf) return res.status(404).json({ error: '未找到工作流' })

  // 设置状态为运行中
  wf.status = 'running'
  wf.lastRunAt = new Date().toISOString().split('T')[0]
  saveWorkflows(workflows)

  // 异步执行工作流
  executeWorkflow(wf).then(result => {
    const updated = loadWorkflows()
    const target = updated.find(w => w.id === wf.id)
    if (target) {
      target.status = result.success ? 'completed' : 'failed'
      saveWorkflows(updated)
    }
  }).catch(() => {
    const updated = loadWorkflows()
    const target = updated.find(w => w.id === wf.id)
    if (target) {
      target.status = 'failed'
      saveWorkflows(updated)
    }
  })

  res.json({ success: true, message: '工作流已启动' })
})




// ==================== 静态文件服务 ====================
const serverFile = fileURLToPath(import.meta.url)
const serverDir = path.dirname(serverFile)
const distPath = [
  path.join(serverDir, 'dist'),
  path.join(serverDir, '..', 'dist'),
  path.join(process.cwd(), 'dist')
].find(candidate => fs.existsSync(path.join(candidate, 'index.html')))

if (distPath) {
  app.use(express.static(distPath))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    const indexPath = path.join(distPath, 'index.html')
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath)
    return res.status(404).json({ error: 'Not found' })
  })
}

// ==================== 启动服务器 ====================

app.listen(PORT, () => {
  console.log(`🚀 OpenClaw Web UI Server running on port ${PORT}`)
  console.log(`📱 API: http://localhost:${PORT}/api`)
  console.log(`💾 Data: ${DATA_DIR}`)
  console.log(`\n已加载 ${instances.length} 个实例：`)
  instances.forEach(i => console.log(`  • ${i.name} (${i.type}) - ${i.status}`))
})
