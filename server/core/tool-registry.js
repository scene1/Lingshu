// ============================================================
// 灵枢 v3.0 — 后端工具注册表（三层工具统一管理）
// MCP 工具 / 内置工具 / 插件工具
// ============================================================

import fs from 'fs'
import path from 'path'
import os from 'os'
import { redactSensitiveText, redactSensitiveValue } from './security.js'

const CONFIG_PATH = path.join(os.homedir(), 'Lingshu', 'openclaw.json')

const DEFAULT_TOOL_PERMISSIONS = {
  network: false,
  filesystem: false,
  shell: false,
  desktop: false,
}

const NATIVE_TOOL_METADATA = {
  'native:app_open': {
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: '要打开的本地应用名称' },
        path: { type: 'string', description: '可选应用路径' },
      },
      required: ['appName'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        appPath: { type: 'string' },
        message: { type: 'string' },
      },
    },
    permissions: { ...DEFAULT_TOOL_PERMISSIONS, desktop: true },
    runtime: { kind: 'native', executable: 'open' },
  },
  'native:web_search': {
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: { type: 'array' },
      },
    },
    permissions: { ...DEFAULT_TOOL_PERMISSIONS, network: true },
    runtime: { kind: 'native', executable: 'web-search' },
  },
  'native:file_upload': {
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: '本地文件路径或上传表单文件' },
      },
      required: ['file'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        fileId: { type: 'string' },
        path: { type: 'string' },
      },
    },
    permissions: { ...DEFAULT_TOOL_PERMISSIONS, filesystem: true },
    runtime: { kind: 'native', executable: 'upload' },
  },
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'])
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MAX_OPENAPI_RESPONSE_BYTES = 1024 * 1024

function slugify(value, fallback = 'item') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function parseOpenAPISpec(specInput) {
  if (!specInput) {
    throw new Error('缺少 OpenAPI spec')
  }
  if (typeof specInput === 'object') {
    return specInput
  }
  const text = String(specInput).trim()
  if (!text) {
    throw new Error('OpenAPI spec 不能为空')
  }
  try {
    return JSON.parse(text)
  } catch (_) {
    throw new Error('当前导入入口仅支持 JSON 格式的 OpenAPI/Swagger 文档')
  }
}

function getOpenAPIServerUrl(spec, override) {
  if (override) return String(override).trim()
  const firstServer = Array.isArray(spec.servers) ? spec.servers[0]?.url : ''
  if (firstServer) return firstServer
  if (spec.host) {
    const scheme = Array.isArray(spec.schemes) ? spec.schemes[0] : 'https'
    return `${scheme}://${spec.host}${spec.basePath || ''}`
  }
  return ''
}

function getOpenAPIAuth(spec) {
  const schemes = spec.components?.securitySchemes || spec.securityDefinitions || {}
  const firstScheme = Object.values(schemes)[0]
  if (!firstScheme) return { type: 'none' }
  if (firstScheme.type === 'http' && firstScheme.scheme === 'bearer') return { type: 'bearer' }
  if (firstScheme.type === 'apiKey') return { type: 'apiKey', in: firstScheme.in, name: firstScheme.name }
  if (firstScheme.type === 'oauth2') return { type: 'oauth2' }
  return { type: firstScheme.type || 'configured' }
}

function schemaFromParameter(param) {
  if (param.schema) return param.schema
  if (param.type) return { type: param.type, enum: param.enum }
  return { type: 'string' }
}

function buildOpenAPIInputSchema(operation, pathItem = {}) {
  const grouped = {
    path: { type: 'object', properties: {}, required: [] },
    query: { type: 'object', properties: {}, required: [] },
    header: { type: 'object', properties: {}, required: [] },
  }
  const params = [
    ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ]

  for (const param of params) {
    const location = param.in
    if (!grouped[location] || !param.name) continue
    grouped[location].properties[param.name] = {
      ...schemaFromParameter(param),
      description: param.description,
    }
    if (param.required) grouped[location].required.push(param.name)
  }

  const properties = {}
  for (const [location, schema] of Object.entries(grouped)) {
    if (Object.keys(schema.properties).length > 0) {
      if (schema.required.length === 0) delete schema.required
      properties[location] = schema
    }
  }

  const jsonBody = operation.requestBody?.content?.['application/json']?.schema
  if (jsonBody) {
    properties.body = jsonBody
  }

  return {
    type: 'object',
    properties,
    additionalProperties: true,
  }
}

function getOpenAPIResponseSchema(operation) {
  const responses = operation.responses || {}
  const preferred = responses['200'] || responses['201'] || responses.default || Object.values(responses)[0]
  return preferred?.content?.['application/json']?.schema || {
    type: 'object',
    additionalProperties: true,
  }
}

function getObjectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function applyOpenAPIPathParams(apiPath, params = {}) {
  return String(apiPath || '').replace(/\{([^}]+)\}/g, (token, rawName) => {
    const name = String(rawName || '').trim()
    if (!(name in params)) {
      throw new Error(`缺少 path 参数：${name}`)
    }
    return encodeURIComponent(String(params[name]))
  })
}

function appendQueryParams(url, query = {}) {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item))
    } else {
      url.searchParams.set(key, String(value))
    }
  }
}

function buildOpenAPIAuthHeadersAndQuery(tool, authInput = {}) {
  const headers = {}
  const query = {}
  const auth = tool.auth || { type: 'none' }
  const bearerToken = authInput.bearerToken || authInput.token
  const apiKey = authInput.apiKey

  if (auth.type === 'bearer' && bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`
  } else if (auth.type === 'apiKey' && apiKey) {
    const apiKeyName = authInput.apiKeyName || auth.name || 'api_key'
    if ((authInput.apiKeyIn || auth.in) === 'query') {
      query[apiKeyName] = apiKey
    } else {
      headers[apiKeyName] = apiKey
    }
  }

  if (authInput.headerName && authInput.headerValue) {
    headers[String(authInput.headerName)] = String(authInput.headerValue)
  }

  return { headers, query }
}

function normalizeOpenAPIExecuteInput(input = {}) {
  const source = getObjectValue(input)
  return {
    path: getObjectValue(source.path),
    query: getObjectValue(source.query),
    header: getObjectValue(source.header),
    body: source.body,
    auth: getObjectValue(source.auth),
  }
}

function assertOpenAPIServerOverrideAllowed(configuredServerUrl, requestedServerUrl) {
  const configured = String(configuredServerUrl || '').trim()
  const requested = String(requestedServerUrl || '').trim()
  if (requested && requested !== configured) {
    const error = new Error('执行时不允许覆盖 OpenAPI serverUrl')
    error.statusCode = 400
    throw error
  }
  return configured
}

async function readResponseTextWithLimit(response, maxBytes = MAX_OPENAPI_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > maxBytes) {
    throw new Error(`OpenAPI 响应超过大小限制（${maxBytes} bytes）`)
  }
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`OpenAPI 响应超过大小限制（${maxBytes} bytes）`)
    }
    return text
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new Error(`OpenAPI 响应超过大小限制（${maxBytes} bytes）`)
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

async function executeOpenAPITool(id, payload = {}) {
  const startedAt = Date.now()
  const tool = getOpenAPITools().find(item => item.id === id)
  if (!tool) {
    const error = new Error('OpenAPI 工具不存在')
    error.statusCode = 404
    throw error
  }
  if (tool.enabled === false || tool.status === 'disabled') {
    const error = new Error('OpenAPI 工具未启用')
    error.statusCode = 403
    throw error
  }

  const input = normalizeOpenAPIExecuteInput(payload.input || payload)
  const method = String(tool.config?.method || tool.runtime?.method || '').toUpperCase()
  const serverUrl = assertOpenAPIServerOverrideAllowed(
    tool.config?.serverUrl || tool.runtime?.serverUrl,
    payload.serverUrl,
  )
  const apiPath = String(tool.config?.path || tool.runtime?.path || '')
  if (!method || !apiPath) throw new Error('OpenAPI operation 缺少 method 或 path')
  if (!serverUrl) throw new Error('OpenAPI operation 缺少 serverUrl')
  const url = new URL(applyOpenAPIPathParams(apiPath, input.path), serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`)
  const authParts = buildOpenAPIAuthHeadersAndQuery(tool, input.auth)
  appendQueryParams(url, { ...input.query, ...authParts.query })

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`不支持的 OpenAPI 协议：${url.protocol}`)
  }

  const headers = {
    Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    ...authParts.headers,
    ...Object.fromEntries(Object.entries(input.header).map(([key, value]) => [key, String(value)])),
    ...getObjectValue(payload.headers),
  }
  const options = {
    method,
    headers,
  }
  if (BODY_METHODS.has(method) && input.body !== undefined) {
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }
    options.body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body)
  }

  const timeoutMs = Math.max(1000, Math.min(Number(payload.timeoutMs || 15000), 120000))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const contentType = response.headers.get('content-type') || ''
    const rawText = await readResponseTextWithLimit(response)
    let data = rawText
    if (contentType.includes('application/json') && rawText) {
      try { data = JSON.parse(rawText) } catch (_) {}
    }
    const safeData = redactSensitiveValue(data)
    const safeHeaders = redactSensitiveValue(Object.fromEntries(response.headers.entries()))
    const safeRawText = typeof safeData === 'string' ? safeData : undefined

    return {
      id,
      success: response.ok,
      status: response.ok ? 'success' : 'error',
      statusCode: response.status,
      statusText: response.statusText,
      method,
      url: redactSensitiveText(url.toString()),
      durationMs: Date.now() - startedAt,
      contentType,
      headers: safeHeaders,
      data: safeData,
      rawText: safeRawText,
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`OpenAPI 执行超时（${timeoutMs}ms）`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function buildOpenAPIToolsFromSpec(specInput, options = {}) {
  const spec = parseOpenAPISpec(specInput)
  if (!spec.openapi && !spec.swagger) {
    throw new Error('未识别到 openapi 或 swagger 字段')
  }
  if (!spec.paths || typeof spec.paths !== 'object') {
    throw new Error('OpenAPI spec 缺少 paths')
  }

  const serviceTitle = options.name || spec.info?.title || options.source || 'OpenAPI Service'
  const serviceId = slugify(options.source || spec.info?.['x-service-id'] || serviceTitle, 'openapi-service')
  const serverUrl = getOpenAPIServerUrl(spec, options.serverUrl)
  const auth = getOpenAPIAuth(spec)
  const tools = []
  const ids = new Set()

  for (const [apiPath, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase()) || !operation || typeof operation !== 'object') continue
      const operationKey = slugify(operation.operationId || `${method}-${apiPath}`, `${method}-operation`)
      let id = `openapi:${serviceId}:${operationKey}`
      let suffix = 2
      while (ids.has(id)) {
        id = `openapi:${serviceId}:${operationKey}-${suffix}`
        suffix += 1
      }
      ids.add(id)

      tools.push({
        id,
        name: operation.summary || operation.operationId || `${method.toUpperCase()} ${apiPath}`,
        description: operation.description || operation.summary || `${method.toUpperCase()} ${apiPath}`,
        layer: 'openapi',
        source: serviceTitle,
        enabled: true,
        status: 'enabled',
        config: {
          serviceId,
          serviceTitle,
          operationId: operation.operationId,
          method: method.toUpperCase(),
          path: apiPath,
          serverUrl,
          tags: operation.tags || [],
        },
        inputSchema: buildOpenAPIInputSchema(operation, pathItem),
        outputSchema: getOpenAPIResponseSchema(operation),
        auth,
        permissions: { ...DEFAULT_TOOL_PERMISSIONS, network: true },
        runtime: {
          kind: 'openapi',
          method: method.toUpperCase(),
          path: apiPath,
          serverUrl,
        },
      })
    }
  }

  return tools
}

function getToolCheckMeta(config, id) {
  return config.tools?.registryChecks?.[id] || {}
}

function withToolRuntimeMetadata(tool, config) {
  const checkMeta = getToolCheckMeta(config, tool.id)
  const nativeMeta = NATIVE_TOOL_METADATA[tool.id] || {}
  const isCliTool = tool.id.startsWith('native:cli:')
  const inputSchema = tool.inputSchema || nativeMeta.inputSchema || {
    type: 'object',
    properties: {},
    additionalProperties: true,
  }
  const outputSchema = tool.outputSchema || nativeMeta.outputSchema || {
    type: 'object',
    additionalProperties: true,
  }
  const permissions = {
    ...DEFAULT_TOOL_PERMISSIONS,
    ...(nativeMeta.permissions || {}),
    ...(tool.permissions || {}),
    ...(isCliTool ? { shell: true } : {}),
  }
  const runtime = {
    kind: tool.layer,
    ...(nativeMeta.runtime || {}),
    ...(tool.runtime || {}),
  }

  return {
    ...tool,
    inputSchema,
    outputSchema,
    auth: tool.auth || { type: 'none' },
    permissions,
    runtime,
    status: checkMeta.status || tool.status,
    lastCheckedAt: checkMeta.lastCheckedAt,
    lastTestResult: checkMeta.lastTestResult,
  }
}

function persistToolCheckResult(id, result) {
  const config = loadConfig()
  config.tools = config.tools || {}
  config.tools.registryChecks = config.tools.registryChecks || {}
  config.tools.registryChecks[id] = {
    status: result.status,
    lastCheckedAt: result.checkedAt,
    lastTestResult: {
      success: result.success,
      message: result.message,
      durationMs: result.durationMs,
      warnings: result.warnings || [],
    },
  }
  saveConfig(config)
}

/** 读取 openclaw.json 配置 */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    }
  } catch (error) {
    console.error('[ToolRegistry] 读取配置失败:', error.message)
  }
  return {}
}

/** 保存 openclaw.json 配置 */
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    return true
  } catch (error) {
    console.error('[ToolRegistry] 保存配置失败:', error.message)
    return false
  }
}

/** 获取 MCP 工具列表 */
function getMCPTools() {
  const config = loadConfig()
  const mcpServers = config.mcp?.servers || {}
  return Object.entries(mcpServers).map(([id, cfg]) => {
    const serverCfg = cfg || {}
    return withToolRuntimeMetadata({
      id: `mcp:${id}`,
      name: serverCfg.name || id,
      description: serverCfg.description || `${serverCfg.type || 'stdio'} MCP 服务`,
      layer: 'mcp',
      source: id,
      enabled: serverCfg.enabled !== false,
      status: serverCfg.status === 'online' ? 'enabled' : (serverCfg.enabled === false ? 'disabled' : 'offline'),
      config: {
        type: serverCfg.type || 'stdio',
        command: serverCfg.command,
        args: serverCfg.args,
        url: serverCfg.url,
        tools: serverCfg.tools?.length || 0,
      },
      auth: serverCfg.auth || { type: serverCfg.headers || serverCfg.apiKey ? 'configured' : 'none' },
      permissions: { ...DEFAULT_TOOL_PERMISSIONS, network: serverCfg.type === 'http' || !!serverCfg.url, shell: serverCfg.type !== 'http' },
      runtime: { kind: 'mcp', transport: serverCfg.type || (serverCfg.url ? 'http' : 'stdio') },
    }, config)
  })
}

/** 获取内置工具列表 */
function getNativeTools() {
  const config = loadConfig()
  const cliCommands = config.tools?.exec?.commands || []

  // 内置工具（硬编码基础能力）
  const builtIn = [
    {
      id: 'native:app_open',
      name: '应用启动',
      description: '打开本地应用程序（飞书、微信、Chrome 等）',
      layer: 'native',
      source: 'builtin',
      enabled: true,
      status: 'enabled',
      config: { category: 'system' },
    },
    {
      id: 'native:web_search',
      name: '网页搜索',
      description: '使用搜索引擎查询信息',
      layer: 'native',
      source: 'builtin',
      enabled: true,
      status: 'enabled',
      config: { category: 'search' },
    },
    {
      id: 'native:file_upload',
      name: '文件上传',
      description: '上传文件到服务器',
      layer: 'native',
      source: 'builtin',
      enabled: true,
      status: 'enabled',
      config: { category: 'file' },
    },
  ]

  // CLI 命令工具
  const cliTools = cliCommands.map((cmd, idx) => withToolRuntimeMetadata({
    id: `native:cli:${cmd.name || `cmd-${idx}`}`,
    name: cmd.name || cmd.label || `命令 ${idx + 1}`,
    description: cmd.description || cmd.label || '',
    layer: 'native',
    source: 'cli',
    enabled: cmd.enabled !== false,
    status: cmd.enabled === false ? 'disabled' : 'enabled',
    config: {
      command: cmd.command,
      category: cmd.category || '通用',
    },
    inputSchema: cmd.inputSchema || {
      type: 'object',
      properties: Object.fromEntries((String(cmd.command || '').match(/\{\{[^}]+\}\}/g) || [])
        .map(token => token.slice(2, -2).trim())
        .filter(Boolean)
        .map(name => [name, { type: 'string' }])),
      additionalProperties: true,
    },
    outputSchema: { type: 'object', properties: { output: { type: 'string' } } },
    auth: { type: 'none' },
    permissions: { ...DEFAULT_TOOL_PERMISSIONS, shell: true, filesystem: true },
    runtime: { kind: 'cli', command: cmd.command },
  }, config))

  return [...builtIn.map(tool => withToolRuntimeMetadata(tool, config)), ...cliTools]
}

/** 获取插件工具列表 */
function getPluginTools() {
  const config = loadConfig()
  const plugins = config.plugins || []
  if (!Array.isArray(plugins)) return []

  return plugins.map(plugin => withToolRuntimeMetadata({
    id: `plugin:${plugin.id}`,
    name: plugin.name || plugin.id,
    description: plugin.description || '',
    layer: 'plugin',
    source: plugin.id,
    enabled: plugin.enabled !== false,
    status: plugin.enabled === false ? 'disabled' : 'enabled',
    config: {
      version: plugin.version,
      author: plugin.author,
      tools: plugin.tools || [],
    },
    inputSchema: plugin.inputSchema || { type: 'object', additionalProperties: true },
    outputSchema: plugin.outputSchema || { type: 'object', additionalProperties: true },
    auth: plugin.auth || { type: plugin.authRequired ? 'required' : 'none' },
    permissions: { ...DEFAULT_TOOL_PERMISSIONS, ...(plugin.permissions || {}) },
    runtime: { kind: 'plugin', version: plugin.version },
  }, config))
}

/** 获取 OpenAPI 导入工具列表 */
function getOpenAPITools() {
  const config = loadConfig()
  const openapiTools = config.tools?.openapi || []
  if (!Array.isArray(openapiTools)) return []

  return openapiTools.map(tool => withToolRuntimeMetadata({
    ...tool,
    layer: 'openapi',
    permissions: { ...DEFAULT_TOOL_PERMISSIONS, network: true, ...(tool.permissions || {}) },
    runtime: { kind: 'openapi', ...(tool.runtime || {}) },
  }, config))
}

/** 导入 OpenAPI/Swagger JSON，把每个 operation 注册为一个工具 */
function importOpenAPISpec(payload = {}) {
  const config = loadConfig()
  config.tools = config.tools || {}
  config.tools.openapi = Array.isArray(config.tools.openapi) ? config.tools.openapi : []

  const imported = buildOpenAPIToolsFromSpec(payload.spec, {
    name: payload.name,
    source: payload.source,
    serverUrl: payload.serverUrl,
  })
  if (imported.length === 0) {
    throw new Error('OpenAPI spec 中没有可导入的 operation')
  }

  const byId = new Map(config.tools.openapi.map(tool => [tool.id, tool]))
  for (const tool of imported) {
    byId.set(tool.id, tool)
  }
  config.tools.openapi = Array.from(byId.values())

  if (!saveConfig(config)) {
    throw new Error('保存 OpenAPI 工具配置失败')
  }

  return imported.map(tool => withToolRuntimeMetadata(tool, config))
}

/** 获取所有工具（按层级过滤） */
function getAllTools(layer) {
  if (layer === 'mcp') return getMCPTools()
  if (layer === 'native') return getNativeTools()
  if (layer === 'plugin') return getPluginTools()
  if (layer === 'openapi') return getOpenAPITools()
  return [...getMCPTools(), ...getNativeTools(), ...getPluginTools(), ...getOpenAPITools()]
}

/** 启用工具 */
function enableTool(id) {
  const config = loadConfig()

  if (id.startsWith('mcp:')) {
    const serverId = id.slice(4)
    if (config.mcp?.servers?.[serverId]) {
      config.mcp.servers[serverId].enabled = true
      saveConfig(config)
      return true
    }
  } else if (id.startsWith('native:cli:')) {
    const cmdName = id.slice('native:cli:'.length)
    if (config.tools?.exec?.commands) {
      const cmd = config.tools.exec.commands.find(c => c.name === cmdName)
      if (cmd) {
        cmd.enabled = true
        saveConfig(config)
        return true
      }
    }
  } else if (id.startsWith('plugin:')) {
    const pluginId = id.slice(7)
    if (Array.isArray(config.plugins)) {
      const plugin = config.plugins.find(p => p.id === pluginId)
      if (plugin) {
        plugin.enabled = true
        saveConfig(config)
        return true
      }
    }
  } else if (id.startsWith('openapi:')) {
    if (Array.isArray(config.tools?.openapi)) {
      const tool = config.tools.openapi.find(item => item.id === id)
      if (tool) {
        tool.enabled = true
        tool.status = 'enabled'
        saveConfig(config)
        return true
      }
    }
  }
  return false
}

/** 禁用工具 */
function disableTool(id) {
  const config = loadConfig()

  if (id.startsWith('mcp:')) {
    const serverId = id.slice(4)
    if (config.mcp?.servers?.[serverId]) {
      config.mcp.servers[serverId].enabled = false
      saveConfig(config)
      return true
    }
  } else if (id.startsWith('native:cli:')) {
    const cmdName = id.slice('native:cli:'.length)
    if (config.tools?.exec?.commands) {
      const cmd = config.tools.exec.commands.find(c => c.name === cmdName)
      if (cmd) {
        cmd.enabled = false
        saveConfig(config)
        return true
      }
    }
  } else if (id.startsWith('plugin:')) {
    const pluginId = id.slice(7)
    if (Array.isArray(config.plugins)) {
      const plugin = config.plugins.find(p => p.id === pluginId)
      if (plugin) {
        plugin.enabled = false
        saveConfig(config)
        return true
      }
    }
  } else if (id.startsWith('openapi:')) {
    if (Array.isArray(config.tools?.openapi)) {
      const tool = config.tools.openapi.find(item => item.id === id)
      if (tool) {
        tool.enabled = false
        tool.status = 'disabled'
        saveConfig(config)
        return true
      }
    }
  }
  return false
}

/** 发现已安装的 MCP 服务 */
function discoverMCPServers() {
  const discovered = []

  // 1. 扫描全局 MCP 配置目录
  const mcpConfigPaths = [
    path.join(os.homedir(), '.claude', 'mcp_servers.json'),
    path.join(os.homedir(), '.config', 'mcp', 'servers.json'),
    path.join(os.homedir(), 'Lingshu', 'mcp_servers.json'),
  ]

  for (const configPath of mcpConfigPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        const servers = data.mcpServers || data.servers || data
        for (const [id, cfg] of Object.entries(servers)) {
          discovered.push({
            id: `mcp:${id}`,
            name: cfg.name || id,
            description: `发现于 ${path.basename(path.dirname(configPath))}`,
            layer: 'mcp',
            source: id,
            enabled: false,
            status: 'discovered',
            config: {
              type: cfg.type || (cfg.command ? 'stdio' : 'http'),
              command: cfg.command,
              args: cfg.args,
              url: cfg.url,
            },
          })
        }
      } catch (_) { /* 忽略解析错误 */ }
    }
  }

  // 2. 扫描 npm 全局安装的 MCP 包
  try {
    const npmGlobalPath = path.join(os.homedir(), '.npm-global', 'lib', 'node_modules')
    if (fs.existsSync(npmGlobalPath)) {
      const entries = fs.readdirSync(npmGlobalPath)
      for (const entry of entries) {
        if (entry.startsWith('@modelcontextprotocol') || entry.includes('mcp-server')) {
          const pkgPath = path.join(npmGlobalPath, entry, 'package.json')
          if (fs.existsSync(pkgPath)) {
            try {
              const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
              discovered.push({
                id: `mcp:npm:${entry}`,
                name: pkg.name || entry,
                description: pkg.description || `npm 全局包: ${entry}`,
                layer: 'mcp',
                source: `npm:${entry}`,
                enabled: false,
                status: 'discovered',
                config: { type: 'stdio', command: 'npx', args: [entry] },
              })
            } catch (_) { /* 忽略 */ }
          }
        }
      }
    }
  } catch (_) { /* 忽略 */ }

  return discovered
}

function testTool(id, security = {}) {
  const startedAt = Date.now()
  const tool = getAllTools().find(item => item.id === id)
  const checkedAt = new Date().toISOString()
  const warnings = []
  let success = false
  let status = 'error'
  let message = '工具不存在'

  if (tool) {
    if (!tool.enabled) {
      status = 'disabled'
      message = '工具当前未启用'
    } else if (tool.layer === 'mcp') {
      const transport = tool.config?.type || tool.runtime?.transport
      const hasConnection = transport === 'http'
        ? !!tool.config?.url
        : !!tool.config?.command
      success = !!hasConnection
      status = success ? 'online' : 'error'
      message = success ? 'MCP 连接配置完整' : 'MCP 缺少 url 或 command 配置'
      if (tool.config?.tools === 0) warnings.push('未缓存 MCP tool 列表，建议后续接入真实握手')
    } else if (tool.id.startsWith('native:cli:')) {
      const command = String(tool.config?.command || '')
      const executable = command.trim().split(/\s+/)[0] || ''
      const allowedCommands = Array.isArray(security.allowedCommands) ? security.allowedCommands : []
      success = !!command && (allowedCommands.length === 0 || allowedCommands.includes(executable))
      status = success ? 'enabled' : 'error'
      message = success ? 'CLI 命令通过白名单检查' : `CLI 命令未通过白名单检查：${executable || '空命令'}`
      if (security.allowExecution !== true) warnings.push('当前处于预览与审计模式，未开放实际执行')
    } else if (tool.layer === 'native') {
      success = true
      status = 'enabled'
      message = '内置工具元数据可用'
    } else if (tool.layer === 'plugin') {
      success = true
      status = 'enabled'
      message = '插件工具元数据可用'
      if (!tool.config?.version) warnings.push('插件缺少版本信息')
    } else if (tool.layer === 'openapi') {
      success = !!tool.config?.method && !!tool.config?.path
      status = success ? 'enabled' : 'error'
      message = success ? 'OpenAPI operation 元数据可用' : 'OpenAPI operation 缺少 method 或 path'
      if (!tool.config?.serverUrl) warnings.push('未配置 serverUrl，执行时需要补齐服务地址')
      if (tool.auth?.type && tool.auth.type !== 'none') warnings.push(`需要认证：${tool.auth.type}`)
    }
  }

  const result = {
    id,
    success,
    status,
    message,
    checkedAt,
    durationMs: Date.now() - startedAt,
    warnings,
  }
  persistToolCheckResult(id, result)
  return result
}

export {
  getAllTools,
  getMCPTools,
  getNativeTools,
  getPluginTools,
  getOpenAPITools,
  enableTool,
  disableTool,
  discoverMCPServers,
  importOpenAPISpec,
  testTool,
  executeOpenAPITool,
  assertOpenAPIServerOverrideAllowed,
}
