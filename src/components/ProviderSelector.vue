<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { chatProviders, providerEntry, type ChatProviderId, type ProviderPreference } from '../chatProviders'
import { useChatStore } from '../stores/chat'
import { api } from '../services/tauri'
import type { Capabilities, ProviderKind, ProviderModel } from '../types'

const emit=defineEmits<{configure:[kind:ProviderKind,profileId?:string]}>()
const chat=useChatStore()
const list=ref<HTMLElement>(), panel=ref<HTMLElement>(), queryInput=ref<HTMLInputElement>()
const collapsed=ref(localStorage.getItem('claudechat.providersCollapsed')==='true')
function toggleList(){collapsed.value=!collapsed.value;localStorage.setItem('claudechat.providersCollapsed',String(collapsed.value));if(collapsed.value)close()}
const opened=ref<ChatProviderId|null>(null), busy=ref(false), fetching=ref(false), testing=ref(false), error=ref('')
const position=reactive({left:0,top:0,width:360})
const catalogs=ref<Record<string,ProviderModel[]>>({}), capabilities=ref<Record<string,Capabilities>>({})
const query=ref(''), customModel=ref('')
const draft=reactive<ProviderPreference>({profileId:'',model:'',thinking:'medium',searchMode:'auto',searchProvider:'claude',searchBaseUrl:'',searchModel:''})
const activeId=computed(()=>chat.settings.baseUrl && chat.settings.model ? providerEntry(chat.settings.provider) : null)
const entry=computed(()=>chatProviders.find(p=>p.id===opened.value))
const profiles=computed(()=>chat.profiles.filter(p=>providerEntry(p.provider)===opened.value))
const profile=computed(()=>profiles.value.find(p=>p.id===draft.profileId))
const selectedSettings=computed(()=>profile.value ? {...chat.settings,...draft,baseUrl:profile.value.baseUrl,provider:profile.value.provider,requestOptions:profile.value.requestOptions,apiKey:''} : null)
const modelKey=computed(()=>`${draft.profileId}:${profile.value?.baseUrl || ''}`)
const models=computed(()=>{
 const known=profiles.value.map(p=>({id:p.model,name:p.model}));if(draft.model)known.push({id:draft.model,name:draft.model})
 return [...new Map([...known,...(catalogs.value[modelKey.value] || [])].filter(m=>m.id).map(m=>[m.id,m])).values()].sort((a,b)=>a.id.localeCompare(b.id))
})
const filtered=computed(()=>models.value.filter(m=>`${m.id} ${m.name || ''}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const capability=computed(()=>{const c=capabilities.value[draft.profileId];return c && c.model===draft.model && c.baseUrl===profile.value?.baseUrl && c.provider===profile.value?.provider ? c : null})
const levels=['off','low','medium','high'] as const
const level=computed(()=>Math.max(0,levels.indexOf(draft.thinking)))
const labels={streaming:'流式输出',thinking:'思考',vision:'视觉',tool:'工具',search:'联网搜索'} as const
const status=(s?:string)=>({supported:'已验证',accepted:'已接受',rejected:'请求被拒绝',failed:'失败',unsupported:'不支持',unknown:'未知'}[s || 'unknown'] || '未知')
function dot(id:ChatProviderId){const ps=chat.profiles.filter(p=>providerEntry(p.provider)===id);if(!ps.length)return 'empty';const p=ps.find(p=>p.id===(id===activeId.value?chat.settings.profileId:chat.providerPreferences[id]?.profileId)) || ps[0];const c=capabilities.value[p.id];if(c?.model===p.model && c.baseUrl===p.baseUrl && c.connection==='failed')return 'failed';return p.hasKey?'ready':'configured'}
function place(){const bounds=list.value?.getBoundingClientRect();if(!bounds)return;position.width=Math.min(374,window.innerWidth-24);position.left=Math.max(12,Math.min(bounds.right+10,window.innerWidth-position.width-12));position.top=Math.max(12,Math.min(bounds.top,window.innerHeight-480))}
async function resized(){await nextTick();requestAnimationFrame(place)}
function close(){opened.value=null}
function loadProfile(id:string){const p=profiles.value.find(p=>p.id===id);if(!p)return;const saved=chat.providerPreferences[opened.value!];Object.assign(draft,{profileId:p.id,model:p.model,thinking:p.thinking,searchMode:'auto',searchProvider:chat.settings.searchProvider,searchBaseUrl:chat.settings.searchBaseUrl,searchModel:''},saved?.profileId===p.id?saved:{});if(activeId.value===opened.value && chat.settings.profileId===p.id)Object.assign(draft,{model:chat.settings.model,thinking:chat.settings.thinking,searchMode:chat.settings.searchMode,searchProvider:chat.settings.searchProvider,searchBaseUrl:chat.settings.searchBaseUrl,searchModel:chat.settings.searchModel || ''});if(p.provider==='grok')draft.searchProvider='searxng';query.value='';customModel.value='';error.value=''}
async function open(id:ChatProviderId){if(chat.loading || chat.profileBusy || busy.value)return;if(opened.value===id){close();return}opened.value=id;error.value='';query.value='';const ps=chat.profiles.filter(p=>providerEntry(p.provider)===id);const p=ps.find(p=>p.id===chat.providerPreferences[id]?.profileId) || ps[0];if(p){busy.value=true;try{await chat.activateProvider(id,p.id)}catch(e){error.value=String(e)}finally{busy.value=false}loadProfile(p.id)}else{Object.assign(draft,{profileId:'',model:'',thinking:'medium',searchMode:'auto',searchProvider:'claude',searchBaseUrl:'',searchModel:''})}await nextTick();place();queryInput.value?.focus()}
async function apply(){if(!profile.value || !draft.model.trim() || chat.loading)return;busy.value=true;error.value='';try{await chat.activateProvider(opened.value!,profile.value.id);await chat.saveSettings({...chat.settings,...draft,model:draft.model.trim(),webSearch:draft.searchMode!=='off',apiKey:''});await chat.setModel(draft.model);await chat.rememberProvider();close()}catch(e){error.value=String(e)}finally{busy.value=false}}
async function refreshModels(){const settings=selectedSettings.value;if(!settings)return;const key=modelKey.value;fetching.value=true;error.value='';try{if(!api.isTauri)throw new Error('模型发现需要在桌面应用中运行；可使用已有 Profile 模型或手动输入。');catalogs.value[key]=await api.getProviderModels(settings)}catch(e){error.value=String(e)}finally{fetching.value=false}}
async function detect(){const settings=selectedSettings.value;if(!settings)return;testing.value=true;error.value='';try{capabilities.value[settings.profileId]=await api.detectCapabilities(settings)}catch(e){error.value=String(e)}finally{testing.value=false}}
async function loadCapabilities(){if(!api.isTauri)return;const results=await Promise.allSettled(chat.profiles.map(async p=>({id:p.id,value:await api.getExtension<Capabilities>(`v3:capabilities:${p.id}`)})));for(const result of results)if(result.status==='fulfilled' && result.value.value)capabilities.value[result.value.id]=result.value.value}
watch(()=>chat.profiles,loadCapabilities,{deep:true})
function outside(event:PointerEvent){const target=event.target as Node;if(opened.value && !panel.value?.contains(target) && !list.value?.contains(target))close()}
function escape(event:KeyboardEvent){if(event.key==='Escape' && opened.value){const id=opened.value;close();list.value?.querySelector<HTMLButtonElement>(`[data-provider="${id}"]`)?.focus()}}
function openCurrent(){const id=activeId.value || providerEntry(chat.settings.provider);if(opened.value===id){place();return}collapsed.value=false;localStorage.setItem('claudechat.providersCollapsed','false');void open(id)}
onMounted(()=>{void loadCapabilities();document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);window.addEventListener('resize',resized);window.addEventListener('chat-provider-config',openCurrent)})
onUnmounted(()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',resized);window.removeEventListener('chat-provider-config',openCurrent)})
</script>

<template>
 <section ref="list" class="chat-provider-selector" aria-label="聊天服务">
  <button class="provider-section-toggle" aria-label="折叠或展开聊天服务" :aria-expanded="!collapsed" aria-controls="chat-provider-list" @click="toggleList"><span class="provider-section-label">聊天服务</span><span aria-hidden="true">{{ collapsed ? '›' : '⌄' }}</span></button><div v-show="!collapsed" id="chat-provider-list">
  <button v-for="p in chatProviders" :key="p.id" class="chat-provider-row" :class="{selected:activeId===p.id,expanded:opened===p.id}" :style="{'--provider-accent':p.color}" :data-provider="p.id" :aria-label="p.name" :aria-current="activeId===p.id?'true':undefined" :aria-expanded="opened===p.id" aria-controls="chat-provider-panel" :disabled="chat.loading || chat.profileBusy || busy" @click="open(p.id)">
   <span class="provider-mark" aria-hidden="true">{{ p.mark }}</span><span class="provider-name">{{ p.name }}</span><span class="provider-status" :class="dot(p.id)" :title="dot(p.id)==='ready'?'已配置密钥':dot(p.id)==='empty'?'尚未配置':'配置状态待检测'"/><span class="provider-chevron" aria-hidden="true">›</span>
  </button></div>
 </section>
 <Teleport to="body"><section v-if="opened && entry" id="chat-provider-panel" ref="panel" role="dialog" :aria-label="`${entry.name} 配置`" class="chat-provider-panel" :style="{left:`${position.left}px`,top:`${position.top}px`,width:`${position.width}px`,maxHeight:`calc(100vh - ${position.top+12}px)`,'--provider-accent':entry.color}">
  <header><div><span class="provider-mark">{{ entry.mark }}</span><strong>{{ entry.name }}</strong></div><button aria-label="关闭服务配置" class="provider-icon-button" @click="close">×</button></header>
  <div class="provider-panel-scroll">
   <label class="provider-field">API 配置<select :value="draft.profileId" :disabled="busy || testing" @change="loadProfile(($event.target as HTMLSelectElement).value)"><option value="" disabled>选择 API 配置</option><option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
   <div v-if="!profiles.length" class="provider-empty"><strong>连接你的 {{ entry.name }}</strong><p>添加 API 配置后，即可选择模型并开始聊天。</p><button class="provider-primary" @click="emit('configure',entry.kind,'new');close()">添加 API 配置</button></div>
   <template v-else>
    <div class="provider-model-heading"><span>对话模型</span><button class="provider-text-button" :disabled="fetching || testing" @click="refreshModels">{{ fetching?'获取中…':'↻ 刷新列表' }}</button></div>
    <label class="provider-model-search"><span aria-hidden="true">⌕</span><input ref="queryInput" v-model="query" type="search" placeholder="搜索模型…" aria-label="搜索对话模型"/></label>
    <div class="provider-model-list" role="group" aria-label="模型列表"><button v-for="m in filtered" :key="m.id" :class="{chosen:draft.model===m.id}" @click="draft.model=m.id"><span><strong>{{ m.name || m.id }}</strong><small v-if="m.name && m.name!==m.id">{{ m.id }}</small></span><span v-if="draft.model===m.id">✓</span></button><p v-if="!filtered.length" class="provider-muted">无匹配模型，可手动添加。</p></div>
    <form class="provider-custom-model" @submit.prevent="customModel.trim() && (draft.model=customModel.trim());customModel=''"><input v-model="customModel" aria-label="自定义对话模型" placeholder="自定义模型 ID"/><button type="submit" :disabled="!customModel.trim()">选择</button></form>
    <section class="provider-detail-section"><div class="provider-model-heading"><span>思考强度</span><strong>{{ draft.thinking }}</strong></div><input class="provider-thinking-range" aria-label="思考强度" type="range" min="0" max="3" :value="level" @input="draft.thinking=levels[Number(($event.target as HTMLInputElement).value)] || 'off'"/><div class="provider-range-labels"><span>更快 · Off</span><span>更深入 · High</span></div></section>
    <section class="provider-detail-section"><div class="provider-model-heading"><span>联网搜索</span></div><div class="provider-search-modes" role="group" aria-label="联网搜索模式"><button v-for="(name,id) in {off:'关闭',auto:'自动',force:'始终搜索'}" :key="id" :class="{chosen:draft.searchMode===id}" @click="draft.searchMode=id">{{ name }}</button></div><label class="provider-field">搜索服务<select v-model="draft.searchProvider"><option value="claude" :disabled="profile?.provider==='grok'">当前 Chat 内置搜索</option><option value="searxng">SearXNG</option></select></label><label v-if="draft.searchProvider==='searxng'" class="provider-field">搜索地址<input v-model.trim="draft.searchBaseUrl" placeholder="SearXNG 实例地址"/></label><label v-else class="provider-field">搜索模型<input v-model.trim="draft.searchModel" list="provider-search-models" placeholder="留空使用对话模型"/><datalist id="provider-search-models"><option v-for="m in models" :key="m.id" :value="m.id"/></datalist></label><p class="provider-muted">{{ draft.searchProvider==='searxng'?'由搜索服务检索资料，对话模型组织回答。':'搜索模型需支持内置联网搜索，费用按实际调用模型统计。' }}</p></section>
    <section class="provider-detail-section"><div class="provider-model-heading"><span>能力状态</span><button class="provider-text-button" :disabled="testing || busy || !draft.model" @click="detect">{{ testing?'检测中…':'测试连接' }}</button></div><div class="provider-capabilities"><span v-for="(name,key) in labels" :key="key" :class="{verified:capability?.[key]==='supported'}">{{ name }} · {{ status(capability?.[key]) }}</span><span>上下文 · {{ capability?.contextLength?.toLocaleString() || '未知' }}</span></div><p class="provider-muted">{{ capability ? `检测模型 ${capability.model} · ${new Date(capability.checkedAt).toLocaleString()}` : '切换模型后需重新检测，未知状态不会被当作已支持。' }}</p><p v-if="testing" class="provider-muted">检测会产生少量 API 用量。</p></section>
   </template><p v-if="error" class="provider-panel-error" role="alert">{{ error }}</p>
  </div>
  <footer><button class="provider-text-button" @click="emit('configure',entry.kind,draft.profileId || 'new');close()">管理 API 配置</button><button class="provider-primary" :disabled="!profile || !draft.model.trim() || busy || testing || chat.loading" @click="apply">{{ busy?'应用中…':'应用配置' }}</button></footer>
 </section></Teleport>
</template>
