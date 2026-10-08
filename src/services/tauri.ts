import type { Attachment, ConnectionResult, Conversation, Message, Settings, ApiProfile, Usage, ModelPrice, MessageReference, Capabilities, ProviderModel } from '../types'

const isTauri = '__TAURI_INTERNALS__' in window
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error('请通过 Tauri 桌面应用运行此功能。')
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(command, args)
}

export const api = {
  isTauri,
  getProviderModels: (settings: Settings) => invoke<ProviderModel[]>('get_provider_models', {settings}),
  getTree: (conversationId: string) => invoke<{messages: Message[]; leaf: string | null}>('get_tree', {conversationId}),
  selectBranch: (conversationId: string, leaf: string | null) => invoke<void>('select_branch', {conversationId, leaf}),
  getExtension: <T>(key: string) => invoke<T | null>('get_extension', {key}),
  saveExtension: (key: string, value: unknown) => invoke<void>('save_extension', {key, value}),
  detectCapabilities: (settings: Settings) => invoke<Capabilities>('detect_capabilities', {settings}),
  getConversations: () => invoke<Conversation[]>('get_conversations'),
  searchConversations: (query: string) => invoke<Conversation[]>('search_conversations', { query }),
  setConversationPrompt: (conversationId: string, prompt: string) => invoke<void>('set_conversation_prompt', { conversationId, prompt }),
  parseAttachment: (name: string, mime: string, data: string) => invoke<Attachment>('parse_attachment', { name, mime, data }),
  parseAttachmentPath: (path: string) => invoke<Attachment>('parse_attachment_path', { path }),
  getAttachmentData: (attachmentId: string) => invoke<string | null>('get_attachment_data', { attachmentId }),
  exportConversation: (conversationId: string, format: 'md' | 'pdf', path: string) => invoke<void>('export_conversation', { conversationId, format, path }),
  createConversation: (model: string) => invoke<Conversation>('create_conversation', { model }),
  getMessages: (conversationId: string) => invoke<Message[]>('get_messages', { conversationId }),
  renameConversation: (conversationId: string, title: string) => invoke<void>('rename_conversation', { conversationId, title }),
  setConversationModel: (conversationId: string, model: string) => invoke<void>('set_conversation_model', { conversationId, model }),
  deleteConversation: (conversationId: string) => invoke<void>('delete_conversation', { conversationId }),
  getSettings: () => invoke<Settings>('get_settings'),
  getProfiles: () => invoke<ApiProfile[]>('get_profiles'),
  saveProfile: (profile: ApiProfile, apiKey: string) => invoke<ApiProfile>('save_profile', { profile, apiKey }),
  importLegacyProfile: () => invoke<ApiProfile>('import_legacy_profile'),
  deleteProfile: (id: string) => invoke<void>('delete_profile', { id }),
  getUsage: () => invoke<Usage[]>('get_usage'),
  getModelPrices: () => invoke<ModelPrice[]>('get_model_prices'),
  saveModelPrice: (price: ModelPrice) => invoke<void>('save_model_price', { price }),
  saveCodeFile: (path: string, content: string, expected: string) => invoke<void>('save_code_file', { path, content, expected }),
  saveSettings: (settings: Settings, conversationId?: string) => invoke<void>('save_settings', { settings, conversationId: conversationId || null }),
  testConnection: (settings: Settings) => invoke<ConnectionResult>('test_connection', { settings }),
  sendMessage: (conversationId: string, content: string, settings: Settings, persistUser = true, attachments: Attachment[] = [], parentId: string | null = null, references: MessageReference[] = []) => invoke<void>('send_message', { conversationId, content, settings, persistUser, attachments, parentId, references }),
  deleteLastAssistant: (conversationId: string) => invoke<void>('delete_last_assistant', { conversationId }),
  stopGeneration: () => invoke<void>('stop_generation')
}
