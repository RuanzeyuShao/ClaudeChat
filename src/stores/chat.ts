import { defineStore } from 'pinia'
import { listen } from '@tauri-apps/api/event'
import { api } from '../services/tauri'
import type { Conversation, Message, Settings, ThemeMode } from '../types'

const defaultSettings: Settings = { apiKey: '', baseUrl: 'https://api.anthropic.com', provider: 'anthropic-compatible', model: 'claude-opus-5-5', thinking: 'medium', webSearch: true, theme: 'system' }
export const useChatStore = defineStore('chat', {
  state: () => ({ conversations: [] as Conversation[], activeId: '' as string, settings: defaultSettings, loading: false, error: '', initialized: false }),
  getters: { active(state): Conversation | undefined { return state.conversations.find(x => x.id === state.activeId) } },
  actions: {
    async initialize() {
      if (this.initialized) return
      this.initialized = true
      if (!api.isTauri) { await this.newConversation(); return }
      this.settings = { ...defaultSettings, ...await api.getSettings() }
      this.applyTheme(this.settings.theme)
      this.conversations = await api.getConversations()
      if (this.conversations.length) await this.select(this.conversations[0].id); else await this.newConversation()
      await listen<{ conversationId: string; delta: string }>('chat-delta', ({ payload }) => {
        const message = this.active?.messages.at(-1)
        if (message && this.activeId === payload.conversationId) message.content += payload.delta
      })
      await listen<{ conversationId: string; sources: Message['sources'] }>('chat-sources', ({ payload }) => {
        const message = this.active?.messages.at(-1)
        if (message && this.activeId === payload.conversationId) message.sources = payload.sources
      })
      await listen<string>('chat-finished', ({ payload }) => { this.loading = false; const msg = this.conversations.find(item => item.id === payload)?.messages.at(-1); if (msg) msg.pending = false })
      await listen<{ conversationId: string; message: string }>('chat-error', ({ payload }) => { this.loading = false; if (this.activeId === payload.conversationId) this.error = payload.message; const msg = this.conversations.find(item => item.id === payload.conversationId)?.messages.at(-1); if (msg) msg.pending = false })
    },
    async newConversation() {
      const now = new Date().toISOString()
      const item: Conversation = api.isTauri ? await api.createConversation(this.settings.model) : { id: crypto.randomUUID(), title: '新对话', model: this.settings.model, createdAt: now, updatedAt: now, messages: [] }
      this.conversations.unshift(item); this.activeId = item.id; this.error = ''
    },
    async select(id: string) { this.activeId = id; this.error = ''; const item = this.active; if (item) { this.settings.model = item.model; if (api.isTauri) item.messages = await api.getMessages(id) } },
    async remove(id: string) { if (api.isTauri) await api.deleteConversation(id); this.conversations = this.conversations.filter(x => x.id !== id); if (this.activeId === id) this.activeId = ''; if (!this.conversations.length) await this.newConversation(); else if (!this.activeId) await this.select(this.conversations[0].id) },
    async rename(id: string, title: string) { const item = this.conversations.find(x => x.id === id); if (item) item.title = title; if (api.isTauri) await api.renameConversation(id, title) },
    async setModel(model: string) {
      const clean = model.trim(); if (!clean) return
      this.settings.model = clean
      if (this.active) this.active.model = clean
      if (api.isTauri) { if (this.activeId) await api.setConversationModel(this.activeId, clean); await api.saveSettings({ ...this.settings, apiKey: '' }) }
    },
    async setThinking(value: number) {
      this.settings.thinking = (['off', 'low', 'medium', 'high'] as const)[value] ?? 'off'
      if (api.isTauri) await api.saveSettings({ ...this.settings, apiKey: '' })
    },
    async saveSettings(settings: Settings) { this.settings = settings; this.applyTheme(settings.theme); if (api.isTauri) await api.saveSettings(settings) },
    applyTheme(theme: ThemeMode) {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    },
    async send(content: string) {
      if (!this.active || this.loading || !content.trim()) return
      this.error = ''; this.loading = true
      const user: Message = { id: crypto.randomUUID(), role: 'user', content, createdAt: new Date().toISOString() }
      const assistant: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: new Date().toISOString(), pending: true }
      this.active.messages.push(user, assistant); this.active.updatedAt = new Date().toISOString()
      await this.requestReply(content, assistant, true)
    },
    async regenerate() {
      if (!this.active || this.loading) return
      const last = this.active.messages.at(-1)
      const previousUser = [...this.active.messages].reverse().find(message => message.role === 'user')
      if (!last || last.role !== 'assistant' || !previousUser) return
      this.active.messages.pop()
      if (api.isTauri) await api.deleteLastAssistant(this.active.id)
      const assistant: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: new Date().toISOString(), pending: true }
      this.active.messages.push(assistant); this.loading = true; this.error = ''
      await this.requestReply(previousUser.content, assistant, false)
    },
    async requestReply(content: string, assistant: Message, persistUser: boolean) {
      if (!this.active) return
      if (!api.isTauri) { setTimeout(() => { assistant.content = '开发预览模式。请使用 `npm run tauri:dev` 启动桌面版并在设置中填入 Anthropic API Key。'; assistant.pending = false; this.loading = false }, 500); return }
      const conversationId = this.active.id
      try { await api.sendMessage(conversationId, content, this.settings, persistUser) } catch (e) { if (this.activeId === conversationId) this.error = String(e); assistant.pending = false; this.loading = false }
    },
    async stop() { if (api.isTauri) await api.stopGeneration(); this.loading = false; const msg = this.active?.messages.at(-1); if (msg) msg.pending = false }
  }
})
