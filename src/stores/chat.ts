import { defineStore } from 'pinia'
import { listen } from '@tauri-apps/api/event'
import { chatProviders, providerEntry, preference, type ChatProviderId, type ProviderPreference } from '../chatProviders'
import { api } from '../services/tauri'
import type { Attachment, Conversation, Message, Settings, ThemeMode, ApiProfile, Usage, Preset, Organization, MessageReference } from '../types'

const defaultSettings: Settings = { apiKey: '', baseUrl: '', provider: 'anthropic-compatible', model: '', thinking: 'medium', webSearch: true, theme: 'system', systemPrompt: '', profileId: '', searchMode: 'auto', searchProvider: 'claude', searchBaseUrl: '', contextMode: 'full', recentTurns: 10, selectedMessageIds: [], selectedAttachmentIds: [] }
export const useChatStore = defineStore('chat', {
  state: () => ({ conversations: [] as Conversation[], activeId: '' as string, settings: defaultSettings, profiles: [] as ApiProfile[], usage: [] as Usage[], loading: false, error: '', initialized: false, profileBusy: false, providerPreferences: {} as Partial<Record<ChatProviderId, ProviderPreference>>, trees: {} as Record<string, Message[]>, presets: [] as Preset[], organization: {} as Record<string, Organization>, references: [] as MessageReference[] }),
  getters: { active(state): Conversation | undefined { return state.conversations.find(x => x.id === state.activeId) } },
  actions: {
    async initialize() {
      if (this.initialized) return
      this.initialized = true
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (this.settings.theme === 'system') this.applyTheme('system') })
      if (!api.isTauri) { if(import.meta.env.DEV && new URLSearchParams(location.search).get('preview')==='providers'){this.profiles=chatProviders.map(p=>({id:`preview-${p.id}`,name:`${p.name} 示例 Profile`,provider:p.kind,baseUrl:'https://demo.invalid/v1',model:'chat-balanced',thinking:'medium',inputPrice:0,outputPrice:0,hasKey:true}));this.settings={...this.settings,profileId:this.profiles[0].id,model:'chat-balanced'};if(new URLSearchParams(location.search).get('theme')==='light')this.settings.theme='light'} this.applyTheme(this.settings.theme); await this.newConversation(); return }
      this.settings = { ...defaultSettings, ...await api.getSettings() }
      this.providerPreferences=await api.getExtension<Partial<Record<ChatProviderId,ProviderPreference>>>('v3:chatProviders') || {}; this.presets = await api.getExtension<Preset[]>('v3:presets') || []; this.organization = await api.getExtension<Record<string, Organization>>('v3:organization') || {}; this.profiles = await api.getProfiles(); this.usage = await api.getUsage()
      this.applyTheme(this.settings.theme)
      this.conversations = await api.getConversations()
      if (this.conversations.length) await this.select(this.conversations[0].id); else await this.newConversation()
      await listen<{ conversationId: string; delta: string }>('chat-delta', ({ payload }) => {
        const message = this.active?.messages.at(-1)
        if (message && this.activeId === payload.conversationId) {message.content += payload.delta;if(message.searchTrace)message.searchTrace.status='generating'}
      })
      await listen<{conversationId:string;trace:Message['searchTrace']}>('chat-search', ({payload})=>{const message=this.active?.messages.at(-1);if(message && this.activeId===payload.conversationId)message.searchTrace=payload.trace})
      await listen<{ conversationId: string; sources: Message['sources'] }>('chat-sources', ({ payload }) => {
        const message = this.active?.messages.at(-1)
        if (message && this.activeId === payload.conversationId) message.sources = payload.sources
      })
      await listen<{ usage: Usage }>('chat-usage', ({ payload }) => { if (!this.usage.some(item => item.id === payload.usage.id)) this.usage.unshift(payload.usage) })
      await listen<{ conversationId: string; title: string }>('conversation-title', ({ payload }) => { const item = this.conversations.find(value => value.id === payload.conversationId); if (item) item.title = payload.title })
      await listen<string>('chat-finished', ({ payload }) => { const msg = this.conversations.find(item => item.id === payload)?.messages.at(-1); if (msg) msg.pending = false })
      await listen<{ conversationId: string; message: string }>('chat-error', ({ payload }) => { if (this.activeId === payload.conversationId) this.error = payload.message; const msg = this.conversations.find(item => item.id === payload.conversationId)?.messages.at(-1); if (msg) msg.pending = false })
    },
    async newConversation() {
      if (this.loading) return
      const now = new Date().toISOString()
      const item: Conversation = api.isTauri ? await api.createConversation(this.settings.model) : { id: crypto.randomUUID(), title: '准备开始', model: this.settings.model, createdAt: now, updatedAt: now, messages: [], systemPrompt: '' }
      this.conversations.unshift(item); this.references=[];this.settings.selectedMessageIds=[];this.settings.selectedAttachmentIds=[]; this.activeId = item.id; this.error = ''
    },
    async select(id: string) { if (this.loading) return; this.references = []; this.activeId = id; this.error = ''; this.settings.selectedMessageIds = []; this.settings.selectedAttachmentIds = []; const item = this.active; if (item) { this.settings.model = item.model; if (api.isTauri) await this.refreshTree(id) } },
    async remove(id: string) { if (this.loading) return; if (api.isTauri) await api.deleteConversation(id); this.conversations = this.conversations.filter(x => x.id !== id);delete this.trees[id];delete this.organization[id];if(api.isTauri)await api.saveExtension('v3:organization',this.organization); if (this.activeId === id) this.activeId = ''; if (!this.conversations.length) await this.newConversation(); else if (!this.activeId) await this.select(this.conversations[0].id) },
    async rename(id: string, title: string) { const item = this.conversations.find(x => x.id === id); if (item) item.title = title; if (api.isTauri) await api.renameConversation(id, title) },
    async setConversationPrompt(prompt: string) { if (!this.active) return; this.active.systemPrompt = prompt; if (api.isTauri) await api.setConversationPrompt(this.active.id, prompt) },
    async setModel(model: string) {
      const clean=model.trim();if(!clean)return
      await this.saveSettings({...this.settings,model:clean},this.activeId || undefined)
      if(this.active)this.active.model=clean
    },
    async setThinking(value: number) {
      this.settings.thinking = (['off', 'low', 'medium', 'high'] as const)[value] ?? 'off'
      if (api.isTauri) await api.saveSettings({ ...this.settings, apiKey: '' })
    },
    async saveSettings(settings: Settings, conversationId?: string) { if (api.isTauri) await api.saveSettings(settings,conversationId); this.settings = {...settings,apiKey:''}; this.applyTheme(settings.theme) },
    async refreshProfiles() { if (api.isTauri) this.profiles = await api.getProfiles() },
    async refreshUsage() { if (!api.isTauri) return; const saved = await api.getUsage(); const byId = new Map([...saved, ...this.usage].map(item => [item.id, item])); this.usage = [...byId.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)) },
    async switchProfile(id: string) {
      if(this.loading)throw new Error('请等待当前回答完成后再切换 API 配置')
      const p=this.profiles.find(x=>x.id===id);if(!p)throw new Error('此 API 配置已不存在，请重新选择')
      if(!p.model.trim())throw new Error('请先为此 API 配置选择默认模型')
      if(!p.hasKey)throw new Error('请先为此 API 配置填写 API Key')
      const external=['grok','deepseek','openai-compatible'].includes(p.provider)
      await this.saveSettings({...this.settings,profileId:p.id,apiKey:'',baseUrl:p.baseUrl,provider:p.provider,model:p.model,thinking:p.thinking,requestOptions:p.requestOptions,searchModel:'',...(external?{searchProvider:'searxng' as const,searchMode:this.settings.searchBaseUrl?'auto' as const:'off' as const,webSearch:!!this.settings.searchBaseUrl}:{})},this.activeId || undefined)
      if(this.active)this.active.model=p.model
    },
    async reloadProfileState() {
      if(!api.isTauri)return
      const [profiles,settings,prefs]=await Promise.all([api.getProfiles(),api.getSettings(),api.getExtension<Partial<Record<ChatProviderId,ProviderPreference>>>('v3:chatProviders')])
      this.profiles=profiles;this.settings={...this.settings,...settings,selectedMessageIds:this.settings.selectedMessageIds,selectedAttachmentIds:this.settings.selectedAttachmentIds};this.providerPreferences=prefs || {}
    },
    async storeProfile(profile:ApiProfile,key:string):Promise<ApiProfile> {
      if(this.loading || this.profileBusy)throw new Error('请等待当前操作完成')
      this.profileBusy=true
      try {
        const runtime={...this.settings};const old=this.profiles.find(p=>p.id===profile.id)
        const connectionChanged=!old || old.baseUrl!==profile.baseUrl || old.provider!==profile.provider || old.model!==profile.model || old.thinking!==profile.thinking || JSON.stringify(old.requestOptions || {})!==JSON.stringify(profile.requestOptions || {})
        const saved=api.isTauri?await api.saveProfile(profile,key):{...profile,hasKey:!!key.trim() || !!this.profiles.find(p=>p.id===profile.id)?.hasKey}
        const index=this.profiles.findIndex(p=>p.id===saved.id);if(index<0)this.profiles.push(saved);else this.profiles[index]=saved
        if(api.isTauri){try{await this.reloadProfileState();if(runtime.profileId===saved.id && !connectionChanged)await this.saveSettings({...this.settings,model:runtime.model,thinking:runtime.thinking})}catch(e){this.error=`配置已保存，但刷新失败：${String(e)}`;if(runtime.profileId===saved.id)this.settings={...runtime,baseUrl:saved.baseUrl,provider:saved.provider,model:connectionChanged?saved.model:runtime.model,thinking:connectionChanged?saved.thinking:runtime.thinking,requestOptions:saved.requestOptions}}}
        else {for(const id of Object.keys(this.providerPreferences) as ChatProviderId[])if(this.providerPreferences[id]?.profileId===saved.id)delete this.providerPreferences[id];if(this.settings.profileId===saved.id)this.settings={...this.settings,baseUrl:saved.baseUrl,provider:saved.provider,model:connectionChanged?saved.model:runtime.model,thinking:connectionChanged?saved.thinking:runtime.thinking,requestOptions:saved.requestOptions}}
        if(this.settings.profileId===saved.id && this.active && this.settings.model)await this.setModel(this.settings.model)
        return saved
      } finally {this.profileBusy=false}
    },
    async useProfile(id:string) {
      if(this.loading || this.profileBusy)throw new Error('请等待当前操作完成')
      this.profileBusy=true
      try {await this.rememberProvider();await this.switchProfile(id);await this.rememberProvider()}finally{this.profileBusy=false}
    },
    async removeProfile(id:string) {
      if(this.loading || this.profileBusy)throw new Error('请等待当前操作完成')
      this.profileBusy=true
      try {if(api.isTauri){await api.deleteProfile(id);await this.reloadProfileState()}else{this.profiles=this.profiles.filter(p=>p.id!==id);for(const key of Object.keys(this.providerPreferences) as ChatProviderId[])if(this.providerPreferences[key]?.profileId===id)delete this.providerPreferences[key];if(this.settings.profileId===id)this.settings={...this.settings,profileId:'',baseUrl:'',model:'',apiKey:'',requestOptions:null,searchMode:'off',searchModel:'',webSearch:false}}}finally{this.profileBusy=false}
    },
    async rememberProvider() {if(!this.settings.profileId)return;this.providerPreferences[providerEntry(this.settings.provider)]=preference(this.settings);if(api.isTauri)await api.saveExtension('v3:chatProviders',this.providerPreferences)},
    async activateProvider(id: ChatProviderId, profileId?: string) {
      if(this.loading || this.profileBusy)return
      await this.rememberProvider();const saved=this.providerPreferences[id];const profiles=this.profiles.filter(p=>providerEntry(p.provider)===id);const profile=profiles.find(p=>p.id===(profileId || saved?.profileId)) || profiles[0];
      if(!profile || !profile.hasKey || !profile.model.trim())return
      await this.switchProfile(profile.id)
      if(profile.provider==='grok' && !saved)await this.saveSettings({...this.settings,searchProvider:'searxng',searchModel:'',searchMode:this.settings.searchBaseUrl?'auto':'off',apiKey:''})
      if(saved && saved.profileId===profile.id){await this.saveSettings({...this.settings,...saved,apiKey:''});if(saved.model)await this.setModel(saved.model)}
      await this.rememberProvider()
    },
    applyTheme(theme: ThemeMode) {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    },
    async send(content: string, attachments: Attachment[] = []) {
      if (!this.active || this.loading || this.profileBusy || (!content.trim() && !attachments.length)) return
      if(api.isTauri && (!this.settings.baseUrl || !this.settings.model)){this.error='请先在设置中添加并启用 API 配置';return}
      if(api.isTauri && this.settings.profileId && !this.profiles.find(p=>p.id===this.settings.profileId)?.hasKey){this.error='当前 API 配置缺少密钥，请在设置中补充 API Key';return}
      this.error = ''; this.loading = true
      const parentId = this.active.messages.at(-1)?.id || null
      const user: Message = { parentId, references: [...this.references], id: crypto.randomUUID(), role: 'user', content, attachments, createdAt: new Date().toISOString() }
      const assistant: Message = { parentId: user.id, id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: new Date().toISOString(), pending: true }
      this.trees[this.activeId] = [...(this.trees[this.activeId] || this.active.messages), user]; this.active.messages.push(user, assistant); this.active.updatedAt = new Date().toISOString()
      await this.requestReply(content, assistant, true, attachments)
    },
    async refreshTree(id: string) {
      const tree = await api.getTree(id); this.trees[id] = tree.messages
      const item = this.conversations.find(c => c.id === id); if (!item) return
      const path: Message[] = []; let cursor = tree.leaf; const seen = new Set<string>()
      while (cursor && !seen.has(cursor)) { seen.add(cursor); const node = tree.messages.find(m => m.id === cursor); if (!node) break; path.unshift(node); cursor = node.parentId || null }
      item.messages = path
    },
    async jumpNode(id: string) { if (this.loading || !this.active) return; if (api.isTauri) {await api.selectBranch(this.activeId,id);await this.refreshTree(this.activeId)} else {const all=this.trees[this.activeId] || [];const path:Message[]=[];let node=all.find(m=>m.id===id);while(node){path.unshift(node);node=all.find(m=>m.id===node?.parentId)}this.active.messages=path} },
    versions(message: Message): Message[] { return (this.trees[this.activeId] || this.active?.messages || []).filter(m => m.role === message.role && (m.parentId || null) === (message.parentId || null)) },
    async selectVersion(message: Message, delta: number) {
      if (this.loading || !this.active) return
      const versions = this.versions(message); const index = versions.findIndex(m => m.id === message.id); const node = versions[index + delta]; if (!node) return
      const all = this.trees[this.activeId] || []; let leaf = node
      while (true) { const child = all.filter(m => m.parentId === leaf.id).at(-1); if (!child) break; leaf = child }
      if (api.isTauri) { await api.selectBranch(this.activeId, leaf.id); await this.refreshTree(this.activeId) }
      else { const path: Message[] = []; let current: Message | undefined = leaf; while (current) { path.unshift(current); current = all.find(m => m.id === current?.parentId) } this.active.messages = path }
    },
    async regenerate(message?: Message) {
      if (!this.active || this.loading) return
      const last = message || this.active.messages.at(-1); if (!last || last.role !== 'assistant') return
      const parent = this.active.messages.find(m => m.id === last.parentId); if (!parent) return
      const index = this.active.messages.findIndex(m => m.id === parent.id); this.active.messages = this.active.messages.slice(0, index + 1)
      const assistant: Message = {id: crypto.randomUUID(), parentId: parent.id, role: 'assistant', content: '', createdAt: new Date().toISOString(), pending: true}
      this.active.messages.push(assistant); this.loading = true; this.error = ''
      await this.requestReply(parent.content, assistant, false)
    },
    async editResend(message: Message, edited?: string) {
      if (this.loading || !this.active) return
      const content = edited ?? window.prompt('编辑并创建新分支', message.content); if (content === null || !content.trim()) return
      const index = this.active.messages.findIndex(m => m.id === message.id); this.active.messages = this.active.messages.slice(0, index)
      this.references = [...(message.references || [])]; await this.send(content, message.attachments || [])
    },
    async reSearch(message: Message) {const old=this.settings.searchMode;this.settings.searchMode='force';try{await this.regenerate(message)}finally{this.settings.searchMode=old}},
    async renameCategory(kind: 'folder' | 'tag', old: string, next: string) {for(const value of Object.values(this.organization)){if(kind==='folder' && value.folder===old)value.folder=next;if(kind==='tag')value.tags=[...new Set((value.tags || []).map(t=>t===old?next:t).filter(Boolean))]}if(api.isTauri)await api.saveExtension('v3:organization',this.organization)},
    async continueReply(message: Message) { if (this.loading || !this.active) return; const index = this.active.messages.findIndex(m => m.id === message.id); this.active.messages = this.active.messages.slice(0, index + 1); await this.send('请从上一条回答结束处继续生成，避免重复已有内容。') },
    quote(message: Message, selectedText?: string) { const text = selectedText || message.content; this.references = [{messageId: message.id, text}] },
    async organize(id: string, value: Organization) { this.organization[id] = value; if (api.isTauri) await api.saveExtension('v3:organization', this.organization) },
    async savePreset(preset: Preset) { const index = this.presets.findIndex(p => p.id === preset.id); if (index >= 0) this.presets[index] = preset; else this.presets.push(preset); if (api.isTauri) await api.saveExtension('v3:presets', this.presets) },
    async deletePreset(id: string) { this.presets = this.presets.filter(p => p.id !== id); if (api.isTauri) await api.saveExtension('v3:presets', this.presets) },
    async applyPreset(id: string) { const preset = this.presets.find(p => p.id === id); if (!preset || this.loading) return; if (preset.profileId) {if(!this.profiles.some(p=>p.id===preset.profileId)){this.error='预设绑定的 API Profile 已删除';return}await this.switchProfile(preset.profileId)} else if(preset.profileId==='') await this.saveSettings({...this.settings,profileId:''}); const settings = {...this.settings}; if (preset.thinking) settings.thinking = preset.thinking; if (preset.searchMode) { settings.searchMode = preset.searchMode; settings.webSearch = preset.searchMode !== 'off' } await this.saveSettings(settings); if (preset.model) await this.setModel(preset.model); if (preset.systemPrompt !== undefined) await this.setConversationPrompt(preset.systemPrompt) },
    async requestReply(content: string, assistant: Message, persistUser: boolean, attachments: Attachment[] = []) {
      if (!this.active) return
      if (!api.isTauri) { setTimeout(() => { assistant.content = '开发预览模式。请使用 `npm run tauri:dev` 启动桌面版并配置 API Profile。'; assistant.pending = false; this.trees[this.activeId] = [...(this.trees[this.activeId] || []), assistant]; this.references = []; this.loading = false }, 500); return }
      const conversationId = this.active.id
      try { const user = this.active.messages.at(-2); const parentId = persistUser ? user?.parentId || null : assistant.parentId || null
        await api.sendMessage(conversationId, content, this.settings, persistUser, attachments, parentId, persistUser ? user?.references || [] : [])
        await this.refreshTree(conversationId); this.references = []; this.loading = false } catch (e) { try { await this.refreshTree(conversationId) } catch {} if (this.activeId === conversationId) this.error = String(e); assistant.pending = false; this.loading = false }
    },
    async stop() { if (api.isTauri) { await api.stopGeneration(); return } this.loading = false; const msg = this.active?.messages.at(-1); if (msg) msg.pending = false }
  }
})
