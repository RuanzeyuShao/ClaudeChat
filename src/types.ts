export type Role = 'user' | 'assistant' | 'system'
export interface Source { citation?: string; title: string; url: string; snippet?: string }
export interface Attachment { id: string; name: string; mime: string; kind: 'image' | 'document' | 'code'; size: number; text?: string | null; data?: string | null }
export interface ApiProfile { requestOptions?: Record<string, unknown> | null; id: string; name: string; baseUrl: string; provider: ProviderKind; model: string; thinking: ThinkingLevel; inputPrice: number; outputPrice: number; hasKey: boolean }
export interface ModelPrice { profileId: string; model: string; inputPrice: number; outputPrice: number }
export interface Usage { id: string; conversationId: string; profileId: string; profileName: string; model: string; inputTokens: number; outputTokens: number; thinkingTokens: number; durationMs: number; estimatedCost: number; createdAt: string }
export interface MessageReference { messageId: string; text: string }
export interface Preset { id: string; name: string; systemPrompt?: string; model?: string; thinking?: ThinkingLevel; searchMode?: Settings['searchMode']; profileId?: string }
export interface Organization { pinned?: boolean; folder?: string; tags?: string[] }
export interface Capabilities { checkedAt: string; model: string; baseUrl: string; provider: string; connection: string; streaming: string; thinking: string; vision: string; tool: string; search: string; contextLength: number | null; detail?: string }
export interface Message { usageId?: string | null; reasoningContent?: string; parentId?: string | null; references?: MessageReference[]; searchTrace?: {query: string; provider: string; status: string; mode: string; sources: number; events?: unknown[]}; id: string; role: Role; content: string; createdAt: string; sources?: Source[]; attachments?: Attachment[]; pending?: boolean }
export interface Conversation { id: string; title: string; model: string; createdAt: string; updatedAt: string; messages: Message[]; systemPrompt: string }
export type ThemeMode = 'system' | 'light' | 'dark'
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'
export type ProviderKind = 'anthropic-compatible' | 'openai-compatible' | 'openai' | 'deepseek' | 'moonshot' | 'zhipu' | 'grok'
export interface ProviderModel { id: string; name?: string }
export interface Settings {
  searchModel?: string
  requestOptions?: Record<string, unknown> | null
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
