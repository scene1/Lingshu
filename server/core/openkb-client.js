import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_BASE_URL = 'http://127.0.0.1:7566'
const QUERY_CACHE_TTL_MS = 10 * 60 * 1000
const QUERY_CACHE_MAX = 100
const queryCache = new Map()
let configFilePath = ''
const observability = {
  statusChecks: 0,
  queries: 0,
  successes: 0,
  errors: 0,
  cacheHits: 0,
  degradedResponses: 0,
  totalLatencyMs: 0,
  lastLatencyMs: 0,
  lastQueryAt: '',
  lastSuccessAt: '',
  lastErrorAt: '',
  lastError: '',
}

function readStoredConfig() {
  if (!configFilePath) return {}
  try {
    const data = JSON.parse(fs.readFileSync(configFilePath, 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch (_) {
    return {}
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || DEFAULT_BASE_URL))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('OpenKB URL 仅支持 http 或 https')
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) throw new Error('OpenKB Sidecar 只允许使用本机回环地址')
  return url.toString().replace(/\/+$/, '')
}

function configFromEnv() {
  const stored = readStoredConfig()
  return {
    enabled: process.env.LINGSHU_OPENKB_ENABLED !== undefined ? process.env.LINGSHU_OPENKB_ENABLED === '1' : stored.enabled === true,
    baseUrl: normalizeBaseUrl(process.env.LINGSHU_OPENKB_URL || stored.baseUrl || DEFAULT_BASE_URL),
    token: String(process.env.LINGSHU_OPENKB_TOKEN || stored.token || ''),
    kb: String(process.env.LINGSHU_OPENKB_KB || stored.kb || 'lingshu').slice(0, 120),
  }
}

function headers(config, json = false) {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
  }
}

async function fetchJson(url, options = {}, timeoutMs = 120000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data?.detail || data?.message || `OpenKB HTTP ${response.status}`)
  }
  return data
}

export function getOpenKBConfig() {
  const config = configFromEnv()
  return { ...config, token: undefined, authConfigured: Boolean(config.token) }
}

export function configureOpenKBStorage(filePath) {
  configFilePath = String(filePath || '')
}

export function saveOpenKBConfig(input = {}) {
  if (!configFilePath) throw new Error('OpenKB 配置存储尚未初始化')
  const previous = readStoredConfig()
  const next = {
    enabled: input.enabled === true,
    baseUrl: normalizeBaseUrl(input.baseUrl || previous.baseUrl || DEFAULT_BASE_URL),
    kb: String(input.kb || previous.kb || 'lingshu').trim().slice(0, 120),
    token: input.token === undefined || input.token === '********' ? String(previous.token || '') : String(input.token || '').slice(0, 1000),
    updatedAt: new Date().toISOString(),
  }
  if (!next.kb) throw new Error('OpenKB 知识库名称不能为空')
  fs.mkdirSync(path.dirname(configFilePath), { recursive: true })
  const tempPath = `${configFilePath}.tmp-${process.pid}`
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), { mode: 0o600 })
  fs.renameSync(tempPath, configFilePath)
  queryCache.clear()
  return getOpenKBConfig()
}

export async function getOpenKBStatus(overrides = {}) {
  const config = { ...configFromEnv(), ...overrides }
  observability.statusChecks += 1
  if (!config.enabled) return { enabled: false, connected: false, ...config, token: undefined }
  try {
    const [meta, kbs] = await Promise.all([
      fetchJson(`${config.baseUrl}/api/v1/meta`, { headers: headers(config) }, 5000),
      fetchJson(`${config.baseUrl}/api/v1/kbs`, { headers: headers(config) }, 5000),
    ])
    const kbNames = (Array.isArray(kbs) ? kbs : Array.isArray(kbs?.items) ? kbs.items : [])
      .map(item => typeof item === 'string' ? item : item?.name || item?.id).filter(Boolean)
    return {
      enabled: true,
      connected: true,
      baseUrl: config.baseUrl,
      kb: config.kb,
      version: meta.version,
      kbs,
      diagnostics: {
        localAddress: true,
        metaReachable: true,
        knowledgeBaseFound: kbNames.length === 0 ? null : kbNames.includes(config.kb),
      },
    }
  } catch (error) {
    return {
      enabled: true,
      connected: false,
      baseUrl: config.baseUrl,
      kb: config.kb,
      error: error.message,
      diagnostics: { localAddress: true, metaReachable: false, knowledgeBaseFound: false },
    }
  }
}

export async function diagnoseOpenKB(input = {}) {
  const startedAt = Date.now()
  const current = configFromEnv()
  const status = await getOpenKBStatus({
    ...current,
    ...input,
    enabled: true,
    baseUrl: normalizeBaseUrl(input.baseUrl || current.baseUrl),
    kb: String(input.kb || current.kb || 'lingshu'),
    token: input.token === undefined || input.token === '********' ? current.token : String(input.token || ''),
  })
  return { ...status, latencyMs: Date.now() - startedAt, checkedAt: new Date().toISOString() }
}

export async function queryOpenKB(question, overrides = {}) {
  const config = { ...configFromEnv(), ...overrides }
  if (!config.enabled) throw new Error('OpenKB 未启用')
  const normalizedQuestion = String(question || '').replace(/\s+/g, ' ').trim()
  if (!normalizedQuestion) throw new Error('OpenKB 查询内容为空')
  const cacheKey = `${config.baseUrl}|${config.kb}|${normalizedQuestion.toLowerCase()}`
  const cached = queryCache.get(cacheKey)
  const now = Date.now()
  observability.queries += 1
  observability.lastQueryAt = new Date().toISOString()
  if (cached && now - cached.timestamp <= QUERY_CACHE_TTL_MS && overrides.cacheBypass !== true) {
    observability.cacheHits += 1
    return { ...cached.value, cacheHit: true, degraded: false }
  }
  const startedAt = Date.now()
  try {
    const data = await fetchJson(`${config.baseUrl}/api/v1/query`, {
      method: 'POST',
      headers: headers(config, true),
      body: JSON.stringify({ kb: config.kb, question: normalizedQuestion, stream: false, save: false }),
    })
    const latencyMs = Date.now() - startedAt
    const sources = (Array.isArray(data.sources) ? data.sources : Array.isArray(data.citations) ? data.citations : Array.isArray(data.references) ? data.references : [])
      .slice(0, 12)
      .map((source, index) => typeof source === 'string'
        ? { title: source, snippet: '', index }
        : {
            title: String(source.title || source.name || source.document || source.path || `来源 ${index + 1}`),
            path: String(source.path || source.url || ''),
            snippet: String(source.snippet || source.content || source.text || '').slice(0, 500),
            score: typeof source.score === 'number' ? source.score : undefined,
          })
    const value = {
      answer: String(data.answer || ''),
      savedPath: data.saved_path || null,
      kb: config.kb,
      sources,
      cacheHit: false,
      degraded: false,
      latencyMs,
    }
    queryCache.set(cacheKey, { timestamp: now, value })
    while (queryCache.size > QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value)
    observability.successes += 1
    observability.totalLatencyMs += latencyMs
    observability.lastLatencyMs = latencyMs
    observability.lastSuccessAt = new Date().toISOString()
    observability.lastError = ''
    return value
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    observability.errors += 1
    observability.totalLatencyMs += latencyMs
    observability.lastLatencyMs = latencyMs
    observability.lastErrorAt = new Date().toISOString()
    observability.lastError = String(error.message || error).slice(0, 240)
    if (cached) {
      observability.degradedResponses += 1
      return { ...cached.value, cacheHit: true, degraded: true, degradationReason: 'OpenKB 暂时不可用，返回过期缓存' }
    }
    throw error
  }
}

export function getOpenKBObservability() {
  const averageLatencyMs = observability.successes + observability.errors > 0
    ? Math.round(observability.totalLatencyMs / (observability.successes + observability.errors))
    : 0
  return {
    ...observability,
    averageLatencyMs,
    successRate: observability.queries > 0 ? Math.round((observability.successes / observability.queries) * 100) : null,
    cacheSize: queryCache.size,
    cacheTtlMs: QUERY_CACHE_TTL_MS,
  }
}

export function resetOpenKBObservability() {
  queryCache.clear()
  for (const key of Object.keys(observability)) {
    observability[key] = typeof observability[key] === 'number' ? 0 : ''
  }
}

export async function addOpenKBDocument({ fileName, bytes, mimeType = 'application/octet-stream' }, overrides = {}) {
  const config = { ...configFromEnv(), ...overrides }
  if (!config.enabled) throw new Error('OpenKB 未启用')
  const form = new FormData()
  form.set('kb', config.kb)
  form.set('stream', 'false')
  form.append('files', new Blob([bytes], { type: mimeType }), fileName)
  return fetchJson(`${config.baseUrl}/api/v1/add`, {
    method: 'POST',
    headers: headers(config),
    body: form,
  }, 10 * 60 * 1000)
}
