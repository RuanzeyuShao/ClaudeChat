<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import ApiProfileManager from './ApiProfileManager.vue'
import PresetManager from './PresetManager.vue'
import { useChatStore } from '../stores/chat'
import type { ProviderKind } from '../types'

defineProps<{initialProvider?:ProviderKind;initialProfileId?:string}>()
const emit=defineEmits<{close:[]}>()
const chat=useChatStore(), root=ref<HTMLElement>()
const manager=ref<InstanceType<typeof ApiProfileManager>>()
const tab=ref<'api'|'presets'|'preferences'>('api')
const form=reactive({theme:chat.settings.theme,systemPrompt:chat.settings.systemPrompt,searchProvider:chat.settings.searchProvider,searchBaseUrl:chat.settings.searchBaseUrl})
const baseline=ref(JSON.stringify(form)), saving=ref(false), error=ref(''), saved=ref(false), discardOpen=ref(false)
let nextAction:(()=>void)|undefined
const dirty=computed(()=>JSON.stringify(form)!==baseline.value)
function guard(action:()=>void){
 if(saving.value || manager.value?.busy)return
 const leave=()=>{if(dirty.value){nextAction=action;discardOpen.value=true}else action()}
 if(tab.value==='api')manager.value?.requestLeave(leave);else leave()
}
function close(){guard(()=>emit('close'))}
function switchTab(value:typeof tab.value){if(value===tab.value)return;guard(()=>{tab.value=value})}
function discard(){Object.assign(form,JSON.parse(baseline.value));discardOpen.value=false;const action=nextAction;nextAction=undefined;action?.()}
async function savePreferences(){saving.value=true;error.value='';saved.value=false;try{const original=JSON.parse(baseline.value);const changes=Object.fromEntries(Object.entries(form).filter(([key,value])=>original[key]!==value));await chat.saveSettings({...chat.settings,...changes,apiKey:''});syncPreferences();saved.value=true}catch(e){error.value=String(e)}finally{saving.value=false}}
function syncPreferences(){Object.assign(form,{theme:chat.settings.theme,systemPrompt:chat.settings.systemPrompt,searchProvider:chat.settings.searchProvider,searchBaseUrl:chat.settings.searchBaseUrl});baseline.value=JSON.stringify(form)}
watch(()=>[chat.settings.theme,chat.settings.systemPrompt,chat.settings.searchProvider,chat.settings.searchBaseUrl],()=>{if(!dirty.value)syncPreferences()})
function keyboard(event:KeyboardEvent){
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(manager.value?.confirmOpen)manager.value.cancelModal();else if(discardOpen.value)discardOpen.value=false;else close()}
 if(event.key==='Tab'){
  const region=root.value?.querySelector<HTMLElement>('[role="alertdialog"]') || root.value
  const nodes=Array.from(region?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || []).filter(node=>node.offsetParent!==null)
  const first=nodes[0],last=nodes.at(-1);if(!first)return
  if(event.shiftKey && (document.activeElement===first || !region?.contains(document.activeElement))){event.preventDefault();last?.focus()}
  else if(!event.shiftKey && (document.activeElement===last || !region?.contains(document.activeElement))){event.preventDefault();first.focus()}
 }
}
onMounted(async()=>{await nextTick();root.value?.focus()})
</script>
<template>
 <div class="api-settings-backdrop" @click.self="close"><section ref="root" class="api-settings" role="dialog" aria-modal="true" aria-labelledby="api-settings-title" tabindex="-1" @keydown="keyboard">
  <header class="api-settings-header"><div><h2 id="api-settings-title">设置</h2><p>管理你的聊天连接与偏好</p></div><button aria-label="关闭设置" :disabled="saving || manager?.busy" @click="close">×</button></header>
  <nav class="api-settings-tabs" aria-label="设置分类"><button :class="{active:tab==='api'}" :aria-current="tab==='api'?'page':undefined" @click="switchTab('api')">API 配置 <span>{{ chat.profiles.length }}</span></button><button :class="{active:tab==='presets'}" @click="switchTab('presets')">Prompt 预设</button><button :class="{active:tab==='preferences'}" @click="switchTab('preferences')">通用偏好</button></nav>
  <ApiProfileManager v-show="tab==='api'" ref="manager" :initial-provider="initialProvider" :initial-profile-id="initialProfileId"/>
  <div v-show="tab==='presets'" class="api-settings-secondary"><h3>Prompt / Persona</h3><p class="api-help">保存常用提示词，按需绑定模型和 API 配置。</p><PresetManager/></div>
  <div v-show="tab==='preferences'" class="api-settings-secondary"><form @submit.prevent="savePreferences"><fieldset :disabled="saving"><h3>外观与默认行为</h3><label>主题<select v-model="form.theme"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label>全局 System Prompt<textarea v-model="form.systemPrompt" rows="4" placeholder="为所有对话设置默认提示词…"/></label><label>默认搜索服务<select v-model="form.searchProvider"><option value="claude">当前 Chat 内置搜索</option><option value="searxng">SearXNG 实例</option></select></label><label v-if="form.searchProvider==='searxng'">SearXNG 地址<input v-model.trim="form.searchBaseUrl" placeholder="https://search.example.com"/></label></fieldset><p v-if="error" class="api-error" role="alert">{{ error }}</p><p v-if="saved && !dirty" class="api-success" role="status">偏好已保存。</p><button class="api-primary" :disabled="saving || !dirty" type="submit">{{ saving?'保存中…':'保存偏好' }}</button></form></div>
  <div v-if="discardOpen" class="api-confirm-backdrop"><section class="api-confirm" role="alertdialog" aria-modal="true" aria-labelledby="preferences-discard-title"><h3 id="preferences-discard-title">偏好尚未保存</h3><p>继续离开将放弃刚才的偏好修改。</p><footer><button class="api-secondary" @click="discardOpen=false">继续编辑</button><button class="api-primary" @click="discard">放弃修改并继续</button></footer></section></div>
 </section></div>
</template>
