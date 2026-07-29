export type AgentStatus = 'running' | 'stopped' | 'error' | 'unknown'

export interface NormalizedAgent {
  id: string
  name: string
  description: string
  model: string | { primary?: string }
  status: AgentStatus
  createdAt: string
  lastActive: string
  messageCount: number
  uptime: string
  default?: boolean
  config: {
    temperature: number
    maxTokens: number
    systemPrompt: string
    skills: string[]
  }
}

const RESERVED_AGENT_KEYS = ['defaults', 'default', 'list']

const normalizeStatus = (status: unknown): AgentStatus => {
  if (status === 'running' || status === 'stopped' || status === 'error') return status
  return 'unknown'
}

export const normalizeAgentsFromConfig = (config: any): NormalizedAgent[] => {
  const defaultModel = config?.agents?.defaults?.model || config?.models?.defaults?.model || ''

  const normalize = (agent: any = {}, fallbackId: string | null, index: number): NormalizedAgent => {
    const id = agent.id || agent.name || fallbackId || `agent-${index}`
    return {
      id,
      name: agent.name || agent.id || fallbackId || `Agent ${index + 1}`,
      description: agent.description || '',
      model: agent.model || defaultModel,
      status: normalizeStatus(agent.status),
      createdAt: agent.createdAt || '',
      lastActive: agent.lastActive || '',
      messageCount: Number(agent.messageCount || 0),
      uptime: agent.uptime || '0h',
      default: !!agent.default,
      config: {
        temperature: agent.config?.temperature ?? agent.temperature ?? 0.7,
        maxTokens: agent.config?.maxTokens ?? agent.maxTokens ?? 4000,
        systemPrompt: agent.config?.systemPrompt || agent.systemPrompt || '',
        skills: Array.isArray(agent.config?.skills) ? agent.config.skills : []
      }
    }
  }

  if (Array.isArray(config?.agents)) {
    return config.agents.map((agent: any, index: number) => normalize(agent, null, index))
  }

  if (Array.isArray(config?.agents?.list)) {
    return config.agents.list.map((agent: any, index: number) => normalize(agent, null, index))
  }

  if (config?.agents && typeof config.agents === 'object') {
    return Object.entries(config.agents)
      .filter(([key]) => !RESERVED_AGENT_KEYS.includes(key))
      .map(([key, agent], index) => normalize(agent, key, index))
  }

  return []
}

export const getAgentListFromConfig = (config: any): any[] => {
  if (!config.agents || Array.isArray(config.agents)) {
    config.agents = { list: Array.isArray(config.agents) ? config.agents : [] }
  }
  if (!Array.isArray(config.agents.list)) config.agents.list = []
  return config.agents.list
}
