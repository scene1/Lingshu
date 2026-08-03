import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { exec, spawn, execFile, execFileSync } from 'child_process'
import os from 'os'
import multer from 'multer'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import MarkdownIt from 'markdown-it'

// 放宽 SSL 证书校验（自签证书 / 内部 API 网关需要）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const app = express()
const PORT = process.env.PORT || 3003

app.use(cors())
app.use(express.json())

// 数据存储目录：1.1.0 起统一迁移到 ~/Lingshu，保留 openclaw-web-ui-data 子目录以承接旧数据。
const MIGRATED_OPENCLAW_DATA_DIR = path.join(os.homedir(), 'Lingshu', 'workspace', 'openclaw-web-ui-data')
const DEFAULT_LINGSHU_DATA_DIR = path.join(os.homedir(), 'Lingshu', 'workspace', 'lingshu-app-data')
const DATA_DIR = process.env.LINGSHU_DATA_DIR || process.env.OPENCLAW_DATA_DIR || (fs.existsSync(MIGRATED_OPENCLAW_DATA_DIR) ? MIGRATED_OPENCLAW_DATA_DIR : DEFAULT_LINGSHU_DATA_DIR)
const INSTANCES_FILE = path.join(DATA_DIR, 'instances.json')
const CHAT_DIR = path.join(DATA_DIR, 'chat-history')
const UPLOAD_DIR = process.env.LINGSHU_UPLOAD_DIR || process.env.OPENCLAW_UPLOAD_DIR || path.join(os.homedir(), 'Lingshu', 'workspace', 'uploads')
const USER_SKILLS_DIR = path.join(os.homedir(), 'Lingshu', 'skills')
const DOCUMENT_VERSION_DIR = path.join(DATA_DIR, 'document-versions')
const MEETINGS_DIR = path.join(DATA_DIR, 'meetings')
const EXPORTS_DIR = path.join(DATA_DIR, 'exports')
const DOCUMENT_WORKBENCH_FILE = path.join(DATA_DIR, 'document-workbench.json')
const TOOL_RUNTIME_AUDIT_FILE = path.join(DATA_DIR, 'tool-runtime-audit.jsonl')
const AGENT_DESKTOP_INVOCATIONS_FILE = path.join(DATA_DIR, 'agent-desktop-invocations.jsonl')
const GROUP_CHAT_DIR = path.join(CHAT_DIR, 'group-chat')
const upload = multer({ dest: UPLOAD_DIR })
const markdownRenderer = new MarkdownIt({ html: false, linkify: true, typographer: true })
const documentWatchState = {
  key: '',
  watcher: null,
  events: [],
  timers: new Map(),
  fileWatches: new Map(),
  lastId: 0,
  error: ''
}

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
if (!fs.existsSync(DOCUMENT_VERSION_DIR)) {
  fs.mkdirSync(DOCUMENT_VERSION_DIR, { recursive: true })
}
if (!fs.existsSync(MEETINGS_DIR)) {
  fs.mkdirSync(MEETINGS_DIR, { recursive: true })
}
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true })
}
if (!fs.existsSync(DOCUMENT_WORKBENCH_FILE)) {
  fs.writeFileSync(DOCUMENT_WORKBENCH_FILE, JSON.stringify({ recent: [], favorites: [] }, null, 2))
}
if (!fs.existsSync(TOOL_RUNTIME_AUDIT_FILE)) {
  fs.writeFileSync(TOOL_RUNTIME_AUDIT_FILE, '')
}
if (!fs.existsSync(AGENT_DESKTOP_INVOCATIONS_FILE)) {
  fs.writeFileSync(AGENT_DESKTOP_INVOCATIONS_FILE, '')
}
if (!fs.existsSync(GROUP_CHAT_DIR)) {
  fs.mkdirSync(GROUP_CHAT_DIR, { recursive: true })
}

app.use('/uploads', express.static(UPLOAD_DIR))
app.use('/exports', express.static(EXPORTS_DIR, {
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
  }
}))

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    name: 'lingshu-app',
    port: PORT,
    time: new Date().toISOString()
  })
})

// 默认实例配置
const DEFAULT_INSTANCES = [
  {
    id: 'local',
    name: '本地灵枢运行时',
    type: 'local',
    status: 'connected',
    configPath: '~/Lingshu/openclaw.json',
    workspacePath: '~/Lingshu/workspace',
    description: '当前机器上的灵枢运行实例',
    lastConnected: new Date().toISOString()
  },
  {
    id: 'workbuddy-desktop',
    name: 'WorkBuddy',
    type: 'agent-desktop',
    status: 'disconnected',
    appName: 'WorkBuddy',
    configPath: '/Applications/WorkBuddy.app',
    workspacePath: '~/Lingshu/workspace',
    description: '本机 WorkBuddy Agent 桌面端',
    lastConnected: ''
  },
  {
    id: 'marvis-desktop',
    name: 'Marvis',
    type: 'agent-desktop',
    status: 'disconnected',
    appName: 'Marvis',
    configPath: '/Applications/Marvis.app',
    workspacePath: '~/Lingshu/workspace',
    description: '本机 Marvis Agent 桌面端',
    lastConnected: ''
  },
  {
    id: 'codex-desktop',
    name: 'Codex',
    type: 'agent-desktop',
    status: 'disconnected',
    appName: 'Codex',
    configPath: '/Applications/Codex.app',
    workspacePath: '~/Lingshu/workspace',
    description: '本机 Codex Agent 桌面端',
    lastConnected: ''
  }
]

function findInstalledMacAppPath(candidate) {
  const clean = String(candidate || '').trim().replace(/\.app$/i, '')
  if (!clean) return ''
  const appFileName = `${clean}.app`.toLowerCase()
  const roots = ['/Applications', path.join(os.homedir(), 'Applications')]
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue
      const entries = fs.readdirSync(root, { withFileTypes: true })
      const match = entries.find(entry => entry.isDirectory() && entry.name.toLowerCase() === appFileName)
      if (match) return path.join(root, match.name)
    } catch (_) {}
  }
  return ''
}

function safeInstanceSlug(value) {
  return String(value || 'agent')
    .trim()
    .toLowerCase()
    .replace(/\.app$/i, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'agent'
}

function parseUrlSchemes(info) {
  try {
    const rows = Array.isArray(info.CFBundleURLTypes) ? info.CFBundleURLTypes : []
    return rows.flatMap(row => Array.isArray(row.CFBundleURLSchemes) ? row.CFBundleURLSchemes : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  } catch (_) {
    return []
  }
}

function findExecutableOnPath(commandName) {
  const clean = String(commandName || '').trim()
  if (!clean || clean.includes('/') || /[\u0000\r\n]/.test(clean)) return ''
  const pathEntries = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
  const extraEntries = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
  for (const dir of [...pathEntries, ...extraEntries]) {
    try {
      const candidate = path.join(dir, clean)
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    } catch (_) {}
  }
  return ''
}

function detectAgentInvocationCapabilities(appInfo) {
  const displayName = String(appInfo.displayName || appInfo.name || '').toLowerCase()
  const bundleId = String(appInfo.bundleId || '').toLowerCase()
  const cliCandidateMap = [
    { match: /codex|openai/, commands: ['codex'] },
    { match: /workbuddy/, commands: ['workbuddy'] },
    { match: /marvis/, commands: ['marvis'] },
    { match: /cursor/, commands: ['cursor'] },
    { match: /claude/, commands: ['claude'] },
    { match: /chatgpt/, commands: ['chatgpt'] },
    { match: /parazta/, commands: ['parazta'] }
  ]
  const matched = cliCandidateMap.find(item => item.match.test(displayName) || item.match.test(bundleId))
  const cliCommand = matched?.commands.map(findExecutableOnPath).find(Boolean) || ''
  const urlScheme = (appInfo.urlSchemes || []).find(scheme =>
    !['http', 'https', 'file', 'mailto'].includes(String(scheme).toLowerCase())
  ) || ''
  return {
    canOpen: true,
    canUseUrlScheme: !!urlScheme,
    canUseCli: !!cliCommand,
    urlScheme,
    cliCommand,
    suggestedInvocationMode: cliCommand ? 'cli' : urlScheme ? 'url-scheme' : 'open',
    note: cliCommand
      ? `检测到 CLI：${cliCommand}`
      : urlScheme
        ? `检测到 URL Scheme：${urlScheme}://`
        : '未检测到可投递接口，默认打开桌面端并记录调用意图'
  }
}

function readMacAppInfo(appPath) {
  const fallbackName = path.basename(appPath, '.app')
  const infoPath = path.join(appPath, 'Contents', 'Info.plist')
  if (!fs.existsSync(infoPath)) {
    return { name: fallbackName, displayName: fallbackName, bundleId: '', version: '', path: appPath }
  }
  try {
    const raw = execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPath], {
      encoding: 'utf8',
      timeout: 5000
    })
    const info = JSON.parse(raw)
    const displayName = info.CFBundleDisplayName || info.CFBundleName || info.CFBundleExecutable || fallbackName
    return {
      name: String(info.CFBundleName || displayName || fallbackName),
      displayName: String(displayName || fallbackName),
      bundleId: String(info.CFBundleIdentifier || ''),
      version: String(info.CFBundleShortVersionString || info.CFBundleVersion || ''),
      executable: String(info.CFBundleExecutable || ''),
      urlSchemes: parseUrlSchemes(info),
      path: appPath
    }
  } catch (_) {
    return { name: fallbackName, displayName: fallbackName, bundleId: '', version: '', urlSchemes: [], path: appPath }
  }
}

function scanLocalAgentApps() {
  const roots = ['/Applications', path.join(os.homedir(), 'Applications')]
  const knownNames = new Set([
    'workbuddy',
    'marvis',
    'codex',
    'chatgpt',
    'claude',
    'cursor',
    'raycast',
    'parazta',
    'orcha writer',
    'orcha',
    'obsidian',
    'trae',
    'windsurf'
  ])
  const keywordPattern = /(agent|ai|gpt|claude|codex|buddy|marvis|cursor|parazta|orcha|trae|windsurf|assistant|copilot)/i
  const seen = new Set()
  const apps = []

  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue
      const entries = fs.readdirSync(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.endsWith('.app')) continue
        const appPath = path.join(root, entry.name)
        const info = readMacAppInfo(appPath)
        const haystack = `${entry.name} ${info.name} ${info.displayName} ${info.bundleId} ${info.executable || ''}`
        const normalizedName = String(info.displayName || info.name || entry.name).replace(/\.app$/i, '').toLowerCase()
        const known = knownNames.has(normalizedName) || knownNames.has(entry.name.replace(/\.app$/i, '').toLowerCase())
        const keyword = keywordPattern.test(haystack)
        if (!known && !keyword) continue
        const key = info.bundleId || appPath
        if (seen.has(key)) continue
        seen.add(key)
        const baseInfo = {
          name: info.name,
          displayName: info.displayName,
          bundleId: info.bundleId,
          version: info.version,
          executable: info.executable || '',
          urlSchemes: info.urlSchemes || [],
          path: appPath,
          source: root === '/Applications' ? 'applications' : 'home-applications',
          matchedReason: known ? 'known-agent-app' : 'keyword-match',
          installed: true
        }
        apps.push({
          ...baseInfo,
          invocation: detectAgentInvocationCapabilities(baseInfo)
        })
      }
    } catch (_) {}
  }

  return apps.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), 'zh-CN'))
}

function renderInvocationTemplate(template, instruction, context = {}) {
  return String(template || '')
    .replace(/\{\{instruction\}\}/g, instruction)
    .replace(/\{\{encodedInstruction\}\}/g, encodeURIComponent(instruction))
    .replace(/\{\{appName\}\}/g, context.appName || '')
    .replace(/\{\{instanceId\}\}/g, context.instanceId || '')
}

function parseCliArgsTemplate(template, instruction, context = {}) {
  const raw = String(template || '{{instruction}}')
  const lines = raw.includes('\n') ? raw.split('\n') : raw.split(/\s+/)
  return lines
    .map(line => renderInvocationTemplate(line, instruction, context).trim())
    .filter(Boolean)
}

function normalizeInvocationMode(instance) {
  const mode = String(instance?.invocationMode || '').trim()
  if (['cli', 'url-scheme', 'open'].includes(mode)) return mode
  if (instance?.cliCommand) return 'cli'
  if (instance?.urlTemplate || instance?.urlScheme) return 'url-scheme'
  return 'open'
}

function normalizeInstance(instance) {
  if (!instance || typeof instance !== 'object') return instance
  const next = { ...instance }
  if (next.type === 'stepfun-desktop') {
    next.type = 'agent-desktop'
    next.name = String(next.name || '').includes('阶跃') || String(next.name || '').includes('小跃')
      ? 'Agent 桌面端'
      : next.name
    next.description = String(next.description || '').replace(/阶跃 AI 桌面端托管的/, '本机 Agent 桌面端连接的')
    next.appName = next.appName || 'Agent Desktop'
  }
  return next
}

function seedAgentDesktopDefaults(existingInstances) {
  const next = Array.isArray(existingInstances) ? [...existingInstances] : []
  const existingIds = new Set(next.map(instance => instance?.id))
  for (const preset of DEFAULT_INSTANCES.filter(instance => instance.type === 'agent-desktop')) {
    if (!existingIds.has(preset.id)) next.push({ ...preset })
  }
  return next
}

// 加载实例列表
function loadInstances() {
  try {
    if (fs.existsSync(INSTANCES_FILE)) {
      const data = JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf8'))
      let loaded = (data.instances || DEFAULT_INSTANCES).map(normalizeInstance)
      if (data.agentDesktopDefaultsSeeded !== true) {
        loaded = seedAgentDesktopDefaults(loaded)
        fs.writeFileSync(INSTANCES_FILE, JSON.stringify({
          instances: loaded,
          updatedAt: new Date().toISOString(),
          agentDesktopDefaultsSeeded: true
        }, null, 2))
      }
      return loaded
    }
  } catch (error) {
    console.error('加载实例失败:', error)
  }
  return DEFAULT_INSTANCES.map(normalizeInstance)
}

// 保存实例列表
function saveInstances(instances) {
  try {
    fs.writeFileSync(INSTANCES_FILE, JSON.stringify({
      instances,
      updatedAt: new Date().toISOString(),
      agentDesktopDefaultsSeeded: true
    }, null, 2))
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
    const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
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
    const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
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

  return `你是灵枢 AI 助手，当前挂载了以下 Skills（技能）。当用户询问你的能力或技能时，必须严格列出这些实际挂载的 Skills，不要编造不存在的能力。

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
  excludeFolders: ['.obsidian', '.git', 'node_modules', '.trash', '.lingshu'],
  maxResults: 5,
  writeMemoryEnabled: true
}

const DEFAULT_TRANSCRIPTION_SETTINGS = {
  enabled: false,
  provider: 'browser',
  baseUrl: '',
  apiKey: '',
  model: 'whisper-1',
  language: 'zh'
}

const DEFAULT_SETTINGS = {
  general: { language: 'zh', theme: 'light', startup: 'last', fontSize: 14, autoScroll: true },
  models: { defaultModel: '', defaultProvider: '' },
  data: { cacheSize: 0 },
  obsidian: DEFAULT_OBSIDIAN_SETTINGS,
  transcription: DEFAULT_TRANSCRIPTION_SETTINGS,
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
        obsidian: { ...DEFAULT_OBSIDIAN_SETTINGS, ...(settings.obsidian || {}) },
        transcription: { ...DEFAULT_TRANSCRIPTION_SETTINGS, ...(settings.transcription || {}) }
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
  const excludeFolders = [
    ...DEFAULT_OBSIDIAN_SETTINGS.excludeFolders,
    ...normalizeFolderList(raw.excludeFolders, DEFAULT_OBSIDIAN_SETTINGS.excludeFolders)
  ]
  return {
    ...raw,
    vaultPath,
    includeFolders: normalizeFolderList(raw.includeFolders, DEFAULT_OBSIDIAN_SETTINGS.includeFolders),
    excludeFolders: [...new Set(excludeFolders)],
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
  const latinTokens = lower.match(/[a-z0-9_#+.]{2,}/g) || []
  const cjkSegments = lower.match(/[\u4e00-\u9fff]{2,}/g) || []
  const cjkTokens = []
  for (const segment of cjkSegments) {
    if (segment.length <= 4) cjkTokens.push(segment)
    for (let i = 0; i < segment.length - 1; i++) cjkTokens.push(segment.slice(i, i + 2))
  }
  return [...new Set([...latinTokens, ...cjkTokens])].slice(0, 32)
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripYamlQuotes(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '')
}

function parseYamlValue(value) {
  const clean = String(value || '').trim()
  if (clean.startsWith('[') && clean.endsWith(']')) {
    return clean.slice(1, -1).split(',').map(item => stripYamlQuotes(item)).filter(Boolean)
  }
  return stripYamlQuotes(clean)
}

function parseMarkdownFrontMatter(raw) {
  const empty = { tags: [], status: '', created: '', updated: '', extra: {}, hasFrontMatter: false }
  if (!String(raw || '').startsWith('---\n')) return empty
  const lines = String(raw || '').split('\n')
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (endIndex <= 0) return empty
  const frontMatter = { ...empty, hasFrontMatter: true, extra: {} }
  const yamlLines = lines.slice(1, endIndex)
  for (let index = 0; index < yamlLines.length; index++) {
    const line = yamlLines[index]
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    const lowerKey = key.toLowerCase()
    let parsed = parseYamlValue(match[2])
    if (match[2].trim() === '') {
      const values = []
      let cursor = index + 1
      while (cursor < yamlLines.length) {
        const child = yamlLines[cursor].match(/^\s*-\s+(.+)$/)
        if (!child) break
        values.push(stripYamlQuotes(child[1]))
        cursor++
      }
      if (values.length > 0) {
        parsed = values
        index = cursor - 1
      }
    }
    if (lowerKey === 'tags') {
      frontMatter.tags = Array.isArray(parsed) ? parsed : String(parsed || '').split(/[,\s]+/).filter(Boolean)
    } else if (lowerKey === 'status') {
      frontMatter.status = Array.isArray(parsed) ? parsed.join(', ') : String(parsed || '')
    } else if (lowerKey === 'created') {
      frontMatter.created = Array.isArray(parsed) ? parsed[0] || '' : String(parsed || '')
    } else if (lowerKey === 'updated') {
      frontMatter.updated = Array.isArray(parsed) ? parsed[0] || '' : String(parsed || '')
    } else {
      frontMatter.extra[key] = parsed
    }
  }
  return frontMatter
}

function readObsidianNote(filePath, config) {
  const stat = fs.statSync(filePath)
  if (stat.size > 512 * 1024) return null
  const raw = fs.readFileSync(filePath, 'utf8')
  const relativePath = path.relative(config.vaultPath, filePath).split(path.sep).join('/')
  const title = (raw.match(/^#\s+(.+)$/m)?.[1] || path.basename(filePath, '.md')).trim()
  const frontMatter = parseMarkdownFrontMatter(raw)
  const inlineTags = [...raw.matchAll(/(?:^|\s)#([\u4e00-\u9fff\w/-]+)/g)].map(match => match[1])
  const tags = [...new Set([...frontMatter.tags, ...inlineTags])]
  const headings = [...raw.matchAll(/^#{1,4}\s+(.+)$/gm)].map(match => match[1].trim()).slice(0, 12)
  const plain = stripMarkdownForSearch(raw)
  return { filePath, relativePath, title, tags, frontMatter, headings, raw, plain, mtime: stat.mtime.toISOString() }
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

  const memoryDir = path.join(config.vaultPath, '灵枢', 'Memory', 'Facts')
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
    `id: lingshu-${Date.now()}`,
    'type: memory',
    'source: lingshu',
    `created_at: ${now.toISOString()}`,
    `updated_at: ${now.toISOString()}`,
    `tags: [${['lingshu-memory', ...tagList].map(tag => `"${tag}"`).join(', ')}]`,
    '---'
  ].join('\n')

  atomicWriteTextFile(filePath, `${frontmatter}\n\n# ${safeTitle}\n\n${String(content || '').trim()}\n`)
  return {
    title: safeTitle,
    path: filePath,
    relativePath: path.relative(config.vaultPath, filePath).split(path.sep).join('/')
  }
}

function formatMemoryValueForMarkdown(value) {
  if (typeof value === 'string') return value
  try { return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`` }
  catch (_) { return String(value || '') }
}

function buildMemorySyncContent(key, entry) {
  const timestamp = entry?.timestamp || ''
  const syncedAt = new Date().toISOString()
  const metaLines = [
    '> 来源：灵枢记忆',
    entry?.agent ? `> Agent：${entry.agent}` : null,
    timestamp ? `> 原记录时间：${timestamp}` : null,
    `> 同步时间：${syncedAt}`
  ].filter(Boolean)
  return [
    ...metaLines,
    '',
    '## Memory Key',
    '',
    `\`${key}\``,
    '',
    '## 内容',
    '',
    formatMemoryValueForMarkdown(entry?.value)
  ].join('\n')
}

function syncMemoriesToObsidian({ keys = [], includeSynced = false } = {}) {
  const data = loadMemory()
  data.memories = data.memories || {}
  const selectedKeys = (Array.isArray(keys) && keys.length > 0 ? keys : Object.keys(data.memories))
    .map(key => String(key || '').trim())
    .filter(Boolean)
  const synced = []
  const skipped = []

  for (const key of selectedKeys) {
    const entry = data.memories[key]
    if (!entry) {
      skipped.push({ key, reason: '记忆不存在' })
      continue
    }
    if (!includeSynced && entry.syncedToObsidian?.relativePath) {
      skipped.push({ key, reason: '已同步' })
      continue
    }
    const note = writeObsidianMemoryNote({
      title: key,
      content: buildMemorySyncContent(key, entry),
      tags: ['manual-sync', entry.agent || 'memory'].filter(Boolean)
    })
    data.memories[key] = {
      ...entry,
      syncedToObsidian: {
        relativePath: note.relativePath,
        syncedAt: new Date().toISOString()
      }
    }
    synced.push({ key, note })
  }

  saveMemory(data)
  return { success: true, synced, skipped, memories: data.memories }
}

// ==================== 文档工作台与会议纪要共享能力 ====================

function getMarkdownVaultConfig() {
  const config = getObsidianConfig()
  const vaultPath = config.vaultPath ? path.resolve(config.vaultPath) : ''
  if (!vaultPath) return { ok: false, reason: '未配置 Markdown Vault 路径', config }
  if (!fs.existsSync(vaultPath)) return { ok: false, reason: 'Markdown Vault 路径不存在', config }
  if (!fs.statSync(vaultPath).isDirectory()) return { ok: false, reason: 'Markdown Vault 路径不是目录', config }
  return { ok: true, config: { ...config, vaultPath } }
}

function ensureLingshuVaultContract(config) {
  const metaDir = path.join(config.vaultPath, '.lingshu')
  if (!isPathInside(config.vaultPath, metaDir)) throw new Error('非法 .lingshu 路径')
  const subdirs = ['history', 'tasks', 'attachments']
  fs.mkdirSync(metaDir, { recursive: true })
  for (const subdir of subdirs) {
    const target = path.join(metaDir, subdir)
    if (!isPathInside(config.vaultPath, target)) throw new Error('非法 .lingshu 子目录')
    fs.mkdirSync(target, { recursive: true })
  }
  const readmePath = path.join(metaDir, 'README.md')
  if (!fs.existsSync(readmePath)) {
    atomicWriteTextFile(readmePath, [
      '# .lingshu',
      '',
      '这是灵枢在当前 Markdown Vault 中使用的轻量运行时目录。',
      '',
      '- `history/`：预留给文档快照或可重建历史。',
      '- `tasks/`：预留给 AI 写入待确认任务。',
      '- `attachments/`：预留给文档工作台附件。',
      '',
      '该目录会被灵枢和 Obsidian 检索默认排除；Markdown 正文仍然是唯一可信数据源。'
    ].join('\n'))
  }
  return {
    relativePath: '.lingshu',
    history: '.lingshu/history',
    tasks: '.lingshu/tasks',
    attachments: '.lingshu/attachments'
  }
}

function normalizeVaultRelativePath(inputPath, { allowEmpty = false } = {}) {
  const raw = String(inputPath || '').replace(/\\/g, '/').trim()
  if (!raw) {
    if (allowEmpty) return ''
    throw new Error('缺少文件路径')
  }
  if (path.isAbsolute(raw) || raw.startsWith('~')) throw new Error('仅允许 Vault 内相对路径')
  const normalized = path.posix.normalize(raw).replace(/^\/+/, '')
  if (!allowEmpty && (!normalized || normalized === '.')) throw new Error('缺少文件路径')
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error('非法路径')
  return normalized === '.' ? '' : normalized
}

function resolveVaultPath(relativePath, config, { requireMarkdown = false, allowDirectory = false } = {}) {
  const normalized = normalizeVaultRelativePath(relativePath, { allowEmpty: allowDirectory })
  if (requireMarkdown && !normalized.toLowerCase().endsWith('.md')) throw new Error('仅支持 Markdown 文件')
  const absolutePath = path.resolve(config.vaultPath, normalized)
  if (!isPathInside(config.vaultPath, absolutePath)) throw new Error('路径超出 Vault 范围')
  return { relativePath: normalized, absolutePath }
}

function hashContent(content) {
  return crypto.createHash('sha256').update(String(content || '')).digest('hex')
}

function fileRevision(filePath) {
  if (!fs.existsSync(filePath)) return ''
  return hashContent(fs.readFileSync(filePath, 'utf8'))
}

function atomicWriteTextFile(filePath, content) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`)
  let fd = null
  try {
    fd = fs.openSync(tempPath, 'w', 0o600)
    fs.writeFileSync(fd, String(content || ''), 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    fs.renameSync(tempPath, filePath)
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd) } catch (_) {}
    }
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath) } catch (_) {}
    throw error
  }
}

function documentSnapshotDirectory(relativePath) {
  const safeRelative = relativePath.split('/').map(part => part.replace(/[\\/:*?"<>|]+/g, '_')).join('/')
  return path.join(DOCUMENT_VERSION_DIR, safeRelative)
}

function documentSnapshotPath(relativePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(documentSnapshotDirectory(relativePath), `${stamp}.md`)
}

function resolveDocumentSnapshot(relativePath, versionId) {
  const safeVersion = path.basename(String(versionId || ''))
  if (!/^\d{4}-\d{2}-\d{2}T[\d-]+Z\.md$/.test(safeVersion)) throw new Error('非法版本 ID')
  const snapshotPath = path.join(documentSnapshotDirectory(relativePath), safeVersion)
  if (!isPathInside(DOCUMENT_VERSION_DIR, snapshotPath)) throw new Error('非法版本路径')
  return snapshotPath
}

function safeDocumentTitle(title) {
  const clean = String(title || '未命名文档')
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return clean || '未命名文档'
}

function safeConversationTitle(title) {
  return safeDocumentTitle(String(title || '新会话').replace(/\.\.\.$/, '')).slice(0, 60) || '新会话'
}

function conversationRoleLabel(role) {
  if (role === 'user') return '👤 用户'
  if (role === 'assistant') return '🤖 AI'
  if (role === 'system') return '⚙️ System'
  return String(role || 'message')
}

function formatConversationMarkdown(sessionData, instance = null) {
  const title = safeConversationTitle(sessionData.title || sessionData.messages?.[0]?.content || '新会话')
  const createdAt = sessionData.createdAt || new Date().toISOString()
  const updatedAt = sessionData.updatedAt || createdAt
  const messages = Array.isArray(sessionData.messages) ? sessionData.messages : []
  const frontmatter = [
    '---',
    `id: ${sessionData.id || `session-${Date.now()}`}`,
    'type: conversation',
    'source: lingshu',
    `instance_id: ${sessionData.instanceId || ''}`,
    instance?.name ? `instance_name: ${JSON.stringify(instance.name)}` : '',
    sessionData.model ? `model: ${JSON.stringify(sessionData.model)}` : '',
    `created_at: ${createdAt}`,
    `updated_at: ${updatedAt}`,
    `message_count: ${messages.length}`,
    'tags: ["codex", "conversation", "lingshu"]',
    '---'
  ].filter(Boolean).join('\n')

  const header = [
    frontmatter,
    '',
    `# ${title}`,
    '',
    `- **会话ID**: \`${sessionData.id || ''}\``,
    `- **实例**: ${instance?.name || sessionData.instanceId || 'unknown'}`,
    `- **日期**: ${String(createdAt).slice(0, 10)}`,
    `- **消息数**: ${messages.length} 条`,
    sessionData.obsidianArchive?.relativePath ? `- **归档路径**: \`${sessionData.obsidianArchive.relativePath}\`` : '',
    '',
    '---',
    ''
  ].filter(line => line !== '').join('\n')

  const messageBlocks = messages.map((message, index) => [
    `### ${conversationRoleLabel(message.role)} (${index + 1})`,
    '',
    message.model ? `> model: ${message.model}` : '',
    message.timestamp ? `> time: ${message.timestamp}` : '',
    '',
    String(message.content || '').trim() || '_空消息_',
    '',
    '---',
    ''
  ].filter(line => line !== '').join('\n')).join('\n')

  return `${header}\n${messageBlocks}`.trim() + '\n'
}

function resolveConversationArchivePath(sessionData, config) {
  const archiveDir = path.join(config.vaultPath, 'Codex', '对话存档')
  if (!isPathInside(config.vaultPath, archiveDir)) throw new Error('非法会话归档目录')
  fs.mkdirSync(archiveDir, { recursive: true })

  const existing = sessionData.obsidianArchive?.relativePath
  if (existing) {
    try {
      const resolved = resolveVaultPath(existing, config, { requireMarkdown: true })
      if (resolved.relativePath.startsWith('Codex/对话存档/')) return resolved.absolutePath
    } catch (_) {}
  }

  const createdDate = String(sessionData.createdAt || new Date().toISOString()).slice(0, 10)
  const title = safeConversationTitle(sessionData.title || sessionData.messages?.[0]?.content || '新会话')
  const shortId = String(sessionData.id || Date.now()).replace(/[^\w-]+/g, '').slice(-8)
  let filePath = path.join(archiveDir, `会话_${createdDate}_${title}.md`)
  if (fs.existsSync(filePath)) filePath = path.join(archiveDir, `会话_${createdDate}_${title}_${shortId}.md`)
  let suffix = 2
  while (fs.existsSync(filePath)) {
    filePath = path.join(archiveDir, `会话_${createdDate}_${title}_${shortId}-${suffix}.md`)
    suffix++
  }
  return filePath
}

function collectArchivedConversationEntries(config) {
  const archiveDir = path.join(config.vaultPath, 'Codex', '对话存档')
  if (!fs.existsSync(archiveDir)) return []
  return fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md') && entry.name !== '会话索引.md')
    .map(entry => {
      const relativePath = `Codex/对话存档/${entry.name}`
      const title = entry.name.replace(/\.md$/, '')
      const date = entry.name.match(/会话_(\d{4}-\d{2}-\d{2})/)?.[1] || ''
      return { title, date, relativePath }
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.title.localeCompare(b.title, 'zh-Hans-CN'))
}

function updateConversationArchiveIndex(config) {
  const archiveDir = path.join(config.vaultPath, 'Codex', '对话存档')
  fs.mkdirSync(archiveDir, { recursive: true })
  const entries = collectArchivedConversationEntries(config)
  const lines = [
    '# Codex 会话索引',
    '',
    `> 共 ${entries.length} 个历史会话，按时间倒序排列。由灵枢自动维护。`,
    '',
    '| 序号 | 日期 | 标题 |',
    '|------|------|------|',
    ...entries.map((entry, index) => {
      const link = entry.relativePath.replace(/^Codex\/对话存档\//, '').replace(/\.md$/, '')
      return `| ${index + 1} | ${entry.date || '-'} | [[${link}]] |`
    })
  ]
  atomicWriteTextFile(path.join(archiveDir, '会话索引.md'), lines.join('\n') + '\n')
  return { count: entries.length, relativePath: 'Codex/对话存档/会话索引.md' }
}

function archiveSessionToObsidian(sessionData, { updateIndex = true } = {}) {
  const vault = getMarkdownVaultConfig()
  if (!vault.ok) return { ok: false, skipped: true, reason: vault.reason }
  if (!Array.isArray(sessionData.messages) || sessionData.messages.length === 0) {
    return { ok: false, skipped: true, reason: '空会话暂不归档' }
  }

  const instance = instances.find(item => item.id === sessionData.instanceId)
  const archivePath = resolveConversationArchivePath(sessionData, vault.config)
  const relativePath = path.relative(vault.config.vaultPath, archivePath).split(path.sep).join('/')
  const nextSessionData = {
    ...sessionData,
    obsidianArchive: {
      relativePath,
      archivedAt: new Date().toISOString()
    }
  }
  atomicWriteTextFile(archivePath, formatConversationMarkdown(nextSessionData, instance))
  const index = updateIndex ? updateConversationArchiveIndex(vault.config) : null
  return { ok: true, relativePath, index, sessionData: nextSessionData }
}

function saveSessionJson(filePath, sessionData, { archive = false, updateIndex = true } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  let nextSessionData = sessionData
  let archiveResult = null
  if (archive) {
    try {
      archiveResult = archiveSessionToObsidian(sessionData, { updateIndex })
      if (archiveResult.ok && archiveResult.sessionData) nextSessionData = archiveResult.sessionData
    } catch (error) {
      archiveResult = { ok: false, error: error.message }
      nextSessionData = {
        ...sessionData,
        obsidianArchiveError: {
          message: error.message,
          at: new Date().toISOString()
        }
      }
    }
  }
  fs.writeFileSync(filePath, JSON.stringify(nextSessionData, null, 2))
  return { sessionData: nextSessionData, archiveResult }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildExportHtml({ title, markdown, sourcePath }) {
  const rendered = markdownRenderer.render(String(markdown || ''))
  const generatedAt = new Date().toISOString()
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: #f6f8fb; color: #111827; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif; line-height: 1.72; }
    main { max-width: 860px; margin: 0 auto; padding: 48px 28px 72px; background: #fff; min-height: 100vh; }
    h1, h2, h3, h4 { line-height: 1.3; margin: 1.4em 0 0.55em; }
    h1 { font-size: 2rem; padding-bottom: 0.35em; border-bottom: 1px solid #e5e7eb; }
    h2 { font-size: 1.45rem; padding-bottom: 0.25em; border-bottom: 1px solid #eef2f6; }
    p, ul, ol, blockquote, pre, table { margin: 0.75em 0; }
    a { color: #2563eb; }
    code { padding: 0.14em 0.34em; border-radius: 4px; background: #f2f4f7; font-family: "SF Mono", Monaco, Consolas, monospace; font-size: 0.92em; }
    pre { overflow: auto; padding: 14px 16px; border-radius: 8px; background: #111827; color: #f9fafb; }
    pre code { padding: 0; background: transparent; color: inherit; }
    blockquote { padding-left: 14px; color: #4b5563; border-left: 4px solid #93c5fd; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 10px; border: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
    th { background: #f9fafb; }
    .export-meta { margin-bottom: 28px; color: #667085; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <div class="export-meta">Source: ${escapeHtml(sourcePath)} · Generated: ${escapeHtml(generatedAt)}</div>
    ${rendered}
  </main>
</body>
</html>`
}

function buildExportFileName(relativePath, format) {
  const parsed = path.parse(relativePath || 'document.md')
  const safeBase = safeDocumentTitle(parsed.name || 'document')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${stamp}-${safeBase}.${format === 'html' ? 'html' : 'md'}`
}

function loadDocumentWorkbenchState() {
  try {
    const data = JSON.parse(fs.readFileSync(DOCUMENT_WORKBENCH_FILE, 'utf8'))
    return {
      recent: Array.isArray(data.recent) ? data.recent : [],
      favorites: Array.isArray(data.favorites) ? data.favorites : []
    }
  } catch (_) {
    return { recent: [], favorites: [] }
  }
}

function saveDocumentWorkbenchState(state) {
  fs.writeFileSync(DOCUMENT_WORKBENCH_FILE, JSON.stringify({
    recent: Array.isArray(state.recent) ? state.recent.slice(0, 30) : [],
    favorites: Array.isArray(state.favorites) ? state.favorites.slice(0, 80) : []
  }, null, 2))
}

function normalizeDocumentWorkbenchEntry(input, config) {
  const { relativePath, absolutePath } = resolveVaultPath(input?.path || input?.relativePath, config, { requireMarkdown: true })
  const title = safeDocumentTitle(input?.title || path.basename(relativePath, '.md'))
  const stat = fs.existsSync(absolutePath) ? fs.statSync(absolutePath) : null
  return {
    path: relativePath,
    title,
    mtime: stat?.mtime?.toISOString?.() || '',
    updatedAt: new Date().toISOString()
  }
}

function buildDocumentTree(config) {
  const walk = (dir, depth = 0) => {
    if (depth > 8) return []
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return [] }

    return entries
      .filter(entry => {
        const relativePath = path.relative(config.vaultPath, path.join(dir, entry.name)).split(path.sep).join('/')
        if (!shouldIncludeObsidianPath(relativePath, config)) return false
        return entry.isDirectory() || (entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      })
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-Hans-CN'))
      .slice(0, 300)
      .map(entry => {
        const fullPath = path.join(dir, entry.name)
        const relativePath = path.relative(config.vaultPath, fullPath).split(path.sep).join('/')
        const node = {
          title: entry.name,
          key: relativePath,
          path: relativePath,
          type: entry.isDirectory() ? 'directory' : 'file'
        }
        if (entry.isDirectory()) node.children = walk(fullPath, depth + 1)
        return node
      })
  }

  return walk(config.vaultPath)
}

function listMarkdownVaultFiles(config, maxFiles = 3000) {
  const results = []
  const walk = (dir) => {
    if (results.length >= maxFiles) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const entry of entries) {
      if (results.length >= maxFiles) break
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(config.vaultPath, fullPath).split(path.sep).join('/')
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

function searchMarkdownDocuments(query, maxResults = 20) {
  const vault = getMarkdownVaultConfig()
  if (!vault.ok) return { ok: false, reason: vault.reason, results: [] }
  const tokens = tokenizeSearchText(query)
  if (tokens.length === 0) return { ok: true, results: [] }

  const results = []
  for (const filePath of listMarkdownVaultFiles(vault.config)) {
    try {
      if (!isPathInside(vault.config.vaultPath, filePath)) continue
      const note = readObsidianNote(filePath, vault.config)
      if (!note) continue
      const score = scoreObsidianNote(note, query, tokens)
      if (score <= 0) continue
      results.push({
        title: note.title,
        relativePath: note.relativePath,
        path: note.relativePath,
        tags: note.tags,
        headings: note.headings.slice(0, 6),
        mtime: note.mtime,
        score,
        snippet: buildObsidianSnippet(note, tokens, 260)
      })
    } catch (_) {}
  }

  results.sort((a, b) => b.score - a.score || new Date(b.mtime) - new Date(a.mtime))
  return { ok: true, results: results.slice(0, Math.min(Math.max(Number(maxResults) || 20, 1), 50)) }
}

function listDocumentProperties(config, { tags = [], status = '', query = '', maxResults = 200 } = {}) {
  const selectedTags = (Array.isArray(tags) ? tags : String(tags || '').split(','))
    .map(tag => String(tag || '').trim().toLowerCase())
    .filter(Boolean)
  const selectedStatus = String(status || '').trim().toLowerCase()
  const cleanQuery = String(query || '').trim().toLowerCase()
  const tagFacet = new Map()
  const statusFacet = new Map()
  const documents = []

  for (const filePath of listMarkdownVaultFiles(config, 5000)) {
    try {
      if (!isPathInside(config.vaultPath, filePath)) continue
      const note = readObsidianNote(filePath, config)
      if (!note) continue
      const docTags = [...new Set(note.tags)].filter(Boolean)
      const docStatus = String(note.frontMatter?.status || '').trim()
      docTags.forEach(tag => tagFacet.set(tag, (tagFacet.get(tag) || 0) + 1))
      if (docStatus) statusFacet.set(docStatus, (statusFacet.get(docStatus) || 0) + 1)

      const tagSet = new Set(docTags.map(tag => tag.toLowerCase()))
      if (selectedTags.length > 0 && !selectedTags.every(tag => tagSet.has(tag))) continue
      if (selectedStatus && docStatus.toLowerCase() !== selectedStatus) continue
      if (cleanQuery && !`${note.title} ${note.relativePath}`.toLowerCase().includes(cleanQuery)) continue

      documents.push({
        title: note.title,
        path: note.relativePath,
        relativePath: note.relativePath,
        tags: docTags,
        status: docStatus,
        created: note.frontMatter?.created || '',
        updated: note.frontMatter?.updated || '',
        hasFrontMatter: !!note.frontMatter?.hasFrontMatter,
        mtime: note.mtime
      })
    } catch (_) {}
  }

  documents.sort((a, b) => new Date(b.updated || b.mtime) - new Date(a.updated || a.mtime) || a.title.localeCompare(b.title, 'zh-Hans-CN'))
  const tagsFacet = [...tagFacet.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'))
    .slice(0, 120)
  const statuses = [...statusFacet.entries()]
    .map(([name, count]) => ({ status: name, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status, 'zh-Hans-CN'))

  return {
    ok: true,
    filters: { tags: selectedTags, status: selectedStatus, query: cleanQuery },
    facets: { tags: tagsFacet, statuses },
    documents: documents.slice(0, Math.min(Math.max(Number(maxResults) || 200, 1), 1000)),
    total: documents.length
  }
}

function listDocumentLinkCandidates(config, query = '', maxResults = 500) {
  const cleanQuery = String(query || '').trim().toLowerCase()
  const tokens = tokenizeSearchText(cleanQuery)
  const results = []
  for (const filePath of listMarkdownVaultFiles(config, 5000)) {
    try {
      if (!isPathInside(config.vaultPath, filePath)) continue
      const note = readObsidianNote(filePath, config)
      if (!note) continue
      const stem = note.relativePath.replace(/\.md$/i, '')
      const base = path.basename(note.relativePath, '.md')
      const aliases = [...new Set([note.title, base, stem, note.relativePath].filter(Boolean))]
      const haystack = [note.title, note.relativePath, ...note.tags, ...note.headings.slice(0, 4)].join(' ').toLowerCase()
      let score = cleanQuery ? 0 : 1
      if (cleanQuery) {
        if (note.title.toLowerCase().includes(cleanQuery)) score += 20
        if (base.toLowerCase().includes(cleanQuery)) score += 14
        if (note.relativePath.toLowerCase().includes(cleanQuery)) score += 9
        for (const token of tokens) {
          if (haystack.includes(token)) score += 3
        }
      }
      if (cleanQuery && score <= 0) continue
      results.push({
        title: note.title,
        path: note.relativePath,
        relativePath: note.relativePath,
        aliases,
        headings: note.headings.slice(0, 4),
        tags: note.tags.slice(0, 6),
        mtime: note.mtime,
        score
      })
    } catch (_) {}
  }

  results.sort((a, b) => b.score - a.score || new Date(b.mtime) - new Date(a.mtime))
  return {
    ok: true,
    candidates: results.slice(0, Math.min(Math.max(Number(maxResults) || 500, 1), 1000))
  }
}

function normalizeWikiLinkLookupKey(value) {
  return String(value || '')
    .split('#')[0]
    .replace(/\.md$/i, '')
    .trim()
    .toLowerCase()
}

function buildDocumentLinkCandidateIndex(config) {
  const candidates = listDocumentLinkCandidates(config, '', 5000).candidates || []
  const index = new Map()
  for (const candidate of candidates) {
    const aliases = [
      candidate.title,
      candidate.path,
      String(candidate.path || '').replace(/\.md$/i, ''),
      ...(candidate.aliases || [])
    ]
    for (const alias of aliases) {
      const key = normalizeWikiLinkLookupKey(alias)
      if (key && !index.has(key)) index.set(key, candidate)
    }
  }
  return { candidates, index }
}

function extractWikiLinkTargets(markdown) {
  return [...String(markdown || '').matchAll(/\[\[([^\]\n]+)]]/g)]
    .map(match => String(match[1] || '').split('|')[0].split('#')[0].trim())
    .filter(Boolean)
}

function buildDocumentBacklinks(relativePath, config, maxResults = 30) {
  const target = resolveVaultPath(relativePath, config, { requireMarkdown: true })
  if (!fs.existsSync(target.absolutePath)) throw new Error('文档不存在')
  const targetRaw = fs.readFileSync(target.absolutePath, 'utf8')
  const targetTitle = (targetRaw.match(/^#\s+(.+)$/m)?.[1] || path.basename(target.relativePath, '.md')).trim()
  const targetStem = target.relativePath.replace(/\.md$/i, '')
  const targetBase = path.basename(target.relativePath, '.md')
  const aliases = [...new Set([targetTitle, targetBase, targetStem, target.relativePath].filter(Boolean))]
  const aliasLower = aliases.map(item => String(item).toLowerCase())
  const titleNeedle = targetTitle.length >= 4 ? targetTitle.toLowerCase() : ''
  const pathNeedle = target.relativePath.toLowerCase()
  const stemNeedle = targetStem.toLowerCase()
  const linkPattern = new RegExp(`\\]\\((?:\\.\\/|\\/)?${escapeRegex(target.relativePath)}(?:#[^)]+)?\\)`, 'i')
  const results = []

  for (const filePath of listMarkdownVaultFiles(config)) {
    try {
      if (!isPathInside(config.vaultPath, filePath)) continue
      const note = readObsidianNote(filePath, config)
      if (!note || note.relativePath === target.relativePath) continue

      const rawLower = note.raw.toLowerCase()
      const reasons = []
      let score = 0
      const wikiLinks = [...note.raw.matchAll(/\[\[([^\]]+)]]/g)]
      const wikiHit = wikiLinks.some(match => {
        const targetName = String(match[1] || '').split('|')[0].split('#')[0].trim().toLowerCase()
        return aliasLower.includes(targetName)
      })
      if (wikiHit) {
        reasons.push('WikiLink')
        score += 30
      }
      if (linkPattern.test(note.raw) || rawLower.includes(pathNeedle) || rawLower.includes(stemNeedle)) {
        reasons.push('路径引用')
        score += 18
      }
      if (titleNeedle && rawLower.includes(titleNeedle)) {
        reasons.push('标题提及')
        score += 8
      }
      if (score <= 0) continue

      const lines = note.raw.split('\n')
      const lowerLines = lines.map(line => line.toLowerCase())
      const hitLine = lowerLines.findIndex(line => (
        wikiLinks.length && line.includes('[[') && aliasLower.some(alias => line.includes(alias))
      ) || line.includes(pathNeedle) || line.includes(stemNeedle) || (!!titleNeedle && line.includes(titleNeedle)))
      const snippet = hitLine >= 0
        ? lines.slice(Math.max(0, hitLine - 1), Math.min(lines.length, hitLine + 2)).join('\n').trim().slice(0, 360)
        : buildObsidianSnippet(note, tokenizeSearchText(targetTitle), 260)

      results.push({
        title: note.title,
        path: note.relativePath,
        relativePath: note.relativePath,
        snippet,
        reasons,
        mtime: note.mtime,
        score
      })
    } catch (_) {}
  }

  results.sort((a, b) => b.score - a.score || new Date(b.mtime) - new Date(a.mtime))
  return {
    ok: true,
    target: {
      title: targetTitle,
      path: target.relativePath,
      aliases
    },
    backlinks: results.slice(0, Math.min(Math.max(Number(maxResults) || 30, 1), 80))
  }
}

function buildDocumentGraphBase(relativePath, config, maxResults = 60) {
  const target = resolveVaultPath(relativePath, config, { requireMarkdown: true })
  if (!fs.existsSync(target.absolutePath)) throw new Error('文档不存在')
  const targetNote = readObsidianNote(target.absolutePath, config)
  if (!targetNote) throw new Error('文档过大或无法读取')
  const { index } = buildDocumentLinkCandidateIndex(config)
  const nodes = new Map()
  const edges = new Map()
  const addNode = (node) => {
    if (!node?.path) return
    const previous = nodes.get(node.path) || {}
    nodes.set(node.path, {
      id: node.path,
      path: node.path,
      title: node.title || previous.title || path.basename(node.path, '.md'),
      type: node.type || previous.type || 'related',
      mtime: node.mtime || previous.mtime || ''
    })
  }
  const addEdge = (source, targetPath, type) => {
    if (!source || !targetPath || source === targetPath) return
    const id = `${source}->${targetPath}:${type}`
    if (!edges.has(id)) edges.set(id, { id, source, target: targetPath, type })
  }

  addNode({ path: targetNote.relativePath, title: targetNote.title, type: 'center', mtime: targetNote.mtime })

  for (const linkTarget of extractWikiLinkTargets(targetNote.raw)) {
    const candidate = index.get(normalizeWikiLinkLookupKey(linkTarget))
    if (!candidate?.path || candidate.path === targetNote.relativePath) continue
    addNode({ path: candidate.path, title: candidate.title, type: 'outbound', mtime: candidate.mtime })
    addEdge(targetNote.relativePath, candidate.path, 'outbound')
  }

  const backlinks = buildDocumentBacklinks(targetNote.relativePath, config, maxResults).backlinks || []
  for (const backlink of backlinks) {
    if (!backlink.path || backlink.path === targetNote.relativePath) continue
    addNode({ path: backlink.path, title: backlink.title, type: nodes.has(backlink.path) ? 'bidirectional' : 'inbound', mtime: backlink.mtime })
    addEdge(backlink.path, targetNote.relativePath, 'inbound')
  }

  for (const edge of edges.values()) {
    const sourceNode = nodes.get(edge.source)
    const targetNode = nodes.get(edge.target)
    if (!sourceNode || !targetNode) continue
    if (edge.type === 'outbound' && edges.has(`${edge.target}->${edge.source}:inbound`)) {
      sourceNode.type = sourceNode.type === 'center' ? sourceNode.type : 'bidirectional'
      targetNode.type = targetNode.type === 'center' ? targetNode.type : 'bidirectional'
    }
  }

  return {
    ok: true,
    center: targetNote.relativePath,
    depth: 1,
    nodes: [...nodes.values()].slice(0, Math.min(Math.max(Number(maxResults) || 60, 1), 120)),
    edges: [...edges.values()].slice(0, Math.min(Math.max(Number(maxResults) || 60, 1), 160))
  }
}

function buildDocumentGraph(relativePath, config, maxResults = 60, depth = 1) {
  const safeLimit = Math.min(Math.max(Number(maxResults) || 60, 1), 120)
  const safeDepth = Math.min(Math.max(Number(depth) || 1, 1), 2)
  const graph = buildDocumentGraphBase(relativePath, config, safeLimit)
  if (safeDepth <= 1) return graph

  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  const edges = new Map(graph.edges.map(edge => [edge.id, edge]))
  const directNodes = graph.nodes.filter(node => node.id !== graph.center).slice(0, Math.min(safeLimit, 24))

  for (const node of directNodes) {
    if (nodes.size >= safeLimit && edges.size >= safeLimit * 2) break
    try {
      const local = buildDocumentGraphBase(node.path, config, Math.min(24, safeLimit))
      for (const localNode of local.nodes) {
        if (nodes.size >= safeLimit && !nodes.has(localNode.id)) continue
        if (localNode.id === graph.center) continue
        if (!nodes.has(localNode.id)) {
          nodes.set(localNode.id, { ...localNode, type: localNode.id === node.id ? node.type : 'related' })
        }
      }
      for (const edge of local.edges) {
        if (edges.size >= safeLimit * 2) break
        if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue
        if (!edges.has(edge.id)) edges.set(edge.id, edge)
      }
    } catch (_) {}
  }

  const centerNode = nodes.get(graph.center)
  if (centerNode) centerNode.type = 'center'

  return {
    ok: true,
    center: graph.center,
    depth: safeDepth,
    nodes: [...nodes.values()],
    edges: [...edges.values()]
  }
}

function clearDocumentWatcher() {
  if (documentWatchState.watcher) {
    try { documentWatchState.watcher.close() } catch (_) {}
  }
  for (const filePath of documentWatchState.fileWatches.values()) {
    try { fs.unwatchFile(filePath) } catch (_) {}
  }
  for (const timer of documentWatchState.timers.values()) clearTimeout(timer)
  documentWatchState.key = ''
  documentWatchState.watcher = null
  documentWatchState.timers.clear()
  documentWatchState.fileWatches.clear()
}

function pushDocumentWatchEvent(event) {
  documentWatchState.lastId += 1
  documentWatchState.events.push({
    id: documentWatchState.lastId,
    timestamp: new Date().toISOString(),
    ...event
  })
  if (documentWatchState.events.length > 500) {
    documentWatchState.events = documentWatchState.events.slice(-500)
  }
}

function recordDocumentPathChange(config, relativePath, eventType = 'change') {
  const normalized = normalizeVaultRelativePath(relativePath)
  if (!normalized.toLowerCase().endsWith('.md')) return
  if (!shouldIncludeObsidianPath(normalized, config)) return

  const absolutePath = path.resolve(config.vaultPath, normalized)
  if (!isPathInside(config.vaultPath, absolutePath)) return
  const timerKey = normalized
  if (documentWatchState.timers.has(timerKey)) clearTimeout(documentWatchState.timers.get(timerKey))
  documentWatchState.timers.set(timerKey, setTimeout(() => {
    documentWatchState.timers.delete(timerKey)
    try {
      if (!fs.existsSync(absolutePath)) {
        pushDocumentWatchEvent({ path: normalized, type: 'deleted', source: 'vault', eventType })
        return
      }
      const stat = fs.statSync(absolutePath)
      if (!stat.isFile()) return
      const content = stat.size <= 1024 * 1024 ? fs.readFileSync(absolutePath, 'utf8') : ''
      pushDocumentWatchEvent({
        path: normalized,
        type: eventType === 'rename' ? 'renamed' : 'changed',
        source: 'vault',
        revision: content ? hashContent(content) : '',
        mtime: stat.mtime.toISOString(),
        size: stat.size
      })
    } catch (error) {
      documentWatchState.error = error.message
    }
  }, 250))
}

function ensureDocumentWatcher(config) {
  const watcherKey = JSON.stringify({
    vaultPath: config.vaultPath,
    includeFolders: config.includeFolders,
    excludeFolders: config.excludeFolders
  })
  if (documentWatchState.key === watcherKey && documentWatchState.watcher) {
    return { active: !documentWatchState.error, error: documentWatchState.error, lastEventId: documentWatchState.lastId }
  }

  clearDocumentWatcher()
  documentWatchState.key = watcherKey
  documentWatchState.error = ''

  try {
    documentWatchState.watcher = fs.watch(config.vaultPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      try {
        recordDocumentPathChange(config, String(filename).split(path.sep).join('/'), eventType)
      } catch (error) {
        documentWatchState.error = error.message
      }
    })
    documentWatchState.watcher.on('error', error => {
      documentWatchState.error = error.message
      try { documentWatchState.watcher?.close() } catch (_) {}
      documentWatchState.watcher = null
    })
    return { active: true, error: '', lastEventId: documentWatchState.lastId }
  } catch (error) {
    documentWatchState.error = error.message
    return { active: false, error: error.message, lastEventId: documentWatchState.lastId }
  }
}

function ensureDocumentFileWatcher(config, relativePath) {
  const resolved = resolveVaultPath(relativePath, config, { requireMarkdown: true })
  const watchKey = `${config.vaultPath}:${resolved.relativePath}`
  if (documentWatchState.fileWatches.has(watchKey)) return
  documentWatchState.fileWatches.set(watchKey, resolved.absolutePath)
  fs.watchFile(resolved.absolutePath, { interval: 1200, persistent: false }, (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return
    recordDocumentPathChange(config, resolved.relativePath, current.nlink === 0 ? 'rename' : 'change')
  })
}

function getDocumentFileStatus(relativePath, config) {
  const resolved = resolveVaultPath(relativePath, config, { requireMarkdown: true })
  if (!fs.existsSync(resolved.absolutePath)) {
    return { path: resolved.relativePath, exists: false, revision: '', mtime: '', size: 0 }
  }
  const stat = fs.statSync(resolved.absolutePath)
  if (!stat.isFile()) throw new Error('不是文件')
  const content = stat.size <= 1024 * 1024 ? fs.readFileSync(resolved.absolutePath, 'utf8') : ''
  return {
    path: resolved.relativePath,
    exists: true,
    revision: content ? hashContent(content) : '',
    mtime: stat.mtime.toISOString(),
    size: stat.size
  }
}

function selectDefaultModelKey() {
  const settings = loadSettings()
  if (settings.models?.defaultModel) return settings.models.defaultModel
  const config = loadLocalConfig()
  if (config.models?.providers) {
    for (const [providerId, providerData] of Object.entries(config.models.providers)) {
      const first = Array.isArray(providerData.models) ? providerData.models.find(model => model?.id) : null
      if (first?.id) return `${providerId}/${first.id}`
    }
  }
  const ccModel = getCcSwitchModelList()[0]
  if (ccModel?.id) return `cc-switch/${ccModel.id}`
  return ''
}

function resolveConfiguredModel(modelKey) {
  const config = loadLocalConfig()
  const selected = String(modelKey || selectDefaultModelKey() || '')
  if (!selected) throw new Error('未选择可用模型')

  const [providerId, ...modelParts] = selected.split('/')
  const model = modelParts.join('/') || selected

  if (providerId === 'cc-switch' || providerId === 'ccswitch') {
    const route = getCurrentCcSwitchOpenClawProvider()
    const fallbackModel = (Array.isArray(route?.settings?.models) ? route.settings.models : []).find(item => item?.id)?.id
    if (!route || !route.settings?.baseUrl || !route.settings?.apiKey) throw new Error('CC Switch 当前路由不可用')
    return {
      provider: getCcSwitchApiProtocol(route.settings.api),
      providerId,
      apiKey: route.settings.apiKey,
      baseUrl: route.settings.baseUrl,
      model: model || fallbackModel,
      requestedModel: selected
    }
  }

  const providerConfig = config.providers?.[providerId] || config.models?.providers?.[providerId]
  const apiKey = providerConfig?.apiKey
  const baseUrl = providerConfig?.baseUrl || KNOWN_PROVIDERS[providerId]?.baseUrl
  if (!apiKey || !baseUrl) throw new Error(`${providerId} 缺少 API Key 或 Base URL`)
  return {
    provider: providerId,
    providerId,
    apiKey,
    baseUrl,
    model,
    requestedModel: selected
  }
}

async function callInternalAgent({ modelKey, messages, maxTokens = 4000, temperature = 0.4 }) {
  const resolved = resolveConfiguredModel(modelKey)
  const result = await callProviderAI({
    provider: resolved.provider,
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    messages,
    options: { maxTokens, temperature }
  })
  if (!result.success) throw new Error(result.error || `模型调用失败 (${result.statusCode || 'unknown'})`)
  return { text: result.data.text || '', model: resolved.requestedModel }
}

function getTranscriptionConfig(overrides = {}) {
  const settings = loadSettings()
  return {
    ...DEFAULT_TRANSCRIPTION_SETTINGS,
    ...(settings.transcription || {}),
    ...(overrides || {})
  }
}

async function transcribeAudioFile(audioPath, overrides = {}) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    return { text: '', provider: '', error: '录音文件不存在' }
  }

  const config = getTranscriptionConfig(overrides)
  if (config.provider === 'browser') {
    return {
      text: '',
      provider: config.provider,
      error: '浏览器实时识别只能在录音时使用；导入录音或历史录音请配置 OpenAI-compatible 服务端转写，或手动粘贴逐字稿后生成纪要'
    }
  }

  if (!config.enabled) {
    return { text: '', provider: config.provider, error: '未启用服务端转写 Provider' }
  }

  if (config.provider !== 'openai-compatible') {
    return { text: '', provider: config.provider, error: `暂不支持转写 Provider: ${config.provider}` }
  }

  const cleanBaseUrl = String(config.baseUrl || '').replace(/\/+$/, '')
  if (!cleanBaseUrl || !config.apiKey || !config.model) {
    return { text: '', provider: config.provider, error: '转写 Provider 缺少 baseUrl/apiKey/model' }
  }

  try {
    const audioBuffer = fs.readFileSync(audioPath)
    const form = new FormData()
    form.append('file', new Blob([audioBuffer]), path.basename(audioPath))
    form.append('model', String(config.model))
    if (config.language) form.append('language', String(config.language))

    const response = await fetch(`${cleanBaseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120000)
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return { text: '', provider: config.provider, error: data?.error?.message || `HTTP ${response.status}` }
    }
    const text = data.text || data.transcript || data.result || ''
    return { text: String(text || '').trim(), provider: config.provider, model: config.model, error: '' }
  } catch (error) {
    return { text: '', provider: config.provider, error: error.message }
  }
}

function meetingManifestPath(meetingId) {
  return path.join(MEETINGS_DIR, meetingId, 'manifest.json')
}

function loadMeeting(meetingId) {
  const manifestPath = meetingManifestPath(meetingId)
  if (!fs.existsSync(manifestPath)) return null
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

function saveMeeting(meeting) {
  const meetingDir = path.join(MEETINGS_DIR, meeting.id)
  fs.mkdirSync(meetingDir, { recursive: true })
  fs.writeFileSync(meetingManifestPath(meeting.id), JSON.stringify(meeting, null, 2))
}

function readTextFileIfExists(filePath) {
  try {
    return filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  } catch (_) {
    return ''
  }
}

function meetingSummary(meeting) {
  const transcript = readTextFileIfExists(meeting.transcriptPath)
  const minutes = readTextFileIfExists(meeting.minutesPath)
  return {
    ...meeting,
    hasAudio: !!(meeting.audioPath && fs.existsSync(meeting.audioPath)),
    hasTranscript: !!transcript,
    hasMinutes: !!minutes,
    transcriptLength: transcript.length,
    minutesLength: minutes.length
  }
}

function listMeetings() {
  if (!fs.existsSync(MEETINGS_DIR)) return []
  return fs.readdirSync(MEETINGS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => loadMeeting(entry.name))
    .filter(Boolean)
    .map(meetingSummary)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
}

function buildFallbackMinutes({ title, transcript, audioPath }) {
  const now = new Date().toISOString()
  const lines = [
    '---',
    'type: meeting-minutes',
    'source: lingshu-document-workbench',
    `created_at: ${now}`,
    audioPath ? `audio_path: ${audioPath}` : '',
    '---',
    '',
    `# ${title}`,
    '',
    '## 摘要',
    '',
    transcript ? '待补充：当前模型纪要生成失败，已保留逐字稿，可稍后重新生成。' : '未获得逐字稿。已保存录音，配置转写服务后可重新生成纪要。',
    '',
    '## 待办',
    '',
    '- 待梳理',
    '',
    '## 逐字稿',
    '',
    transcript || '_暂无逐字稿_'
  ]
  return lines.filter(line => line !== '').join('\n')
}

function writeMinutesToVault({ title, content }) {
  const vault = getMarkdownVaultConfig()
  if (!vault.ok) return null
  const date = new Date().toISOString().slice(0, 10)
  const dir = path.join(vault.config.vaultPath, '会议纪要')
  fs.mkdirSync(dir, { recursive: true })
  let filePath = path.join(dir, `${date}-${safeDocumentTitle(title)}.md`)
  let suffix = 2
  while (fs.existsSync(filePath)) {
    filePath = path.join(dir, `${date}-${safeDocumentTitle(title)}-${suffix}.md`)
    suffix++
  }
  if (!isPathInside(vault.config.vaultPath, filePath)) throw new Error('非法会议纪要写入路径')
  atomicWriteTextFile(filePath, content)
  return {
    absolutePath: filePath,
    relativePath: path.relative(vault.config.vaultPath, filePath).split(path.sep).join('/')
  }
}


function getLocalConfigPath() {
  return path.join(os.homedir(), 'Lingshu', 'openclaw.json')
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


const DEFAULT_TOOL_RUNTIME_SECURITY = {
  allowExecution: false,
  requireConfirmation: true,
  allowedCommands: ['open', 'git', 'npm', 'node', 'python3', 'system_profiler'],
  blockedPatterns: ['rm -rf', 'sudo ', 'chmod -R', 'chown -R', 'mkfs', 'diskutil erase', 'dd if=', 'curl |', 'wget |', ':(){', '> /dev/'],
  timeoutMs: 15000,
  maxOutputChars: 4000,
  maxParamLength: 500,
  maxCommandLength: 2000
}

function normalizeRuntimeStringList(value, fallback = []) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value.split(/[\n,]/).map(item => item.trim()).filter(Boolean)
  }
  return [...fallback]
}

function getToolRuntimeSecurity(config = loadLocalConfig()) {
  const saved = config?.tools?.runtime?.security || {}
  return {
    ...DEFAULT_TOOL_RUNTIME_SECURITY,
    ...saved,
    allowedCommands: normalizeRuntimeStringList(saved.allowedCommands, DEFAULT_TOOL_RUNTIME_SECURITY.allowedCommands),
    blockedPatterns: normalizeRuntimeStringList(saved.blockedPatterns, DEFAULT_TOOL_RUNTIME_SECURITY.blockedPatterns),
    timeoutMs: Number(saved.timeoutMs || DEFAULT_TOOL_RUNTIME_SECURITY.timeoutMs),
    maxOutputChars: Number(saved.maxOutputChars || DEFAULT_TOOL_RUNTIME_SECURITY.maxOutputChars),
    maxParamLength: Number(saved.maxParamLength || DEFAULT_TOOL_RUNTIME_SECURITY.maxParamLength),
    maxCommandLength: Number(saved.maxCommandLength || DEFAULT_TOOL_RUNTIME_SECURITY.maxCommandLength)
  }
}

function saveToolRuntimeSecurity(input) {
  const config = loadLocalConfig()
  if (!config.tools) config.tools = {}
  if (!config.tools.runtime) config.tools.runtime = {}
  config.tools.runtime.security = getToolRuntimeSecurity({ tools: { runtime: { security: input || {} } } })
  saveLocalConfig(config)
  return config.tools.runtime.security
}

function extractCliTemplateVariables(template = '') {
  return [...new Set(Array.from(String(template).matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map(match => match[1]))]
}

function escapeCliParamValue(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/[\r\n]/g, ' ')
}

function findToolRuntimeCliCommand(config, commandId) {
  const commands = Array.isArray(config?.tools?.exec?.commands) ? config.tools.exec.commands : []
  const found = commands.find((cmd, idx) => (cmd.name || `cli-${idx}`) === commandId || cmd.id === commandId)
  if (!found) return null
  return {
    id: found.name || found.id || commandId,
    name: found.label || found.name || commandId,
    command: found.command || found.name || '',
    description: found.description || found.label || '',
    category: found.category || '通用',
    enabled: found.enabled === true
  }
}

function materializeCliCommand(template, params = {}, security = getToolRuntimeSecurity()) {
  const variables = extractCliTemplateVariables(template)
  const errors = []
  let command = String(template || '')
  for (const variable of variables) {
    if (!Object.prototype.hasOwnProperty.call(params, variable)) {
      errors.push(`缺少参数：${variable}`)
      continue
    }
    const value = String(params[variable] ?? '')
    if (value.length > security.maxParamLength) {
      errors.push(`参数过长：${variable}`)
      continue
    }
    command = command.replaceAll(`{${variable}}`, escapeCliParamValue(value))
  }
  return { command, variables, errors }
}

function redactRuntimeText(text = '') {
  return String(text)
    .replace(/(api[_-]?key|token|secret|password)=([^\s]+)/ig, '$1=***')
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, 'sk-***')
}

function validateToolRuntimeCommand({ commandConfig, command, confirmed = false, executionRequested = false, security }) {
  const errors = []
  const warnings = []
  const trimmed = String(command || '').trim()
  if (!commandConfig) errors.push('命令不存在')
  if (commandConfig && commandConfig.enabled !== true) errors.push('命令未启用')
  if (!trimmed) errors.push('命令为空')
  if (trimmed.length > security.maxCommandLength) errors.push('命令长度超过限制')
  const executable = trimmed.split(/\s+/)[0]?.replace(/^['"]|['"]$/g, '') || ''
  if (executable && !security.allowedCommands.includes(executable)) {
    errors.push(`命令不在白名单中：${executable}`)
  }
  const lower = trimmed.toLowerCase()
  const matchedPattern = security.blockedPatterns.find(pattern => lower.includes(String(pattern).toLowerCase()))
  if (matchedPattern) errors.push(`命中阻断规则：${matchedPattern}`)
  if (/[;&|]{2,}/.test(trimmed)) warnings.push('命令包含 shell 组合操作符，请确认是否必要')
  if (executionRequested && security.requireConfirmation && confirmed !== true) errors.push('需要执行前确认')
  if (executionRequested && security.allowExecution !== true) errors.push('实际执行未开放')
  return { ok: errors.length === 0, errors, warnings, executable }
}

function appendToolRuntimeAudit(entry) {
  const safeEntry = {
    id: `tool_audit_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
    commandPreview: redactRuntimeText(entry.commandPreview || '')
  }
  fs.appendFileSync(TOOL_RUNTIME_AUDIT_FILE, `${JSON.stringify(safeEntry)}\n`)
  return safeEntry
}

function readToolRuntimeAudit(limit = 200) {
  if (!fs.existsSync(TOOL_RUNTIME_AUDIT_FILE)) return []
  return fs.readFileSync(TOOL_RUNTIME_AUDIT_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-limit)
    .map(line => {
      try { return JSON.parse(line) } catch (_) { return null }
    })
    .filter(Boolean)
    .reverse()
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
      { id: 'claude-fable-5', name: 'Claude Fable 5 - 最新一代旗舰' },
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8（推荐）- 最新旗舰' },
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7 - 高性能推理' },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6 - 强推理能力' },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5 - 稳定版本' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 - 平衡性能与速度' },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 - 经典版本' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 - 极速响应' },
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
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'User-Agent': 'claude-cli/1.0.0', ...authHeader },
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
      headers: { ...authHeader, ...(isAnthropic ? { 'anthropic-version': '2023-06-01', 'User-Agent': 'claude-cli/1.0.0' } : {}) },
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
  const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
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

app.get('/api/local-agent-apps', (req, res) => {
  try {
    const apps = scanLocalAgentApps()
    const existing = new Set(instances
      .filter(instance => instance.type === 'agent-desktop' || instance.type === 'stepfun-desktop')
      .flatMap(instance => [
        String(instance.appName || '').toLowerCase(),
        String(instance.name || '').toLowerCase(),
        String(instance.bundleId || '').toLowerCase(),
        String(instance.configPath || '').toLowerCase()
      ].filter(Boolean)))

    res.json({
      apps: apps.map(appInfo => ({
        ...appInfo,
        instanceExists: existing.has(String(appInfo.displayName || appInfo.name).toLowerCase())
          || existing.has(String(appInfo.name || '').toLowerCase())
          || existing.has(String(appInfo.bundleId || '').toLowerCase())
          || existing.has(String(appInfo.path || '').toLowerCase())
      }))
    })
  } catch (error) {
    res.status(500).json({ error: '扫描本机 Agent 失败', message: error.message })
  }
})

app.post('/api/local-agent-apps/seed-instances', (req, res) => {
  try {
    const requestedApps = Array.isArray(req.body?.apps) ? req.body.apps : scanLocalAgentApps()
    const added = []
    for (const appInfo of requestedApps) {
      const appName = String(appInfo.displayName || appInfo.name || '').trim()
      const appPath = String(appInfo.path || '').trim()
      if (!appName || !appPath || !fs.existsSync(appPath)) continue

      const exists = instances.some(instance =>
        (instance.type === 'agent-desktop' || instance.type === 'stepfun-desktop')
        && (
          String(instance.appName || '').toLowerCase() === appName.toLowerCase()
          || String(instance.name || '').toLowerCase() === appName.toLowerCase()
          || (appInfo.bundleId && String(instance.bundleId || '').toLowerCase() === String(appInfo.bundleId).toLowerCase())
          || String(instance.configPath || '').toLowerCase() === appPath.toLowerCase()
        )
      )
      if (exists) continue

      const slug = safeInstanceSlug(appName)
      const newInstance = {
        id: `${slug}-desktop-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        name: appName,
        type: 'agent-desktop',
        status: 'disconnected',
        appName,
        bundleId: appInfo.bundleId || '',
        configPath: appPath,
        workspacePath: '~/Lingshu/workspace',
        invocationMode: appInfo.invocation?.suggestedInvocationMode || 'open',
        urlScheme: appInfo.invocation?.urlScheme || '',
        urlTemplate: appInfo.invocation?.urlScheme ? `${appInfo.invocation.urlScheme}://` : '',
        cliCommand: appInfo.invocation?.cliCommand || '',
        cliArgsTemplate: appInfo.invocation?.cliCommand ? '{{instruction}}' : '',
        invocationCapabilities: appInfo.invocation || {},
        description: `本机扫描发现的 Agent 桌面端：${appName}`,
        createdAt: new Date().toISOString()
      }
      instances.push(newInstance)
      added.push(newInstance)
    }

    if (added.length > 0) saveInstances(instances)
    res.json({ success: true, added, count: added.length })
  } catch (error) {
    res.status(500).json({ error: '加入本机 Agent 实例失败', message: error.message })
  }
})

// 添加新实例
app.post('/api/instances', (req, res) => {
  const { name, type, host, port, configPath, workspacePath, appName, bundleId, description, invocationMode, urlScheme, urlTemplate, cliCommand, cliArgsTemplate } = req.body
  
  const newInstance = {
    id: `instance-${Date.now()}`,
    name,
    type: type === 'stepfun-desktop' ? 'agent-desktop' : type,
    host,
    port,
    configPath,
    workspacePath,
    appName,
    bundleId,
    description,
    invocationMode,
    urlScheme,
    urlTemplate,
    cliCommand,
    cliArgsTemplate,
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
    if (instance.type === 'local') {
      // 测试本地灵枢运行时配置
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
    } else if (instance.type === 'agent-desktop' || instance.type === 'stepfun-desktop') {
      const appName = instance.appName || instance.name
      const configuredPath = instance.configPath ? instance.configPath.replace('~', os.homedir()) : ''
      const appPath = configuredPath.endsWith('.app') && fs.existsSync(configuredPath)
        ? configuredPath
        : findInstalledMacAppPath(appName)

      if (appPath) {
        instance.type = 'agent-desktop'
        instance.status = 'connected'
        instance.configPath = appPath
        instance.appName = appName
        instance.lastConnected = new Date().toISOString()
        saveInstances(instances)
        res.json({ success: true, status: 'connected', appName, appPath })
      } else {
        instance.type = 'agent-desktop'
        instance.status = 'error'
        saveInstances(instances)
        res.json({
          success: false,
          status: 'error',
          message: `未找到桌面 Agent 应用：${appName}。请确认它已安装在 /Applications 或 ~/Applications。`
        })
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
  
  if (instance.type === 'local') {
    exec('openclaw gateway restart', (error, stdout, stderr) => {
      if (error) {
        res.status(500).json({ error: '重启失败', message: error.message })
      } else {
        res.json({ success: true, message: 'OpenClaw 已重启' })
      }
    })
  } else if (instance.type === 'agent-desktop' || instance.type === 'stepfun-desktop') {
    const appName = instance.appName || instance.name
    const configuredPath = instance.configPath ? instance.configPath.replace('~', os.homedir()) : ''
    const appPath = configuredPath.endsWith('.app') && fs.existsSync(configuredPath)
      ? configuredPath
      : findInstalledMacAppPath(appName)

    if (!appPath) {
      return res.status(404).json({ success: false, message: `未找到桌面 Agent 应用：${appName}` })
    }

    execFile('open', [appPath], { timeout: 10000 }, (error) => {
      if (error) {
        res.status(500).json({ success: false, message: error.message })
      } else {
        res.json({ success: true, message: `${appName} 已打开`, appPath })
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
      path.join(os.homedir(), 'Lingshu', 'logs', 'openclaw.log'),
      path.join(os.homedir(), 'Lingshu', 'logs', 'gateway.log'),
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
  const localInstance = instances.find(i => i.id === 'local') || DEFAULT_INSTANCES.find(i => i.id === 'local')
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
  const localInstance = instances.find(i => i.id === 'local') || DEFAULT_INSTANCES.find(i => i.id === 'local')
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



// ==================== 工具运行时安全 API ====================

app.get('/api/tool-runtime/security', (req, res) => {
  try {
    res.json(getToolRuntimeSecurity())
  } catch (error) {
    res.status(500).json({ error: '读取工具运行时安全策略失败', message: error.message })
  }
})

app.post('/api/tool-runtime/security', (req, res) => {
  try {
    const security = saveToolRuntimeSecurity(req.body || {})
    appendToolRuntimeAudit({ action: 'security.update', status: 'saved', commandPreview: 'tool runtime security policy updated' })
    res.json({ success: true, security })
  } catch (error) {
    res.status(500).json({ error: '保存工具运行时安全策略失败', message: error.message })
  }
})

app.get('/api/tool-runtime/audit', (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000)
    res.json(readToolRuntimeAudit(limit))
  } catch (error) {
    res.status(500).json({ error: '读取工具运行时审计失败', message: error.message })
  }
})

app.post('/api/tool-runtime/cli/preview', (req, res) => {
  try {
    const { commandId, params = {} } = req.body || {}
    const config = loadLocalConfig()
    const security = getToolRuntimeSecurity(config)
    const commandConfig = findToolRuntimeCliCommand(config, commandId)
    const materialized = materializeCliCommand(commandConfig?.command || '', params, security)
    const validation = validateToolRuntimeCommand({ commandConfig, command: materialized.command, security })
    validation.errors.push(...materialized.errors)
    validation.ok = validation.errors.length === 0
    const audit = appendToolRuntimeAudit({
      action: 'cli.preview',
      commandId,
      status: validation.ok ? 'allowed' : 'blocked',
      reason: validation.errors.join('; '),
      commandPreview: materialized.command
    })
    res.json({
      success: true,
      commandId,
      command: redactRuntimeText(materialized.command),
      variables: materialized.variables,
      validation,
      auditId: audit.id
    })
  } catch (error) {
    res.status(500).json({ error: '预览 CLI 命令失败', message: error.message })
  }
})

app.post('/api/tool-runtime/cli/run', (req, res) => {
  try {
    const { commandId, params = {}, confirmed = false } = req.body || {}
    const config = loadLocalConfig()
    const security = getToolRuntimeSecurity(config)
    const commandConfig = findToolRuntimeCliCommand(config, commandId)
    const materialized = materializeCliCommand(commandConfig?.command || '', params, security)
    const validation = validateToolRuntimeCommand({ commandConfig, command: materialized.command, confirmed, executionRequested: true, security })
    validation.errors.push(...materialized.errors)
    validation.ok = validation.errors.length === 0
    if (!validation.ok) {
      const audit = appendToolRuntimeAudit({
        action: 'cli.run',
        commandId,
        status: 'blocked',
        reason: validation.errors.join('; '),
        commandPreview: materialized.command
      })
      return res.status(403).json({ success: false, validation, auditId: audit.id })
    }

    const startedAt = Date.now()
    exec(materialized.command, { timeout: security.timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout = '', stderr = '') => {
      const output = `${stdout}${stderr ? `\n${stderr}` : ''}`.slice(0, security.maxOutputChars)
      const audit = appendToolRuntimeAudit({
        action: 'cli.run',
        commandId,
        status: error ? 'failed' : 'completed',
        reason: error?.message || '',
        durationMs: Date.now() - startedAt,
        commandPreview: materialized.command
      })
      res.status(error ? 500 : 200).json({
        success: !error,
        output,
        error: error?.message,
        durationMs: Date.now() - startedAt,
        auditId: audit.id
      })
    })
  } catch (error) {
    res.status(500).json({ error: '执行 CLI 命令失败', message: error.message })
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
      availableModels: null,
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

// ==================== 多 Agent 群聊 API ====================

function safeGroupChatId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '')
}

function getGroupChatPath(sessionId) {
  const safeId = safeGroupChatId(sessionId)
  if (!safeId) throw new Error('非法群聊 ID')
  return path.join(GROUP_CHAT_DIR, `${safeId}.json`)
}

function normalizeGroupParticipant(input = {}, index = 0) {
  return {
    agentId: String(input.agentId || input.name || `Agent-${index + 1}`).trim(),
    model: String(input.model || '').trim(),
    provider: String(input.provider || '').trim(),
    avatarColor: input.avatarColor || ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2'][index % 6]
  }
}

function summarizeGroupSession(session) {
  return {
    id: session.id,
    name: session.name || '群聊',
    mode: session.mode || 'all',
    participantCount: Array.isArray(session.participants) ? session.participants.length : 0,
    messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  }
}

function loadGroupSession(sessionId) {
  const filePath = getGroupChatPath(sessionId)
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function saveGroupSession(session) {
  fs.mkdirSync(GROUP_CHAT_DIR, { recursive: true })
  const filePath = getGroupChatPath(session.id)
  const next = { ...session, updatedAt: new Date().toISOString() }
  atomicWriteTextFile(filePath, JSON.stringify(next, null, 2))
  return next
}

function createGroupSession(input = {}) {
  const now = new Date().toISOString()
  const participants = Array.isArray(input.participants) ? input.participants.map(normalizeGroupParticipant) : []
  const session = {
    id: `group-${Date.now()}`,
    name: String(input.name || '新群聊').trim() || '新群聊',
    mode: ['all', 'sequential', 'free'].includes(input.mode) ? input.mode : 'all',
    participants,
    messages: [],
    createdAt: now,
    updatedAt: now
  }
  return saveGroupSession(session)
}

function buildGroupAgentMessages({ session, agent, userMessage }) {
  const recent = (session.messages || []).slice(-12).map(msg => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: `${msg.sender || msg.role}: ${msg.content}`
  }))
  return [
    {
      role: 'system',
      content: [
        `你正在参加一个多 Agent 协作群聊。你的身份是：${agent.agentId}。`,
        `群聊名称：${session.name || '群聊'}。`,
        '请基于上下文给出清晰、可执行、不要重复他人观点的回复。',
        '如果信息不足，请直接说明需要补充什么。'
      ].join('\n')
    },
    ...recent,
    { role: 'user', content: userMessage }
  ]
}

function selectGroupResponders({ participants, mode, mentionAgent, messageCount }) {
  const ready = participants.filter(p => p.agentId && p.model)
  if (mentionAgent) return ready.filter(p => p.agentId === mentionAgent)
  if (mode === 'free') return []
  if (mode === 'sequential') {
    if (ready.length === 0) return []
    return [ready[messageCount % ready.length]]
  }
  return ready
}

app.get('/api/group-chat/sessions', (req, res) => {
  try {
    if (!fs.existsSync(GROUP_CHAT_DIR)) return res.json([])
    const sessions = fs.readdirSync(GROUP_CHAT_DIR)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try { return summarizeGroupSession(JSON.parse(fs.readFileSync(path.join(GROUP_CHAT_DIR, file), 'utf8'))) }
        catch (_) { return null }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    res.json(sessions)
  } catch (error) {
    res.status(500).json({ error: '读取群聊列表失败', message: error.message })
  }
})

app.post('/api/group-chat/sessions', (req, res) => {
  try {
    const session = createGroupSession(req.body || {})
    res.json(summarizeGroupSession(session))
  } catch (error) {
    res.status(500).json({ error: '创建群聊失败', message: error.message })
  }
})

app.get('/api/group-chat/sessions/:sessionId', (req, res) => {
  try {
    const session = loadGroupSession(req.params.sessionId)
    if (!session) return res.status(404).json({ error: '群聊不存在' })
    res.json(session)
  } catch (error) {
    res.status(500).json({ error: '读取群聊失败', message: error.message })
  }
})

app.patch('/api/group-chat/sessions/:sessionId', (req, res) => {
  try {
    const session = loadGroupSession(req.params.sessionId)
    if (!session) return res.status(404).json({ error: '群聊不存在' })
    const body = req.body || {}
    const updated = saveGroupSession({
      ...session,
      name: body.name !== undefined ? String(body.name || '群聊') : session.name,
      mode: ['all', 'sequential', 'free'].includes(body.mode) ? body.mode : session.mode,
      participants: Array.isArray(body.participants) ? body.participants.map(normalizeGroupParticipant) : session.participants
    })
    res.json(updated)
  } catch (error) {
    res.status(500).json({ error: '更新群聊失败', message: error.message })
  }
})

app.delete('/api/group-chat/sessions/:sessionId', (req, res) => {
  try {
    const filePath = getGroupChatPath(req.params.sessionId)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: '删除群聊失败', message: error.message })
  }
})

app.post('/api/group-chat', async (req, res) => {
  try {
    const { sessionId, message, participants = [], mode = 'all', mentionAgent } = req.body || {}
    const content = String(message || '').trim()
    if (!content) return res.status(400).json({ error: '消息不能为空' })

    let session = sessionId ? loadGroupSession(sessionId) : null
    if (!session) {
      session = createGroupSession({ name: content.slice(0, 20) || '新群聊', participants, mode })
    } else {
      session.participants = Array.isArray(participants) ? participants.map(normalizeGroupParticipant) : session.participants
      session.mode = ['all', 'sequential', 'free'].includes(mode) ? mode : session.mode
    }

    const userMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      sender: 'You',
      content,
      timestamp: new Date().toISOString()
    }
    session.messages = [...(session.messages || []), userMessage]

    const responders = selectGroupResponders({
      participants: session.participants || [],
      mode: session.mode,
      mentionAgent,
      messageCount: session.messages.filter(msg => msg.role === 'assistant').length
    })

    const assistantMessages = []
    for (const agent of responders) {
      try {
        const result = await callInternalAgent({
          modelKey: agent.model,
          messages: buildGroupAgentMessages({ session, agent, userMessage: content }),
          maxTokens: 3000,
          temperature: 0.5
        })
        assistantMessages.push({
          id: `msg-${Date.now()}-${assistantMessages.length}`,
          role: 'assistant',
          sender: agent.agentId,
          content: result.text || '（无回复）',
          model: result.model || agent.model,
          provider: agent.provider,
          timestamp: new Date().toISOString()
        })
      } catch (error) {
        assistantMessages.push({
          id: `msg-${Date.now()}-${assistantMessages.length}`,
          role: 'assistant',
          sender: agent.agentId,
          content: `调用失败：${error.message}`,
          model: agent.model,
          provider: agent.provider,
          timestamp: new Date().toISOString()
        })
      }
    }

    if (responders.length === 0) {
      assistantMessages.push({
        id: `msg-${Date.now()}-empty`,
        role: 'assistant',
        sender: '系统',
        content: mentionAgent ? `未找到可回复的 Agent：${mentionAgent}` : '当前模式下没有可回复的 Agent。请为参与者选择模型，或在自由发言模式下 @ 指定 Agent。',
        timestamp: new Date().toISOString()
      })
    }

    session.messages.push(...assistantMessages)
    const saved = saveGroupSession(session)
    res.json({ sessionId: saved.id, messages: assistantMessages, session: summarizeGroupSession(saved) })
  } catch (error) {
    res.status(500).json({ error: '群聊发送失败', message: error.message })
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
  saveSessionJson(filePath, sessionData)
  
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

// 追加会话事件（用于本地工具调用、快捷命令等非 LLM 消息）
app.post('/api/instances/:instanceId/sessions/:sessionId/events', (req, res) => {
  const { instanceId, sessionId } = req.params
  const { messages = [], model, title } = req.body || {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 不能为空' })
  }

  const instance = instances.find(i => i.id === instanceId)
  if (!instance) {
    return res.status(404).json({ error: '实例不存在' })
  }

  const filePath = path.join(CHAT_DIR, instanceId, `${sessionId}.json`)
  let sessionData

  if (fs.existsSync(filePath)) {
    sessionData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } else {
    sessionData = {
      id: sessionId,
      instanceId,
      title: title || '新会话',
      model: model || 'tool',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isFavorite: false
    }
  }

  const normalizedMessages = messages.map((item, index) => ({
    id: String(item?.id || `${Date.now()}-${index}`),
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: String(item?.content || ''),
    timestamp: item?.timestamp || new Date().toISOString(),
    model: item?.model ? String(item.model) : undefined
  })).filter(item => item.content.trim())

  if (normalizedMessages.length === 0) {
    return res.status(400).json({ error: '没有可保存的消息内容' })
  }

  sessionData.messages = [...(sessionData.messages || []), ...normalizedMessages]
  sessionData.updatedAt = new Date().toISOString()
  if (model) sessionData.model = model

  const firstUserMessage = normalizedMessages.find(item => item.role === 'user')
  if ((!sessionData.title || sessionData.title === '新会话') && firstUserMessage) {
    sessionData.title = firstUserMessage.content.slice(0, 20) + (firstUserMessage.content.length > 20 ? '...' : '')
  }

  try {
    const savedSession = saveSessionJson(filePath, sessionData, { archive: true })
    res.json(savedSession.sessionData)
  } catch (error) {
    res.status(500).json({ error: '保存会话事件失败', message: error.message })
  }
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
  const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
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
  
  const savedSession = saveSessionJson(filePath, sessionData, { archive: true })
  sessionData = savedSession.sessionData
  
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
    timestamp: new Date().toISOString(),
    obsidianArchive: savedSession.archiveResult
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
    // 从 ~/Lingshu/skills/ 读取真实的 skills
    const skillsDir = path.join(os.homedir(), 'Lingshu', 'skills')
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
  if (instance.type !== 'local' && instance.type !== 'agent-desktop' && instance.type !== 'stepfun-desktop') {
    return res.status(403).json({ error: '只有本地运行时或 Agent 桌面端可以执行技能' })
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
  
  const appAliases = {
    feishu: ['Lark', '飞书'],
    lark: ['Lark', '飞书'],
    wechat: ['WeChat', '微信'],
    chrome: ['Google Chrome'],
    safari: ['Safari'],
    terminal: ['Terminal'],
    finder: ['Finder'],
    vscode: ['Visual Studio Code'],
    parazta: ['ParaZTA'],
    workbuddy: ['WorkBuddy'],
    marvis: ['Marvis'],
    codex: ['Codex'],
    chatgpt: ['ChatGPT'],
    claude: ['Claude'],
    cursor: ['Cursor']
  }

  const normalizedAppName = String(appName || '')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\.app$/i, '')
    .replace(/\s*(应用|app|软件|程序)$/i, '')
    .trim()

  if (!normalizedAppName || normalizedAppName.length > 120 || /[\u0000\r\n]/.test(normalizedAppName)) {
    return res.status(400).json({ success: false, error: '应用名称不合法' })
  }

  const candidates = appAliases[normalizedAppName.toLowerCase()] || appAliases[normalizedAppName] || [normalizedAppName]
  const errors = []

  const tryOpenApp = (candidate) => new Promise((resolve) => {
    const appPath = findInstalledMacAppPath(candidate)
    const args = appPath ? [appPath] : ['-a', candidate]
    execFile('open', args, { timeout: 10000 }, (error) => {
      if (error) {
        errors.push(`${candidate}: ${error.message}`)
        resolve({ ok: false, candidate, appPath })
      } else {
        resolve({ ok: true, candidate, appPath })
      }
    })
  })

  const isAppRunning = (candidate) => new Promise((resolve) => {
    execFile('pgrep', ['-if', candidate], { timeout: 5000 }, (error, stdout) => {
      resolve(!error && Boolean(String(stdout || '').trim()))
    })
  })

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  try {
    for (const candidate of candidates) {
      const result = await tryOpenApp(candidate)
      if (result.ok) {
        await wait(1500)
        const running = await isAppRunning(candidate)
        if (running) {
          return res.json({
            success: true,
            verified: true,
            app: normalizedAppName,
            openedAs: result.candidate,
            path: result.appPath || null
          })
        }
        return res.json({
          success: false,
          opened: true,
          verified: false,
          app: normalizedAppName,
          openedAs: result.candidate,
          path: result.appPath || null,
          error: `打开请求已发送，但没有检测到 ${result.candidate} 进程。应用可能启动后立即退出、被系统权限拦截，或作为后台/菜单栏应用运行。`,
          details: errors.slice(-3)
        })
      }
    }
    res.status(404).json({
      success: false,
      app: normalizedAppName,
      error: `没有找到可打开的应用：${normalizedAppName}。请确认应用已安装，且名称与 /Applications 中显示一致。`,
      details: errors.slice(-3)
    })
  } catch (error) {
    res.status(500).json({ success: false, error: '打开失败', message: error.message })
  }
})

app.post('/api/instances/:id/agent-desktop/invoke', async (req, res) => {
  const { id } = req.params
  const instance = instances.find(i => i.id === id)
  if (!instance) return res.status(404).json({ error: '实例不存在' })
  if (instance.type !== 'agent-desktop' && instance.type !== 'stepfun-desktop') {
    return res.status(400).json({ success: false, error: '该实例不是 Agent 桌面端' })
  }

  const instruction = String(req.body?.instruction || '').trim()
  const appName = String(instance.appName || instance.name || '').trim()
  const configuredPath = instance.configPath ? String(instance.configPath).replace('~', os.homedir()) : ''
  const appPath = configuredPath.endsWith('.app') && fs.existsSync(configuredPath)
    ? configuredPath
    : findInstalledMacAppPath(appName)

  if (!appPath) {
    return res.status(404).json({
      success: false,
      error: `未找到桌面 Agent 应用：${appName}`,
      appName
    })
  }

  try {
    const invocationMode = normalizeInvocationMode(instance)
    const invocation = {
      id: `agent-invocation-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      instanceId: instance.id,
      instanceName: instance.name,
      appName,
      appPath,
      instruction,
      invocationMode,
      source: req.body?.source || 'chat',
      createdAt: new Date().toISOString()
    }
    fs.appendFileSync(AGENT_DESKTOP_INVOCATIONS_FILE, JSON.stringify(invocation) + '\n')

    if (invocationMode === 'cli') {
      const cliCommand = String(instance.cliCommand || '').trim()
      const resolvedCli = cliCommand.includes('/') ? cliCommand.replace('~', os.homedir()) : findExecutableOnPath(cliCommand)
      if (!resolvedCli || !fs.existsSync(resolvedCli)) {
        return res.status(400).json({
          success: false,
          error: `未找到 CLI：${cliCommand || '未配置'}`,
          invocation
        })
      }
      const args = parseCliArgsTemplate(instance.cliArgsTemplate || '{{instruction}}', instruction, {
        appName,
        instanceId: instance.id
      })
      return execFile(resolvedCli, args, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({
            success: false,
            error: 'CLI 投递失败',
            message: error.message,
            stderr: String(stderr || '').slice(0, 4000),
            invocation: { ...invocation, cliCommand: resolvedCli, cliArgs: args }
          })
        }
        res.json({
          success: true,
          mode: 'cli',
          message: `已通过 CLI 投递给 ${appName}`,
          appName,
          appPath,
          cliCommand: resolvedCli,
          cliArgs: args,
          stdout: String(stdout || '').slice(0, 4000),
          stderr: String(stderr || '').slice(0, 4000),
          invocation
        })
      })
    }

    if (invocationMode === 'url-scheme') {
      const url = renderInvocationTemplate(
        instance.urlTemplate || (instance.urlScheme ? `${instance.urlScheme}://?prompt={{encodedInstruction}}` : ''),
        instruction,
        { appName, instanceId: instance.id }
      )
      if (!url || !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
        return res.status(400).json({
          success: false,
          error: 'URL Scheme 模板不合法',
          invocation
        })
      }
      return execFile('open', [url], { timeout: 10000 }, (error) => {
        if (error) {
          return res.status(500).json({
            success: false,
            error: 'URL Scheme 投递失败',
            message: error.message,
            invocation: { ...invocation, url }
          })
        }
        res.json({
          success: true,
          mode: 'url-scheme',
          message: `已通过 URL Scheme 投递给 ${appName}`,
          appName,
          appPath,
          url,
          invocation
        })
      })
    }

    execFile('open', [appPath], { timeout: 10000 }, (error) => {
      if (error) {
        return res.status(500).json({ success: false, error: '打开桌面 Agent 失败', message: error.message, invocation })
      }
      res.json({
        success: true,
        mode: 'open',
        message: instruction
          ? `已打开 ${appName}，并记录本次调用意图。`
          : `已打开 ${appName}`,
        appName,
        appPath,
        invocation
      })
    })
  } catch (error) {
    res.status(500).json({ success: false, error: '调用桌面 Agent 失败', message: error.message })
  }
})

// ==================== Dashboard API ====================

// GET /api/dashboard/stats
app.get('/api/dashboard/stats', (req, res) => {
  try {
    const skillsDir = path.join(os.homedir(), 'Lingshu', 'skills')
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
    const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
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
  const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
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
    const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
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
    const configPath = path.join(os.homedir(), 'Lingshu', 'openclaw.json')
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
    const saved = saveSessionJson(filePath, updated, { archive: true })
    res.json(saved.sessionData)
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
  settings.data = { ...settings.data, dataDir: path.join(os.homedir(), 'Lingshu') }
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

app.get('/api/memory/sync-to-obsidian', (req, res) => {
  try {
    const data = loadMemory()
    const memories = data.memories || {}
    const items = Object.entries(memories).map(([key, entry]) => ({
      key,
      value: entry.value,
      agent: entry.agent || '',
      timestamp: entry.timestamp || '',
      syncedToObsidian: entry.syncedToObsidian || null
    })).sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')) || a.key.localeCompare(b.key, 'zh-Hans-CN'))
    res.json({
      memories: items,
      total: items.length,
      unsynced: items.filter(item => !item.syncedToObsidian?.relativePath).length
    })
  } catch (error) {
    res.status(500).json({ error: '读取记忆同步状态失败', message: error.message })
  }
})

app.post('/api/memory/sync-to-obsidian', (req, res) => {
  try {
    const { keys = [], includeSynced = false } = req.body || {}
    res.json(syncMemoriesToObsidian({ keys, includeSynced }))
  } catch (error) {
    res.status(500).json({ error: '同步记忆到知识库失败', message: error.message })
  }
})

app.post('/api/conversations/archive-to-obsidian', (req, res) => {
  try {
    const { instanceId = '', includeEmpty = false } = req.body || {}
    const archived = []
    const skipped = []
    const failed = []

    if (!fs.existsSync(CHAT_DIR)) {
      return res.json({ success: true, archived, skipped, failed, index: null })
    }

    const instanceDirs = fs.readdirSync(CHAT_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => !instanceId || entry.name === instanceId)

    for (const dir of instanceDirs) {
      const instanceChatDir = path.join(CHAT_DIR, dir.name)
      const files = fs.readdirSync(instanceChatDir).filter(file => file.endsWith('.json'))
      for (const file of files) {
        const filePath = path.join(instanceChatDir, file)
        try {
          const sessionData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
          const messages = Array.isArray(sessionData.messages) ? sessionData.messages : []
          if (!includeEmpty && messages.length === 0) {
            skipped.push({ id: sessionData.id || file.replace('.json', ''), reason: '空会话' })
            continue
          }
          const saved = saveSessionJson(filePath, sessionData, { archive: true, updateIndex: false })
          if (saved.archiveResult?.ok) {
            archived.push({
              id: saved.sessionData.id,
              title: saved.sessionData.title,
              relativePath: saved.archiveResult.relativePath
            })
          } else {
            skipped.push({
              id: sessionData.id || file.replace('.json', ''),
              reason: saved.archiveResult?.reason || saved.archiveResult?.error || '未归档'
            })
          }
        } catch (error) {
          failed.push({ file: `${dir.name}/${file}`, error: error.message })
        }
      }
    }

    let index = null
    try {
      const vault = getMarkdownVaultConfig()
      if (vault.ok) index = updateConversationArchiveIndex(vault.config)
    } catch (error) {
      failed.push({ file: 'Codex/对话存档/会话索引.md', error: error.message })
    }

    res.json({ success: failed.length === 0, archived, skipped, failed, index })
  } catch (error) {
    res.status(500).json({ error: '归档会话到知识库失败', message: error.message })
  }
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

// ==================== 文档工作台 API ====================

app.get('/api/documents/status', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    let contract = null
    let contractError = ''
    if (vault.ok) {
      try {
        contract = ensureLingshuVaultContract(vault.config)
      } catch (error) {
        contractError = error.message
      }
    }
    const noteCount = vault.ok ? listObsidianMarkdownFiles(vault.config, 5000).length : 0
    res.json({
      valid: vault.ok,
      reason: vault.reason || '',
      vaultPath: vault.config?.vaultPath || '',
      noteCount,
      includeFolders: vault.config?.includeFolders || [],
      excludeFolders: vault.config?.excludeFolders || [],
      contract,
      contractError
    })
  } catch (error) {
    res.status(500).json({ error: '检查文档工作台失败', message: error.message })
  }
})

app.get('/api/documents/tree', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    res.json({ tree: buildDocumentTree(vault.config) })
  } catch (error) {
    res.status(500).json({ error: '读取文档树失败', message: error.message })
  }
})

app.get('/api/documents/search', (req, res) => {
  try {
    const q = String(req.query.q || '')
    const limit = Number(req.query.limit) || 20
    res.json(searchMarkdownDocuments(q, limit))
  } catch (error) {
    res.status(500).json({ error: '搜索文档失败', message: error.message })
  }
})

app.get('/api/documents/properties', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const tags = String(req.query.tags || '')
    const status = String(req.query.status || '')
    const q = String(req.query.q || '')
    const limit = Number(req.query.limit) || 200
    res.json(listDocumentProperties(vault.config, { tags, status, query: q, maxResults: limit }))
  } catch (error) {
    res.status(500).json({ error: '读取文档属性失败', message: error.message })
  }
})

app.get('/api/documents/link-candidates', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const q = String(req.query.q || '')
    const limit = Number(req.query.limit) || 500
    res.json(listDocumentLinkCandidates(vault.config, q, limit))
  } catch (error) {
    res.status(500).json({ error: '读取文档链接候选失败', message: error.message })
  }
})

app.get('/api/documents/backlinks', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const limit = Number(req.query.limit) || 30
    res.json(buildDocumentBacklinks(req.query.path, vault.config, limit))
  } catch (error) {
    res.status(500).json({ error: '读取文档反链失败', message: error.message })
  }
})

app.get('/api/documents/graph', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const limit = Number(req.query.limit) || 60
    const depth = Number(req.query.depth) || 1
    res.json(buildDocumentGraph(req.query.path, vault.config, limit, depth))
  } catch (error) {
    res.status(500).json({ error: '读取文档图谱失败', message: error.message })
  }
})

app.get('/api/documents/workbench', (req, res) => {
  try {
    res.json(loadDocumentWorkbenchState())
  } catch (error) {
    res.status(500).json({ error: '读取文档工作台状态失败', message: error.message })
  }
})

app.post('/api/documents/recent', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const entry = normalizeDocumentWorkbenchEntry(req.body || {}, vault.config)
    const state = loadDocumentWorkbenchState()
    state.recent = [entry, ...state.recent.filter(item => item.path !== entry.path)].slice(0, 30)
    saveDocumentWorkbenchState(state)
    res.json(state)
  } catch (error) {
    res.status(400).json({ error: '记录最近打开失败', message: error.message })
  }
})

app.post('/api/documents/favorites', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const entry = normalizeDocumentWorkbenchEntry(req.body || {}, vault.config)
    const state = loadDocumentWorkbenchState()
    if (!state.favorites.some(item => item.path === entry.path)) {
      state.favorites = [{ ...entry, addedAt: new Date().toISOString() }, ...state.favorites].slice(0, 80)
    }
    saveDocumentWorkbenchState(state)
    res.json(state)
  } catch (error) {
    res.status(400).json({ error: '收藏文档失败', message: error.message })
  }
})

app.delete('/api/documents/favorites', (req, res) => {
  try {
    const targetPath = normalizeVaultRelativePath(req.query.path)
    const state = loadDocumentWorkbenchState()
    state.favorites = state.favorites.filter(item => item.path !== targetPath)
    saveDocumentWorkbenchState(state)
    res.json(state)
  } catch (error) {
    res.status(400).json({ error: '取消收藏失败', message: error.message })
  }
})

app.get('/api/documents/file', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const { relativePath, absolutePath } = resolveVaultPath(req.query.path, vault.config, { requireMarkdown: true })
    if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: '文档不存在' })
    const stat = fs.statSync(absolutePath)
    if (!stat.isFile()) return res.status(400).json({ error: '不是文件' })
    if (stat.size > 1024 * 1024) return res.status(413).json({ error: '文档超过 1MB，暂不在工作台内编辑' })
    const content = fs.readFileSync(absolutePath, 'utf8')
    res.json({
      path: relativePath,
      title: path.basename(relativePath, '.md'),
      content,
      revision: hashContent(content),
      mtime: stat.mtime.toISOString(),
      size: stat.size
    })
  } catch (error) {
    res.status(400).json({ error: '读取文档失败', message: error.message })
  }
})

app.get('/api/documents/file-status', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    ensureDocumentWatcher(vault.config)
    ensureDocumentFileWatcher(vault.config, req.query.path)
    res.json(getDocumentFileStatus(req.query.path, vault.config))
  } catch (error) {
    res.status(400).json({ error: '读取文档状态失败', message: error.message })
  }
})

app.get('/api/documents/watch', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const watcher = ensureDocumentWatcher(vault.config)
    res.json(watcher)
  } catch (error) {
    res.status(500).json({ error: '启动文档监听失败', message: error.message })
  }
})

app.get('/api/documents/events', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const watcher = ensureDocumentWatcher(vault.config)
    const since = Math.max(Number(req.query.since) || 0, 0)
    const requestedPath = req.query.path ? normalizeVaultRelativePath(req.query.path) : ''
    if (requestedPath) ensureDocumentFileWatcher(vault.config, requestedPath)
    const events = documentWatchState.events
      .filter(event => event.id > since)
      .filter(event => !requestedPath || event.path === requestedPath)
    res.json({ ...watcher, events, lastEventId: documentWatchState.lastId })
  } catch (error) {
    res.status(400).json({ error: '读取文档事件失败', message: error.message })
  }
})

app.put('/api/documents/file', (req, res) => {
  try {
    const { path: requestedPath, content, baseRevision, force } = req.body || {}
    if (typeof content !== 'string') return res.status(400).json({ error: 'content 为必填' })
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const { relativePath, absolutePath } = resolveVaultPath(requestedPath, vault.config, { requireMarkdown: true })
    const exists = fs.existsSync(absolutePath)
    if (exists && !fs.statSync(absolutePath).isFile()) return res.status(400).json({ error: '不是文件' })

    const currentRevision = exists ? fileRevision(absolutePath) : ''
    if (!force && baseRevision !== undefined && currentRevision && baseRevision !== currentRevision) {
      return res.status(409).json({ error: '文档已在外部发生变化', currentRevision })
    }

    if (exists) {
      const snapshot = documentSnapshotPath(relativePath)
      fs.mkdirSync(path.dirname(snapshot), { recursive: true })
      fs.copyFileSync(absolutePath, snapshot)
    } else {
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    }

    atomicWriteTextFile(absolutePath, content)
    const stat = fs.statSync(absolutePath)
    res.json({
      success: true,
      path: relativePath,
      revision: hashContent(content),
      mtime: stat.mtime.toISOString(),
      size: stat.size
    })
  } catch (error) {
    res.status(400).json({ error: '保存文档失败', message: error.message })
  }
})

app.get('/api/documents/versions', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const { relativePath } = resolveVaultPath(req.query.path, vault.config, { requireMarkdown: true })
    const snapshotDir = documentSnapshotDirectory(relativePath)
    if (!fs.existsSync(snapshotDir)) return res.json({ versions: [] })

    const versions = fs.readdirSync(snapshotDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.md$/.test(entry.name))
      .map(entry => {
        const filePath = path.join(snapshotDir, entry.name)
        const stat = fs.statSync(filePath)
        return {
          id: entry.name,
          createdAt: entry.name.replace(/\.md$/, '').replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z'),
          size: stat.size,
          revision: fileRevision(filePath)
        }
      })
      .sort((a, b) => String(b.id).localeCompare(String(a.id)))
      .slice(0, 80)

    res.json({ versions })
  } catch (error) {
    res.status(400).json({ error: '读取版本历史失败', message: error.message })
  }
})

app.get('/api/documents/versions/content', (req, res) => {
  try {
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const { relativePath } = resolveVaultPath(req.query.path, vault.config, { requireMarkdown: true })
    const snapshotPath = resolveDocumentSnapshot(relativePath, req.query.version)
    if (!fs.existsSync(snapshotPath)) return res.status(404).json({ error: '版本不存在' })
    const content = fs.readFileSync(snapshotPath, 'utf8')
    const stat = fs.statSync(snapshotPath)
    res.json({
      path: relativePath,
      version: path.basename(snapshotPath),
      content,
      revision: hashContent(content),
      size: stat.size,
      createdAt: path.basename(snapshotPath).replace(/\.md$/, '').replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
    })
  } catch (error) {
    res.status(400).json({ error: '读取版本内容失败', message: error.message })
  }
})

app.post('/api/documents/versions/restore', (req, res) => {
  try {
    const { path: requestedPath, version, baseRevision, force } = req.body || {}
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const { relativePath, absolutePath } = resolveVaultPath(requestedPath, vault.config, { requireMarkdown: true })
    const snapshotPath = resolveDocumentSnapshot(relativePath, version)
    if (!fs.existsSync(snapshotPath)) return res.status(404).json({ error: '版本不存在' })
    if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: '当前文档不存在' })

    const currentRevision = fileRevision(absolutePath)
    if (!force && baseRevision !== undefined && currentRevision && baseRevision !== currentRevision) {
      return res.status(409).json({ error: '文档已在外部发生变化', currentRevision })
    }

    const backupPath = documentSnapshotPath(relativePath)
    fs.mkdirSync(path.dirname(backupPath), { recursive: true })
    fs.copyFileSync(absolutePath, backupPath)
    const content = fs.readFileSync(snapshotPath, 'utf8')
    atomicWriteTextFile(absolutePath, content)
    const stat = fs.statSync(absolutePath)
    res.json({
      success: true,
      path: relativePath,
      revision: hashContent(content),
      mtime: stat.mtime.toISOString(),
      size: stat.size
    })
  } catch (error) {
    res.status(400).json({ error: '恢复版本失败', message: error.message })
  }
})

app.post('/api/documents/export', (req, res) => {
  try {
    const { path: requestedPath, content, format = 'html' } = req.body || {}
    const exportFormat = format === 'markdown' || format === 'md' ? 'markdown' : 'html'
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const { relativePath, absolutePath } = resolveVaultPath(requestedPath, vault.config, { requireMarkdown: true })
    if (!fs.existsSync(absolutePath) && typeof content !== 'string') return res.status(404).json({ error: '文档不存在' })

    const sourceContent = typeof content === 'string' ? content : fs.readFileSync(absolutePath, 'utf8')
    const title = (sourceContent.match(/^#\s+(.+)$/m)?.[1] || path.basename(relativePath, '.md')).trim()
    const fileName = buildExportFileName(relativePath, exportFormat)
    const exportPath = path.join(EXPORTS_DIR, fileName)
    if (!isPathInside(EXPORTS_DIR, exportPath)) throw new Error('非法导出路径')

    if (exportFormat === 'markdown') {
      fs.writeFileSync(exportPath, sourceContent)
    } else {
      fs.writeFileSync(exportPath, buildExportHtml({ title, markdown: sourceContent, sourcePath: relativePath }))
    }

    res.json({
      success: true,
      format: exportFormat,
      title,
      fileName,
      path: exportPath,
      url: `/exports/${encodeURIComponent(fileName)}`,
      createdAt: new Date().toISOString()
    })
  } catch (error) {
    res.status(400).json({ error: '导出文档失败', message: error.message })
  }
})

app.post('/api/documents/create', (req, res) => {
  try {
    const { parentPath = '', title = '未命名文档', content = '' } = req.body || {}
    const vault = getMarkdownVaultConfig()
    if (!vault.ok) return res.status(400).json({ error: vault.reason })
    const parent = resolveVaultPath(parentPath, vault.config, { allowDirectory: true })
    const parentStat = fs.existsSync(parent.absolutePath) ? fs.statSync(parent.absolutePath) : null
    const targetDir = parentStat?.isFile() ? path.dirname(parent.absolutePath) : parent.absolutePath
    if (!isPathInside(vault.config.vaultPath, targetDir)) throw new Error('非法目录')
    fs.mkdirSync(targetDir, { recursive: true })

    const baseName = safeDocumentTitle(title)
    let filePath = path.join(targetDir, `${baseName}.md`)
    let suffix = 2
    while (fs.existsSync(filePath)) {
      filePath = path.join(targetDir, `${baseName}-${suffix}.md`)
      suffix++
    }
    atomicWriteTextFile(filePath, content || `# ${baseName}\n`)
    const relativePath = path.relative(vault.config.vaultPath, filePath).split(path.sep).join('/')
    res.json({ success: true, path: relativePath })
  } catch (error) {
    res.status(400).json({ error: '创建文档失败', message: error.message })
  }
})

app.post('/api/documents/agent/edit', async (req, res) => {
  try {
    const {
      agentId = 'document-agent',
      documentPath = '',
      baseRevision = '',
      documentContent,
      content = '',
      selection,
      instruction = '',
      action = 'rewrite',
      contextPolicy = 'document-only',
      model
    } = req.body || {}
    const sourceContent = typeof documentContent === 'string' ? documentContent : content
    if (!String(sourceContent).trim()) return res.status(400).json({ error: 'documentContent/content 为必填' })
    if (!String(instruction).trim() && action === 'custom') return res.status(400).json({ error: 'instruction 为必填' })

    let normalizedDocumentPath = ''
    let currentRevision = ''
    if (documentPath) {
      const vault = getMarkdownVaultConfig()
      if (!vault.ok) return res.status(400).json({ error: vault.reason })
      const resolved = resolveVaultPath(documentPath, vault.config, { requireMarkdown: true })
      normalizedDocumentPath = resolved.relativePath
      currentRevision = fs.existsSync(resolved.absolutePath) ? fileRevision(resolved.absolutePath) : ''
      if (baseRevision && currentRevision && baseRevision !== currentRevision) {
        return res.status(409).json({ error: '文档已在外部发生变化', currentRevision })
      }
    }

    const selectionText = typeof selection === 'string'
      ? selection
      : typeof selection?.text === 'string'
        ? selection.text
        : ''
    const normalizedContextPolicy = ['document-only', 'vault', 'full-tools'].includes(contextPolicy) ? contextPolicy : 'document-only'
    const actionLabel = {
      rewrite: '改写并优化表达',
      summarize: '生成结构化摘要',
      expand: '扩写当前内容',
      polish: '润色为清晰专业的中文',
      translate: '翻译当前内容',
      review: '审阅当前内容并提出可直接应用的改进稿',
      custom: instruction
    }[action] || instruction || '优化文档'

    const targetText = selectionText || sourceContent
    const citations = []
    let vaultContext = ''
    if (normalizedContextPolicy !== 'document-only') {
      try {
        const query = [instruction, actionLabel, selectionText || normalizedDocumentPath].filter(Boolean).join(' ')
        const search = searchMarkdownDocuments(query || targetText.slice(0, 120), 5)
        if (search.ok && Array.isArray(search.results) && search.results.length > 0) {
          citations.push(...search.results.map(item => ({
            title: item.title,
            path: item.path || item.relativePath,
            snippet: item.snippet || ''
          })))
          vaultContext = [
            '## Vault 相关上下文',
            ...search.results.map((item, index) => [
              `### ${index + 1}. ${item.title}`,
              `路径：${item.path || item.relativePath}`,
              item.snippet || ''
            ].join('\n'))
          ].join('\n\n')
        }
      } catch (_) {}
    }

    const messages = [
      {
        role: 'system',
        content: [
          '你是灵枢内部文档 Agent。只输出可直接替换的 Markdown 正文，不要使用代码围栏，不要解释操作过程。',
          '保留用户原文中的事实、链接、表格和任务项。默认只生成建议稿，不直接覆盖文档。',
          normalizedContextPolicy === 'document-only' ? '上下文策略：仅使用当前选区或当前文档。' : '',
          normalizedContextPolicy === 'vault' ? '上下文策略：可以参考当前 Vault 中的相关 Markdown 笔记，但不要编造引用。' : '',
          normalizedContextPolicy === 'full-tools' ? '上下文策略：可以参考当前 Vault 和灵枢 Skills 语义，但本接口仍只返回文档修改建议。' : ''
        ].filter(Boolean).join('\n')
      },
      {
        role: 'user',
        content: [
          `Agent：${agentId}`,
          normalizedDocumentPath ? `文档路径：${normalizedDocumentPath}` : '',
          baseRevision ? `基础版本：${baseRevision}` : '',
          `上下文策略：${normalizedContextPolicy}`,
          `任务：${actionLabel}`,
          instruction ? `补充要求：${instruction}` : '',
          selectionText ? `范围：仅处理选区文本${typeof selection?.from === 'number' && typeof selection?.to === 'number' ? `（${selection.from}-${selection.to}）` : ''}。` : '范围：处理整篇文档。',
          vaultContext,
          '',
          '当前 Markdown：',
          targetText
        ].filter(Boolean).join('\n')
      }
    ]
    const result = await callInternalAgent({ modelKey: model, messages, temperature: 0.35 })
    res.json({
      success: true,
      baseRevision: baseRevision || currentRevision || '',
      documentPath: normalizedDocumentPath,
      proposedContent: result.text.trim(),
      proposal: result.text.trim(),
      replaceSelection: !!selectionText,
      citations,
      model: result.model,
      summary: actionLabel,
      contextPolicy: normalizedContextPolicy
    })
  } catch (error) {
    res.status(500).json({ error: '文档 Agent 调用失败', message: error.message })
  }
})

// ==================== 转写设置 API ====================

app.get('/api/transcription/settings', (req, res) => {
  try {
    const config = getTranscriptionConfig()
    res.json({ ...config, apiKey: config.apiKey ? '********' : '' })
  } catch (error) {
    res.status(500).json({ error: '读取转写设置失败', message: error.message })
  }
})

app.put('/api/transcription/settings', (req, res) => {
  try {
    const current = loadSettings()
    const incoming = req.body || {}
    const existingApiKey = current.transcription?.apiKey || ''
    const apiKey = incoming.apiKey === '********' ? existingApiKey : String(incoming.apiKey || '')
    const transcription = {
      ...DEFAULT_TRANSCRIPTION_SETTINGS,
      ...(current.transcription || {}),
      enabled: !!incoming.enabled,
      provider: incoming.provider === 'openai-compatible' ? 'openai-compatible' : 'browser',
      baseUrl: String(incoming.baseUrl || '').trim(),
      apiKey,
      model: String(incoming.model || 'whisper-1').trim(),
      language: String(incoming.language || 'zh').trim()
    }
    const updated = { ...current, transcription, updatedAt: new Date().toISOString() }
    saveSettings(updated)
    res.json({ ...transcription, apiKey: transcription.apiKey ? '********' : '' })
  } catch (error) {
    res.status(500).json({ error: '保存转写设置失败', message: error.message })
  }
})

// ==================== 会议录音与纪要 API ====================

app.get('/api/meetings', (req, res) => {
  try {
    res.json({ meetings: listMeetings() })
  } catch (error) {
    res.status(500).json({ error: '读取历史会议失败', message: error.message })
  }
})

app.get('/api/meetings/:id', (req, res) => {
  try {
    const meeting = loadMeeting(req.params.id)
    if (!meeting) return res.status(404).json({ error: '会议不存在' })
    res.json({
      ...meetingSummary(meeting),
      transcript: readTextFileIfExists(meeting.transcriptPath),
      minutes: readTextFileIfExists(meeting.minutesPath)
    })
  } catch (error) {
    res.status(500).json({ error: '读取会议失败', message: error.message })
  }
})

app.post('/api/meetings', (req, res) => {
  try {
    const title = safeDocumentTitle(req.body?.title || `会议 ${new Date().toLocaleString('zh-CN')}`)
    const id = `meeting-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
    const meeting = {
      id,
      title,
      status: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      audioPath: '',
      transcriptPath: '',
      minutesPath: '',
      vaultRelativePath: ''
    }
    saveMeeting(meeting)
    res.json(meeting)
  } catch (error) {
    res.status(500).json({ error: '创建会议失败', message: error.message })
  }
})

function getAudioUploadExtension(file, mimeType) {
  const originalExt = path.extname(file?.originalname || '').replace(/^\./, '').toLowerCase()
  const allowed = new Set(['mp3', 'm4a', 'wav', 'webm', 'mp4', 'aac', 'flac', 'ogg', 'opus'])
  if (allowed.has(originalExt)) return originalExt
  const mime = String(mimeType || file?.mimetype || '').toLowerCase()
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('flac')) return 'flac'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('aac')) return 'aac'
  if (mime.includes('webm')) return 'webm'
  return 'webm'
}

app.post('/api/meetings/:id/audio', upload.single('audio'), (req, res) => {
  try {
    const meeting = loadMeeting(req.params.id)
    if (!meeting) return res.status(404).json({ error: '会议不存在' })
    if (!req.file) return res.status(400).json({ error: '缺少录音文件' })

    const meetingDir = path.join(MEETINGS_DIR, meeting.id)
    fs.mkdirSync(meetingDir, { recursive: true })
    const mime = String(req.body?.mimeType || req.file.mimetype || '')
    const ext = getAudioUploadExtension(req.file, mime)
    const audioPath = path.join(meetingDir, `audio.${ext}`)
    fs.renameSync(req.file.path, audioPath)

    const transcript = String(req.body?.transcript || '').trim()
    let transcriptPath = meeting.transcriptPath || ''
    if (transcript) {
      transcriptPath = path.join(meetingDir, 'transcript.md')
      fs.writeFileSync(transcriptPath, transcript)
    }

    const updated = {
      ...meeting,
      status: 'recorded',
      audioPath,
      audioOriginalName: req.file.originalname || '',
      audioMimeType: mime,
      transcriptPath,
      updatedAt: new Date().toISOString()
    }
    saveMeeting(updated)
    res.json(updated)
  } catch (error) {
    res.status(500).json({ error: '保存录音失败', message: error.message })
  }
})

app.post('/api/meetings/:id/retranscribe', async (req, res) => {
  try {
    const meeting = loadMeeting(req.params.id)
    if (!meeting) return res.status(404).json({ error: '会议不存在' })
    if (!meeting.audioPath || !fs.existsSync(meeting.audioPath)) {
      return res.status(400).json({ error: '该会议没有可转写的录音文件' })
    }

    const transcribing = { ...meeting, status: 'transcribing', updatedAt: new Date().toISOString() }
    saveMeeting(transcribing)
    const transcription = await transcribeAudioFile(meeting.audioPath, req.body?.transcription || {})
    const transcript = transcription.text || ''
    const transcriptPath = path.join(MEETINGS_DIR, meeting.id, 'transcript.md')
    if (transcript) fs.writeFileSync(transcriptPath, transcript)

    const updated = {
      ...meeting,
      status: transcript ? 'transcribed' : 'recorded',
      transcriptPath: transcript ? transcriptPath : meeting.transcriptPath,
      updatedAt: new Date().toISOString(),
      transcription: {
        provider: transcription.provider,
        model: transcription.model || '',
        error: transcription.error || ''
      }
    }
    saveMeeting(updated)
    res.json({ ...meetingSummary(updated), transcript, minutes: readTextFileIfExists(updated.minutesPath) })
  } catch (error) {
    res.status(500).json({ error: '重新转写失败', message: error.message })
  }
})

app.post('/api/meetings/:id/finalize', async (req, res) => {
  try {
    const meeting = loadMeeting(req.params.id)
    if (!meeting) return res.status(404).json({ error: '会议不存在' })

    let transcript = String(req.body?.transcript || (
      meeting.transcriptPath && fs.existsSync(meeting.transcriptPath)
        ? fs.readFileSync(meeting.transcriptPath, 'utf8')
        : ''
    )).trim()
    let transcription = { text: transcript, provider: transcript ? 'provided' : '', error: '' }

    if (!transcript && meeting.audioPath) {
      const transcribing = { ...meeting, status: 'transcribing', updatedAt: new Date().toISOString() }
      saveMeeting(transcribing)
      transcription = await transcribeAudioFile(meeting.audioPath, req.body?.transcription || {})
      transcript = transcription.text || ''
      if (transcript) {
        const transcriptPath = path.join(MEETINGS_DIR, meeting.id, 'transcript.md')
        fs.writeFileSync(transcriptPath, transcript)
        meeting.transcriptPath = transcriptPath
      }
    } else if (transcript && !meeting.transcriptPath) {
      const transcriptPath = path.join(MEETINGS_DIR, meeting.id, 'transcript.md')
      fs.writeFileSync(transcriptPath, transcript)
      meeting.transcriptPath = transcriptPath
    }

    let minutes = ''
    let model = ''
    if (transcript) {
      try {
        const result = await callInternalAgent({
          modelKey: req.body?.model,
          temperature: 0.25,
          maxTokens: 5000,
          messages: [
            {
              role: 'system',
              content: '你是灵枢会议纪要 Agent。根据逐字稿生成中文 Markdown 会议纪要，包含：一句话结论、会议摘要、关键讨论、决策、待办事项（负责人/截止时间如未知写未定）、风险与后续跟进。不要编造逐字稿中没有的信息。'
            },
            { role: 'user', content: `会议标题：${meeting.title}\n\n逐字稿：\n${transcript}` }
          ]
        })
        minutes = result.text.trim()
        model = result.model
      } catch (error) {
        minutes = buildFallbackMinutes({ title: meeting.title, transcript, audioPath: meeting.audioPath })
      }
    } else {
      minutes = buildFallbackMinutes({ title: meeting.title, transcript: '', audioPath: meeting.audioPath })
    }

    const meetingDir = path.join(MEETINGS_DIR, meeting.id)
    const localMinutesPath = path.join(meetingDir, 'minutes.md')
    fs.writeFileSync(localMinutesPath, minutes)
    const vaultNote = writeMinutesToVault({ title: meeting.title, content: minutes })

    const updated = {
      ...meeting,
      status: transcript ? 'summarized' : 'recorded',
      transcriptPath: meeting.transcriptPath,
      minutesPath: localMinutesPath,
      vaultRelativePath: vaultNote?.relativePath || '',
      updatedAt: new Date().toISOString(),
      transcription: {
        provider: transcription.provider,
        model: transcription.model || '',
        error: transcription.error || ''
      }
    }
    saveMeeting(updated)
    res.json({ ...updated, minutes, model, transcript })
  } catch (error) {
    res.status(500).json({ error: '生成会议纪要失败', message: error.message })
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

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 灵枢 App Server running on port ${PORT}`)
  console.log(`📱 API: http://127.0.0.1:${PORT}/api`)
  console.log(`💾 Data: ${DATA_DIR}`)
  console.log(`\n已加载 ${instances.length} 个实例：`)
  instances.forEach(i => console.log(`  • ${i.name} (${i.type}) - ${i.status}`))
})
