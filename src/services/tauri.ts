import type { ConnectionResult, Conversation, Message, Settings } from '../types'

const isTauri = '__TAURI_INTERNALS__' in window
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error('请通过 Tauri 桌面应用运行此功能。')
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(command, args)
}

export const api = {
  isTauri,
  getConversations: () => invoke<Conversation[]>('get_conversations'),
  createConversation: (model: string) => invoke<Conversation>('create_conversation', { model }),
  getMessages: (conversationId: string) => invoke<Message[]>('get_messages', { conversationId }),
  renameConversation: (conversationId: string, title: string) => invoke<void>('rename_conversation', { conversationId, title }),
  setConversationModel: (conversationId: string, model: string) => invoke<void>('set_conversation_model', { conversationId, model }),
  deleteConversation: (conversationId: string) => invoke<void>('delete_conversation', { conversationId }),
  getSettings: () => invoke<Settings>('get_settings'),
  saveSettings: (settings: Settings) => invoke<void>('save_settings', { settings }),
  testConnection: (settings: Settings) => invoke<ConnectionResult>('test_connection', { settings }),
  sendMessage: (conversationId: string, content: string, settings: Settings, persistUser = true) => invoke<void>('send_message', { conversationId, content, settings, persistUser }),
  deleteLastAssistant: (conversationId: string) => invoke<void>('delete_last_assistant', { conversationId }),
  stopGeneration: () => invoke<void>('stop_generation')
}
