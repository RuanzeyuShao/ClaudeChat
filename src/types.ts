export type Role = 'user' | 'assistant' | 'system'
export interface Source { title: string; url: string }
export interface Attachment { id: string; name: string; mime: string; kind: 'image' | 'document'; size: number; text?: string | null; data?: string | null }
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
}
export interface ConnectionResult { ok: boolean; message: string }
