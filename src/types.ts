export type Role = 'user' | 'assistant' | 'system'
export interface Source { title: string; url: string; snippet?: string }
export interface Attachment { id: string; name: string; mime: string; kind: 'image' | 'document' | 'code'; size: number; text?: string | null; data?: string | null }
export interface ApiProfile { id: string; name: string; baseUrl: string; provider: ProviderKind; model: string; thinking: ThinkingLevel; inputPrice: number; outputPrice: number; hasKey: boolean }
export interface ModelPrice { profileId: string; model: string; inputPrice: number; outputPrice: number }
export interface Usage { id: string; conversationId: string; profileId: string; profileName: string; model: string; inputTokens: number; outputTokens: number; thinkingTokens: number; durationMs: number; estimatedCost: number; createdAt: string }
export interface Message { id: string; role: Role; content: string; createdAt: string; sources?: Source[]; attachments?: Attachment[]; pending?: boolean }
export interface Conversation { id: string; title: string; model: string; createdAt: string; updatedAt: string; messages: Message[]; systemPrompt: string }
export type ThemeMode = 'system' | 'light' | 'dark'
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'
export type ProviderKind = 'anthropic-compatible' | 'openai-compatible'
export interface Settings {
  apiKey: string
  baseUrl: string
  provider: ProviderKind
  model: string
  thinking: ThinkingLevel
  webSearch: boolean
  theme: ThemeMode
  systemPrompt: string
  profileId: string
  searchMode: 'off' | 'auto' | 'force'
  searchProvider: 'claude' | 'searxng'
  searchBaseUrl: string
  contextMode: 'full' | 'recent' | 'smart'
  recentTurns: number
  selectedMessageIds: string[]
  selectedAttachmentIds: string[]
}
export interface ConnectionResult { ok: boolean; message: string }
