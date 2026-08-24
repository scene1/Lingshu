import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const MEMORY_TYPES = new Set(['fact', 'preference', 'decision', 'task', 'inference'])
const MEMORY_STATUSES = new Set(['active', 'candidate', 'archived', 'rejected', 'expired', 'superseded'])
const SENSITIVE_PATTERN = /(?:api[_-]?key|access[_-]?token|password|passwd|密码|密钥|私钥|bearer\s+|sk-[a-z0-9_-]{8,})/i

function normalizeText(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function fingerprint(type, content) {
  return crypto.createHash('sha256').update(`${type}:${content.toLowerCase()}`).digest('hex').slice(0, 24)
}

function detectMemorySlot(type, content) {
  const text = normalizeText(content).toLowerCase()
  if (type === 'fact' && /(?:后端|服务)?端口/.test(text)) return 'fact:backend_port'
  if (type === 'fact' && /(?:项目叫|项目名称)/.test(text)) return 'fact:project_name'
  if (type === 'fact' && /(?:工作目录|工作区|workspace)/i.test(text)) return 'fact:workspace'
  if (type === 'decision' && /(?:模型|provider|deepseek|anthropic|openai)/i.test(text)) return 'decision:model_provider'
  if (type === 'decision' && /前端/.test(text)) return 'decision:frontend_strategy'
  if (type === 'preference' && /(?:回答|回复).*(?:简洁|详细|中文|英文|要点|表格)/.test(text)) return 'preference:response_style'
  return ''
}

function isExplicitCorrection(content) {
  return /(?:改为|改成|更新为|换成|现在(?:是|用)|从.{1,60}(?:改|换)(?:为|成)|不再.{1,60}(?:改用|使用|采用))/i.test(content)
}

function normalizeStoredItem(item = {}) {
  return {
    ...item,
    scope: ['global', 'project', 'agent'].includes(item.scope) ? item.scope : 'global',
    scopeId: String(item.scopeId || ''),
    status: MEMORY_STATUSES.has(item.status) ? item.status : 'candidate',
    sensitivity: item.sensitivity === 'private' ? 'private' : 'normal',
    sourceEpisodeIds: Array.isArray(item.sourceEpisodeIds) ? item.sourceEpisodeIds.map(String).slice(0, 20) : [],
    conflictWith: Array.isArray(item.conflictWith) ? item.conflictWith.map(String).slice(0, 20) : [],
    supersedes: Array.isArray(item.supersedes) ? item.supersedes.map(String).slice(0, 20) : item.supersedes ? [String(item.supersedes)] : [],
    slotKey: String(item.slotKey || detectMemorySlot(item.type, item.content)),
  }
}

function tokenize(value) {
  const text = normalizeText(value, 2000).toLowerCase()
  const latin = text.match(/[a-z0-9][a-z0-9_.-]{1,}/g) || []
  const cjkRuns = text.match(/[\u3400-\u9fff]{2,}/g) || []
  const cjk = cjkRuns.flatMap(run => {
    const tokens = [run]
    for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2))
    return tokens
  })
  return new Set([...latin, ...cjk])
}

function classifySentence(sentence) {
  const text = normalizeText(sentence)
  if (!text || text.length < 4 || SENSITIVE_PATTERN.test(text)) return null
  if (/(?:我(?:更)?喜欢|我偏好|我的偏好|以后请|今后请|请一直|回答请|默认请)/i.test(text)) return 'preference'
  if (/(?:我们)?(?:已经)?决定|确定采用|最终选择|保留现有|不再使用|统一使用|结论是/i.test(text)) return 'decision'
  if (/(?:待办|下一步(?:是|要)|记得(?:要)?|稍后(?:要)?|需要继续|后续要)/i.test(text)) return 'task'
  if (/(?:我叫|我的.{0,16}(?:是|为)|项目叫|项目名称|当前(?:后端|服务)?端口|工作目录|目标是)/i.test(text)) return 'fact'
  return null
}

export function extractMemoryCandidates(text, metadata = {}) {
  const source = String(text || '').slice(0, 6000)
  const sentences = source.split(/(?<=[。！？!?；;\n])/).map(item => normalizeText(item)).filter(Boolean)
  const seen = new Set()
  return sentences.flatMap(sentence => {
    const type = classifySentence(sentence)
    if (!type) return []
    const key = fingerprint(type, sentence)
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      id: `mem_${key}`,
      type,
      content: sentence,
      status: type === 'inference' ? 'candidate' : 'active',
      confidence: type === 'inference' ? 0.55 : 1,
      confirmedByUser: type !== 'inference',
      scope: ['global', 'project', 'agent'].includes(metadata.scope) ? metadata.scope : 'global',
      scopeId: String(metadata.scopeId || ''),
      sensitivity: 'normal',
      sourceEpisodeIds: metadata.episodeId ? [String(metadata.episodeId)] : [],
      slotKey: detectMemorySlot(type, sentence),
      explicitCorrection: isExplicitCorrection(sentence),
      sourceSessionId: String(metadata.sessionId || ''),
      sourceMessageId: String(metadata.messageId || ''),
    }]
  }).slice(0, 8)
}

export class ConversationMemoryStore {
  constructor(filePath) {
    this.filePath = filePath
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      return { version: 2, items: Array.isArray(data.items) ? data.items.map(normalizeStoredItem) : [], updatedAt: data.updatedAt || '' }
    } catch (_) {
      return { version: 2, items: [], updatedAt: '' }
    }
  }

  save(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const next = { version: 2, items: data.items.slice(0, 5000), updatedAt: new Date().toISOString() }
    const tempPath = `${this.filePath}.tmp-${process.pid}`
    fs.writeFileSync(tempPath, JSON.stringify(next, null, 2))
    fs.renameSync(tempPath, this.filePath)
    return next
  }

  ingest(text, metadata = {}) {
    const candidates = extractMemoryCandidates(text, metadata)
    if (candidates.length === 0) return { added: [], updated: [], data: this.load() }
    const data = this.load()
    const added = []
    const updated = []
    for (const candidate of candidates) {
      const existing = data.items.find(item => item.id === candidate.id)
      if (existing) {
        existing.lastSeenAt = new Date().toISOString()
        existing.seenCount = Number(existing.seenCount || 1) + 1
        updated.push(existing)
      } else {
        const conflicting = candidate.slotKey
          ? data.items.filter(item => item.id !== candidate.id
            && item.status === 'active'
            && item.slotKey === candidate.slotKey
            && item.scope === candidate.scope
            && item.scopeId === candidate.scopeId)
          : []
        const item = {
          ...candidate,
          status: conflicting.length > 0 && !candidate.explicitCorrection ? 'candidate' : candidate.status,
          conflictWith: conflicting.map(entry => entry.id),
          supersedes: candidate.explicitCorrection ? conflicting.map(entry => entry.id) : [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          seenCount: 1,
        }
        delete item.explicitCorrection
        if (candidate.explicitCorrection) {
          for (const entry of conflicting) {
            entry.status = 'superseded'
            entry.supersededBy = item.id
            entry.updatedAt = new Date().toISOString()
          }
        }
        data.items.unshift(item)
        added.push(item)
      }
    }
    return { added, updated, data: this.save(data) }
  }

  query(query, { limit = 8, includeGlobalPreferences = true } = {}) {
    this.expireDue()
    const queryTokens = tokenize(query)
    const now = Date.now()
    return this.load().items
      .filter(item => item.status === 'active' && MEMORY_TYPES.has(item.type) && !SENSITIVE_PATTERN.test(item.content || ''))
      .map(item => {
        const itemTokens = tokenize(item.content)
        let overlap = 0
        for (const token of queryTokens) if (itemTokens.has(token)) overlap += token.length > 2 ? 2 : 1
        const preferenceBoost = includeGlobalPreferences && item.type === 'preference' ? 1.5 : 0
        const ageDays = Math.max(0, (now - new Date(item.lastSeenAt || item.updatedAt || item.createdAt || 0).getTime()) / 86400000)
        const recency = Math.max(0, 1 - ageDays / 180)
        return { ...item, relevance: overlap + preferenceBoost + recency * 0.5 }
      })
      .filter(item => item.relevance >= 1)
      .sort((a, b) => b.relevance - a.relevance || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, Math.min(Math.max(Number(limit) || 8, 1), 20))
  }

  list({ status = '', type = '', q = '', limit = 200 } = {}) {
    this.expireDue()
    const query = normalizeText(q).toLowerCase()
    return this.load().items
      .filter(item => !status || item.status === status)
      .filter(item => !type || item.type === type)
      .filter(item => !query || String(item.content || '').toLowerCase().includes(query))
      .slice(0, Math.min(Math.max(Number(limit) || 200, 1), 1000))
  }

  update(id, patch = {}) {
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return null
    if (patch.type && MEMORY_TYPES.has(patch.type)) item.type = patch.type
    if (patch.status && MEMORY_STATUSES.has(patch.status)) item.status = patch.status
    if (patch.scope && ['global', 'project', 'agent'].includes(patch.scope)) item.scope = patch.scope
    if (patch.scopeId !== undefined) item.scopeId = normalizeText(patch.scopeId, 120)
    if (patch.expiresAt !== undefined) {
      if (patch.expiresAt && Number.isNaN(new Date(patch.expiresAt).getTime())) throw new Error('expiresAt 不是有效时间')
      item.expiresAt = patch.expiresAt ? new Date(patch.expiresAt).toISOString() : ''
    }
    if (patch.content !== undefined) {
      const content = normalizeText(patch.content)
      if (!content || SENSITIVE_PATTERN.test(content)) throw new Error('记忆内容为空或包含敏感信息')
      item.content = content
      item.slotKey = detectMemorySlot(item.type, content) || item.slotKey
    }
    item.updatedAt = new Date().toISOString()
    this.save(data)
    return item
  }

  correct(id, content, metadata = {}) {
    const data = this.load()
    const previous = data.items.find(entry => entry.id === id)
    if (!previous) return null
    const normalized = normalizeText(content)
    if (!normalized || SENSITIVE_PATTERN.test(normalized)) throw new Error('纠正内容为空或包含敏感信息')
    const nextId = `mem_${fingerprint(previous.type, normalized)}`
    const existing = data.items.find(entry => entry.id === nextId)
    if (existing && existing.id !== previous.id) {
      existing.status = 'active'
      existing.supersedes = [...new Set([...(existing.supersedes || []), previous.id])]
      existing.updatedAt = new Date().toISOString()
      previous.status = 'superseded'
      previous.supersededBy = existing.id
      previous.updatedAt = new Date().toISOString()
      this.save(data)
      return existing
    }
    const now = new Date().toISOString()
    const item = normalizeStoredItem({
      ...previous,
      id: nextId,
      content: normalized,
      status: 'active',
      slotKey: detectMemorySlot(previous.type, normalized) || previous.slotKey,
      conflictWith: [],
      supersedes: [previous.id],
      correctedByUser: true,
      sourceSessionId: String(metadata.sessionId || 'manual-correction'),
      sourceMessageId: String(metadata.messageId || `correction-${Date.now()}`),
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      lastVerifiedAt: now,
      seenCount: 1,
    })
    previous.status = 'superseded'
    previous.supersededBy = item.id
    previous.updatedAt = now
    data.items.unshift(item)
    this.save(data)
    return item
  }

  resolveConflict(id, resolution) {
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return null
    if (!Array.isArray(item.conflictWith) || item.conflictWith.length === 0) throw new Error('该记忆没有待处理冲突')
    const now = new Date().toISOString()
    if (resolution === 'accept_new') {
      for (const conflictId of item.conflictWith) {
        const previous = data.items.find(entry => entry.id === conflictId)
        if (!previous) continue
        previous.status = 'superseded'
        previous.supersededBy = item.id
        previous.updatedAt = now
      }
      item.status = 'active'
      item.supersedes = [...new Set([...(item.supersedes || []), ...item.conflictWith])]
      item.conflictWith = []
      item.lastVerifiedAt = now
    } else if (resolution === 'keep_existing') {
      item.status = 'rejected'
      item.rejectedReason = '用户选择保留现有记忆'
      item.lastVerifiedAt = now
    } else {
      throw new Error('resolution 必须是 accept_new 或 keep_existing')
    }
    item.updatedAt = now
    this.save(data)
    return item
  }

  expireDue(now = new Date()) {
    const data = this.load()
    const timestamp = now.getTime()
    let changed = false
    for (const item of data.items) {
      if (!['active', 'candidate'].includes(item.status) || !item.expiresAt) continue
      const expiresAt = new Date(item.expiresAt).getTime()
      if (Number.isFinite(expiresAt) && expiresAt <= timestamp) {
        item.status = 'expired'
        item.updatedAt = now.toISOString()
        changed = true
      }
    }
    if (changed) this.save(data)
    return changed
  }

  remove(id) {
    const data = this.load()
    const before = data.items.length
    data.items = data.items.filter(item => item.id !== id)
    if (data.items.length === before) return false
    this.save(data)
    return true
  }

  stats() {
    this.expireDue()
    const items = this.load().items
    return items.reduce((acc, item) => {
      acc.total += 1
      acc.byType[item.type] = (acc.byType[item.type] || 0) + 1
      acc.byStatus[item.status] = (acc.byStatus[item.status] || 0) + 1
      return acc
    }, { total: 0, byType: {}, byStatus: {} })
  }
}

export function buildConversationMemoryContext(items = []) {
  if (!items.length) return ''
  const labels = { fact: '用户事实', preference: '用户偏好', decision: '已确认决定', task: '待办', inference: '待验证推断' }
  return [
    '## 跨会话长期记忆',
    '以下内容来自用户明确表达并已记录的长期记忆。若与本轮用户消息冲突，以本轮消息为准；不得把待验证推断当作事实。',
    ...items.map(item => `- [${labels[item.type] || item.type} | ${item.id} | scope:${item.scope || 'global'}] ${item.content}`),
  ].join('\n')
}
