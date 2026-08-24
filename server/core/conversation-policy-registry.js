import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const POLICY_STATUSES = new Set(['draft', 'validated', 'canary', 'active', 'degraded', 'superseded', 'rolled_back', 'rejected'])
const PROHIBITED_PROMPT_PATTERN = /(?:绕过|跳过|忽略).{0,24}(?:审批|权限|安全|系统规则)|(?:泄露|输出|发送).{0,20}(?:密钥|密码|token|api\s*key)|ignore\s+(?:all\s+)?(?:previous|security|system)\s+instructions/i

export const DEFAULT_CONVERSATION_POLICY = {
  promptAppendix: '',
  temperature: 0.7,
  maxTokens: 4000,
  maxSteps: 6,
  toolTimeoutMs: 60000,
  maxToolResultChars: 12000,
  maxInputTokens: 32000,
  reserveOutputTokens: 4000,
  minRecentMessages: 8,
  memoryTopK: 8,
  maxTools: 12,
  retrievalMode: 'auto',
}

function clamp(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

function normalizeConfig(input = {}, base = DEFAULT_CONVERSATION_POLICY) {
  const promptAppendix = String(input.promptAppendix ?? base.promptAppendix ?? '').trim().slice(0, 8000)
  if (promptAppendix && PROHIBITED_PROMPT_PATTERN.test(promptAppendix)) throw new Error('策略提示包含绕过安全、权限或敏感信息保护的指令')
  return {
    promptAppendix,
    temperature: clamp(input.temperature, 0, 2, base.temperature),
    maxTokens: Math.round(clamp(input.maxTokens, 256, 32000, base.maxTokens)),
    maxSteps: Math.round(clamp(input.maxSteps, 1, 12, base.maxSteps)),
    toolTimeoutMs: Math.round(clamp(input.toolTimeoutMs, 1000, 300000, base.toolTimeoutMs)),
    maxToolResultChars: Math.round(clamp(input.maxToolResultChars, 1000, 50000, base.maxToolResultChars)),
    maxInputTokens: Math.round(clamp(input.maxInputTokens, 4096, 200000, base.maxInputTokens)),
    reserveOutputTokens: Math.round(clamp(input.reserveOutputTokens, 256, 32000, base.reserveOutputTokens)),
    minRecentMessages: Math.round(clamp(input.minRecentMessages, 2, 40, base.minRecentMessages)),
    memoryTopK: Math.round(clamp(input.memoryTopK, 0, 20, base.memoryTopK)),
    maxTools: Math.round(clamp(input.maxTools, 0, 20, base.maxTools)),
    retrievalMode: ['auto', 'off'].includes(input.retrievalMode) ? input.retrievalMode : base.retrievalMode,
  }
}

function emptyTelemetry() {
  return {
    total: 0, successes: 0, errors: 0, totalLatencyMs: 0, averageLatencyMs: 0, errorRate: 0,
    feedbackTotal: 0, useful: 0, usefulRate: null,
    semanticTotal: 0, semanticScoreTotal: 0, averageSemanticScore: null,
    humanLabelTotal: 0, humanLabelScoreTotal: 0, averageHumanLabelScore: null,
    cohorts: {}, recent: [],
  }
}

function normalizeCohortName(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_\-:.\u4e00-\u9fff]/g, '_').slice(0, 80) || 'unknown'
}

function cohortKey(input = {}) {
  const task = normalizeCohortName(input.taskCategory)
  const model = normalizeCohortName(input.model)
  const client = normalizeCohortName(input.client || 'desktop')
  return `task=${task}|model=${model}|client=${client}`
}

function normalizeCohorts(input = {}) {
  return Object.fromEntries(Object.entries(input || {}).slice(0, 100).map(([key, value]) => [String(key).slice(0, 240), {
    key: String(value?.key || key).slice(0, 240),
    taskCategory: normalizeCohortName(value?.taskCategory),
    model: normalizeCohortName(value?.model),
    client: normalizeCohortName(value?.client || 'desktop'),
    total: Math.max(0, Number(value?.total || 0)),
    errors: Math.max(0, Number(value?.errors || 0)),
    errorRate: Math.max(0, Math.min(1, Number(value?.errorRate || 0))),
    totalLatencyMs: Math.max(0, Number(value?.totalLatencyMs || 0)),
    averageLatencyMs: Math.max(0, Number(value?.averageLatencyMs || 0)),
    semanticTotal: Math.max(0, Number(value?.semanticTotal || 0)),
    semanticScoreTotal: Math.max(0, Number(value?.semanticScoreTotal || 0)),
    averageSemanticScore: value?.averageSemanticScore === null || value?.averageSemanticScore === undefined ? null : clamp(value.averageSemanticScore, 0, 1, 0),
  }]))
}

function normalizeItem(item = {}) {
  return {
    ...item,
    id: String(item.id || ''),
    name: String(item.name || '未命名策略').slice(0, 120),
    description: String(item.description || '').slice(0, 500),
    version: Math.max(1, Number(item.version || 1)),
    status: POLICY_STATUSES.has(item.status) ? item.status : 'draft',
    config: normalizeConfig(item.config || {}),
    rollout: {
      percent: clamp(item.rollout?.percent, 0, 100, 0),
      minSamples: Math.round(clamp(item.rollout?.minSamples, 5, 10000, 20)),
      maxErrorRate: clamp(item.rollout?.maxErrorRate, 0, 1, 0.1),
      maxLatencyRegressionRatio: clamp(item.rollout?.maxLatencyRegressionRatio, 1, 10, 1.5),
      minUsefulRate: clamp(item.rollout?.minUsefulRate, 0, 1, 0.55),
      minFeedbackSamples: Math.round(clamp(item.rollout?.minFeedbackSamples, 0, 10000, 5)),
      minSemanticScore: clamp(item.rollout?.minSemanticScore, 0, 1, 0.72),
      minSemanticSamples: Math.round(clamp(item.rollout?.minSemanticSamples, 0, 10000, 5)),
      minCohortSamples: Math.round(clamp(item.rollout?.minCohortSamples, 2, 10000, 5)),
      maxCohortErrorRate: clamp(item.rollout?.maxCohortErrorRate, 0, 1, 0.2),
    },
    telemetry: {
      ...emptyTelemetry(), ...(item.telemetry || {}),
      cohorts: normalizeCohorts(item.telemetry?.cohorts),
      recent: Array.isArray(item.telemetry?.recent) ? item.telemetry.recent.slice(0, 100) : [],
    },
    approval: item.approval && typeof item.approval === 'object' ? item.approval : null,
    origin: item.origin && typeof item.origin === 'object' ? item.origin : { type: 'manual' },
  }
}

function defaultPolicy() {
  const now = new Date().toISOString()
  return normalizeItem({
    id: 'policy_default_v1',
    name: '默认对话策略',
    description: 'P3 基线策略，保持 P2 Conversation Runtime v2 行为。',
    version: 1,
    status: 'active',
    config: DEFAULT_CONVERSATION_POLICY,
    createdAt: now,
    activatedAt: now,
  })
}

function sessionBucket(sessionId, policyId) {
  const hash = crypto.createHash('sha256').update(`${sessionId}:${policyId}`).digest()
  return hash.readUInt32BE(0) % 10000 / 100
}

export class ConversationPolicyRegistry {
  constructor(filePath) {
    this.filePath = filePath
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      const items = Array.isArray(data.items) ? data.items.map(normalizeItem) : []
      return { version: 1, items: items.length ? items : [defaultPolicy()], updatedAt: data.updatedAt || '' }
    } catch (_) {
      return { version: 1, items: [defaultPolicy()], updatedAt: '' }
    }
  }

  save(data) {
    const next = { version: 1, items: data.items.map(normalizeItem).slice(0, 200), updatedAt: new Date().toISOString() }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp-${process.pid}`
    fs.writeFileSync(tempPath, JSON.stringify(next, null, 2))
    fs.renameSync(tempPath, this.filePath)
    return next
  }

  list() {
    return this.load().items.sort((a, b) => Number(b.version) - Number(a.version) || String(b.createdAt).localeCompare(String(a.createdAt)))
  }

  get(id) {
    return this.load().items.find(item => item.id === id) || null
  }

  create(input = {}) {
    const data = this.load()
    const base = data.items.find(item => item.id === input.parentId) || data.items.find(item => item.status === 'active') || data.items[0]
    const version = Math.max(0, ...data.items.map(item => Number(item.version || 0))) + 1
    const now = new Date().toISOString()
    const item = normalizeItem({
      id: `policy_v${version}_${crypto.randomBytes(4).toString('hex')}`,
      name: String(input.name || `对话策略 v${version}`).trim(),
      description: String(input.description || '').trim(),
      version,
      parentId: base?.id || '',
      status: 'draft',
      config: normalizeConfig(input.config || {}, base?.config || DEFAULT_CONVERSATION_POLICY),
      createdAt: now,
      updatedAt: now,
      origin: input.origin || { type: 'manual' },
    })
    data.items.unshift(item)
    this.save(data)
    return item
  }

  update(id, input = {}) {
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return null
    if (!['draft', 'rejected'].includes(item.status)) throw new Error('只有草稿或已拒绝策略可以修改')
    if (input.name !== undefined) item.name = String(input.name || '').trim().slice(0, 120) || item.name
    if (input.description !== undefined) item.description = String(input.description || '').trim().slice(0, 500)
    if (input.config) item.config = normalizeConfig(input.config, item.config)
    item.status = 'draft'
    item.evaluation = null
    item.updatedAt = new Date().toISOString()
    this.save(data)
    return item
  }

  attachEvaluation(id, report, gate) {
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return null
    if (!report) throw new Error('评测报告不存在')
    item.evaluation = {
      reportId: report.id,
      model: report.model,
      createdAt: report.createdAt,
      summary: report.summary,
      gatePassed: gate?.passed === true,
      gateFailures: Array.isArray(gate?.failures) ? gate.failures : [],
      boundAt: new Date().toISOString(),
    }
    item.approval = null
    item.status = gate?.passed === true ? 'validated' : 'draft'
    item.updatedAt = new Date().toISOString()
    this.save(data)
    return item
  }

  approve(id, input = {}) {
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return null
    if (item.status !== 'validated' || item.evaluation?.gatePassed !== true) throw new Error('只有通过评测 Gate 的策略可以人工批准')
    item.approval = {
      approved: input.approved !== false,
      reviewer: String(input.reviewer || 'local-human').slice(0, 120),
      comment: String(input.comment || '').slice(0, 1000),
      decidedAt: new Date().toISOString(),
    }
    if (!item.approval.approved) item.status = 'rejected'
    item.updatedAt = item.approval.decidedAt
    this.save(data)
    return item
  }

  startCanary(id, input = {}) {
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return null
    if (item.status !== 'validated' || item.evaluation?.gatePassed !== true) throw new Error('策略必须绑定通过 Gate 的评测报告后才能灰度')
    if (item.approval?.approved !== true) throw new Error('策略必须经过人工批准后才能灰度')
    for (const other of data.items) {
      if (other.id !== item.id && other.status === 'canary') {
        other.status = 'rolled_back'
        other.rollbackReason = '启动了新的灰度策略'
        other.rollout.percent = 0
      }
    }
    item.status = 'canary'
    item.rollout = {
      percent: clamp(input.percent, 1, 50, 10),
      minSamples: Math.round(clamp(input.minSamples, 5, 10000, 20)),
      maxErrorRate: clamp(input.maxErrorRate, 0, 1, 0.1),
      maxLatencyRegressionRatio: clamp(input.maxLatencyRegressionRatio, 1, 10, 1.5),
      minUsefulRate: clamp(input.minUsefulRate, 0, 1, 0.55),
      minFeedbackSamples: Math.round(clamp(input.minFeedbackSamples, 0, 10000, 5)),
      minSemanticScore: clamp(input.minSemanticScore, 0, 1, 0.72),
      minSemanticSamples: Math.round(clamp(input.minSemanticSamples, 0, 10000, 5)),
      minCohortSamples: Math.round(clamp(input.minCohortSamples, 2, 10000, 5)),
      maxCohortErrorRate: clamp(input.maxCohortErrorRate, 0, 1, 0.2),
    }
    item.telemetry = emptyTelemetry()
    item.canaryStartedAt = new Date().toISOString()
    item.updatedAt = item.canaryStartedAt
    this.save(data)
    return item
  }

  resolve(sessionId) {
    const items = this.load().items
    const active = items.find(item => item.status === 'active') || defaultPolicy()
    const canary = items.find(item => item.status === 'canary' && item.rollout.percent > 0)
    if (canary && sessionBucket(String(sessionId || 'anonymous'), canary.id) < canary.rollout.percent) {
      return { policy: canary, variant: 'canary', activePolicyId: active.id }
    }
    return { policy: active, variant: 'active', activePolicyId: active.id }
  }

  recordOutcome(id, input = {}) {
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return null
    const durationMs = Math.max(0, Number(input.durationMs || 0))
    item.telemetry.total += 1
    if (input.success === false) item.telemetry.errors += 1
    else item.telemetry.successes += 1
    item.telemetry.totalLatencyMs += durationMs
    item.telemetry.averageLatencyMs = item.telemetry.total ? Math.round(item.telemetry.totalLatencyMs / item.telemetry.total) : 0
    item.telemetry.errorRate = item.telemetry.total ? item.telemetry.errors / item.telemetry.total : 0
    if (['useful', 'useless'].includes(input.feedback)) {
      item.telemetry.feedbackTotal += 1
      if (input.feedback === 'useful') item.telemetry.useful += 1
      item.telemetry.usefulRate = item.telemetry.useful / item.telemetry.feedbackTotal
    }
    const cohortInput = input.cohort || {}
    const key = cohortKey(cohortInput)
    const cohort = item.telemetry.cohorts[key] || {
      key,
      taskCategory: normalizeCohortName(cohortInput.taskCategory),
      model: normalizeCohortName(cohortInput.model),
      client: normalizeCohortName(cohortInput.client || 'desktop'),
      total: 0, errors: 0, errorRate: 0, totalLatencyMs: 0, averageLatencyMs: 0,
      semanticTotal: 0, semanticScoreTotal: 0, averageSemanticScore: null,
    }
    cohort.total += 1
    if (input.success === false) cohort.errors += 1
    cohort.errorRate = cohort.errors / cohort.total
    cohort.totalLatencyMs += durationMs
    cohort.averageLatencyMs = Math.round(cohort.totalLatencyMs / cohort.total)
    item.telemetry.cohorts[key] = cohort
    item.telemetry.recent.unshift({
      success: input.success !== false,
      durationMs,
      feedback: input.feedback || '',
      sessionIdHash: crypto.createHash('sha256').update(String(input.sessionId || '')).digest('hex').slice(0, 12),
      cohortKey: key,
      createdAt: new Date().toISOString(),
    })
    item.telemetry.recent = item.telemetry.recent.slice(0, 100)

    const automaticRollback = this.applyAutomaticRollback(data, item)
    item.updatedAt = new Date().toISOString()
    this.save(data)
    return { item, automaticRollback }
  }

  applyAutomaticRollback(data, item) {
    if (item.status !== 'canary' || item.telemetry.total < item.rollout.minSamples) return false
    const active = data.items.find(entry => entry.status === 'active')
    const latencyRegression = active?.telemetry?.averageLatencyMs > 0
      ? item.telemetry.averageLatencyMs / active.telemetry.averageLatencyMs
      : 1
    const reasons = []
    if (item.telemetry.errorRate > item.rollout.maxErrorRate) reasons.push(`错误率 ${(item.telemetry.errorRate * 100).toFixed(1)}% 超过阈值`)
    if (latencyRegression > item.rollout.maxLatencyRegressionRatio) reasons.push(`延迟回归 ${latencyRegression.toFixed(2)}x 超过阈值`)
    if (item.telemetry.feedbackTotal >= item.rollout.minFeedbackSamples && Number(item.telemetry.usefulRate || 0) < item.rollout.minUsefulRate) reasons.push(`有用率 ${(Number(item.telemetry.usefulRate || 0) * 100).toFixed(1)}% 低于阈值`)
    if (item.rollout.minSemanticSamples > 0 && item.telemetry.semanticTotal >= item.rollout.minSemanticSamples && Number(item.telemetry.averageSemanticScore || 0) < item.rollout.minSemanticScore) reasons.push(`语义质量 ${(Number(item.telemetry.averageSemanticScore || 0) * 100).toFixed(1)}% 低于阈值`)
    for (const cohort of Object.values(item.telemetry.cohorts || {})) {
      if (cohort.total >= item.rollout.minCohortSamples && cohort.errorRate > item.rollout.maxCohortErrorRate) {
        reasons.push(`cohort ${cohort.key} 错误率 ${(cohort.errorRate * 100).toFixed(1)}% 超过阈值`)
      }
      if (item.rollout.minSemanticSamples > 0 && cohort.semanticTotal >= item.rollout.minSemanticSamples && Number(cohort.averageSemanticScore || 0) < item.rollout.minSemanticScore) {
        reasons.push(`cohort ${cohort.key} 语义质量 ${(Number(cohort.averageSemanticScore || 0) * 100).toFixed(1)}% 低于阈值`)
      }
    }
    if (!reasons.length) return false
    item.status = 'rolled_back'
    item.rollout.percent = 0
    item.rollbackReason = reasons.slice(0, 6).join('；')
    item.rolledBackAt = new Date().toISOString()
    return true
  }

  recordSemanticAssessment(id, input = {}) {
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return null
    const score = clamp(input.score, 0, 1, null)
    if (score === null) throw new Error('语义评分必须是 0 到 1')
    item.telemetry.semanticTotal += 1
    item.telemetry.semanticScoreTotal += score
    item.telemetry.averageSemanticScore = item.telemetry.semanticScoreTotal / item.telemetry.semanticTotal
    if (input.source === 'human') {
      item.telemetry.humanLabelTotal += 1
      item.telemetry.humanLabelScoreTotal += score
      item.telemetry.averageHumanLabelScore = item.telemetry.humanLabelScoreTotal / item.telemetry.humanLabelTotal
    }
    const key = cohortKey(input.cohort || {})
    const cohort = item.telemetry.cohorts[key]
    if (cohort) {
      cohort.semanticTotal += 1
      cohort.semanticScoreTotal += score
      cohort.averageSemanticScore = cohort.semanticScoreTotal / cohort.semanticTotal
    }
    const automaticRollback = this.applyAutomaticRollback(data, item)
    item.updatedAt = new Date().toISOString()
    this.save(data)
    return { item, automaticRollback }
  }

  recordFeedback(id, feedback) {
    const value = feedback === 'useful' || feedback === 'like' || feedback === 'accepted' ? 'useful'
      : feedback === 'useless' || feedback === 'dislike' || feedback === 'rejected' ? 'useless' : ''
    if (!value) return null
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return null
    item.telemetry.feedbackTotal += 1
    if (value === 'useful') item.telemetry.useful += 1
    item.telemetry.usefulRate = item.telemetry.useful / item.telemetry.feedbackTotal
    this.applyAutomaticRollback(data, item)
    item.updatedAt = new Date().toISOString()
    this.save(data)
    return item
  }

  activate(id) {
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return null
    if (item.status !== 'canary') throw new Error('只有灰度中的策略可以激活')
    if (item.approval?.approved !== true) throw new Error('策略尚未获得人工批准')
    if (item.telemetry.total < item.rollout.minSamples) throw new Error(`灰度样本不足，需要至少 ${item.rollout.minSamples} 次`)
    if (item.telemetry.errorRate > item.rollout.maxErrorRate) throw new Error('灰度错误率超过阈值，不能激活')
    if (item.rollout.minSemanticSamples > 0 && item.telemetry.semanticTotal < item.rollout.minSemanticSamples) throw new Error(`语义评审样本不足，需要至少 ${item.rollout.minSemanticSamples} 次`)
    if (item.telemetry.semanticTotal > 0 && Number(item.telemetry.averageSemanticScore || 0) < item.rollout.minSemanticScore) throw new Error('灰度语义质量低于阈值，不能激活')
    const active = data.items.find(entry => entry.status === 'active')
    if (active) {
      active.status = 'superseded'
      active.updatedAt = new Date().toISOString()
      item.previousActiveId = active.id
    }
    item.status = 'active'
    item.rollout.percent = 100
    item.activatedAt = new Date().toISOString()
    item.updatedAt = item.activatedAt
    this.save(data)
    return item
  }

  rollback(id, reason = '手动回滚') {
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return null
    if (!['active', 'canary', 'degraded'].includes(item.status)) throw new Error('当前策略状态不能回滚')
    const fallback = item.status === 'active'
      ? data.items.find(entry => entry.id === item.previousActiveId) || data.items.find(entry => entry.status === 'superseded')
      : data.items.find(entry => entry.status === 'active')
    item.status = 'rolled_back'
    item.rollout.percent = 0
    item.rollbackReason = String(reason || '手动回滚').slice(0, 300)
    item.rolledBackAt = new Date().toISOString()
    item.updatedAt = item.rolledBackAt
    if (fallback && fallback.id !== item.id) {
      fallback.status = 'active'
      fallback.rollout.percent = 100
      fallback.activatedAt = new Date().toISOString()
      fallback.updatedAt = fallback.activatedAt
    }
    this.save(data)
    return { item, fallback: fallback || null }
  }

  remove(id) {
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return false
    if (!['draft', 'rejected', 'rolled_back'].includes(item.status)) throw new Error('只有草稿、已拒绝或已回滚策略可以删除')
    data.items = data.items.filter(entry => entry.id !== id)
    this.save(data)
    return true
  }

  summary() {
    const items = this.list()
    return {
      total: items.length,
      active: items.find(item => item.status === 'active') || null,
      canary: items.find(item => item.status === 'canary') || null,
      byStatus: items.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {}),
      items: items.map(item => ({ ...item, diff: this.diff(item.id, item.parentId) })),
    }
  }

  diff(id, againstId = '') {
    const items = this.load().items
    const item = items.find(entry => entry.id === id)
    if (!item) return []
    const base = items.find(entry => entry.id === againstId) || items.find(entry => entry.id === item.parentId) || items.find(entry => entry.status === 'active' && entry.id !== item.id)
    if (!base) return []
    const keys = [...new Set([...Object.keys(base.config || {}), ...Object.keys(item.config || {})])]
    return keys.filter(key => JSON.stringify(base.config?.[key]) !== JSON.stringify(item.config?.[key])).map(key => ({
      key,
      before: base.config?.[key] ?? null,
      after: item.config?.[key] ?? null,
      basePolicyId: base.id,
    }))
  }
}

export function resolvePolicyBucket(sessionId, policyId) {
  return sessionBucket(sessionId, policyId)
}
