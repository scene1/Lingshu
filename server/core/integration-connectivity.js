const DEFAULT_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 1024 * 1024

function normalizeHttpUrl(value, { allowEmpty = false } = {}) {
  const raw = String(value || '').trim()
  if (!raw && allowEmpty) return ''
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('地址格式无效')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只允许 HTTP 或 HTTPS 地址')
  if (parsed.username || parsed.password) throw new Error('地址中不能包含账号或密码')
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

function joinHttpUrl(baseUrl, pathname = '') {
  const base = normalizeHttpUrl(baseUrl)
  const parsed = new URL(base.endsWith('/') ? base : `${base}/`)
  const cleanPath = String(pathname || '').trim()
  if (!cleanPath) return parsed.toString()
  return new URL(cleanPath.replace(/^\/+/, ''), parsed).toString()
}

function assertIntegrationApiUrlAllowed(baseUrl, apiUrl, provider = '') {
  const base = new URL(normalizeHttpUrl(baseUrl))
  const api = new URL(normalizeHttpUrl(apiUrl))
  const trustedPairs = new Set([
    'github.com|api.github.com',
    'bitbucket.org|api.bitbucket.org',
  ])
  if (base.hostname !== api.hostname && !trustedPairs.has(`${base.hostname}|${api.hostname}`)) {
    throw new Error(`${provider || '集成'} API 地址必须与服务地址属于同一主机`)
  }
  return api.toString().replace(/\/$/, '')
}

async function fetchWithLimits(url, options = {}, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('当前运行时不支持网络请求')
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs || DEFAULT_TIMEOUT_MS), 1000), 30000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('连接超时')), timeoutMs)
  const startedAt = Date.now()
  try {
    const response = await fetchImpl(normalizeHttpUrl(url), {
      ...options,
      timeoutMs: undefined,
      signal: controller.signal,
      redirect: 'error',
    })
    const length = Number(response.headers?.get?.('content-length') || 0)
    if (length > MAX_RESPONSE_BYTES) throw new Error('远程响应过大')
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('远程响应过大')
    let data = null
    if (text) {
      try { data = JSON.parse(text) } catch { data = { text: text.slice(0, 1000) } }
    }
    return { ok: response.ok, status: response.status, data, durationMs: Date.now() - startedAt }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('连接超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function channelChecks(channel) {
  const checks = []
  const required = (key, label) => checks.push({ key, label, ok: !!String(channel[key] || '').trim() })
  if (channel.id === 'weixin' || channel.id === 'wecom') {
    required('corpId', channel.id === 'weixin' ? 'App ID' : '企业 ID')
    required('secret', '应用密钥')
  } else {
    if (channel.id !== 'telegram') required('appId', 'App ID')
    required('appSecret', channel.id === 'telegram' ? 'Bot Token' : 'App Secret')
  }
  if (channel.webhook) {
    try {
      normalizeHttpUrl(channel.webhook)
      checks.push({ key: 'webhook', label: 'Webhook 地址', ok: true })
    } catch {
      checks.push({ key: 'webhook', label: 'Webhook 地址', ok: false })
    }
  }
  return checks
}

async function testChannelConnection(channel, fetchImpl = globalThis.fetch) {
  const checks = channelChecks(channel)
  if (checks.some(item => !item.ok)) return { success: false, checks, message: '渠道凭证不完整' }

  let request
  if (channel.id === 'feishu') {
    request = {
      url: 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: channel.appId, app_secret: channel.appSecret }) },
      isSuccess: result => result.ok && result.data?.code === 0 && !!result.data?.tenant_access_token,
    }
  } else if (channel.id === 'telegram') {
    request = {
      url: `https://api.telegram.org/bot${encodeURIComponent(channel.appSecret)}/getMe`,
      options: { method: 'GET' },
      isSuccess: result => result.ok && result.data?.ok === true,
    }
  } else if (channel.id === 'weixin') {
    request = {
      url: `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(channel.corpId)}&secret=${encodeURIComponent(channel.secret)}`,
      options: { method: 'GET' },
      isSuccess: result => result.ok && !!result.data?.access_token,
    }
  } else if (channel.id === 'wecom') {
    request = {
      url: `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(channel.corpId)}&corpsecret=${encodeURIComponent(channel.secret)}`,
      options: { method: 'GET' },
      isSuccess: result => result.ok && result.data?.errcode === 0 && !!result.data?.access_token,
    }
  } else if (channel.id === 'dingtalk') {
    request = {
      url: 'https://api.dingtalk.com/v1.0/oauth2/accessToken',
      options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appKey: channel.appId, appSecret: channel.appSecret }) },
      isSuccess: result => result.ok && !!result.data?.accessToken,
    }
  } else if (channel.id === 'qqbot') {
    request = {
      url: 'https://bots.qq.com/app/getAppAccessToken',
      options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: channel.appId, clientSecret: channel.appSecret }) },
      isSuccess: result => result.ok && !!result.data?.access_token,
    }
  } else if (channel.webhook) {
    request = { url: channel.webhook, options: { method: 'GET' }, isSuccess: result => result.status < 500 }
  } else {
    return { success: false, checks, message: '当前渠道需要配置 Webhook 才能验证' }
  }

  let result
  try {
    result = await fetchWithLimits(request.url, request.options, fetchImpl)
  } catch {
    throw new Error('平台鉴权请求失败或超时')
  }
  const success = request.isSuccess(result)
  checks.push({ key: 'authentication', label: '平台鉴权', ok: success, durationMs: result.durationMs, status: result.status })
  return { success, checks, durationMs: result.durationMs, message: success ? '平台鉴权通过' : '平台拒绝了当前凭证' }
}

function buildRemoteInstanceUrl(instance) {
  if (instance.baseUrl) return normalizeHttpUrl(instance.baseUrl)
  const host = String(instance.host || '').trim()
  if (!host) throw new Error('远程实例地址不能为空')
  if (/^https?:\/\//i.test(host)) return normalizeHttpUrl(instance.port ? `${host.replace(/\/$/, '')}:${Number(instance.port)}` : host)
  const protocol = instance.tls === false ? 'http' : 'https'
  const port = Number(instance.port || 0)
  return normalizeHttpUrl(`${protocol}://${host}${port ? `:${port}` : ''}`)
}

async function testRemoteInstanceConnection(instance, fetchImpl = globalThis.fetch) {
  const baseUrl = buildRemoteInstanceUrl(instance)
  const healthPath = String(instance.healthPath || '/api/health').trim() || '/api/health'
  const headers = { Accept: 'application/json' }
  if (instance.apiToken) headers.Authorization = `Bearer ${instance.apiToken}`
  const result = await fetchWithLimits(joinHttpUrl(baseUrl, healthPath), {
    method: 'GET',
    headers,
    timeoutMs: instance.timeoutMs,
  }, fetchImpl)
  return {
    success: result.ok,
    status: result.ok ? 'connected' : 'error',
    httpStatus: result.status,
    durationMs: result.durationMs,
    runtime: result.data && typeof result.data === 'object' ? {
      status: result.data.status || result.data.state || '',
      version: result.data.version || '',
      name: result.data.name || '',
    } : {},
  }
}

export {
  assertIntegrationApiUrlAllowed,
  buildRemoteInstanceUrl,
  channelChecks,
  fetchWithLimits,
  joinHttpUrl,
  normalizeHttpUrl,
  testChannelConnection,
  testRemoteInstanceConnection,
}
