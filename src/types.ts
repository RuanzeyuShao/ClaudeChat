export type Role = 'user' | 'assistant' | 'system'
export interface Source { title: string; url: string }
export interface Message { id: string; role: Role; content: string; createdAt: string; sources?: Source[]; pending?: boolean }
export interface Conversation { id: string; title: string; model: string; createdAt: string; updatedAt: string; messages: Message[] }
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
}
export interface ConnectionResult { ok: boolean; message: string }
