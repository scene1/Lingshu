// ============================================================
// 灵枢 v3.0 — Provider 注册中心
// 对标 Cherry Studio 的注册中心架构，统一管理所有模型供应商
// ============================================================

import type { ProviderConfig, ModelEntry, ProviderProtocol } from '../types'

// ---- 注册中心 ----

class ProviderRegistry {
  private providers: Map<string, ProviderConfig> = new Map()
  private listeners: Set<() => void> = new Set()

  /** 注册 Provider */
  register(config: ProviderConfig): void {
    this.providers.set(config.id, config)
    this.notify()
  }

  /** 批量注册 */
  registerAll(configs: ProviderConfig[]): void {
    configs.forEach(c => this.providers.set(c.id, c))
    this.notify()
  }

  /** 注销 Provider */
  unregister(id: string): boolean {
    const result = this.providers.delete(id)
    if (result) this.notify()
    return result
  }

  /** 获取单个 Provider */
  get(id: string): ProviderConfig | undefined {
    return this.providers.get(id)
  }

  /** 获取所有 Provider */
  getAll(): ProviderConfig[] {
    return Array.from(this.providers.values())
  }

  /** 获取已启用模型的所有 Provider（排除 claude-cli 等不需要 key 的） */
  getActive(): ProviderConfig[] {
    return this.getAll().filter(p => p.keyPlaceholder !== '无需 API Key')
  }

  /** 从 baseUrl 反向查找 Provider */
  resolve(url: string): ProviderConfig | undefined {
    const normalized = url.replace(/\/$/, '').toLowerCase()
    return this.getAll().find(p =>
      p.baseUrl.replace(/\/$/, '').toLowerCase() === normalized
    )
  }

  /** 模糊搜索 Provider */
  search(query: string): ProviderConfig[] {
    const q = query.toLowerCase()
    return this.getAll().filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.baseUrl.toLowerCase().includes(q)
    )
  }

  /** 根据协议过滤 */
  getByProtocol(protocol: ProviderProtocol): ProviderConfig[] {
    return this.getAll().filter(p => p.protocols.includes(protocol))
  }

  /** 获取完整模型列表 */
  getAllModels(): Array<{ providerId: string; providerName: string; model: ModelEntry }> {
    const result: Array<{ providerId: string; providerName: string; model: ModelEntry }> = []
    this.providers.forEach((provider) => {
      provider.models.forEach((model) => {
        result.push({
          providerId: provider.id,
          providerName: provider.name,
          model,
        })
      })
    })
    return result
  }

  /** 从 URL 同步模型列表 */
  async syncModelList(providerId: string, modelsUrl: string): Promise<ModelEntry[]> {
    try {
      const response = await fetch(modelsUrl)
      if (!response.ok) {
        throw new Error(`同步模型列表失败: ${response.status}`)
      }
      const data = await response.json()
      const models: ModelEntry[] = data.data?.map((m: { id: string; name?: string }) => ({
        value: m.id,
        label: m.name || m.id,
        desc: '',
      })) || []

      const provider = this.providers.get(providerId)
      if (provider) {
        provider.models = models
        this.notify()
      }
      return models
    } catch (error) {
      console.error(`[ProviderRegistry] 同步 ${providerId} 模型列表失败:`, error)
      throw error
    }
  }

  /** 订阅变更 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.listeners.forEach(fn => fn())
  }

  /** 检查是否有 providers */
  get isEmpty(): boolean {
    return this.providers.size === 0
  }

  get size(): number {
    return this.providers.size
  }
}

// 全局单例
export const providerRegistry = new ProviderRegistry()

// ---- 预置 Provider 定义 ----

export const PRESET_PROVIDERS: ProviderConfig[] = [
  {
    id: 'stepfun',
    name: 'StepFun (阶跃星辰)',
    icon: '🚀',
    baseUrl: 'https://api.stepfun.com/step_plan/v1',
    protocols: ['openai-chat'],
    models: [
      { value: 'step-3.7-flash', label: 'Step-3.7 Flash', desc: '最新旗舰，极速响应' },
      { value: 'step-3.5-flash-2603', label: 'Step-3.5 Flash 2603', desc: '稳定版本' },
      { value: 'step-3.5-flash', label: 'Step-3.5 Flash', desc: '轻量极速' },
    ],
    capabilities: {
      vision: true,
      functionCalling: true,
      streaming: true,
      webSearch: true,
      imageGeneration: false,
    },
    docUrl: 'https://platform.stepfun.com/',
    keyUrl: 'https://platform.stepfun.com/',
    keyPlaceholder: 'your-api-key',
  },
  {
    id: 'zhipu',
    name: '智谱 AI (GLM)',
    icon: '🧠',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    protocols: ['openai-chat'],
    models: [
      { value: 'glm-4.6', label: 'GLM-4.6', desc: '最新旗舰模型' },
      { value: 'glm-4.5-flash', label: 'GLM-4.5 Flash', desc: '高速响应' },
    ],
    capabilities: {
      vision: true,
      functionCalling: true,
      streaming: true,
      webSearch: true,
      imageGeneration: true,
    },
    docUrl: 'https://open.bigmodel.cn/',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    keyPlaceholder: 'your-api-key',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '🤖',
    baseUrl: 'https://api.openai.com/v1',
    protocols: ['openai-chat', 'openai-responses'],
    models: [
      { value: 'gpt-4o', label: 'GPT-4o', desc: '旗舰多模态模型' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini', desc: '轻量高效' },
    ],
    capabilities: {
      vision: true,
      functionCalling: true,
      streaming: true,
      webSearch: false,
      imageGeneration: true,
    },
    docUrl: 'https://platform.openai.com/',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-xxxxxxxx',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    icon: '🧬',
    baseUrl: 'https://api.anthropic.com/v1',
    protocols: ['anthropic-messages'],
    models: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude 4 Sonnet', desc: '平衡性能与速度' },
      { value: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', desc: '经典稳定版' },
    ],
    capabilities: {
      vision: true,
      functionCalling: true,
      streaming: true,
      webSearch: false,
      imageGeneration: false,
    },
    docUrl: 'https://console.anthropic.com/',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-xxxxxxxx',
  },
  {
    id: 'doubao',
    name: '豆包 (火山引擎)',
    icon: '🫘',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    protocols: ['openai-chat'],
    models: [
      { value: 'doubao-pro-256k', label: '豆包 Pro 256K', desc: '超长上下文' },
      { value: 'doubao-lite-128k', label: '豆包 Lite 128K', desc: '轻量版本' },
    ],
    capabilities: {
      vision: true,
      functionCalling: true,
      streaming: true,
      webSearch: false,
      imageGeneration: false,
    },
    docUrl: 'https://console.volcengine.com/',
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    keyPlaceholder: 'your-api-key',
  },
  {
    id: 'qwen',
    name: '通义千问 (阿里云)',
    icon: '☁️',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    protocols: ['openai-chat'],
    models: [
      { value: 'qwen-max', label: 'Qwen-Max', desc: '最强性能' },
      { value: 'qwen-plus', label: 'Qwen-Plus', desc: '均衡之选' },
    ],
    capabilities: {
      vision: true,
      functionCalling: true,
      streaming: true,
      webSearch: false,
      imageGeneration: false,
    },
    docUrl: 'https://dashscope.aliyun.com/',
    keyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    keyPlaceholder: 'sk-xxxxxxxx',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: '🔍',
    baseUrl: 'https://api.deepseek.com/v1',
    protocols: ['openai-chat'],
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek-V3', desc: '最新通用模型' },
      { value: 'deepseek-reasoner', label: 'DeepSeek-R1', desc: '深度推理，支持思维链' },
    ],
    capabilities: {
      vision: false,
      functionCalling: true,
      streaming: true,
      webSearch: false,
      imageGeneration: false,
    },
    docUrl: 'https://platform.deepseek.com/',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-xxxxxxxx',
  },
  {
    id: 'moonshot',
    name: 'Moonshot (月之暗面)',
    icon: '🌙',
    baseUrl: 'https://api.moonshot.cn/v1',
    protocols: ['openai-chat'],
    models: [
      { value: 'moonshot-v1-8k', label: 'Moonshot v1 8K', desc: '标准上下文' },
      { value: 'moonshot-v1-128k', label: 'Moonshot v1 128K', desc: '超长上下文' },
    ],
    capabilities: {
      vision: false,
      functionCalling: true,
      streaming: true,
      webSearch: false,
      imageGeneration: false,
    },
    docUrl: 'https://platform.moonshot.cn/',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    keyPlaceholder: 'sk-xxxxxxxx',
  },
  {
    id: 'xiaomi',
    name: '小米 MiMo',
    icon: '📱',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    protocols: ['openai-chat'],
    models: [
      { value: 'mimo-v2-flash', label: 'MiMo v2 Flash', desc: '最新快速版' },
    ],
    capabilities: {
      vision: true,
      functionCalling: true,
      streaming: true,
      webSearch: false,
      imageGeneration: false,
    },
    docUrl: 'https://platform.xiaomimimo.com/',
    keyUrl: 'https://platform.xiaomimimo.com/',
    keyPlaceholder: 'tp-xxxxxxxx',
  },
]

/** 初始化 Provider 注册中心 */
export function initProviderRegistry(): void {
  providerRegistry.registerAll(PRESET_PROVIDERS)
}
