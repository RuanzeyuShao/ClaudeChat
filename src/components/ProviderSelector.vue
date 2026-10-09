<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { chatProviders, providerEntry, providerLabel, type ChatProviderId, type ProviderPreference } from '../chatProviders'
import { useChatStore } from '../stores/chat'
import { api } from '../services/tauri'
import type { Capabilities, ProviderKind, ProviderModel } from '../types'
import { useUiStore } from '../stores/ui'
import { friendlyError } from '../utils/experience'
import { builtinSearchHelp, hasBuiltinSearchRoute } from '../utils/searchPolicy'
import { X, ChevronRight, ChevronDown, Search, RefreshCw, Check, SlidersHorizontal } from '@lucide/vue'

const emit=defineEmits<{configure:[kind:ProviderKind,profileId?:string]}>()
const chat=useChatStore()
const ui=useUiStore()
const advanced=ref(false)
const list=ref<HTMLElement>(), panel=ref<HTMLElement>(), queryInput=ref<HTMLInputElement>()
const collapsed=ref(localStorage.getItem('claudechat.providersCollapsed')==='true')
function toggleList(){collapsed.value=!collapsed.value;localStorage.setItem('claudechat.providersCollapsed',String(collapsed.value));if(collapsed.value)close()}
const opened=ref<ChatProviderId|null>(null), busy=ref(false), fetching=ref(false), testing=ref(false), error=ref('')
const position=reactive({left:0,top:0,width:360})
const panelOrigin=ref<'sidebar'|'composer'>('sidebar')
const composerAnchor=ref<HTMLElement|null>(null)
const panelHeight=ref(window.innerHeight-24)
let placementFrame=0,panelObserver:ResizeObserver|undefined
const catalogs=ref<Record<string,ProviderModel[]>>({}), capabilities=ref<Record<string,Capabilities>>({})
const query=ref(''), customModel=ref('')
const modelPickerOpen=ref(true), modelToggle=ref<HTMLButtonElement>()
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
function place(){
 const anchor=panelOrigin.value==='composer'?composerAnchor.value:list.value
 if(!anchor || (panelOrigin.value==='composer' && (!anchor.isConnected || anchor.closest<HTMLElement>('.chat-view')?.style.display==='none'))){if(opened.value)close(false);return}
 const bounds=anchor.getBoundingClientRect();position.width=Math.min(panelOrigin.value==='composer'?410:374,window.innerWidth-24)
 if(panelOrigin.value==='composer'){
  position.left=Math.max(12,Math.min(bounds.left,window.innerWidth-position.width-12))
  const above=Math.max(0,bounds.top-20),below=Math.max(0,window.innerHeight-bounds.bottom-20)
  const topSide=above>=Math.min(260,below) || above>=below
  const available=topSide?above:below
  panelHeight.value=Math.min(620,available)
  const scroll=panel.value?.querySelector<HTMLElement>('.provider-panel-scroll')
  const header=panel.value?.querySelector<HTMLElement>('header'),footer=panel.value?.querySelector<HTMLElement>('footer')
  const natural=(scroll?.scrollHeight || 360)+(header?.offsetHeight || 56)+(footer?.offsetHeight || 50)
  const height=Math.min(panelHeight.value,panel.value?.getBoundingClientRect().height || natural)
  position.top=topSide?Math.max(12,bounds.top-8-height):bounds.bottom+8
 }else{
  position.left=Math.max(12,Math.min(bounds.right+10,window.innerWidth-position.width-12));position.top=Math.max(12,Math.min(bounds.top,window.innerHeight-480));panelHeight.value=window.innerHeight-position.top-12
 }
}
async function resized(){await nextTick();cancelAnimationFrame(placementFrame);placementFrame=requestAnimationFrame(place)}
function returnFocus(id:ChatProviderId|null){const trigger=panelOrigin.value==='composer'?composerAnchor.value:list.value?.querySelector<HTMLButtonElement>(`[data-provider="${id}"]`);void nextTick(()=>{if(trigger?.isConnected && trigger.getClientRects().length)trigger.focus({preventScroll:true})})}
function close(restore=true){if(busy.value)return;const id=opened.value;opened.value=null;if(restore)returnFocus(id)}
function loadProfile(id:string){const p=profiles.value.find(p=>p.id===id);if(!p)return;const saved=chat.providerPreferences[opened.value!];const external=['grok','deepseek','openai-compatible'].includes(p.provider);const searchProvider=external?'searxng':(chat.settings.searchProvider==='searxng' && chat.settings.searchBaseUrl.trim()?'searxng':'claude');Object.assign(draft,{profileId:p.id,model:p.model,thinking:p.thinking,searchMode:chat.settings.searchMode,searchProvider,searchBaseUrl:chat.settings.searchBaseUrl,searchModel:''},saved?.profileId===p.id?saved:{});if(activeId.value===opened.value && chat.settings.profileId===p.id)Object.assign(draft,{model:chat.settings.model,thinking:chat.settings.thinking,searchMode:chat.settings.searchMode,searchProvider:chat.settings.searchProvider,searchBaseUrl:chat.settings.searchBaseUrl,searchModel:chat.settings.searchModel || ''});if(external)draft.searchProvider='searxng';if(draft.searchProvider==='searxng' && !draft.searchBaseUrl.trim())draft.searchMode='off';modelPickerOpen.value=true;query.value='';customModel.value='';error.value=''}
async function showProvider(id:ChatProviderId){if(chat.profileBusy || busy.value)return;opened.value=id;modelPickerOpen.value=true;error.value='';query.value='';advanced.value=false;const ps=chat.profiles.filter(p=>providerEntry(p.provider)===id);const p=ps.find(p=>p.id===(activeId.value===id?chat.settings.profileId:chat.providerPreferences[id]?.profileId)) || ps[0];if(p){loadProfile(p.id)}else{Object.assign(draft,{profileId:'',model:'',thinking:'medium',searchMode:'off',searchProvider:'claude',searchBaseUrl:'',searchModel:''})}await nextTick();place();queryInput.value?.focus()}
async function open(id:ChatProviderId){if(chat.profileBusy || busy.value)return;if(opened.value===id && panelOrigin.value==='sidebar'){close();return}panelOrigin.value='sidebar';composerAnchor.value=null;await showProvider(id)}
async function apply(){if(!profile.value || !draft.model.trim() || chat.loading || busy.value || testing.value || chat.profileBusy)return;busy.value=true;error.value='';const id=opened.value;try{await chat.applyProviderPreference(id!,{...draft});opened.value=null;returnFocus(id);ui.notify(`已切换到 ${providerLabel(chat.settings.provider)} · ${chat.settings.model}`)}catch(e){error.value=friendlyError(e);ui.failure(e)}finally{busy.value=false}}
async function selectModel(model:string){
 if(busy.value || testing.value || chat.profileBusy)return
 draft.model=model.trim();error.value='';modelPickerOpen.value=false
 await nextTick();modelToggle.value?.focus({preventScroll:true});void resized()
}
async function selectCustomModel(){const model=customModel.value.trim();if(!model || busy.value || testing.value || chat.profileBusy)return;await selectModel(model);customModel.value=''}
async function toggleModels(){modelPickerOpen.value=!modelPickerOpen.value;await nextTick();if(modelPickerOpen.value)queryInput.value?.focus({preventScroll:true});void resized()}

async function refreshModels(){const settings=selectedSettings.value;if(!settings)return;const key=modelKey.value;fetching.value=true;error.value='';try{if(!api.isTauri)throw new Error('模型发现需要在桌面应用中运行');catalogs.value[key]=await api.getProviderModels(settings)}catch(e){error.value=friendlyError(e);ui.failure(e)}finally{fetching.value=false}}
async function detect(){const settings=selectedSettings.value;if(!settings || testing.value)return;testing.value=true;error.value='';try{capabilities.value[settings.profileId]=await api.detectCapabilities(settings);ui.notify('能力检测已完成')}catch(e){error.value=friendlyError(e);ui.failure(e)}finally{testing.value=false}}
async function loadCapabilities(){if(!api.isTauri)return;const results=await Promise.allSettled(chat.profiles.map(async p=>({id:p.id,value:await api.getExtension<Capabilities>(`v3:capabilities:${p.id}`)})));for(const result of results)if(result.status==='fulfilled' && result.value.value)capabilities.value[result.value.id]=result.value.value}
watch(()=>chat.profiles,loadCapabilities,{deep:true})
function outside(event:PointerEvent){const target=event.target as Node;if(opened.value && !panel.value?.contains(target) && !list.value?.contains(target) && !composerAnchor.value?.contains(target))close(false)}
function escape(event:KeyboardEvent){if(event.isComposing)return;if(event.key==='Escape' && opened.value){event.preventDefault();event.stopPropagation();close()}if(event.key==='Tab' && opened.value){const nodes=Array.from(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') || []).filter(n=>n.offsetParent!==null);if(event.shiftKey && document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1)?.focus()}else if(!event.shiftKey && document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0]?.focus()}}}
async function openCurrent(event:Event){
 if(chat.profileBusy || busy.value)return
 const detail=(event as CustomEvent<{anchor?:HTMLElement;section?:string}>).detail
 const anchor=detail?.anchor || document.querySelector<HTMLElement>('.composer-provider-button');if(!anchor)return
 if(opened.value && panelOrigin.value==='composer' && composerAnchor.value===anchor){close();return}
 panelOrigin.value='composer';composerAnchor.value=anchor;await showProvider(activeId.value || providerEntry(chat.settings.provider))
 if(detail?.section==='thinking'){modelPickerOpen.value=false;await nextTick();const range=panel.value?.querySelector<HTMLInputElement>('.provider-thinking-range');range?.focus({preventScroll:true});range?.scrollIntoView({block:'nearest'});place()}
}
function scrollPosition(event:Event){if(!panel.value?.contains(event.target as Node))void resized()}
watch(panel,node=>{panelObserver?.disconnect();if(node){panelObserver=new ResizeObserver(()=>void resized());panelObserver.observe(node);const box=composerAnchor.value?.closest('.input-box');if(box)panelObserver.observe(box)}},{flush:'post'})
watch(()=>chat.activeId,()=>close(false))
onMounted(()=>{void loadCapabilities();document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);window.addEventListener('resize',resized);window.addEventListener('scroll',scrollPosition,true);window.addEventListener('chat-provider-config',openCurrent)})
onUnmounted(()=>{panelObserver?.disconnect();cancelAnimationFrame(placementFrame);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',resized);window.removeEventListener('scroll',scrollPosition,true);window.removeEventListener('chat-provider-config',openCurrent)})
</script>

<template>
 <section ref="list" class="chat-provider-selector" aria-label="聊天服务">
  <button class="provider-section-toggle" aria-label="折叠或展开聊天服务" :aria-expanded="!collapsed" aria-controls="chat-provider-list" @click="toggleList"><span class="provider-section-label">聊天服务</span><component :is="collapsed?ChevronRight:ChevronDown" :size="14"/></button><div v-show="!collapsed" id="chat-provider-list">
  <button v-for="p in chatProviders" :key="p.id" class="chat-provider-row" :class="{selected:activeId===p.id,expanded:opened===p.id}" :style="{'--provider-accent':p.color}" :data-provider="p.id" :aria-label="p.name" :aria-current="activeId===p.id?'true':undefined" :aria-expanded="opened===p.id" aria-controls="chat-provider-panel" :disabled="chat.profileBusy || busy" @click="open(p.id)">
   <span class="provider-mark" aria-hidden="true">{{ p.mark }}</span><span class="provider-name">{{ p.name }}</span><span class="provider-status" :class="dot(p.id)" :title="dot(p.id)==='ready'?'已配置密钥':dot(p.id)==='empty'?'尚未配置':'配置状态待检测'"/><ChevronRight class="provider-chevron" :size="14"/>
  </button></div>
 </section>
 <Teleport to="body"><section v-if="opened && entry" id="chat-provider-panel" ref="panel" role="dialog" :aria-label="`${entry.name} 配置`" class="chat-provider-panel" :class="{'composer-model-panel':panelOrigin==='composer'}" :style="{left:`${position.left}px`,top:`${position.top}px`,width:`${position.width}px`,maxHeight:`${panelHeight}px`,'--provider-accent':entry.color}">
  <header><div><span class="provider-mark">{{ entry.mark }}</span><strong>{{ entry.name }}</strong></div><button aria-label="关闭服务配置" class="provider-icon-button" @click="close()"><X :size="18"/></button></header>
  <div class="provider-panel-scroll"><fieldset class="provider-controls" :disabled="busy || testing || chat.profileBusy" :aria-busy="busy">
   <div v-if="chat.loading" class="provider-request-lock" role="status"><strong>{{ chat.stopping?'正在停止当前回答…':'当前回答继续使用原模型' }}</strong><p>{{ providerLabel((chat.requestSettings || chat.settings).provider) }} · {{ (chat.requestSettings || chat.settings).model }}</p><p>可以查看并选择下一轮配置；回答结束后才能应用。</p><button class="secondary" :disabled="chat.stopping" @click="chat.stop">{{ chat.stopping?'停止中…':'停止当前生成' }}</button></div>
   <label v-if="panelOrigin==='composer'" class="provider-field composer-service-field">聊天服务<select aria-label="选择聊天服务" :value="opened" :disabled="busy || chat.profileBusy" @change="showProvider(($event.target as HTMLSelectElement).value as ChatProviderId)"><option v-for="service in chatProviders" :key="service.id" :value="service.id">{{ service.name }}</option></select></label>
   <label class="provider-field">API 配置<select :value="draft.profileId" :disabled="busy || testing" @change="loadProfile(($event.target as HTMLSelectElement).value)"><option value="" disabled>选择 API 配置</option><option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
   <div v-if="!profiles.length" class="provider-empty"><strong>连接你的 {{ entry.name }}</strong><p>添加 API 配置后，即可选择模型并开始聊天。</p><button class="provider-primary" @click="emit('configure',entry.kind,'new');close()">添加 API 配置</button></div>
   <template v-else>
    <div class="provider-model-heading"><span>对话模型</span></div><button ref="modelToggle" class="provider-model-toggle" aria-label="选择对话模型" :aria-expanded="modelPickerOpen" aria-controls="provider-model-options" :title="draft.model" @click="toggleModels"><span>{{ draft.model || '选择模型' }}</span><component :is="modelPickerOpen?ChevronDown:ChevronRight" :size="15"/></button><div v-if="modelPickerOpen" id="provider-model-options"><div class="provider-model-heading"><span>可用模型</span><button class="provider-text-button" :disabled="fetching || testing" @click="refreshModels"><RefreshCw :size="13" :class="{spin:fetching}"/>{{ fetching?'获取中…':'刷新列表' }}</button></div>
    <label class="provider-model-search"><Search :size="15"/><input ref="queryInput" v-model="query" type="search" placeholder="搜索模型…" aria-label="搜索对话模型"/></label>

    <div class="provider-model-list" role="group" aria-label="模型列表"><button v-for="m in filtered" :key="m.id" :class="{chosen:draft.model===m.id}" :aria-pressed="draft.model===m.id" @click="selectModel(m.id)"><span><strong>{{ m.name || m.id }}</strong><small v-if="m.name && m.name!==m.id">{{ m.id }}</small></span><Check v-if="draft.model===m.id" :size="15"/></button><p v-if="!filtered.length" class="provider-muted">无匹配模型，可手动添加。</p></div>
    <form class="provider-custom-model" @submit.prevent="selectCustomModel"><input v-model="customModel" aria-label="自定义对话模型" placeholder="自定义模型 ID"/><button type="submit" :disabled="!customModel.trim()">选择</button></form></div><p class="provider-model-help provider-muted">选择模型后仅收起模型列表，配置界面保持打开；所有设置点击“应用配置”后生效。</p><p class="provider-muted" role="status">{{ busy?'正在应用模型配置…':`已选 ${draft.model} · ${chat.settings.profileId===draft.profileId && chat.settings.model===draft.model?'当前使用模型':'待应用模型'}` }}</p>
    <section class="provider-detail-section"><div class="provider-model-heading"><span>思考强度</span><strong>{{ draft.thinking }}</strong></div><input class="provider-thinking-range" aria-label="思考强度" :aria-valuetext="draft.thinking" type="range" min="0" max="3" step="1" :style="{'--thinking-progress':`${level/3*100}%`}" :value="level" @input="draft.thinking=levels[Number(($event.target as HTMLInputElement).value)] || 'off'"/><div class="provider-range-labels"><span>更快 · Off</span><span>更深入 · High</span></div></section>
    <section class="provider-detail-section"><div class="provider-model-heading"><span>联网搜索</span></div><div class="provider-search-modes" role="group" aria-label="联网搜索模式"><button v-for="(name,id) in {off:'关闭',auto:'自动',force:'始终搜索'}" :key="id" :class="{chosen:draft.searchMode===id}" @click="draft.searchMode=id">{{ name }}</button></div></section><details  :open="advanced" @toggle="advanced=($event.target as HTMLDetailsElement).open" class="provider-advanced"><summary><SlidersHorizontal :size="15"/>高级选项</summary><section><p v-if="profile" class="provider-muted">{{ builtinSearchHelp(profile.provider) }}</p><label class="provider-field">搜索服务<select v-model="draft.searchProvider"><option value="claude" :disabled="!profile || !hasBuiltinSearchRoute(profile.provider)">Provider API 内置搜索（需支持）</option><option value="searxng">SearXNG</option></select></label><label v-if="draft.searchProvider==='searxng'" class="provider-field">搜索地址<input v-model.trim="draft.searchBaseUrl" placeholder="SearXNG 实例地址"/></label><label v-else class="provider-field">搜索模型<input v-model.trim="draft.searchModel" list="provider-search-models" placeholder="留空使用对话模型"/><datalist id="provider-search-models"><option v-for="m in models" :key="m.id" :value="m.id"/></datalist></label><p class="provider-muted">{{ draft.searchProvider==='searxng'?'由搜索服务检索资料，对话模型组织回答。':'搜索工具由当前 Provider API 执行，并不使用 Claude 网页账号。费用按实际调用统计。' }}</p></section>
    <section class="provider-detail-section"><div class="provider-model-heading"><span>能力状态</span><button class="provider-text-button" :disabled="testing || busy || chat.loading || !draft.model" @click="detect">{{ testing?'检测中…':'测试连接' }}</button></div><div class="provider-capabilities"><span v-for="(name,key) in labels" :key="key" :class="{verified:capability?.[key]==='supported'}">{{ name }} · {{ status(capability?.[key]) }}</span><span>上下文 · {{ capability?.contextLength?.toLocaleString() || '未知' }}</span></div><p class="provider-muted">{{ capability ? `检测模型 ${capability.model} · ${new Date(capability.checkedAt).toLocaleString()}` : '切换模型后需重新检测，未知状态不会被当作已支持。' }}</p><p v-if="testing" class="provider-muted">检测会产生少量 API 用量。</p></section></details>
   </template><p v-if="error" class="provider-panel-error" role="alert">{{ error }}</p>
  </fieldset></div>
  <footer><button class="provider-text-button" :disabled="busy || testing || chat.profileBusy" @click="emit('configure',entry.kind,draft.profileId || 'new');close()">管理 API 配置</button><button class="provider-primary" :disabled="!profile || !draft.model.trim() || busy || testing || chat.loading || chat.profileBusy" @click="apply">{{ busy?'应用中…':'应用配置' }}</button></footer>
 </section></Teleport>
</template>
