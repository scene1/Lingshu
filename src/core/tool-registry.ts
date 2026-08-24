// ============================================================
// 灵枢 v3.0 — 前端工具注册表服务
// 封装 /api/tools 的 API 调用 + 内置缓存
// ============================================================

import type { ToolRegistryItem } from '../types'

export type ToolLayer = ToolRegistryItem['layer']

/** 缓存条目 */
interface CacheEntry {
  items: ToolRegistryItem[]
  timestamp: number
}

/** 缓存过期时间（毫秒） */
const CACHE_TTL = 30_000

/**
 * 工具注册表服务
 *
 * 提供统一工具层（MCP / 内置 / 插件 / OpenAPI）的查询、启用/禁用、发现等能力。
 * 内置 Map 缓存并支持过期清除，减少重复网络请求。
 */
class ToolRegistryService {
  private cache: Map<string, CacheEntry> = new Map()
  private abortController: AbortController | null = null

  /**
   * 获取工具列表（可选按层级过滤）
   * @param layer 工具层级：'mcp' | 'native' | 'plugin' | 'openapi' | undefined（全部）
   */
  async getTools(layer?: ToolLayer): Promise<ToolRegistryItem[]> {
    const cacheKey = layer || 'all'

    // 检查缓存
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.items
    }

    // 发起请求
    const url = layer ? `/api/tools?layer=${layer}` : '/api/tools'
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`获取工具列表失败: ${response.status}`)
    }

    const items: ToolRegistryItem[] = await response.json()

    // 更新缓存
    this.cache.set(cacheKey, { items, timestamp: Date.now() })

    return items
  }

  /**
   * 获取单个工具详情
   * @param id 工具 ID（如 'mcp:filesystem'）
   */
  async getTool(id: string): Promise<ToolRegistryItem | null> {
    // 先查缓存
    for (const entry of this.cache.values()) {
      const found = entry.items.find(item => item.id === id)
      if (found) return found
    }

    // 缓存未命中，从全量列表查询
    const all = await this.getTools()
    return all.find(item => item.id === id) || null
  }

  /**
   * 启用工具
   * @param id 工具 ID
   */
  async enableTool(id: string): Promise<void> {
    const response = await fetch(`/api/tools/${encodeURIComponent(id)}/enable`, {
      method: 'PUT',
    })
    if (!response.ok) {
      throw new Error(`启用工具失败: ${response.status}`)
    }
    this.clearCache()
  }

  /**
   * 禁用工具
   * @param id 工具 ID
   */
  async disableTool(id: string): Promise<void> {
    const response = await fetch(`/api/tools/${encodeURIComponent(id)}/disable`, {
      method: 'PUT',
    })
    if (!response.ok) {
      throw new Error(`禁用工具失败: ${response.status}`)
    }
    this.clearCache()
  }

  /**
   * 发现已安装的 MCP 服务和工具
   * 返回扫描到的工具列表
   */
  async discoverTools(): Promise<ToolRegistryItem[]> {
    // 取消上一次未完成的请求
    if (this.abortController) {
      this.abortController.abort()
    }

    this.abortController = new AbortController()

    const response = await fetch('/api/tools/discover', {
      method: 'POST',
      signal: this.abortController.signal,
    })

    this.abortController = null

    if (!response.ok) {
      throw new Error(`发现工具失败: ${response.status}`)
    }

    const discovered: ToolRegistryItem[] = await response.json()
    return discovered
  }

  /**
   * 测试工具可用性（只做配置/健康检查，不直接执行工具动作）
   */
  async testTool(id: string): Promise<{ success: boolean; result: ToolRegistryItem['lastTestResult']; auditId?: string }> {
    const response = await fetch(`/api/tools/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data?.message || data?.error || `测试工具失败: ${response.status}`)
    }
    this.clearCache()
    return data
  }

  /**
   * 导入 OpenAPI/Swagger JSON，并把 operation 注册为工具
   */
  async importOpenAPISpec(payload: {
    spec: Record<string, unknown> | string
    name?: string
    source?: string
    serverUrl?: string
  }): Promise<{ success: boolean; count: number; imported: ToolRegistryItem[] }> {
    const response = await fetch('/api/tools/openapi/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data?.message || data?.error || `导入 OpenAPI 失败: ${response.status}`)
    }
    this.clearCache()
    return data
  }

  /**
   * 执行 OpenAPI 工具。payload.input 建议使用 { path, query, header, body, auth }。
   */
  async executeTool(id: string, payload: {
    input?: Record<string, unknown>
    serverUrl?: string
    headers?: Record<string, string>
    timeoutMs?: number
  }): Promise<{ success: boolean; result: Record<string, unknown>; auditId?: string }> {
    const response = await fetch(`/api/tools/${encodeURIComponent(id)}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data?.message || data?.error || `执行工具失败: ${response.status}`)
    }
    this.clearCache()
    return data
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.cache.clear()
  }
}

/** 单例实例 */
export const toolRegistryService = new ToolRegistryService()

/** 导出类供测试或自定义实例化使用 */
export { ToolRegistryService }
