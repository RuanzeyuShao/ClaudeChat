import { defineStore } from 'pinia'
import { listen } from '@tauri-apps/api/event'
import { providerEntry, preference, type ChatProviderId, type ProviderPreference } from '../chatProviders'
import { api } from '../services/tauri'
import { useUiStore } from './ui'
import { friendlyError } from '../utils/experience'
import { snapshotSettings, identity, connectionChanged } from '../utils/connection'
import { validateSearch } from '../utils/searchPolicy'
import type { Attachment, Conversation, Message, Settings, ThemeMode, ApiProfile, Usage, Preset, Organization, MessageReference, RequestIdentity } from '../types'

const defaultSettings: Settings = { apiKey: '', baseUrl: '', provider: 'anthropic-compatible', model: '', thinking: 'medium', webSearch: true, theme: 'system', systemPrompt: '', profileId: '', searchMode: 'auto', searchProvider: 'claude', searchBaseUrl: '', contextMode: 'full', recentTurns: 10, selectedMessageIds: [], selectedAttachmentIds: [] }
const listeners: (() => void)[] = []
let frame = 0
const deltas = new Map<string, string>()
export type RequestStatus = 'idle' | 'connecting' | 'searching' | 'thinking' | 'generating' | 'completed' | 'stopped' | 'failed'
export const useChatStore = defineStore('chat', {
  state: () => ({ conversations: [] as Conversation[], activeId: '' as string, settings: { ...defaultSettings }, profiles: [] as ApiProfile[], usage: [] as Usage[], loading: false, error: '', initialized: false, profileBusy: false, activeRequestId:'',requestSettings:null as Settings | null,requestOrigins:{} as Record<string,RequestIdentity>,pendingOrigins:{} as Record<string,RequestIdentity>, usageOrigins: {} as Record<string,{input:string;output:string;thinking:string}>, status: 'idle' as RequestStatus, stopping: false, sendMode: 'enter' as 'enter' | 'ctrl-enter', drafts: {} as Record<string, { text: string; attachments: Attachment[] }>, providerPreferences: {} as Partial<Record<ChatProviderId, ProviderPreference>>, trees: {} as Record<string, Message[]>, presets: [] as Preset[], organization: {} as Record<string, Organization>, references: [] as MessageReference[] }),
  getters: { active(state): Conversation | undefined { return state.conversations.find(x => x.id === state.activeId) } },
  actions: {
    async initialize() {
      if (this.initialized) return
      this.initialized = true
      const media=window.matchMedia('(prefers-color-scheme: dark)')
      const onTheme=()=>{if(this.settings.theme==='system')this.applyTheme('system')}
      media.addEventListener('change',onTheme);listeners.push(()=>media.removeEventListener('change',onTheme))
      if (!api.isTauri) {  this.applyTheme(this.settings.theme); await this.newConversation(); return }
      this.settings = { ...defaultSettings, ...await api.getSettings() }
      this.drafts = await api.getExtension<typeof this.drafts>('v4:drafts') || {}
      this.sendMode = await api.getExtension<typeof this.sendMode>('v4:sendMode') || 'enter'
      this.providerPreferences=await api.getExtension<Partial<Record<ChatProviderId,ProviderPreference>>>('v3:chatProviders') || {}; this.presets = await api.getExtension<Preset[]>('v3:presets') || []; this.organization = await api.getExtension<Record<string, Organization>>('v3:organization') || {}; this.profiles = await api.getProfiles(); this.usage = await api.getUsage()
      this.requestOrigins=await api.getExtension<Record<string,RequestIdentity>>('v4:requestOrigins') || {}
      await this.loadUsageOrigins()
      listeners.push(await listen<{id:string;origin:{input:string;output:string;thinking:string}}>('chat-usage-origin',({payload})=>{this.usageOrigins[payload.id]=payload.origin}))
      this.applyTheme(this.settings.theme)
      this.conversations = await api.getConversations()
      const lastId=await api.getExtension<string>('v4:lastConversation')
      if (this.conversations.length) await this.select(this.conversations.some(c=>c.id===lastId)?lastId!:this.conversations[0].id); else await this.newConversation()
      listeners.push(await listen<{id:string;request:RequestIdentity}>('chat-request-origin',({payload})=>{this.requestOrigins[payload.id]=payload.request}))
      listeners.push(await listen<{conversationId:string;requestId:string;request:RequestIdentity}>('chat-request',({payload})=>{if(this.loading && this.activeId===payload.conversationId && payload.requestId===this.activeRequestId && this.requestSettings){Object.assign(this.requestSettings,payload.request);const message=this.active?.messages.at(-1);if(message?.pending)this.pendingOrigins[message.id]=payload.request}}))
      listeners.push(await listen<{ conversationId: string; requestId:string; delta: string }>('chat-delta', ({ payload }) => {
        if (!this.loading || this.stopping || this.activeId !== payload.conversationId || payload.requestId!==this.activeRequestId) return
        this.status = 'generating'
        deltas.set(payload.conversationId, (deltas.get(payload.conversationId) || '') + payload.delta)
        if (!frame) frame = requestAnimationFrame(() => this.flushDeltas())
      }))
      listeners.push(await listen<{ conversationId: string; requestId:string; phase: 'connecting' | 'thinking' | 'searching'; delta?: string }>('chat-status', ({ payload }) => {
        if (!this.loading || this.stopping || this.activeId !== payload.conversationId || payload.requestId!==this.activeRequestId) return
        this.status = payload.phase
        if (payload.delta) { const message = this.active?.messages.at(-1); if (message?.pending) message.reasoningContent = (message.reasoningContent || '') + payload.delta }
      }))
      listeners.push(await listen<{conversationId:string;requestId:string;trace:Message['searchTrace']}>('chat-search', ({payload})=>{const message=this.active?.messages.at(-1);if(message?.pending && !this.stopping && this.activeId===payload.conversationId && payload.requestId===this.activeRequestId){message.searchTrace=payload.trace; if(payload.trace?.status==='searching')this.status='searching'}}))
      listeners.push(await listen<{ conversationId: string; requestId:string; sources: Message['sources'] }>('chat-sources', ({ payload }) => {
        const message = this.active?.messages.at(-1)
        if (message && this.activeId === payload.conversationId && payload.requestId===this.activeRequestId) message.sources = payload.sources
      }))
      listeners.push(await listen<{ usage: Usage }>('chat-usage', ({ payload }) => { if (!this.usage.some(item => item.id === payload.usage.id)) this.usage.unshift(payload.usage) }))
      listeners.push(await listen<{ conversationId: string; title: string }>('conversation-title', ({ payload }) => { const item = this.conversations.find(value => value.id === payload.conversationId); if (item) item.title = payload.title }))
      listeners.push(await listen<{conversationId:string;requestId:string}>('chat-request-finished', ({ payload }) => { if(payload.requestId!==this.activeRequestId)return;this.flushDeltas(); const msg = this.conversations.find(item => item.id === payload.conversationId)?.messages.at(-1); if (msg) msg.pending = false }))
      // The invoke rejection is the single error owner, avoiding duplicate Toasts.
    },
    flushDeltas() {
      cancelAnimationFrame(frame); frame = 0
      for (const [id, delta] of deltas) { const message = this.conversations.find(c => c.id === id)?.messages.at(-1); if (message) message.content += delta }
      deltas.clear()
    },
    dispose() { this.flushDeltas(); listeners.splice(0).forEach(unlisten => unlisten()); if(this.loading)void this.stop(); this.initialized=false },
    async persistDrafts() { if (api.isTauri) await api.saveExtension('v4:drafts', this.drafts) },
    async setSendMode(mode: 'enter' | 'ctrl-enter') { if (api.isTauri) await api.saveExtension('v4:sendMode',mode); this.sendMode=mode },
    async applyProviderPreference(id: ChatProviderId, value: ProviderPreference) {
      if (this.loading || this.profileBusy) throw new Error('请等待当前操作完成')
      const profile = this.profiles.find(p => p.id === value.profileId && providerEntry(p.provider) === id)
      if (!profile?.hasKey) throw new Error('请先为此 API 配置填写 API Key')
      if (!value.model.trim()) throw new Error('请输入模型 ID')
      if (value.searchMode !== 'off' && value.searchProvider === 'searxng' && !value.searchBaseUrl.trim()) throw new Error('请填写搜索地址，或关闭联网搜索')
      const previous = preference(this.settings), previousId = providerEntry(this.settings.provider)
      this.profileBusy = true
      try {
        await this.saveSettings({ ...this.settings, ...value, model:value.model.trim(), baseUrl:profile.baseUrl, provider:profile.provider, requestOptions:profile.requestOptions, webSearch:value.searchMode!=='off', apiKey:'' },this.activeId || undefined)
        if (this.active) this.active.model = this.settings.model
        if (previous.profileId) this.providerPreferences[previousId] = previous
        this.providerPreferences[providerEntry(this.settings.provider)] = preference(this.settings)
        if (api.isTauri) { try { await api.saveExtension('v3:chatProviders',this.providerPreferences) } catch { useUiStore().notify('连接已应用，但服务偏好未保存。','info') } }
      } finally { this.profileBusy=false }
    },
    async newConversation() {
      if (this.loading || this.profileBusy) return
      this.profileBusy=true
      try{
        const now = new Date().toISOString()
        const item: Conversation = api.isTauri ? await api.createConversation(this.settings.model) : { id: crypto.randomUUID(), title: '准备开始', model: this.settings.model, createdAt: now, updatedAt: now, messages: [], systemPrompt: '' }
        const settings=api.isTauri?await api.selectConversation(item.id):this.settings
        this.acceptSettings(settings);item.model=this.settings.model
        this.conversations.unshift(item);this.references=[];this.settings.selectedMessageIds=[];this.settings.selectedAttachmentIds=[];this.activeId=item.id;this.error=''
      }finally{this.profileBusy=false}
    },
    async select(id:string) {
      if(this.loading || this.profileBusy || !this.conversations.some(c=>c.id===id))return
      this.profileBusy=true
      try{const settings=api.isTauri?await api.selectConversation(id):{...this.settings,selectedMessageIds:[],selectedAttachmentIds:[]};this.acceptSettings(settings);this.activeId=id;this.references=[];this.error='';if(this.active)this.active.model=this.settings.model;if(api.isTauri)await this.refreshTree(id)}finally{this.profileBusy=false}
    },
    async remove(id: string) { if (this.loading || this.profileBusy) return; if (api.isTauri) await api.deleteConversation(id); this.conversations = this.conversations.filter(x => x.id !== id);delete this.trees[id];delete this.organization[id];delete this.drafts[id];void this.persistDrafts().catch(useUiStore().failure);if(api.isTauri)await api.saveExtension('v3:organization',this.organization); if (this.activeId === id) this.activeId = ''; if (!this.conversations.length) await this.newConversation(); else if (!this.activeId) await this.select(this.conversations[0].id) },
    async rename(id: string, title: string) { if (api.isTauri) await api.renameConversation(id, title); const item = this.conversations.find(x => x.id === id); if (item) item.title = title },
    async setConversationPrompt(prompt: string) { if (!this.active) return; const item=this.active;if (api.isTauri) await api.setConversationPrompt(item.id, prompt);item.systemPrompt = prompt },
    async setModel(model: string) {
      const clean=model.trim();if(!clean)return
      await this.saveSettings({...this.settings,model:clean},this.activeId || undefined)
      if(this.active)this.active.model=clean
    },
    async setThinking(value: number) {
      await this.saveSettings({...this.settings,thinking:(['off','low','medium','high'] as const)[value] ?? 'off'},this.activeId || undefined)
    },
    async saveSettings(settings:Settings,conversationId?:string) {
      if(this.loading && connectionChanged(this.settings,settings))throw new Error('回答正在生成，请先停止或等待完成后应用配置')
      if(connectionChanged(this.settings,settings))validateSearch(settings)
      const saved=api.isTauri?await api.saveSettings(snapshotSettings(settings),conversationId):snapshotSettings(settings)
      this.acceptSettings(saved)
    },
    acceptSettings(settings:Settings){
      this.settings={...settings,apiKey:''};this.applyTheme(settings.theme)
      const profile=this.profiles.find(p=>p.id===settings.profileId)
      if(profile){profile.provider=settings.provider;profile.baseUrl=settings.baseUrl;profile.requestOptions=settings.requestOptions}
    },
    async refreshProfiles() { if (api.isTauri) this.profiles = await api.getProfiles() },
    async loadUsageOrigins() { if(api.isTauri)this.usageOrigins=await api.getExtension<typeof this.usageOrigins>('v4:usageOrigins') || {} },
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
      try{validateSearch(this.settings)}catch(e){this.error=friendlyError(e);return}
      this.error = ''; this.loading = true; this.status = 'connecting'; this.stopping = false
      const parentId = this.active.messages.at(-1)?.id || null
      const user: Message = { parentId, references: [...this.references], id: crypto.randomUUID(), role: 'user', content, attachments, createdAt: new Date().toISOString() }
      const assistant: Message = { parentId: user.id, id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: new Date().toISOString(), pending: true }
      this.trees[this.activeId] = [...(this.trees[this.activeId] || this.active.messages), user]; this.active.messages.push(user, assistant); this.active.updatedAt = new Date().toISOString()
      void this.requestReply(content, assistant, true, attachments)
      return true
    },
    async refreshTree(id: string) {
      const tree = await api.getTree(id); this.trees[id] = tree.messages
      const item = this.conversations.find(c => c.id === id); if (!item) return
      const path: Message[] = []; let cursor = tree.leaf; const seen = new Set<string>()
      while (cursor && !seen.has(cursor)) { seen.add(cursor); const node = tree.messages.find(m => m.id === cursor); if (!node) break; path.unshift(node); cursor = node.parentId || null }
      item.messages = path
    },
    async jumpNode(id: string) { if (this.loading || this.profileBusy || !this.active) return; if (api.isTauri) {await api.selectBranch(this.activeId,id);await this.refreshTree(this.activeId)} else {const all=this.trees[this.activeId] || [];const path:Message[]=[];let node=all.find(m=>m.id===id);while(node){path.unshift(node);node=all.find(m=>m.id===node?.parentId)}this.active.messages=path} },
    versions(message: Message): Message[] { return (this.trees[this.activeId] || this.active?.messages || []).filter(m => m.role === message.role && (m.parentId || null) === (message.parentId || null)) },
    async selectVersion(message: Message, delta: number) {
      if (this.loading || this.profileBusy || !this.active) return
      const versions = this.versions(message); const index = versions.findIndex(m => m.id === message.id); const node = versions[index + delta]; if (!node) return
      const all = this.trees[this.activeId] || []; let leaf = node
      while (true) { const child = all.filter(m => m.parentId === leaf.id).at(-1); if (!child) break; leaf = child }
      if (api.isTauri) { await api.selectBranch(this.activeId, leaf.id); await this.refreshTree(this.activeId) }
      else { const path: Message[] = []; let current: Message | undefined = leaf; while (current) { path.unshift(current); current = all.find(m => m.id === current?.parentId) } this.active.messages = path }
    },
    async regenerate(message?: Message) {
      if (!this.active || this.loading || this.profileBusy) return
      const last = message || this.active.messages.at(-1); if (!last || last.role !== 'assistant') return
      const parent = this.active.messages.find(m => m.id === last.parentId); if (!parent) return
      const index = this.active.messages.findIndex(m => m.id === parent.id); this.active.messages = this.active.messages.slice(0, index + 1)
      const assistant: Message = {id: crypto.randomUUID(), parentId: parent.id, role: 'assistant', content: '', createdAt: new Date().toISOString(), pending: true}
      this.active.messages.push(assistant); this.loading = true; this.error = ''; this.status='connecting'; this.stopping=false
      await this.requestReply(parent.content, assistant, false)
    },
    async editResend(message: Message, edited?: string) {
      if (this.loading || this.profileBusy || !this.active) return
      const content = edited ?? await useUiStore().request({title:'编辑并创建新分支',value:message.content,multiline:true,confirm:'重发'}); if (content === null || !content.trim()) return
      const index = this.active.messages.findIndex(m => m.id === message.id); this.active.messages = this.active.messages.slice(0, index)
      this.references = [...(message.references || [])]; await this.send(content, message.attachments || [])
    },
    async reSearch(message: Message) {const old=this.settings.searchMode;this.settings.searchMode='force';try{await this.regenerate(message)}finally{this.settings.searchMode=old}},
    async renameCategory(kind: 'folder' | 'tag', old: string, next: string) {for(const value of Object.values(this.organization)){if(kind==='folder' && value.folder===old)value.folder=next;if(kind==='tag')value.tags=[...new Set((value.tags || []).map(t=>t===old?next:t).filter(Boolean))]}if(api.isTauri)await api.saveExtension('v3:organization',this.organization)},
    async continueReply(message: Message) { if (this.loading || this.profileBusy || !this.active) return; const index = this.active.messages.findIndex(m => m.id === message.id); this.active.messages = this.active.messages.slice(0, index + 1); await this.send('请从上一条回答结束处继续生成，避免重复已有内容。') },
    quote(message: Message, selectedText?: string) { const text = selectedText || message.content; this.references = [{messageId: message.id, text}] },
    async organize(id: string, value: Organization) { const next={...this.organization,[id]:value};if (api.isTauri) await api.saveExtension('v3:organization', next);this.organization=next },
    async savePreset(preset: Preset) { const next=this.presets.filter(p=>p.id!==preset.id);const index=this.presets.findIndex(p=>p.id===preset.id);next.splice(index<0?next.length:index,0,preset);if(api.isTauri)await api.saveExtension('v3:presets',next);this.presets=next },
    async deletePreset(id: string) { const next=this.presets.filter(p=>p.id!==id);if(api.isTauri)await api.saveExtension('v3:presets',next);this.presets=next },
    async applyPreset(id: string) { const preset = this.presets.find(p => p.id === id); if (!preset || this.loading) return; if (preset.profileId) {if(!this.profiles.some(p=>p.id===preset.profileId)){this.error='预设绑定的 API Profile 已删除';return}await this.switchProfile(preset.profileId)} else if(preset.profileId==='') await this.saveSettings({...this.settings,profileId:''}); const settings = {...this.settings}; if (preset.thinking) settings.thinking = preset.thinking; if (preset.searchMode) { settings.searchMode = preset.searchMode; settings.webSearch = preset.searchMode !== 'off' } await this.saveSettings(settings); if (preset.model) await this.setModel(preset.model); if (preset.systemPrompt !== undefined) await this.setConversationPrompt(preset.systemPrompt) },
    async requestReply(content: string, assistant: Message, persistUser: boolean, attachments: Attachment[] = []) {
      if (!this.active) return
      const request=snapshotSettings(this.settings)
      this.activeRequestId=assistant.id
      this.requestSettings=request
      this.pendingOrigins[assistant.id]=identity(request,this.profiles.find(p=>p.id===request.profileId)?.name)
      if (!api.isTauri) { assistant.content = '浏览器仅提供界面预览。请启动 Tauri 桌面版并配置 API 后发送消息。'; assistant.pending = false; this.trees[this.activeId] = [...(this.trees[this.activeId] || []), assistant]; this.references = []; this.loading = false; this.requestSettings=null;this.activeRequestId='';this.status='completed'; return }
      const conversationId = this.active.id
      try { const user = this.active.messages.at(-2); const parentId = persistUser ? user?.parentId || null : assistant.parentId || null
        await api.sendMessage(conversationId, content, request, persistUser, attachments, parentId, persistUser ? user?.references || [] : [],assistant.id)
        this.flushDeltas(); await this.refreshTree(conversationId); this.references = []; this.status=this.stopping?'stopped':'completed'
      } catch (e) { this.flushDeltas(); try { await this.refreshTree(conversationId) } catch {} if (this.activeId === conversationId) this.error = friendlyError(e); assistant.pending = false; this.status=this.stopping?'stopped':'failed'; if(!this.stopping)useUiStore().notify(this.error,'error',()=>void this.retry()) }
      finally { this.loading = false; this.stopping=false;this.requestSettings=null;this.activeRequestId='';delete this.pendingOrigins[assistant.id] }
    },
    async retry() { const last=this.active?.messages.at(-1); if(!last || this.loading)return; if(last.role==='assistant')await this.regenerate(last);else if(last.role==='user'){const assistant:Message={id:crypto.randomUUID(),parentId:last.id,role:'assistant',content:'',createdAt:new Date().toISOString(),pending:true};this.active!.messages.push(assistant);this.loading=true;this.stopping=false;this.error='';this.status='connecting';await this.requestReply(last.content,assistant,false)} },
    async stop() { if(!this.loading || this.stopping)return; this.stopping=true; try { if (api.isTauri) { await api.stopGeneration(); return } this.loading = false; this.stopping=false;this.requestSettings=null;this.activeRequestId=''; this.status='stopped'; const msg = this.active?.messages.at(-1); if (msg) msg.pending = false } catch(e){this.stopping=false;useUiStore().failure(e)} }
  }
})
