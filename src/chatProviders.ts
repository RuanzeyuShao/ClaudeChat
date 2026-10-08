import type { ProviderKind, Settings } from './types'

export const chatProviders = [
  { id: 'claude', name: 'Claude Chat', mark: '✳', color: '#c87853', kind: 'anthropic-compatible' },
  { id: 'gpt', name: 'GPT Chat', mark: 'G', color: '#35977f', kind: 'openai' },
  { id: 'kimi', name: 'Kimi Chat', mark: 'K', color: '#8276d3', kind: 'moonshot' },
  { id: 'deepseek', name: 'DeepSeek Chat', mark: 'D', color: '#5489d8', kind: 'deepseek' },
  { id: 'grok', name: 'Grok Chat', mark: 'X', color: '#888b91', kind: 'grok' },
  { id: 'glm', name: 'GLM Chat', mark: 'Z', color: '#7089a9', kind: 'zhipu' }
] as const
export type ChatProviderId = typeof chatProviders[number]['id']
export function providerEntry(kind: ProviderKind): ChatProviderId {
  return kind === 'openai-compatible' ? 'gpt' : chatProviders.find(p => p.kind === kind)?.id || 'claude'
}
export type ProviderPreference = Pick<Settings, 'profileId' | 'model' | 'thinking' | 'searchMode' | 'searchProvider' | 'searchBaseUrl' | 'searchModel'>
export function preference(settings: Settings): ProviderPreference {
  return {profileId: settings.profileId, model: settings.model, thinking: settings.thinking, searchMode: settings.searchMode, searchProvider: settings.searchProvider, searchBaseUrl: settings.searchBaseUrl, searchModel: settings.searchModel || ''}
}
