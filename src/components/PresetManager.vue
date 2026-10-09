<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useChatStore } from '../stores/chat'
import { useUiStore } from '../stores/ui'
import type { Preset } from '../types'
const chat = useChatStore()
const ui=useUiStore(),busy=ref(false)
const blank = (): Preset => ({id: crypto.randomUUID(), name: ''})
const draft = reactive<Preset>(blank())
const bind = reactive({systemPrompt:true,model:true,thinking:true,searchMode:true,profileId:true})
const error = ref('')
const signature=()=>JSON.stringify({draft,bind}),baseline=ref(signature()),dirty=computed(()=>signature()!==baseline.value)
async function requestLeave(action:()=>void){if(busy.value)return;if(dirty.value){const result=await ui.request({title:'预设尚未保存',description:'离开将放弃刚才的修改。',confirm:'放弃修改并继续'});if(result===null)return;const saved=JSON.parse(baseline.value);for(const key of Object.keys(draft))delete (draft as unknown as Record<string,unknown>)[key];Object.assign(draft,saved.draft);Object.assign(bind,saved.bind)}action()}
const choose = (id:string) => {const p=chat.presets.find(p=>p.id===id);for(const key of Object.keys(draft)) delete (draft as unknown as Record<string,unknown>)[key];Object.assign(draft,p || blank());for(const key of Object.keys(bind) as (keyof typeof bind)[]) bind[key]=p ? p[key] !== undefined : true;baseline.value=signature()}
async function remove(){const result=await ui.request({title:'删除此预设？',description:'不会修改已有会话。',danger:true,confirm:'删除预设'});if(result===null)return;try{await chat.deletePreset(draft.id);choose('');ui.notify('预设已删除')}catch(e){ui.failure(e)}}
const save = async () => {if(busy.value)return;error.value='';if(!draft.name.trim()){error.value='请输入预设名称';ui.notify(error.value,'error');return}const p:Preset={id:draft.id,name:draft.name.trim()};if(bind.systemPrompt)p.systemPrompt=draft.systemPrompt ?? chat.active?.systemPrompt ?? chat.settings.systemPrompt;if(bind.model)p.model=draft.model || chat.settings.model;if(bind.thinking)p.thinking=draft.thinking || chat.settings.thinking;if(bind.searchMode)p.searchMode=draft.searchMode || chat.settings.searchMode;if(bind.profileId)p.profileId=draft.profileId ?? chat.settings.profileId;busy.value=true;try{await chat.savePreset(p);choose(p.id);ui.notify('预设已保存')}catch(e){ui.failure(e)}finally{busy.value=false}}
defineExpose({requestLeave,busy})
</script>
<template><section class="preset-manager">
<label>预设<select :value="chat.presets.some(p=>p.id===draft.id)?draft.id:''" @change="requestLeave(()=>choose(($event.target as HTMLSelectElement).value))"><option value="">新建预设</option><option v-for="p in chat.presets" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
<label>名称<input v-model="draft.name"/></label>
<label><input v-model="bind.systemPrompt" type="checkbox"/>绑定 System Prompt<textarea aria-label="预设 System Prompt" v-model="draft.systemPrompt" :placeholder="chat.active?.systemPrompt || chat.settings.systemPrompt" rows="3"/></label>
<label><input v-model="bind.model" type="checkbox"/>绑定模型<input aria-label="预设模型" v-model="draft.model" :placeholder="chat.settings.model"/></label>
<label><input v-model="bind.thinking" type="checkbox"/>绑定 Thinking<select aria-label="预设 Thinking" v-model="draft.thinking"><option value="off">Off</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
<label><input v-model="bind.searchMode" type="checkbox"/>绑定搜索模式<select aria-label="预设搜索模式" v-model="draft.searchMode"><option value="off">关闭</option><option value="auto">自动</option><option value="force">强制</option></select></label>
<label><input v-model="bind.profileId" type="checkbox"/>绑定 API Profile<select aria-label="预设 API Profile" v-model="draft.profileId"><option value="">全局配置</option><option v-for="p in chat.profiles" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
<div class="test-row"><button class="api-primary" :disabled="busy" @click="save">保存预设</button><button class="api-secondary" v-if="chat.presets.some(p=>p.id===draft.id)" :disabled="chat.loading" @click="chat.applyPreset(draft.id).then(()=>ui.notify('预设已应用')).catch(ui.failure)">应用</button><button class="api-secondary" v-if="chat.presets.some(p=>p.id===draft.id)" :disabled="busy" @click="remove">删除</button></div><p v-if="error" class="error">{{ error }}</p>
</section></template>
