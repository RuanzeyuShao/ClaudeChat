import { defineStore } from 'pinia'
import { listen } from '@tauri-apps/api/event'
import { api } from '../services/tauri'
import type { Attachment, Conversation, Message, Settings, ThemeMode, ApiProfile, Usage } from '../types'

const defaultSettings: Settings = { apiKey: '', baseUrl: 'https://api.anthropic.com', provider: 'anthropic-compatible', model: 'claude-opus-5-5', thinking: 'medium', webSearch: true, theme: 'system', systemPrompt: '', profileId: '', searchMode: 'auto', searchProvider: 'claude', searchBaseUrl: '', contextMode: 'full', recentTurns: 10, selectedMessageIds: [], selectedAttachmentIds: [] }
export const useChatStore = defineStore('chat', {
  state: () => ({ conversations: [] as Conversation[], activeId: '' as string, settings: defaultSettings, profiles: [] as ApiProfile[], usage: [] as Usage[], loading: false, error: '', initialized: false }),
  getters: { active(state): Conversation | undefined { return state.conversations.find(x => x.id === state.activeId) } },
  actions: {
    async initialize() {
      if (this.initialized) return
      this.initialized = true
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (this.settings.theme === 'system') this.applyTheme('system') })
      if (!api.isTauri) { this.applyTheme(this.settings.theme); await this.newConversation(); return }
      this.settings = { ...defaultSettings, ...await api.getSettings() }
      this.profiles = await api.getProfiles(); this.usage = await api.getUsage()
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
      await listen<{ usage: Usage }>('chat-usage', ({ payload }) => { if (!this.usage.some(item => item.id === payload.usage.id)) this.usage.unshift(payload.usage) })
      await listen<{ conversationId: string; title: string }>('conversation-title', ({ payload }) => { const item = this.conversations.find(value => value.id === payload.conversationId); if (item) item.title = payload.title })
      await listen<string>('chat-finished', ({ payload }) => { this.loading = false; const msg = this.conversations.find(item => item.id === payload)?.messages.at(-1); if (msg) msg.pending = false })
      await listen<{ conversationId: string; message: string }>('chat-error', ({ payload }) => { this.loading = false; if (this.activeId === payload.conversationId) this.error = payload.message; const msg = this.conversations.find(item => item.id === payload.conversationId)?.messages.at(-1); if (msg) msg.pending = false })
    },
    async newConversation() {
      const now = new Date().toISOString()
      const item: Conversation = api.isTauri ? await api.createConversation(this.settings.model) : { id: crypto.randomUUID(), title: '准备开始', model: this.settings.model, createdAt: now, updatedAt: now, messages: [], systemPrompt: '' }
      this.conversations.unshift(item); this.activeId = item.id; this.error = ''
    },
    async select(id: string) { this.activeId = id; this.error = ''; this.settings.selectedMessageIds = []; this.settings.selectedAttachmentIds = []; const item = this.active; if (item) { this.settings.model = item.model; if (api.isTauri) item.messages = await api.getMessages(id) } },
    async remove(id: string) { if (api.isTauri) await api.deleteConversation(id); this.conversations = this.conversations.filter(x => x.id !== id); if (this.activeId === id) this.activeId = ''; if (!this.conversations.length) await this.newConversation(); else if (!this.activeId) await this.select(this.conversations[0].id) },
    async rename(id: string, title: string) { const item = this.conversations.find(x => x.id === id); if (item) item.title = title; if (api.isTauri) await api.renameConversation(id, title) },
    async setConversationPrompt(prompt: string) { if (!this.active) return; this.active.systemPrompt = prompt; if (api.isTauri) await api.setConversationPrompt(this.active.id, prompt) },
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
    async refreshProfiles() { if (api.isTauri) this.profiles = await api.getProfiles() },
    async refreshUsage() { if (!api.isTauri) return; const saved = await api.getUsage(); const byId = new Map([...saved, ...this.usage].map(item => [item.id, item])); this.usage = [...byId.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)) },
    async switchProfile(id: string) { const p = this.profiles.find(x => x.id === id); if (!p) return; await this.saveSettings({ ...this.settings, profileId: p.id, apiKey: '', baseUrl: p.baseUrl, provider: p.provider, model: p.model, thinking: p.thinking }); if (this.active) await this.setModel(p.model) },
    applyTheme(theme: ThemeMode) {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    },
    async send(content: string, attachments: Attachment[] = []) {
      if (!this.active || this.loading || (!content.trim() && !attachments.length)) return
      this.error = ''; this.loading = true
      const user: Message = { id: crypto.randomUUID(), role: 'user', content, attachments, createdAt: new Date().toISOString() }
      const assistant: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: new Date().toISOString(), pending: true }
      this.active.messages.push(user, assistant); this.active.updatedAt = new Date().toISOString()
      await this.requestReply(content, assistant, true, attachments)
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
    async requestReply(content: string, assistant: Message, persistUser: boolean, attachments: Attachment[] = []) {
      if (!this.active) return
      if (!api.isTauri) { setTimeout(() => { assistant.content = '开发预览模式。请使用 `npm run tauri:dev` 启动桌面版并在设置中填入 Anthropic API Key。'; assistant.pending = false; this.loading = false }, 500); return }
      const conversationId = this.active.id
      try { await api.sendMessage(conversationId, content, this.settings, persistUser, attachments) } catch (e) { if (this.activeId === conversationId) this.error = String(e); assistant.pending = false; this.loading = false }
    },
    async stop() { if (api.isTauri) await api.stopGeneration(); this.loading = false; const msg = this.active?.messages.at(-1); if (msg) msg.pending = false }
  }
})
