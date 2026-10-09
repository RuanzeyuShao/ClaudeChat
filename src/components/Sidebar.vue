<script setup lang="ts">
import ProviderSelector from './ProviderSelector.vue'
import ActionMenu from './ActionMenu.vue'
import BaseModal from './BaseModal.vue'
import { Sparkles, Plus, Search, X, Settings2, ChartNoAxesCombined, PanelLeftClose, PanelLeftOpen, Pin, Pencil, Folder, Trash2, Filter, MessageSquare } from '@lucide/vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import { useUiStore } from '../stores/ui'
import { historyGroup } from '../utils/experience'
import { api } from '../services/tauri'
import type { Conversation, ProviderKind } from '../types'
defineProps<{page:'chat'|'usage';collapsed:boolean;width:number}>()
const emit=defineEmits<{openSettings:[provider?:ProviderKind,profileId?:string];openUsage:[];openChat:[];toggle:[]}>()
const chat=useChatStore(), ui=useUiStore(), query=ref(''), results=ref<Conversation[]>([]), searching=ref(false)
let sequence=0, timer:ReturnType<typeof setTimeout>|undefined
const searchOpen=ref(false), searchInput=ref<HTMLInputElement>(), filtersOpen=ref(false)
async function focusSearch(){searchOpen.value=true;await nextTick();searchInput.value?.focus()}
watch(query,value=>{
 clearTimeout(timer);const current=++sequence
 if(!value.trim()){results.value=[];searching.value=false;return}
 searching.value=true
 timer=setTimeout(async()=>{try{const found=api.isTauri?await api.searchConversations(value.trim()):chat.conversations.filter(c=>c.title.toLowerCase().includes(value.toLowerCase()));if(current===sequence)results.value=found}catch(e){if(current===sequence){results.value=[];ui.failure(e)}}finally{if(current===sequence)searching.value=false}},180)
})
const folder=ref(''),tag=ref(''),pinned=ref(false)
const folders=computed(()=>[...new Set(Object.values(chat.organization).map(o=>o.folder).filter(Boolean))])
const tags=computed(()=>[...new Set(Object.values(chat.organization).flatMap(o=>o.tags || []))])
const filtered=computed(()=>(query.value.trim()?results.value:chat.conversations).filter(c=>{const o=chat.organization[c.id] || {};return (!folder.value || o.folder===folder.value) && (!tag.value || o.tags?.includes(tag.value)) && (!pinned.value || o.pinned)}).slice().sort((a,b)=>Number(!!chat.organization[b.id]?.pinned)-Number(!!chat.organization[a.id]?.pinned) || b.updatedAt.localeCompare(a.updatedAt)))
const groups=computed(()=>{const map=new Map<string,Conversation[]>();for(const c of filtered.value){const name=chat.organization[c.id]?.pinned?'置顶':historyGroup(c.updatedAt);map.set(name,[...(map.get(name)||[]),c])}return [...map].map(([name,items])=>({name,items}))})
const classifyTarget=ref<string|null>(null),folderDraft=ref(''),tagsDraft=ref(''),saving=ref(false)
async function rename(id:string,old:string){const title=await ui.request({title:'重命名会话',value:old,confirm:'保存'});if(!title?.trim())return;try{await chat.rename(id,title.trim());ui.notify('会话已重命名')}catch(e){ui.failure(e)}}
async function renameCategory(kind:'folder'|'tag'){const old=kind==='folder'?folder.value:tag.value;if(!old)return;const value=await ui.request({title:'管理分类',description:'留空将移除此分类，保留会话内容。',value:old,confirm:'保存'});if(value===null)return;try{await chat.renameCategory(kind,old,value.trim());if(kind==='folder')folder.value=value.trim();else tag.value=value.trim();ui.notify('分类已更新')}catch(e){ui.failure(e)}}
function classify(id:string){const o=chat.organization[id] || {};classifyTarget.value=id;folderDraft.value=o.folder || '';tagsDraft.value=(o.tags || []).join(', ')}
async function saveClassification(){if(!classifyTarget.value || saving.value)return;saving.value=true;try{await chat.organize(classifyTarget.value,{...chat.organization[classifyTarget.value],folder:folderDraft.value.trim(),tags:[...new Set(tagsDraft.value.split(/[,，]/).map(t=>t.trim()).filter(Boolean))]});classifyTarget.value=null;ui.notify('会话分类已保存')}catch(e){ui.failure(e)}finally{saving.value=false}}
async function remove(item:Conversation){const ok=await ui.request({title:'删除对话？',description:`“${item.title}”的消息、分支和附件将从本地删除。`,danger:true,confirm:'确认删除'});if(ok===null)return;try{await chat.remove(item.id);ui.notify('会话已删除')}catch(e){ui.failure(e)}}
async function pin(id:string){try{await chat.organize(id,{...chat.organization[id],pinned:!chat.organization[id]?.pinned})}catch(e){ui.failure(e)}}
async function select(id:string){try{await chat.select(id);emit('openChat')}catch(e){ui.failure(e)}}
async function newChat(){try{await chat.newConversation();emit('openChat')}catch(e){ui.failure(e)}}
const menus=new Map<string,InstanceType<typeof ActionMenu>>()
function menuRef(id:string,instance:unknown){if(instance)menus.set(id,instance as InstanceType<typeof ActionMenu>);else menus.delete(id)}
onMounted(()=>window.addEventListener('chat-search-history',focusSearch))
onUnmounted(()=>{clearTimeout(timer);sequence++;window.removeEventListener('chat-search-history',focusSearch)})
</script>
<template>
 <aside class="sidebar" :class="{'sidebar-collapsed':collapsed}" :style="{width:`${width}px`}">
  <div class="brand"><Sparkles :size="22" :stroke-width="1.6"/><span class="brand-name">ClaudeChat</span><button class="icon-button sidebar-toggle" :aria-label="collapsed?'展开侧边栏':'折叠侧边栏'" @click="emit('toggle')"><component :is="collapsed?PanelLeftOpen:PanelLeftClose" :size="17"/></button></div>
  <button class="new-chat" aria-label="新建对话" title="新建对话 · Ctrl+N" :disabled="chat.loading" @click="newChat"><Plus :size="18"/><span>新建对话</span><kbd>Ctrl N</kbd></button>
  <ProviderSelector @configure="(kind,profileId)=>emit('openSettings',kind,profileId)"/>
  <button class="usage-nav" :class="{active:page==='usage'}" title="用量统计" aria-label="用量统计" @click="emit('openUsage')"><ChartNoAxesCombined :size="18"/><span>用量统计</span></button>
  <div class="history-heading"><span>历史会话</span><div><button class="icon-button" title="筛选会话" aria-label="筛选会话" :class="{active:filtersOpen}" @click="filtersOpen=!filtersOpen"><Filter :size="15"/></button><button class="icon-button" title="搜索历史 · Ctrl+K" aria-label="搜索历史对话" @click="focusSearch"><Search :size="16"/></button></div></div>
  <div v-if="searchOpen" class="history-search-wrap"><Search :size="14"/><input ref="searchInput" v-model="query" type="search" placeholder="搜索会话、消息、附件" aria-label="搜索历史对话" @keydown.esc="query='';searchOpen=false"/><button class="icon-button" aria-label="清空搜索" @click="query='';searchInput?.focus()"><X :size="14"/></button></div>
  <div v-if="filtersOpen" class="conversation-filters"><select v-model="folder" aria-label="筛选文件夹"><option value="">全部文件夹</option><option v-for="f in folders" :key="f" :value="f">{{ f }}</option></select><select v-model="tag" aria-label="筛选标签"><option value="">全部标签</option><option v-for="t in tags" :key="t">{{ t }}</option></select><div><button v-if="folder" @click="renameCategory('folder')">管理文件夹</button><button v-if="tag" @click="renameCategory('tag')">管理标签</button></div><label><input v-model="pinned" type="checkbox"/>仅置顶</label></div>
  <nav class="conversation-list" aria-label="历史会话"><section v-for="group in groups" :key="group.name"><h3>{{ group.name }}</h3><div v-for="item in group.items" :key="item.id" class="conversation" :class="{active:item.id===chat.activeId && page==='chat'}" @contextmenu.prevent="menus.get(item.id)?.show()"><button class="conversation-link" :title="item.title" :disabled="chat.loading" @click="select(item.id)"><Pin v-if="chat.organization[item.id]?.pinned" :size="13"/><MessageSquare v-else :size="15" class="conversation-icon"/><span class="conversation-title">{{ item.title }}<small v-if="chat.organization[item.id]?.folder">{{ chat.organization[item.id].folder }}</small></span></button><ActionMenu :ref="instance=>menuRef(item.id,instance)" label="会话操作"><button role="menuitem" :disabled="chat.loading" @click="rename(item.id,item.title)"><Pencil :size="15"/>重命名</button><button role="menuitem" :disabled="chat.loading" @click="pin(item.id)"><Pin :size="15"/>{{ chat.organization[item.id]?.pinned?'取消置顶':'置顶' }}</button><button role="menuitem" :disabled="chat.loading" @click="classify(item.id)"><Folder :size="15"/>文件夹与标签</button><hr/><button role="menuitem" class="danger" :disabled="chat.loading" @click="remove(item)"><Trash2 :size="15"/>删除对话</button></ActionMenu></div></section><p v-if="searching" class="search-empty">正在搜索…</p><p v-else-if="!filtered.length" class="search-empty">没有匹配的对话</p></nav>
  <div class="sidebar-footer"><button class="settings-button" title="设置 · Ctrl+," aria-label="设置" @click="emit('openSettings')"><Settings2 :size="18"/><span>设置</span></button><small>v0.1.4</small></div>
 </aside>
 <BaseModal v-if="classifyTarget" title="会话分类" :busy="saving" @close="!saving && (classifyTarget=null)"><form id="classification" @submit.prevent="saveClassification"><label>文件夹<input v-model="folderDraft" placeholder="留空移出文件夹" list="folder-names"/><datalist id="folder-names"><option v-for="f in folders" :key="f" :value="f"/></datalist></label><label>标签<input v-model="tagsDraft" placeholder="用逗号分隔多个标签"/></label></form><template #footer><button class="secondary" :disabled="saving" @click="classifyTarget=null">取消</button><button class="primary" form="classification" type="submit" :disabled="saving">{{ saving?'保存中…':'保存' }}</button></template></BaseModal>
</template>
