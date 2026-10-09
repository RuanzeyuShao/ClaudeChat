<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onUnmounted } from 'vue'
import { Paperclip, ArrowUp, Square, Maximize2, Globe, ChevronDown, X, FileText, FileCode2, LoaderCircle, Brain } from '@lucide/vue'
import { useChatStore } from '../stores/chat'
import { useUiStore } from '../stores/ui'
import { api } from '../services/tauri'
import { shouldSend } from '../utils/experience'
import BaseModal from './BaseModal.vue'
import type { Attachment } from '../types'
import { providerLabel } from '../chatProviders'

const chat = useChatStore(), ui = useUiStore()
const connection=computed(()=>chat.requestSettings || chat.settings)
const emit = defineEmits<{ preview: [attachment: Attachment] }>()
const text = ref(''), attachments = ref<Attachment[]>([]), uploading = ref(false), pendingFiles = ref<string[]>([])
const fileInput = ref<HTMLInputElement>(), textarea = ref<HTMLTextAreaElement>(), expanded = ref(false), composing = ref(false)
let disposed = false, draftTimer: ReturnType<typeof setTimeout> | undefined
const resize = () => { if (!textarea.value) return; textarea.value.style.height = 'auto'; textarea.value.style.height = `${Math.min(textarea.value.scrollHeight, 200)}px` }
function capture(id = chat.activeId) { if (id && chat.conversations.some(c=>c.id===id)) chat.drafts[id] = { text: text.value, attachments: [...attachments.value] } }
function saveLater() { clearTimeout(draftTimer); draftTimer=setTimeout(()=>void chat.persistDrafts().catch(ui.failure),400) }
watch(() => chat.activeId, (_id, old) => {
  if (old) capture(old)
  const draft = chat.drafts[chat.activeId]
  // Restore both fields before deep watchers run, to avoid overwriting an inactive draft.
  text.value = draft?.text || ''; attachments.value = [...(draft?.attachments || [])]
  saveLater(); void nextTick(resize)
}, { immediate:true })
watch([text, attachments], () => { capture(); saveLater(); void nextTick(resize) }, { deep:true })
async function submit() {
  if (composing.value || uploading.value || chat.loading || (!text.value.trim() && !attachments.value.length)) return
  const accepted = await chat.send(text.value.trim(), [...attachments.value])
  if (!accepted) { if(chat.error)ui.notify(chat.error,'error'); return }
  text.value=''; attachments.value=[]; capture(); saveLater(); expanded.value=false
  await nextTick(); resize(); textarea.value?.focus()
}
function keydown(event: KeyboardEvent) { if (shouldSend(event,composing.value,chat.sendMode)) { event.preventDefault(); void submit() } }
function compositionEnd() { setTimeout(() => { composing.value=false },0) }
function guard(attachment: Attachment, id: string) {
  const draft = chat.drafts[id] || { text:'',attachments:[] }
  if (draft.attachments.length >= 8) throw new Error('每条消息最多 8 个附件')
  if (draft.attachments.reduce((n,a)=>n+a.size,0)+attachment.size>30*1024*1024) throw new Error('每条消息附件总大小最多 30 MB')
  draft.attachments.push(attachment); chat.drafts[id]=draft
  if (id===chat.activeId) attachments.value=[...draft.attachments]
}
async function upload(names: string[], parse: (index: number) => Promise<Attachment>) {
  if (uploading.value || !chat.activeId) return
  capture(); const id=chat.activeId; uploading.value=true; pendingFiles.value=[...names]
  try { for(let i=0;i<names.length;i++) { try { const attachment=await parse(i); if(disposed)break; guard(attachment,id) } catch(e) { ui.failure(e) } pendingFiles.value.shift() } await chat.persistDrafts() }
  catch(e){ui.failure(e)} finally { uploading.value=false; pendingFiles.value=[] }
}
async function addFiles(files: FileList | File[]) {
  const items=Array.from(files)
  await upload(items.map(f=>f.name),async i=>{
    const file=items[i]
    if(file.size>30*1024*1024)throw new Error('单个附件不得超过 30 MB')
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('读取文件失败'));reader.readAsDataURL(file)})
    return api.parseAttachment(file.name,file.type || (file.name.endsWith('.md')?'text/markdown':''),data)
  })
}
const addPaths=(paths:string[])=>upload(paths.map(p=>p.split(/[\\/]/).at(-1) || p),i=>api.parseAttachmentPath(paths[i]))
const onPaste=(event:ClipboardEvent)=>{if(event.clipboardData?.files.length){event.preventDefault();void addFiles(event.clipboardData.files)}}
const onDropFiles=(event:Event)=>{if(!api.isTauri)void addFiles((event as CustomEvent<File[]>).detail)}
const onDropPaths=(event:Event)=>void addPaths((event as CustomEvent<string[]>).detail)
async function chooseFiles() {
  if(!api.isTauri){fileInput.value?.click();return}
  try { const {open}=await import('@tauri-apps/plugin-dialog');const selected=await open({multiple:true,filters:[{name:'图片、文档与代码',extensions:['png','jpg','jpeg','gif','webp','pdf','docx','txt','md','py','cpp','c','h','hpp','java','js','ts','vue','rs','go','sh','json','yaml','yml']}]});if(selected)await addPaths(Array.isArray(selected)?selected:[selected]) } catch(e){ui.failure(e)}
}
function focusInput(){textarea.value?.focus()}
function openProvider(event:MouseEvent,section:'model'|'thinking'='model'){window.dispatchEvent(new CustomEvent('chat-provider-config',{detail:{anchor:event.currentTarget as HTMLElement,section}}))}
function insertText(event:Event){text.value=(event as CustomEvent<string>).detail;void nextTick(focusInput)}
async function searchMode(event:Event){const select=event.target as HTMLSelectElement;try{const mode=select.value as typeof chat.settings.searchMode;await chat.saveSettings({...chat.settings,searchMode:mode,webSearch:mode!=='off',apiKey:''},chat.activeId || undefined)}catch(e){ui.failure(e)}finally{select.value=chat.settings.searchMode}}
onMounted(()=>{window.addEventListener('chat-drop-files',onDropFiles);window.addEventListener('chat-drop-paths',onDropPaths);window.addEventListener('chat-focus-input',focusInput);window.addEventListener('chat-insert-text',insertText)})
onUnmounted(()=>{disposed=true;capture();clearTimeout(draftTimer);void chat.persistDrafts().catch(ui.failure);window.removeEventListener('chat-drop-files',onDropFiles);window.removeEventListener('chat-drop-paths',onDropPaths);window.removeEventListener('chat-focus-input',focusInput);window.removeEventListener('chat-insert-text',insertText)})
</script>
<template>
  <div class="input-wrap"><div class="input-box">
    <div v-if="attachments.length || uploading" class="attachment-list"><div v-for="(item,index) in attachments" :key="item.id" class="attachment-card"><button class="attachment-preview-trigger" :aria-label="`预览 ${item.name}`" @click="emit('preview',item)"><img v-if="item.kind==='image'" :src="`data:${item.mime};base64,${item.data}`" :alt="item.name"/><component v-else :is="item.kind==='code'?FileCode2:FileText" :size="24" class="attachment-file-icon"/><span><strong>{{ item.name }}</strong><small>{{ Math.ceil(item.size/1024) }} KB · 已解析{{ (item.text?.length || 0)>16000?' · 截取发送':'' }}</small></span></button><button class="icon-button" :aria-label="`移除 ${item.name}`" @click="attachments.splice(index,1)"><X :size="14"/></button></div><div v-for="(name,index) in pendingFiles" :key="index" class="attachment-card parsing"><LoaderCircle :size="18" class="spin"/><span>{{ name }} · 解析中</span></div></div>
    <div class="composer-edit"><textarea ref="textarea" v-model="text" rows="2" aria-label="聊天输入框" placeholder="写下问题，让想法开始生长…" @input="resize" @keydown="keydown" @compositionstart="composing=true" @compositionend="compositionEnd" @paste="onPaste"/><button class="icon-button expand-editor" aria-label="展开编辑" @click="expanded=true"><Maximize2 :size="16"/></button></div>
    <div class="input-footer"><div class="input-options"><input ref="fileInput" class="hidden-file" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.docx,.txt,.md,.py,.cpp,.c,.h,.hpp,.java,.js,.ts,.vue,.rs,.go,.sh,.json,.yaml,.yml" @change="addFiles(($event.target as HTMLInputElement).files || []);($event.target as HTMLInputElement).value=''"/><button class="icon-button" aria-label="添加附件" title="图片、文档或代码" :disabled="uploading" @click="chooseFiles"><Paperclip :size="18"/></button><div class="composer-model-controls"><button class="composer-provider-button" :title="providerLabel(connection.provider)+' · '+(connection.model || '选择模型')" :disabled="chat.profileBusy" aria-label="配置当前聊天服务" @click="openProvider"><span class="composer-provider-name">{{ providerLabel(connection.provider) }}</span><span class="composer-model-name">{{ connection.model || '选择模型' }}</span><ChevronDown :size="14"/></button><button v-if="connection.model" class="thinking-tag" :title="'思考强度：'+connection.thinking" aria-label="配置思考强度" :disabled="chat.profileBusy" @click="openProvider($event,'thinking')"><Brain :size="16"/>{{ {off:'思考关闭',low:'轻度思考',medium:'标准思考',high:'深度思考'}[connection.thinking] }}</button></div><label class="composer-search" title="联网模式"><Globe :size="16"/><select aria-label="联网模式" :value="chat.settings.searchMode" :disabled="chat.loading || chat.profileBusy" @change="searchMode"><option value="off">不联网</option><option value="auto">自动联网</option><option value="force">始终联网</option></select></label></div><button v-if="chat.loading" class="stop" aria-label="停止生成" :disabled="chat.stopping" @click="chat.stop"><Square :size="15" fill="currentColor"/>{{ chat.stopping?'停止中':'停止' }}</button><button v-else class="send" aria-label="发送消息" :disabled="(!text.trim() && !attachments.length) || uploading || chat.profileBusy" @click="submit"><ArrowUp :size="20"/></button></div>
  </div><p>{{ chat.sendMode==='enter'?'Enter 发送 · Shift+Enter 换行':'Ctrl+Enter 发送 · Enter 换行' }}<span class="composer-disclaimer"> · 请核查 AI 提供的重要信息</span></p></div>
  <BaseModal v-if="expanded" title="展开编辑" wide @close="expanded=false"><textarea v-model="text" class="expanded-text" rows="14" aria-label="展开的聊天输入框" @compositionstart="composing=true" @compositionend="compositionEnd" @paste="onPaste"/><template #footer><button class="secondary" @click="expanded=false">收起</button><button class="primary" :disabled="chat.loading || uploading || (!text.trim() && !attachments.length)" @click="submit">发送消息</button></template></BaseModal>
</template>
