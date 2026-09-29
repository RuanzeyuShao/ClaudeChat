import type { Attachment, ConnectionResult, Conversation, Message, Settings } from '../types'

const isTauri = '__TAURI_INTERNALS__' in window
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error('请通过 Tauri 桌面应用运行此功能。')
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(command, args)
}

export const api = {
  isTauri,
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
  saveSettings: (settings: Settings) => invoke<void>('save_settings', { settings }),
  testConnection: (settings: Settings) => invoke<ConnectionResult>('test_connection', { settings }),
  sendMessage: (conversationId: string, content: string, settings: Settings, persistUser = true, attachments: Attachment[] = []) => invoke<void>('send_message', { conversationId, content, settings, persistUser, attachments }),
  deleteLastAssistant: (conversationId: string) => invoke<void>('delete_last_assistant', { conversationId }),
  stopGeneration: () => invoke<void>('stop_generation')
}
