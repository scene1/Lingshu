// ============================================================
// 灵枢 v3.0 — Provider 状态管理 (Zustand)
// ============================================================

import { create } from 'zustand'
import {
  providerRegistry,
  initProviderRegistry,
} from '../core/provider-registry'
import type { ProviderConfig, ModelEntry } from '../types'

interface ProviderState {
  providers: ProviderConfig[]
  selectedProviderId: string | null
  isLoading: boolean
  apiKeys: Record<string, string>

  init: () => void
  refresh: () => void
  addProvider: (config: ProviderConfig) => void
  removeProvider: (id: string) => void
  updateProvider: (id: string, updates: Partial<ProviderConfig>) => void
  setApiKey: (providerId: string, key: string) => void
  syncModels: (providerId: string) => Promise<void>
  getAllModels: () => Array<{ providerId: string; providerName: string; model: ModelEntry }>
  setSelectedProvider: (id: string | null) => void
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  selectedProviderId: null,
  isLoading: false,
  apiKeys: {},

  init: () => {
    initProviderRegistry()
    set({ providers: providerRegistry.getAll() })
  },

  refresh: () => {
    set({ providers: providerRegistry.getAll() })
  },

  addProvider: (config) => {
    providerRegistry.register(config)
    set(state => ({ providers: [...state.providers, config] }))
  },

  removeProvider: (id) => {
    providerRegistry.unregister(id)
    set(state => ({
      providers: state.providers.filter(p => p.id !== id),
      selectedProviderId: state.selectedProviderId === id ? null : state.selectedProviderId,
    }))
  },

  updateProvider: (id, updates) => {
    const provider = providerRegistry.get(id)
    if (provider) {
      Object.assign(provider, updates)
      set(state => ({
        providers: state.providers.map(p => p.id === id ? { ...p, ...updates } : p),
      }))
    }
  },

  setApiKey: (providerId, key) => {
    set(state => ({ apiKeys: { ...state.apiKeys, [providerId]: key } }))
  },

  syncModels: async (providerId) => {
    const provider = get().providers.find(p => p.id === providerId)
    if (!provider) return

    set({ isLoading: true })
    try {
      const modelsUrl = `${provider.baseUrl}/models`
      await providerRegistry.syncModelList(providerId, modelsUrl)
      get().refresh()
    } finally {
      set({ isLoading: false })
    }
  },

  getAllModels: () => providerRegistry.getAllModels(),

  setSelectedProvider: (id) => set({ selectedProviderId: id }),
}))
