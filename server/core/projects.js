import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

const WORKSPACE_DIR = path.join(os.homedir(), 'Lingshu', 'workspace')
const PROJECTS_DIR = path.join(WORKSPACE_DIR, 'projects')
const PROJECTS_FILE = path.join(PROJECTS_DIR, 'projects.json')
const PROJECT_SECRET_KEY_FILE = path.join(PROJECTS_DIR, '.project-secrets.key')
const ENCRYPTED_SECRET_PREFIX = 'enc:v1:'

const PROJECT_STATUSES = new Set(['active', 'paused', 'done', 'archived'])
const PROJECT_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent'])
const WORK_ITEM_TYPES = new Set(['task', 'bug', 'feature', 'decision', 'risk', 'research'])
const WORK_ITEM_STATUSES = new Set(['inbox', 'todo', 'doing', 'blocked', 'review', 'done'])
const PROJECT_CONFIG_TYPES = new Set(['server', 'credential', 'variable', 'note'])

function ensureProjectsDir() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true })
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonFile(filePath, value) {
  ensureProjectsDir()
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tempPath, filePath)
}

function getProjectSecretKey() {
  ensureProjectsDir()
  if (fs.existsSync(PROJECT_SECRET_KEY_FILE)) {
    const key = Buffer.from(fs.readFileSync(PROJECT_SECRET_KEY_FILE, 'utf8').trim(), 'base64')
    if (key.length !== 32) throw new Error('项目凭据密钥格式无效')
    return key
  }
  const key = crypto.randomBytes(32)
  fs.writeFileSync(PROJECT_SECRET_KEY_FILE, key.toString('base64'), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  fs.chmodSync(PROJECT_SECRET_KEY_FILE, 0o600)
  return key
}

function encryptProjectSecret(value, key = getProjectSecretKey()) {
  const plaintext = String(value || '')
  if (!plaintext || plaintext.startsWith(ENCRYPTED_SECRET_PREFIX)) return plaintext
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENCRYPTED_SECRET_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

function decryptProjectSecret(value, key = getProjectSecretKey()) {
  const encoded = String(value || '')
  if (!encoded || !encoded.startsWith(ENCRYPTED_SECRET_PREFIX)) return encoded
  const [ivPart, tagPart, encryptedPart] = encoded.slice(ENCRYPTED_SECRET_PREFIX.length).split(':')
  if (!ivPart || !tagPart || encryptedPart === undefined) throw new Error('项目凭据密文格式无效')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

function decryptProjectConfigItems(items = []) {
  return items.map(item => item?.sensitive ? {
    ...item,
    value: decryptProjectSecret(item.value),
    notes: decryptProjectSecret(item.notes),
  } : item)
}

function encryptProjectForStorage(project) {
  const normalized = normalizeProject(project)
  return {
    ...normalized,
    configItems: normalized.configItems.map(item => item.sensitive ? {
      ...item,
      value: encryptProjectSecret(item.value),
      notes: encryptProjectSecret(item.notes),
    } : item),
  }
}

function normalizeStringList(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,]/)
  return [...new Set(source.map(item => String(item || '').trim()).filter(Boolean))]
}

function normalizeProjectLink(input = {}) {
  return {
    id: input.id || createId('link'),
    type: input.type || 'document',
    title: String(input.title || input.name || input.url || '未命名资料').trim(),
    targetId: String(input.targetId || input.id || '').trim(),
    url: String(input.url || '').trim(),
    excerpt: String(input.excerpt || input.description || '').trim(),
    createdAt: input.createdAt || new Date().toISOString(),
  }
}

function normalizeProjectConfigItem(input = {}) {
  const now = new Date().toISOString()
  const type = PROJECT_CONFIG_TYPES.has(input.type) ? input.type : 'note'
  return {
    id: input.id || createId('config'),
    type,
    title: String(input.title || input.name || input.key || '未命名配置').trim() || '未命名配置',
    environment: String(input.environment || '').trim(),
    host: String(input.host || '').trim(),
    port: String(input.port || '').trim(),
    username: String(input.username || input.user || '').trim(),
    value: String(input.value || input.password || input.token || '').trim(),
    notes: String(input.notes || input.description || '').trim(),
    sensitive: input.sensitive === undefined ? type === 'credential' : !!input.sensitive,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  }
}

function sanitizeProjectConfigItemForResponse(input = {}) {
  const item = { ...input }
  if (!item.sensitive) return item
  return {
    ...item,
    value: '',
    notes: '',
    hasValue: Boolean(item.value),
    hasNotes: Boolean(item.notes),
  }
}

function normalizeProject(input = {}) {
  const now = new Date().toISOString()
  const status = PROJECT_STATUSES.has(input.status) ? input.status : 'active'
  const priority = PROJECT_PRIORITIES.has(input.priority) ? input.priority : 'medium'
  return {
    id: input.id || createId('project'),
    name: String(input.name || '未命名项目').trim() || '未命名项目',
    description: String(input.description || '').trim(),
    status,
    owner: String(input.owner || '').trim(),
    priority,
    startDate: input.startDate || '',
    targetDate: input.targetDate || '',
    progress: Math.max(0, Math.min(100, Number(input.progress || 0))),
    tags: normalizeStringList(input.tags),
    linkedRepositories: normalizeStringList(input.linkedRepositories || input.repositories),
    linkedDocuments: (Array.isArray(input.linkedDocuments) ? input.linkedDocuments : []).map(normalizeProjectLink),
    linkedMeetings: (Array.isArray(input.linkedMeetings) ? input.linkedMeetings : []).map(item => normalizeProjectLink({ ...item, type: 'meeting' })),
    linkedSessions: (Array.isArray(input.linkedSessions) ? input.linkedSessions : []).map(item => normalizeProjectLink({ ...item, type: 'chat' })),
    configItems: (Array.isArray(input.configItems) ? input.configItems : []).map(normalizeProjectConfigItem),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  }
}

function normalizeWorkItemSource(input = {}) {
  if (!input || typeof input !== 'object') return null
  const type = String(input.type || '').trim()
  if (!type) return null
  return {
    type,
    sourceId: String(input.sourceId || '').trim(),
    title: String(input.title || '').trim(),
    url: String(input.url || '').trim(),
    excerpt: String(input.excerpt || '').trim(),
  }
}

function normalizeWorkItemLink(input = {}) {
  return {
    id: input.id || createId('item-link'),
    type: String(input.type || 'url').trim(),
    title: String(input.title || input.url || '关联资料').trim(),
    targetId: String(input.targetId || '').trim(),
    url: String(input.url || '').trim(),
  }
}

function normalizeWorkItem(input = {}, projectId = '') {
  const now = new Date().toISOString()
  const type = WORK_ITEM_TYPES.has(input.type) ? input.type : 'task'
  const status = WORK_ITEM_STATUSES.has(input.status) ? input.status : 'todo'
  const priority = PROJECT_PRIORITIES.has(input.priority) ? input.priority : 'medium'
  return {
    id: input.id || createId('item'),
    projectId: input.projectId || projectId,
    type,
    title: String(input.title || '未命名任务').trim() || '未命名任务',
    description: String(input.description || '').trim(),
    status,
    priority,
    assignee: String(input.assignee || '').trim(),
    dueDate: input.dueDate || '',
    labels: normalizeStringList(input.labels),
    source: normalizeWorkItemSource(input.source),
    links: (Array.isArray(input.links) ? input.links : []).map(normalizeWorkItemLink),
    estimate: input.estimate === '' || input.estimate === undefined ? null : Number(input.estimate),
    actual: input.actual === '' || input.actual === undefined ? null : Number(input.actual),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  }
}

function readProjectsState() {
  const data = readJsonFile(PROJECTS_FILE, { projects: [], workItems: [], updates: [] })
  const rawProjects = Array.isArray(data.projects) ? data.projects : []
  const needsSecretMigration = rawProjects.some(project => (project.configItems || []).some(item => (
    item?.sensitive && [item.value, item.notes].some(value => value && !String(value).startsWith(ENCRYPTED_SECRET_PREFIX))
  )))
  const state = {
    projects: rawProjects.map(project => normalizeProject({
      ...project,
      configItems: decryptProjectConfigItems(project.configItems || []),
    })),
    workItems: Array.isArray(data.workItems) ? data.workItems.map(item => normalizeWorkItem(item, item.projectId)) : [],
    updates: Array.isArray(data.updates) ? data.updates : [],
  }
  if (needsSecretMigration) writeProjectsState(state)
  return state
}

function writeProjectsState(state) {
  writeJsonFile(PROJECTS_FILE, {
    projects: state.projects.map(encryptProjectForStorage),
    workItems: state.workItems.map(item => normalizeWorkItem(item, item.projectId)),
    updates: Array.isArray(state.updates) ? state.updates.slice(-500) : [],
  })
}

function summarizeProject(project, workItems = []) {
  const items = workItems.filter(item => item.projectId === project.id)
  const done = items.filter(item => item.status === 'done').length
  const blocked = items.filter(item => item.status === 'blocked').length
  const progress = items.length > 0 ? Math.round((done / items.length) * 100) : project.progress
  return {
    ...project,
    configItems: (project.configItems || []).map(sanitizeProjectConfigItemForResponse),
    progress,
    taskCount: items.length,
    doneCount: done,
    blockedCount: blocked,
    repositoryCount: project.linkedRepositories.length,
    resourceCount: project.linkedDocuments.length + project.linkedMeetings.length + project.linkedSessions.length,
    configCount: project.configItems.length,
  }
}

function appendProjectUpdate(state, input) {
  const update = {
    id: createId('update'),
    projectId: input.projectId || '',
    type: input.type || 'comment',
    title: String(input.title || '项目更新').trim(),
    content: String(input.content || '').trim(),
    actor: String(input.actor || '灵枢').trim(),
    targetId: String(input.targetId || '').trim(),
    createdAt: new Date().toISOString(),
  }
  state.updates.push(update)
  return update
}

export {
  readProjectsState,
  writeProjectsState,
  normalizeProject,
  normalizeWorkItem,
  normalizeProjectLink,
  normalizeProjectConfigItem,
  encryptProjectSecret,
  decryptProjectSecret,
  sanitizeProjectConfigItemForResponse,
  summarizeProject,
  appendProjectUpdate,
  WORK_ITEM_STATUSES,
}
