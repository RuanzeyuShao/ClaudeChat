<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import ApiProfileManager from './ApiProfileManager.vue'
import PresetManager from './PresetManager.vue'
import PersonalizationPanel from './PersonalizationPanel.vue'
import { useChatStore } from '../stores/chat'
import type { ProviderKind } from '../types'
import { useUiStore } from '../stores/ui'
import { friendlyError } from '../utils/experience'
import { builtinSearchHelp, hasBuiltinSearchRoute } from '../utils/searchPolicy'
import { api } from '../services/tauri'
import { X } from '@lucide/vue'

defineProps<{initialProvider?:ProviderKind;initialProfileId?:string}>()
const emit=defineEmits<{close:[]}>()
const chat=useChatStore(), root=ref<HTMLElement>()
const ui=useUiStore(), presetManager=ref<InstanceType<typeof PresetManager>>()
const manager=ref<InstanceType<typeof ApiProfileManager>>()
const tab=ref<'api'|'presets'|'preferences'|'personalization'>('api')
const form=reactive({autoContinuations:chat.settings.autoContinuations ?? 1,autoRecoveries:chat.settings.autoRecoveries ?? 0,theme:chat.settings.theme,fontSize:chat.fontSize,sendMode:chat.sendMode,systemPrompt:chat.settings.systemPrompt,searchProvider:chat.settings.searchProvider,searchBaseUrl:chat.settings.searchBaseUrl})
const baseline=ref(JSON.stringify(form)), saving=ref(false), error=ref(''), saved=ref(false), discardOpen=ref(false)
let nextAction:(()=>void)|undefined
const dirty=computed(()=>JSON.stringify(form)!==baseline.value)
function guard(action:()=>void){
 if(saving.value || manager.value?.busy || presetManager.value?.busy)return
 const leave=()=>{if(dirty.value){nextAction=action;discardOpen.value=true}else action()}
 if(tab.value==='api')manager.value?.requestLeave(leave);else if(tab.value==='presets')void presetManager.value?.requestLeave(leave);else leave()
}
function close(){guard(()=>emit('close'))}
function switchTab(value:typeof tab.value){if(value===tab.value)return;guard(()=>{tab.value=value})}
function discard(){Object.assign(form,JSON.parse(baseline.value));discardOpen.value=false;const action=nextAction;nextAction=undefined;action?.()}
async function savePreferences(){saving.value=true;error.value='';saved.value=false;try{const original=JSON.parse(baseline.value);const changes=Object.fromEntries(Object.entries(form).filter(([key,value])=>key!=='sendMode' && key!=='fontSize' && key!=='theme' && original[key]!==value));await chat.saveSettings({...chat.settings,...changes,apiKey:''},chat.activeId || undefined);if(form.theme!==chat.settings.theme)await chat.setAppearance(form.theme,chat.settings.colorTheme);await chat.setSendMode(form.sendMode);await chat.setFontSize(form.fontSize);syncPreferences();saved.value=true;ui.notify('偏好已保存')}catch(e){error.value=friendlyError(e);ui.failure(e)}finally{saving.value=false}}
function syncPreferences(){Object.assign(form,{autoContinuations:chat.settings.autoContinuations ?? 1,autoRecoveries:chat.settings.autoRecoveries ?? 0,theme:chat.settings.theme,fontSize:chat.fontSize,sendMode:chat.sendMode,systemPrompt:chat.settings.systemPrompt,searchProvider:chat.settings.searchProvider,searchBaseUrl:chat.settings.searchBaseUrl});baseline.value=JSON.stringify(form)}
watch(()=>[chat.fontSize,chat.settings.theme,chat.settings.systemPrompt,chat.settings.searchProvider,chat.settings.searchBaseUrl],()=>{if(!dirty.value)syncPreferences()})
async function cleanup(){try{await chat.persistDrafts();const count=api.isTauri?await api.cleanupData():0;ui.notify(`已清理 ${count} 条未引用数据`)}catch(e){ui.failure(e)}}
async function clearAll(){
 if(chat.loading || chat.profileBusy)return
 if(await ui.request({title:'清空全部数据？',description:'全部会话、附件、API 配置、密钥、偏好和用量记录将永久删除。',danger:true,confirm:'继续'})===null)return
 if(await ui.request({title:'最后确认',description:'输入“清空”以永久删除全部本地数据。',value:'',danger:true,confirm:'永久删除'})!=='清空')return
 try{if(api.isTauri)await api.clearAllData();chat.drafts={};chat.conversations=[];chat.activeId='';localStorage.clear();window.location.reload()}catch(e){ui.failure(e)}
}
function keyboard(event:KeyboardEvent){
 if(event.key==='Escape' && !event.isComposing){event.preventDefault();event.stopPropagation();if(manager.value?.confirmOpen)manager.value.cancelModal();else if(discardOpen.value)discardOpen.value=false;else close()}
 if(event.key==='Tab'){
  const region=root.value?.querySelector<HTMLElement>('[role="alertdialog"]') || root.value
  const nodes=Array.from(region?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || []).filter(node=>node.offsetParent!==null && node.tabIndex>=0)
  const first=nodes[0],last=nodes.at(-1);if(!first)return
  if(event.shiftKey && (document.activeElement===first || !region?.contains(document.activeElement))){event.preventDefault();last?.focus()}
  else if(!event.shiftKey && (document.activeElement===last || !region?.contains(document.activeElement))){event.preventDefault();first.focus()}
 }
}
onMounted(async()=>{await nextTick();root.value?.focus()})
</script>
<template>
 <div class="api-settings-backdrop" @click.self="close"><section ref="root" class="api-settings" role="dialog" aria-modal="true" aria-labelledby="api-settings-title" tabindex="-1" @keydown="keyboard">
  <header class="api-settings-header"><div><h2 id="api-settings-title">设置</h2><p>管理你的聊天连接与偏好</p></div><button type="button" class="icon-button" aria-label="关闭设置" :disabled="saving || manager?.busy" @click="close"><X :size="18"/></button></header>
  <nav class="api-settings-tabs" aria-label="设置分类"><button :class="{active:tab==='api'}" :aria-current="tab==='api'?'page':undefined" @click="switchTab('api')">API 配置 <span>{{ chat.profiles.length }}</span></button><button :class="{active:tab==='presets'}" @click="switchTab('presets')">Prompt 预设</button><button :class="{active:tab==='preferences'}" @click="switchTab('preferences')">通用偏好</button><button :class="{active:tab==='personalization'}" @click="switchTab('personalization')">个性化</button></nav>
  <PersonalizationPanel v-if="tab==='personalization'"/>
  <ApiProfileManager v-show="tab==='api'" ref="manager" :initial-provider="initialProvider" :initial-profile-id="initialProfileId"/>
  <div v-show="tab==='presets'" class="api-settings-secondary"><h3>Prompt / Persona</h3><p class="api-help">保存常用提示词，按需绑定模型和 API 配置。</p><PresetManager ref="presetManager"/></div>
  <div v-show="tab==='preferences'" class="api-settings-secondary"><form @submit.prevent="savePreferences"><fieldset :disabled="saving"><h3>外观与默认行为</h3><label>自动续写次数（额外计费）<input v-model.number="form.autoContinuations" type="number" min="0" max="2"/></label><label>自动恢复次数（额外计费）<input v-model.number="form.autoRecoveries" type="number" min="0" max="3"/></label><p class="api-help">默认自动续写 1 次、自动恢复 0 次，达到上限后可手动继续生成。</p><label>主题<select v-model="form.theme"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label>字体大小（px）<input v-model.number="form.fontSize" type="number" min="12" max="24" step="1" aria-label="字体大小"/></label><p class="hint">12–24 px，默认 14 px。保存后调整界面、消息与输入框文字，并在下次启动时自动恢复。</p><label>发送方式<select v-model="form.sendMode"><option value="enter">Enter 发送，Shift+Enter 换行</option><option value="ctrl-enter">Ctrl+Enter 发送，Enter 换行</option></select></label><label>全局 System Prompt<textarea v-model="form.systemPrompt" rows="4" placeholder="为所有对话设置默认提示词…"/></label><label>默认搜索服务<select v-model="form.searchProvider"><option value="claude" :disabled="!hasBuiltinSearchRoute(chat.settings.provider)">Provider API 内置搜索（需支持）</option><option value="searxng">SearXNG 实例</option></select></label><p class="hint">{{ builtinSearchHelp(chat.settings.provider) }}</p><p class="hint">搜索服务跟随当前 Provider。保存服务后，还需在输入框选择“自动联网”或“始终联网”；SearXNG 由独立实例检索资料，可配合任意模型。</p><label v-if="form.searchProvider==='searxng'">SearXNG 地址<input v-model.trim="form.searchBaseUrl" placeholder="https://search.example.com"/></label></fieldset><p v-if="error" class="api-error" role="alert">{{ error }}</p><p v-if="saved && !dirty" class="api-success" role="status">偏好已保存。</p><button class="api-primary" :disabled="saving || !dirty" type="submit">{{ saving?'保存中…':'保存偏好' }}</button></form><div class="data-maintenance"><h3>本地数据维护</h3><p class="api-help">删除会话保留历史用量账单；清空全部数据会同时移除聊天、附件、配置、密钥和用量。</p><button class="secondary" :disabled="chat.loading" @click="cleanup">清理未引用附件和来源</button><button class="danger-button" :disabled="chat.loading" @click="clearAll">清空全部数据</button></div></div>
  <div v-if="discardOpen" class="api-confirm-backdrop"><section class="api-confirm" role="alertdialog" aria-modal="true" aria-labelledby="preferences-discard-title"><h3 id="preferences-discard-title">偏好尚未保存</h3><p>继续离开将放弃刚才的偏好修改。</p><footer><button class="api-secondary" @click="discardOpen=false">继续编辑</button><button class="api-primary" @click="discard">放弃修改并继续</button></footer></section></div>
 </section></div>
</template>
