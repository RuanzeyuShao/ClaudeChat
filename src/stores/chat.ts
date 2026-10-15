import { defineStore } from 'pinia'
import { listen } from '@tauri-apps/api/event'
import { providerEntry, preference, type ChatProviderId, type ProviderPreference } from '../chatProviders'
import { api } from '../services/tauri'
import { useUiStore } from './ui'
import { friendlyError } from '../utils/experience'
import { snapshotSettings, identity, connectionChanged } from '../utils/connection'
import { validateSearch } from '../utils/searchPolicy'
import { themeManager, normalizeAppearance, type Appearance } from '../themes/themeManager'
import type { Attachment, Conversation, Message, Settings, ThemeMode, ApiProfile, Usage, Preset, Organization, MessageReference, RequestIdentity, GenerationInfo } from '../types'

const defaultSettings: Settings = { apiKey: '', baseUrl: '', provider: 'anthropic-compatible', model: '', thinking: 'medium', webSearch: true, theme: 'system', colorTheme: 'emerald', systemPrompt: '', profileId: '', searchMode: 'auto', searchProvider: 'claude', searchBaseUrl: '', contextMode: 'full', recentTurns: 10, selectedMessageIds: [], selectedAttachmentIds: [] }
const appearanceWrites=new WeakMap<object,Promise<unknown>>()
const listeners: (() => void)[] = []
let frame = 0
const deltas = new Map<string, string>()
export type RequestStatus = 'idle' | 'connecting' | 'searching' | 'thinking' | 'generating' | 'completed' | 'stopped' | 'failed' | 'continuing' | 'incomplete'
interface ReplyBranch { parentId: string | null; rollbackLeaf: string | null; previousMessages?:Message[] }
interface FailedReply {conversationId:string;content:string;attachments:Attachment[];persistUser:boolean;branch:ReplyBranch}
export const useChatStore = defineStore('chat', {
  state: () => ({ conversations: [] as Conversation[], activeId: '' as string, blankConversationId: '', fontSize: 14, appearanceBusy:false, appearanceRevision:0, savedAppearance:null as Appearance|null, settings: { ...defaultSettings }, profiles: [] as ApiProfile[], usage: [] as Usage[], loading: false, error: '', initialized: false, profileBusy: false, activeRequestId:'',requestCompletion:null as GenerationInfo | null,failedReply:null as FailedReply | null,requestSettings:null as Settings | null,requestOrigins:{} as Record<string,RequestIdentity>,pendingOrigins:{} as Record<string,RequestIdentity>, usageOrigins: {} as Record<string,{input:string;output:string;thinking:string}>, status: 'idle' as RequestStatus, stopping: false, sendMode: 'enter' as 'enter' | 'ctrl-enter', drafts: {} as Record<string, { text: string; attachments: Attachment[] }>, providerPreferences: {} as Partial<Record<ChatProviderId, ProviderPreference>>, trees: {} as Record<string, Message[]>, presets: [] as Preset[], organization: {} as Record<string, Organization>, references: [] as MessageReference[] }),
  getters: { active(state): Conversation | undefined { return state.conversations.find(x => x.id === state.activeId) } },
  actions: {
    async initialize() {
      if (this.initialized) return
      this.initialized = true
      themeManager.start();listeners.push(()=>themeManager.stop())
      await this.loadFontSize()
      if (!api.isTauri) {Object.assign(this.settings,themeManager.cached());this.savedAppearance=normalizeAppearance(this.settings);this.applyTheme(this.settings.theme);await this.newConversation();return}
      this.settings = { ...defaultSettings, ...await api.getSettings() }
      Object.assign(this.settings,normalizeAppearance(this.settings));this.savedAppearance=normalizeAppearance(this.settings)
      this.drafts = await api.getExtension<typeof this.drafts>('v4:drafts') || {}
      this.sendMode = await api.getExtension<typeof this.sendMode>('v4:sendMode') || 'enter'
      this.providerPreferences=await api.getExtension<Partial<Record<ChatProviderId,ProviderPreference>>>('v3:chatProviders') || {}; this.presets = await api.getExtension<Preset[]>('v3:presets') || []; this.organization = await api.getExtension<Record<string, Organization>>('v3:organization') || {}; this.profiles = await api.getProfiles(); this.usage = await api.getUsage()
      this.requestOrigins=await api.getExtension<Record<string,RequestIdentity>>('v4:requestOrigins') || {}
      await this.loadUsageOrigins()
      listeners.push(await listen<{id:string;origin:{input:string;output:string;thinking:string}}>('chat-usage-origin',({payload})=>{this.usageOrigins[payload.id]=payload.origin}))
      this.applyTheme(this.settings.theme)
      this.conversations = await api.getConversations()
      this.blankConversationId = await api.getExtension<string>('v5:blankConversation') || ''
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
      listeners.push(await listen<{ conversationId: string; requestId:string; phase: 'connecting' | 'thinking' | 'searching' | 'continuing'; delta?: string }>('chat-status', ({ payload }) => {
        if (!this.loading || this.stopping || this.activeId !== payload.conversationId || payload.requestId!==this.activeRequestId) return
        this.status = payload.phase
        if(payload.phase==='searching'){const message=this.active?.messages.at(-1);if(message?.searchTrace?.status==='allowed')message.searchTrace.status='searching'}
        if (payload.phase==='thinking' && payload.delta) { const message = this.active?.messages.at(-1); if (message?.pending) message.reasoningContent = (message.reasoningContent || '') + payload.delta }
      }))
      listeners.push(await listen<{conversationId:string;requestId:string;trace:Message['searchTrace']}>('chat-search', ({payload})=>{const message=this.active?.messages.at(-1);if(message?.pending && !this.stopping && this.activeId===payload.conversationId && payload.requestId===this.activeRequestId){message.searchTrace=payload.trace; if(payload.trace?.status==='searching')this.status='searching'}}))
      listeners.push(await listen<{ conversationId: string; requestId:string; sources: Message['sources'] }>('chat-sources', ({ payload }) => {
        const message = this.active?.messages.at(-1)
        if (message && this.activeId === payload.conversationId && payload.requestId===this.activeRequestId) message.sources = payload.sources
      }))
      listeners.push(await listen<{conversationId:string;requestId:string;generation:GenerationInfo}>('chat-generation',({payload})=>{if(this.activeId!==payload.conversationId || this.activeRequestId!==payload.requestId)return;this.requestCompletion=payload.generation;const message=this.active?.messages.at(-1);if(message)message.generation=payload.generation}))
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
        const blank=this.conversations.find(c=>c.id===this.blankConversationId)
        if(blank && !(this.trees[blank.id] || blank.messages).length){
          if(api.isTauri)await this.refreshTree(blank.id)
          if(!(this.trees[blank.id] || blank.messages).length){
            if(this.activeId!==blank.id){
              const settings=api.isTauri?await api.selectConversation(blank.id):{...this.settings,selectedMessageIds:[],selectedAttachmentIds:[]}
              this.acceptSettings(settings);this.activeId=blank.id;this.references=[];this.error=''
            }
            return
          }
        }
        const now = new Date().toISOString()
        const item: Conversation = api.isTauri ? await api.createConversation(this.settings.model) : { id: crypto.randomUUID(), title: '准备开始', model: this.settings.model, createdAt: now, updatedAt: now, messages: [], systemPrompt: '' }
        const settings=api.isTauri?await api.selectConversation(item.id):this.settings
        this.acceptSettings(settings);item.model=this.settings.model
        this.conversations.unshift(item);this.references=[];this.settings.selectedMessageIds=[];this.settings.selectedAttachmentIds=[];this.activeId=item.id;this.error='';this.blankConversationId=item.id
        if(api.isTauri)await api.saveExtension('v5:blankConversation',item.id)
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
      const appearance=this.appearanceBusy?normalizeAppearance(this.settings):normalizeAppearance({...settings,colorTheme:settings.colorTheme ?? this.settings.colorTheme})
      this.settings={...settings,...appearance,apiKey:''};this.applyTheme(this.settings.theme)
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
    async loadFontSize() {
      const value=api.isTauri?await api.getExtension<number>('v5:fontSize'):Number(localStorage.getItem('claudechat.fontSize'))
      this.applyFontSize(value ?? 14)
    },
    applyFontSize(value:number) {
      this.fontSize=Number.isFinite(value) && value>=12 && value<=24?Math.round(value):14
      document.documentElement.style.setProperty('--font-scale',String(this.fontSize/14))
    },
    async setFontSize(value:number) {
      if(!Number.isFinite(value) || value<12 || value>24)throw new Error('字体大小须为 12–24 px')
      if(api.isTauri)await api.saveExtension('v5:fontSize',Math.round(value))
      else localStorage.setItem('claudechat.fontSize',String(Math.round(value)))
      this.applyFontSize(value)
    },
    applyTheme(theme: ThemeMode) {themeManager.apply({theme,colorTheme:this.settings.colorTheme})},
    async setAppearance(theme:ThemeMode,colorTheme:Settings['colorTheme']) {
      if(!this.savedAppearance)this.savedAppearance=normalizeAppearance(this.settings)
      const value=normalizeAppearance({theme,colorTheme}),revision=++this.appearanceRevision
      Object.assign(this.settings,value);this.appearanceBusy=true;this.applyTheme(value.theme)
      const previous=appearanceWrites.get(this) || Promise.resolve()
      const request=previous.catch(()=>{}).then(()=>api.isTauri?api.saveAppearance(value):value)
      appearanceWrites.set(this,request)
      try {
        const saved=normalizeAppearance(await request);this.savedAppearance=saved;themeManager.cache(saved)
        if(revision===this.appearanceRevision){Object.assign(this.settings,saved);this.applyTheme(saved.theme)}
      }catch(error){
        if(revision===this.appearanceRevision){Object.assign(this.settings,this.savedAppearance);this.applyTheme(this.settings.theme)}
        throw error
      }finally{if(revision===this.appearanceRevision)this.appearanceBusy=false}
    },
    validateSend() {
      if(api.isTauri && (!this.settings.baseUrl || !this.settings.model))throw new Error('请先在设置中添加并启用 API 配置')
      if(api.isTauri && this.settings.profileId && !this.profiles.find(p=>p.id===this.settings.profileId)?.hasKey)throw new Error('当前 API 配置缺少密钥，请在设置中补充 API Key')
      validateSearch(this.settings)
    },
    async send(content: string, attachments: Attachment[] = [], branch?: ReplyBranch) {
      if (!this.active || this.loading || this.profileBusy || (!content.trim() && !attachments.length)) return
      try{this.validateSend()}catch(e){this.error=friendlyError(e);return}
      if(branch){
        const branchParent=branch.parentId
        const index=branchParent===null?-1:this.active.messages.findIndex(m=>m.id===branchParent)
        if(branch.parentId!==null && index<0){this.error='原消息已不在当前对话路径中，请重新选择';return}
        branch={...branch,previousMessages:[...this.active.messages]}
        this.active.messages=this.active.messages.slice(0,index+1)
      }
      this.failedReply=null;this.error = ''; this.loading = true; this.status = 'connecting'; this.stopping = false
      const parentId = this.active.messages.at(-1)?.id || null
      const user: Message = { parentId, references: [...this.references], id: crypto.randomUUID(), role: 'user', content, attachments, createdAt: new Date().toISOString() }
      const assistant: Message = { parentId: user.id, id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: new Date().toISOString(), pending: true }
      this.trees[this.activeId] = [...(this.trees[this.activeId] || this.active.messages), user]; this.active.messages.push(user, assistant); this.active.updatedAt = new Date().toISOString()
      void this.requestReply(content, assistant, true, attachments, branch)
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
      try{this.validateSend()}catch(e){this.error=friendlyError(e);return}
      const last = message || this.active.messages.at(-1); if (!last || last.role !== 'assistant') return
      const parent = this.active.messages.find(m => m.id === last.parentId); if (!parent) return
      const branch:ReplyBranch={parentId:parent.id,rollbackLeaf:this.active.messages.at(-1)?.id || null,previousMessages:[...this.active.messages]}
      const index = this.active.messages.findIndex(m => m.id === parent.id); this.active.messages = this.active.messages.slice(0, index + 1)
      const assistant: Message = {id: crypto.randomUUID(), parentId: parent.id, role: 'assistant', content: '', createdAt: new Date().toISOString(), pending: true}
      this.failedReply=null;this.active.messages.push(assistant); this.loading = true; this.error = ''; this.status='connecting'; this.stopping=false
      await this.requestReply(parent.content, assistant, false, [], branch)
    },
    async editResend(message: Message, edited?: string) {
      if (this.loading || this.profileBusy || !this.active) return
      const conversationId=this.activeId
      const content = edited ?? await useUiStore().request({title:'编辑并创建新分支',value:message.content,multiline:true,confirm:'重发'}); if (content === null || !content.trim()) return
      if(this.activeId!==conversationId || this.loading || this.profileBusy || !this.active)return
      const index=this.active.messages.findIndex(m=>m.id===message.id);if(index<0)return
      try{this.validateSend()}catch(e){this.error=friendlyError(e);return}
      const oldReferences=this.references
      this.references=[...(message.references || [])]
      const accepted=await this.send(content,message.attachments || [],{parentId:this.active.messages[index-1]?.id || null,rollbackLeaf:this.active.messages.at(-1)?.id || null})
      if(!accepted)this.references=oldReferences
      return accepted
    },
    async reSearch(message: Message) {if(this.loading || this.profileBusy)return;const old=this.settings.searchMode;this.settings.searchMode='force';try{if(message.role==='user')await this.editResend(message,message.content);else await this.regenerate(message)}finally{this.settings.searchMode=old}},
    async renameCategory(kind: 'folder' | 'tag', old: string, next: string) {for(const value of Object.values(this.organization)){if(kind==='folder' && value.folder===old)value.folder=next;if(kind==='tag')value.tags=[...new Set((value.tags || []).map(t=>t===old?next:t).filter(Boolean))]}if(api.isTauri)await api.saveExtension('v3:organization',this.organization)},
    async continueReply(message: Message) {
      if(this.loading || this.profileBusy || !this.active || !this.active.messages.some(m=>m.id===message.id))return
      return this.send('请从上一条回答结束处继续生成，避免重复已有内容。',[],{parentId:message.id,rollbackLeaf:this.active.messages.at(-1)?.id || null})
    },
    quote(message: Message, selectedText?: string) { const text = selectedText || message.content; this.references = [{messageId: message.id, text}] },
    async organize(id: string, value: Organization) { const next={...this.organization,[id]:value};if (api.isTauri) await api.saveExtension('v3:organization', next);this.organization=next },
    async savePreset(preset: Preset) { const next=this.presets.filter(p=>p.id!==preset.id);const index=this.presets.findIndex(p=>p.id===preset.id);next.splice(index<0?next.length:index,0,preset);if(api.isTauri)await api.saveExtension('v3:presets',next);this.presets=next },
    async deletePreset(id: string) { const next=this.presets.filter(p=>p.id!==id);if(api.isTauri)await api.saveExtension('v3:presets',next);this.presets=next },
    async applyPreset(id: string) {
      if(this.loading || this.profileBusy)throw new Error('请等待当前操作完成')
      const preset=this.presets.find(p=>p.id===id)
      if(!preset)throw new Error('预设已不存在')
      const conversation=this.active
      if(!conversation)throw new Error('请先选择会话')
      let settings=snapshotSettings(this.settings)
      if(preset.profileId){
        const profile=this.profiles.find(p=>p.id===preset.profileId)
        if(!profile)throw new Error('预设绑定的 API Profile 已删除')
        if(!profile.hasKey)throw new Error('请先为预设绑定的 API 配置填写 API Key')
        settings={...settings,profileId:profile.id,baseUrl:profile.baseUrl,provider:profile.provider,model:profile.model,thinking:profile.thinking,requestOptions:profile.requestOptions,searchModel:''}
        if(['grok','deepseek','openai-compatible'].includes(profile.provider))settings={...settings,searchProvider:'searxng',searchMode:settings.searchBaseUrl?'auto':'off',webSearch:!!settings.searchBaseUrl}
      }else if(preset.profileId==='')settings={...settings,profileId:''}
      if(preset.model!==undefined){if(!preset.model.trim())throw new Error('预设模型 ID 不能为空');settings.model=preset.model.trim()}
      if(preset.profileId && !settings.model.trim())throw new Error('请先为预设绑定的 API 配置选择模型')
      if(preset.thinking)settings.thinking=preset.thinking
      if(preset.searchMode){settings.searchMode=preset.searchMode;settings.webSearch=preset.searchMode!=='off'}
      validateSearch(settings)
      this.profileBusy=true
      try{
        const saved=api.isTauri?await api.applyPresetSettings(settings,conversation.id,preset.systemPrompt):settings
        this.acceptSettings(saved);conversation.model=saved.model
        if(preset.systemPrompt!==undefined)conversation.systemPrompt=preset.systemPrompt
        this.error=''
        return true
      }catch(e){this.error=friendlyError(e);throw e}finally{this.profileBusy=false}
    },
    async requestReply(content: string, assistant: Message, persistUser: boolean, attachments: Attachment[] = [], branch?: ReplyBranch) {
      if (!this.active) return
      const request=snapshotSettings(this.settings)
      this.requestCompletion=null
      this.activeRequestId=assistant.id
      this.requestSettings=request
      this.pendingOrigins[assistant.id]=identity(request,this.profiles.find(p=>p.id===request.profileId)?.name)
      if (!api.isTauri) { assistant.content = '浏览器仅提供界面预览。请启动 Tauri 桌面版并配置 API 后发送消息。'; assistant.pending = false; this.trees[this.activeId] = [...(this.trees[this.activeId] || []), assistant]; this.references = []; this.loading = false; this.requestSettings=null;this.activeRequestId='';this.status='completed'; return }
      const conversationId = this.active.id
      try { const user = this.active.messages.at(-2); const parentId = persistUser ? user?.parentId || null : assistant.parentId || null
        const finished=await api.sendMessage(conversationId, content, request, persistUser, attachments, parentId, persistUser ? user?.references || [] : [],assistant.id)
        this.flushDeltas(); await this.refreshTree(conversationId); this.references = [];const message=this.active?.messages.at(-1);const completion=finished || this.requestCompletion || (message?.usageId?this.requestOrigins[message.usageId]?.generation:undefined);if(message?.role==='assistant' && completion)message.generation=completion;this.status=this.stopping || completion?.status==='stopped'?'stopped':completion && completion.status!=='complete'?'incomplete':'completed'
      } catch (e) {
        this.flushDeltas()
        let restorationError=''
        try{if(branch)await api.selectBranch(conversationId,branch.rollbackLeaf);await this.refreshTree(conversationId)}catch(restore){if(branch?.previousMessages){const conversation=this.conversations.find(c=>c.id===conversationId);if(conversation)conversation.messages=branch.previousMessages}restorationError=`；恢复原路径失败：${friendlyError(restore)}`}
        if(this.activeId===conversationId)this.error=friendlyError(e)+restorationError
        assistant.pending=false;this.status=this.stopping?'stopped':'failed'
        if(branch && !this.stopping)this.failedReply={conversationId,content,attachments,persistUser,branch}
        if(!this.stopping)useUiStore().notify(this.error,'error',()=>{
          if(this.activeId!==conversationId){useUiStore().notify('请先返回原会话重试','info');return}
          if(branch && persistUser)void this.send(content,attachments,branch)
          else if(branch){const original=this.active?.messages.find(m=>m.role==='assistant' && m.parentId===branch.parentId);if(original)void this.regenerate(original)}
          else void this.retry()
        })
      }
      finally { this.loading = false; this.stopping=false;this.requestCompletion=null;this.requestSettings=null;this.activeRequestId='';delete this.pendingOrigins[assistant.id] }
    },
    async retry() { if(this.loading || this.profileBusy)return;const failed=this.failedReply;if(failed && failed.conversationId===this.activeId){if(failed.persistUser){await this.send(failed.content,failed.attachments,failed.branch);return}const original=this.active?.messages.find(m=>m.role==='assistant' && m.parentId===failed.branch.parentId);if(original){await this.regenerate(original);return}}const last=this.active?.messages.at(-1); if(!last)return;try{this.validateSend()}catch(e){this.error=friendlyError(e);return} if(last.role==='assistant')await this.regenerate(last);else if(last.role==='user'){const assistant:Message={id:crypto.randomUUID(),parentId:last.id,role:'assistant',content:'',createdAt:new Date().toISOString(),pending:true};this.active!.messages.push(assistant);this.loading=true;this.stopping=false;this.error='';this.status='connecting';await this.requestReply(last.content,assistant,false)} },
    async stop() { if(!this.loading || this.stopping)return; this.stopping=true; try { if (api.isTauri) { await api.stopGeneration(); return } this.loading = false; this.stopping=false;this.requestSettings=null;this.activeRequestId=''; this.status='stopped'; const msg = this.active?.messages.at(-1); if (msg) msg.pending = false } catch(e){this.stopping=false;useUiStore().failure(e)} }
  }
})
