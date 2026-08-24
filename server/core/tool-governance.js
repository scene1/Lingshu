import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_TOOL_GOVERNANCE = {
  rateLimits: {
    default: { limit: 12, windowMs: 60000 },
    knowledge: { limit: 20, windowMs: 60000 },
    openkb: { limit: 6, windowMs: 60000 },
    openapi: { limit: 10, windowMs: 60000 },
    skill: { limit: 8, windowMs: 60000 },
    highRisk: { limit: 3, windowMs: 60000 },
  },
  approvalPolicies: {
    readOnly: 'allow',
    network: 'always_ask',
    write: 'always_ask',
    highRisk: 'always_ask',
    default: 'always_ask',
  },
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback
}

export function normalizeToolGovernance(input = {}) {
  const sourceLimits = input.rateLimits || {}
  const rateLimits = Object.fromEntries(Object.entries(DEFAULT_TOOL_GOVERNANCE.rateLimits).map(([key, fallback]) => [
    key,
    {
      limit: boundedNumber(sourceLimits[key]?.limit, fallback.limit, 1, 1000),
      windowMs: boundedNumber(sourceLimits[key]?.windowMs, fallback.windowMs, 1000, 3600000),
    },
  ]))
  const sourcePolicies = input.approvalPolicies || {}
  const allowed = new Set(['allow', 'always_ask', 'deny'])
  const approvalPolicies = Object.fromEntries(Object.entries(DEFAULT_TOOL_GOVERNANCE.approvalPolicies).map(([key, fallback]) => {
    let value = allowed.has(sourcePolicies[key]) ? sourcePolicies[key] : fallback
    if (key === 'highRisk' && value === 'allow') value = 'always_ask'
    return [key, value]
  }))
  return { rateLimits, approvalPolicies }
}

export class ToolGovernanceStore {
  constructor(filePath) {
    this.filePath = filePath
  }

  load() {
    try { return normalizeToolGovernance(JSON.parse(fs.readFileSync(this.filePath, 'utf8'))) }
    catch (_) { return normalizeToolGovernance() }
  }

  save(input) {
    const data = normalizeToolGovernance(input)
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2))
    return data
  }
}

export class ToolRateLimiter {
  constructor() {
    this.buckets = new Map()
  }

  check(key, policy, now = Date.now()) {
    const limit = boundedNumber(policy?.limit, 12, 1, 1000)
    const windowMs = boundedNumber(policy?.windowMs, 60000, 1000, 3600000)
    const cleanKey = String(key || 'default')
    const recent = (this.buckets.get(cleanKey) || []).filter(timestamp => now - timestamp < windowMs)
    if (recent.length >= limit) {
      const retryAfterMs = Math.max(1, windowMs - (now - recent[0]))
      this.buckets.set(cleanKey, recent)
      return { allowed: false, limit, remaining: 0, retryAfterMs }
    }
    recent.push(now)
    this.buckets.set(cleanKey, recent)
    return { allowed: true, limit, remaining: Math.max(0, limit - recent.length), retryAfterMs: 0 }
  }

  reset() {
    this.buckets.clear()
  }
}

export function classifyToolGovernanceGroup({ name = '', permissions = [], highRisk = false } = {}) {
  if (highRisk) return 'highRisk'
  const joined = `${name} ${permissions.map(permission => typeof permission === 'string' ? permission : permission?.key || permission?.name || '').join(' ')}`.toLowerCase()
  if (/write|delete|create|update|edit|保存|写入|删除/.test(joined)) return 'write'
  if (/network|http|fetch|openapi|web|网络/.test(joined)) return 'network'
  if (/knowledge|openkb|search|query|read|list|get|检索|查询|读取/.test(joined)) return 'readOnly'
  return 'default'
}

export function resolveToolPolicy(governance, input = {}) {
  const normalized = normalizeToolGovernance(governance)
  const group = classifyToolGovernanceGroup(input)
  const approvalPolicy = normalized.approvalPolicies[group] || normalized.approvalPolicies.default
  const rateKey = input.highRisk
    ? 'highRisk'
    : /^openkb/i.test(input.name || '')
      ? 'openkb'
      : /^knowledge/i.test(input.name || '')
        ? 'knowledge'
        : /^openapi/i.test(input.name || '')
          ? 'openapi'
          : /^skill/i.test(input.name || '')
            ? 'skill'
            : 'default'
  return {
    group,
    rateKey,
    rateLimit: normalized.rateLimits[rateKey] || normalized.rateLimits.default,
    denied: approvalPolicy === 'deny',
    requiresApproval: input.highRisk || approvalPolicy === 'always_ask',
    approvalPolicy,
  }
}
