<script setup lang="ts">
import MotionCollapse from '../motion/MotionCollapse.vue'
import {scrollBehavior} from '../motion/runtime'
import MotionTransition from '../motion/MotionTransition.vue'
import { computed, nextTick, ref, watch, onMounted, onUnmounted } from 'vue'
import { GitBranch, ChartNoAxesCombined, SlidersHorizontal, FileDown, FileText, ArrowDown, Sparkles, X, LoaderCircle, Check, Square, AlertCircle, Globe, Brain } from '@lucide/vue'
import { useChatStore } from '../stores/chat'
import { useUiStore } from '../stores/ui'
import { contextSummary } from '../utils/requestPreview'
import { nearBottom } from '../utils/experience'
import MessageItem from '../components/MessageItem.vue'
import ChatInput from '../components/ChatInput.vue'
import DocumentPreview from '../components/DocumentPreview.vue'
import PaneResizeHandle from '../components/PaneResizeHandle.vue'
import ConversationTree from '../components/ConversationTree.vue'
import ConversationMinimap from '../components/ConversationMinimap.vue'
import ActionMenu from '../components/ActionMenu.vue'
import BaseModal from '../components/BaseModal.vue'
import { api } from '../services/tauri'
import type { Attachment } from '../types'
const emit=defineEmits<{openSettings:[]}>()
const props=withDefaults(defineProps<{active?:boolean}>(),{active:true})
const chat=useChatStore(), ui=useUiStore(), list=ref<HTMLElement>(), chatContent=ref<HTMLElement>()
const follow=ref(true), containerWidth=ref(1000), viewportWidth=ref(window.innerWidth)
const hasNewAnswer=ref(false), messageFlow=ref<HTMLElement>()
const minimapVisible=ref(false)
const preferredPreviewWidth=ref(Number(localStorage.getItem('claudechat.previewWidth')) || 520)
const previewWidth=computed(()=>Math.max(280,Math.min(preferredPreviewWidth.value,900,containerWidth.value-470)))
const overlayPreview=computed(()=>containerWidth.value<840)
function resizePreview(delta:number){preferredPreviewWidth.value=Math.max(280,Math.min(previewWidth.value-delta,900,containerWidth.value-470));localStorage.setItem('claudechat.previewWidth',String(preferredPreviewWidth.value))}
const preview=ref<Attachment|null>(null), proposed=ref('')
function openPreview(attachment:Attachment){proposed.value='';preview.value=attachment}
function openDiff(attachment:Attachment,code:string){proposed.value=code;preview.value=attachment}
const codes=computed(()=>chat.active?.messages.flatMap(m=>m.attachments || []).filter(a=>a.kind==='code') || [])
const contextTokens=computed(()=>contextSummary(chat.active?.messages || [],{...chat.settings,systemPrompt:chat.active?.systemPrompt || chat.settings.systemPrompt}).tokens)
const contextOpen=ref(false), usageOpen=ref(false), treeOpen=ref(false), presetsOpen=ref(false), exporting=ref(false)
function toggleMessage(id:string){const all=chat.active?.messages.filter(m=>!m.pending).map(m=>m.id) || [];if(!chat.settings.selectedMessageIds.length)chat.settings.selectedMessageIds=[...all];chat.settings.selectedMessageIds=chat.settings.selectedMessageIds.includes(id)?chat.settings.selectedMessageIds.filter(x=>x!==id):[...chat.settings.selectedMessageIds,id];if(!chat.settings.selectedMessageIds.length)chat.settings.selectedMessageIds=['__none__'];void chat.persistContext().catch(ui.failure)}
function toggleAttachment(id:string){const all=chat.active?.messages.flatMap(m=>m.attachments || []).map(a=>a.id) || [];if(!chat.settings.selectedAttachmentIds.length)chat.settings.selectedAttachmentIds=[...all];chat.settings.selectedAttachmentIds=chat.settings.selectedAttachmentIds.includes(id)?chat.settings.selectedAttachmentIds.filter(x=>x!==id):[...chat.settings.selectedAttachmentIds,id];if(!chat.settings.selectedAttachmentIds.length)chat.settings.selectedAttachmentIds=['__none__'];void chat.persistContext().catch(ui.failure)}
const totals=computed(()=>{
 const now=new Date(), day=new Date(now.getFullYear(),now.getMonth(),now.getDate()), month=new Date(now.getFullYear(),now.getMonth(),1)
 const sum=(items:typeof chat.usage)=>({tokens:items.reduce((n,u)=>n+u.inputTokens+u.outputTokens,0),cost:items.reduce((n,u)=>n+u.estimatedCost,0)})
 return {chat:sum(chat.usage.filter(u=>u.conversationId===chat.activeId)),today:sum(chat.usage.filter(u=>new Date(u.createdAt)>=day)),month:sum(chat.usage.filter(u=>new Date(u.createdAt)>=month))}
})
const requestUsage=computed(()=>{const items=chat.usage.filter(u=>chat.requestOrigins[u.id]?.requestId===chat.activeRequestId);return {count:items.length,cost:items.reduce((n,u)=>n+u.estimatedCost,0)}})
const enteringIds=ref(new Set<string>())
let lastMotionConversation='',knownMotionIds=new Set<string>()
watch(()=>[chat.activeId,(chat.active?.messages || []).map(m=>m.id)] as const,([id,ids])=>{
 if(id!==lastMotionConversation){lastMotionConversation=id;enteringIds.value=new Set()}
 else if(chat.loading && chat.active?.messages.some(m=>m.pending)){enteringIds.value=new Set((chat.active?.messages || []).slice(-2).filter(m=>!knownMotionIds.has(m.id)).map(m=>m.id))}
 knownMotionIds=new Set(ids)
},{immediate:true})
const statusLabels={idle:'',connecting:'连接中',searching:'正在搜索',thinking:'正在思考',generating:'正在生成',completed:'已完成',stopped:'已停止',failed:'请求失败',continuing:'正在自动续写',incomplete:'回答未完成'}
const dragging=ref(false)
let dragDepth=0, observer:ResizeObserver|undefined, scrollObserver:ResizeObserver|undefined, unlisten:(()=>void)|undefined, disposed=false, scrollFrame=0
let jumping=false,lastScrollTop=0,lastClientHeight=0,lastScrollHeight=0,touchY:number|undefined,jumpTimer:ReturnType<typeof setTimeout>|undefined
function rememberScroll(){if(list.value){lastScrollTop=list.value.scrollTop;lastClientHeight=list.value.clientHeight;lastScrollHeight=list.value.scrollHeight}}
function cancelFollowFrame(){cancelAnimationFrame(scrollFrame);scrollFrame=0}
function pauseFollow(){
 if(!props.active)return
 follow.value=false;cancelFollowFrame();clearTimeout(jumpTimer)
 if(jumping){jumping=false;list.value?.scrollTo({top:list.value.scrollTop,behavior:'instant'})}
}
function finishJump(){if(!jumping || !follow.value)return;jumping=false;clearTimeout(jumpTimer);updateScroll()}
function settleJump(){clearTimeout(jumpTimer);jumpTimer=setTimeout(finishJump,180)}
async function scrollBottom(smooth=false){
 follow.value=true;hasNewAnswer.value=false;cancelFollowFrame();clearTimeout(jumpTimer);jumping=smooth
 await nextTick();if(!props.active || !follow.value || !list.value)return
 if(smooth)list.value.focus({preventScroll:true})
 list.value.scrollTo({top:list.value.scrollHeight,behavior:scrollBehavior(smooth)})
 rememberScroll()
 if(smooth){if(nearBottom(list.value,4))jumping=false;else settleJump()}
}
function updateScroll(){
 if(props.active && follow.value && !jumping && !scrollFrame)scrollFrame=requestAnimationFrame(()=>{
  scrollFrame=0
  // User input may have paused following after this frame was queued.
  if(props.active && follow.value && !jumping && list.value){list.value.scrollTo({top:list.value.scrollHeight,behavior:'instant'});rememberScroll()}
 })
}
function onScroll(){
 const element=list.value;if(!props.active || !element)return
 const up=element.scrollTop<lastScrollTop-1,down=element.scrollTop>lastScrollTop+1,layoutChanged=element.clientHeight!==lastClientHeight || element.scrollHeight!==lastScrollHeight;rememberScroll()
 if(jumping){if(nearBottom(element,4)){jumping=false;hasNewAnswer.value=false;clearTimeout(jumpTimer);updateScroll()}else settleJump();return}
 if(up && !layoutChanged){pauseFollow();return}
 if(down && nearBottom(element,4)){follow.value=true;hasNewAnswer.value=false;updateScroll()}
 else if(down && !nearBottom(element,4))follow.value=false
}
function scrollKey(event:KeyboardEvent){if(event.isComposing || (event.target as HTMLElement).closest('input,textarea,select,button,[contenteditable=true]'))return;if(['ArrowUp','PageUp','Home'].includes(event.key) || (event.key===' ' && event.shiftKey))pauseFollow()}
function scrollWheel(event:WheelEvent){if(event.deltaY<0)pauseFollow()}
function scrollPointer(event:PointerEvent){const element=list.value;if(element && event.clientX>=element.getBoundingClientRect().left+element.clientWidth)pauseFollow()}
function touchStart(event:TouchEvent){touchY=event.touches[0]?.clientY}
function touchMove(event:TouchEvent){const y=event.touches[0]?.clientY;if(y!==undefined && touchY!==undefined && y>touchY)pauseFollow();touchY=y}
watch(()=>props.active,async active=>{if(active){await nextTick();updateScroll()}else{cancelFollowFrame();clearTimeout(jumpTimer);jumping=false}})
watch(()=>{const m=chat.active?.messages.at(-1);return [chat.activeId,m?.id,m?.content,m?.reasoningContent,m?.sources?.length,m?.attachments?.length,chat.active?.messages.length]},async(value,previous)=>{
 const message=chat.active?.messages.at(-1)
 const element=list.value
 if(follow.value && !jumping && element && element.scrollTop<lastScrollTop-1 && element.clientHeight===lastClientHeight && element.scrollHeight===lastScrollHeight)pauseFollow()
 if(value[0]===previous[0] && !follow.value && message?.role==='assistant' && (message.content || message.reasoningContent || message.sources?.length || message.attachments?.length))hasNewAnswer.value=true
 await nextTick();updateScroll()
})
watch(()=>chat.activeId,async()=>{preview.value=null;hasNewAnswer.value=false;follow.value=true;jumping=false;cancelFollowFrame();clearTimeout(jumpTimer);lastScrollTop=0;if(!chat.loading)chat.status='idle';await nextTick();void scrollBottom()})
function drop(event:DragEvent){event.preventDefault();dragDepth=0;dragging.value=false;if(event.dataTransfer?.files.length)window.dispatchEvent(new CustomEvent('chat-drop-files',{detail:Array.from(event.dataTransfer.files)}))}
function dragEnter(event:DragEvent){if(event.dataTransfer?.types.includes('Files')){dragDepth++;dragging.value=true}}
function dragLeave(){dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)dragging.value=false}
function keyboard(event:KeyboardEvent){if(!props.active || event.defaultPrevented || event.key!=='Escape' || event.isComposing || document.querySelector('[aria-modal="true"]'))return;if(preview.value){preview.value=null;event.preventDefault()}else if(treeOpen.value){treeOpen.value=false;event.preventDefault()}}
onMounted(async()=>{
 window.addEventListener('keydown',keyboard);window.addEventListener('chat-jump-message',pauseFollow)
 if(chatContent.value){containerWidth.value=chatContent.value.clientWidth;observer=new ResizeObserver(entries=>containerWidth.value=entries[0].contentRect.width);observer.observe(chatContent.value)}
 scrollObserver=new ResizeObserver(()=>updateScroll());if(list.value)scrollObserver.observe(list.value);if(messageFlow.value)scrollObserver.observe(messageFlow.value)
 if(!api.isTauri)return
 try{const {getCurrentWebview}=await import('@tauri-apps/api/webview');const cleanup=await getCurrentWebview().onDragDropEvent(event=>{if(event.payload.type==='over')dragging.value=true;if(event.payload.type==='leave')dragging.value=false;if(event.payload.type==='drop'){dragging.value=false;window.dispatchEvent(new CustomEvent('chat-drop-paths',{detail:event.payload.paths}))}});if(disposed)cleanup();else unlisten=cleanup}catch(e){ui.failure(e)}
})
onUnmounted(()=>{disposed=true;unlisten?.();observer?.disconnect();scrollObserver?.disconnect();cancelFollowFrame();clearTimeout(jumpTimer);window.removeEventListener('keydown',keyboard);window.removeEventListener('chat-jump-message',pauseFollow)})
async function exportChat(format:'md'|'pdf'){
 if(!chat.active || exporting.value)return
 if(!api.isTauri){ui.notify('请在桌面应用中导出会话','info');return}
 const id=chat.active.id,title=chat.active.title
 try{const {save}=await import('@tauri-apps/plugin-dialog');const path=await save({defaultPath:`${title}.${format}`,filters:[{name:format==='md'?'Markdown':'PDF',extensions:[format]}]});if(!path)return;exporting.value=true;await api.exportConversation(id,format,path);ui.notify('会话已导出')}catch(e){ui.failure(e)}finally{exporting.value=false}
}
async function editPrompt(){const value=await ui.request({title:'会话 Prompt',description:'留空使用全局默认提示词。',value:chat.active?.systemPrompt || '',multiline:true,confirm:'保存'});if(value===null)return;try{await chat.setConversationPrompt(value);ui.notify('会话 Prompt 已保存')}catch(e){ui.failure(e)}}
async function persistContext(){try{chat.settings.recentTurns=Math.max(1,Math.min(100,chat.settings.recentTurns || 10));await chat.persistContext()}catch(e){ui.failure(e)}}
function suggestion(value:string){window.dispatchEvent(new CustomEvent('chat-insert-text',{detail:value}))}
</script>
<template>
 <section v-show="active" class="chat-view" :data-motion-stopped="chat.stopping || !chat.loading" @dragenter.prevent="dragEnter" @dragover.prevent @dragleave.prevent="dragLeave" @drop="drop">
  <header class="chat-header"><strong :title="chat.active?.title">{{ chat.active?.messages.length?chat.active.title:'新对话' }}</strong><div class="header-actions"><button class="icon-button" aria-label="对话树" :aria-expanded="treeOpen" :class="{active:treeOpen}" @click="treeOpen=!treeOpen"><GitBranch :size="18"/></button><ActionMenu label="会话更多操作"><button role="menuitem" @click="usageOpen=true"><ChartNoAxesCombined :size="16"/>会话用量</button><button role="menuitem" @click="contextOpen=true"><SlidersHorizontal :size="16"/>上下文选择 <small>约 {{ contextTokens }} Token</small></button><button role="menuitem" :disabled="chat.loading" @click="editPrompt"><FileText :size="16"/>会话 Prompt</button><button role="menuitem" :disabled="chat.loading" @click="presetsOpen=true"><Sparkles :size="16"/>应用 Prompt 预设</button><hr/><button role="menuitem" :disabled="exporting || !chat.active?.messages.length" @click="exportChat('md')"><FileDown :size="16"/>导出 Markdown</button><button role="menuitem" :disabled="exporting || !chat.active?.messages.length" @click="exportChat('pdf')"><FileDown :size="16"/>导出 PDF</button></ActionMenu></div></header>
  <MotionCollapse><ConversationTree v-if="treeOpen" @close="treeOpen=false"/></MotionCollapse>
  <MotionTransition name="motion-fade"><div v-if="dragging" class="drop-overlay"><div><FileText :size="32"/><strong>松开文件，添加到消息</strong><small>图片、PDF、Word、Markdown 和代码</small></div></div></MotionTransition>
  <div ref="chatContent" class="chat-content">
   <div class="chat-main" :class="{'is-empty':!chat.active?.messages.length,'has-minimap':minimapVisible}">
    <ConversationMinimap :scroller="list" :messages="chat.active?.messages || []" :active="active" @navigate="pauseFollow" @visibility="minimapVisible=$event"/>
    <div ref="list" class="messages" tabindex="0" role="region" aria-label="聊天消息" @scroll="onScroll" @scrollend="finishJump" @wheel.passive="scrollWheel" @pointerdown="scrollPointer" @keydown="scrollKey" @touchstart.passive="touchStart" @touchmove.passive="touchMove" @touchend="touchY=undefined"><div ref="messageFlow" class="message-flow"><div v-if="!chat.active?.messages.length" class="welcome-screen"><div class="welcome-mark"><Sparkles :size="30" :stroke-width="1.5"/></div><small>CLAUDECHAT · 让思考更进一步</small><h1>从一个想法开始</h1><p>提问、写作，或把复杂的问题一起理清。</p><button v-if="!chat.profiles.some(p=>p.hasKey && p.model)" class="primary" @click="emit('openSettings')">连接你的 API</button><div class="welcome-suggestions"><button @click="suggestion('帮我把下面的想法整理成清晰的行动计划：')">梳理一个想法</button><button @click="suggestion('请帮我分析这份文件，提炼重点并列出待确认的问题。')">理解一份文件</button><button @click="suggestion('请帮我解释这段代码的逻辑，并提出改进建议：')">探索一段代码</button></div></div><MessageItem v-for="message in chat.active?.messages" :key="message.id" :message="message" :animate-entry="enteringIds.has(message.id)" :code-attachments="codes" :usage="chat.usageFor(message)" :can-regenerate="message.role==='assistant' && message.id===chat.active?.messages.at(-1)?.id && !chat.loading" @regenerate="chat.regenerate(message)" @preview="openPreview" @diff="openDiff"/><div v-if="chat.error" class="request-error" role="alert"><AlertCircle :size="18"/><span>{{ chat.error }}</span><button v-if="chat.rawError" @click="ui.errorDetail=chat.rawError">查看错误详情</button><button :disabled="chat.loading" @click="chat.retry">重试</button><button @click="emit('openSettings')">检查配置</button></div></div></div>
    <div class="composer-dock"><div v-if="(!follow && chat.active?.messages.length) || chat.status!=='idle'" class="composer-notices"><div v-if="!follow && chat.active?.messages.length" class="latest-message-row" role="status" aria-live="polite"><button :aria-label="hasNewAnswer?'有新回答，滚动至最新消息':'回到最新消息'" @click="scrollBottom(true)">{{ hasNewAnswer?'有新回答':'回到最新' }}<ArrowDown :size="16"/></button></div>
    <div v-if="chat.status!=='idle'" class="request-status" :class="{working:chat.loading}" :data-phase="chat.stopping?'stopping':chat.status" role="status" aria-live="polite"><component v-if="chat.loading" :is="chat.status==='searching'?Globe:chat.status==='thinking'?Brain:chat.status==='generating'?Sparkles:LoaderCircle" :size="13" :class="{spin:!chat.stopping && ['connecting','continuing'].includes(chat.status),'motion-breathe':!chat.stopping && ['thinking','searching','generating'].includes(chat.status)}"/><Check v-else-if="chat.status==='completed'" :size="13"/><Square v-else-if="chat.status==='stopped'" :size="12"/><AlertCircle v-else :size="13"/>{{ chat.stopping?'正在停止…':chat.loading && chat.continuationNotice?chat.continuationNotice:statusLabels[chat.status] }}<span v-if="chat.loading"> · {{ Math.max(chat.requestCalls,requestUsage.count) }} 次调用 · 已记账估算 ${{ requestUsage.cost.toFixed(4) }}</span></div></div>
    <div v-if="chat.references.length" class="composer-references"><div><strong>回复引用的内容</strong><p v-for="(r,index) in chat.references" :key="r.messageId+index">{{ r.text.slice(0,240) }}<button class="icon-button" :aria-label="'移除引用 '+(index+1)" @click="chat.references.splice(index,1)"><X :size="12"/></button></p></div><button class="icon-button" aria-label="取消引用" @click="chat.references=[]"><X :size="16"/></button></div>
    <ChatInput @preview="openPreview"/></div>
   </div>
   <button v-if="preview && overlayPreview" class="preview-scrim" aria-label="关闭预览" @click="preview=null"/>
   <PaneResizeHandle v-if="preview && !overlayPreview" label="调整聊天区与预览区宽度" @resize="resizePreview" @reset="preferredPreviewWidth=520"/>
   <MotionTransition name="motion-panel" speed="slow"><DocumentPreview v-if="preview" :class="{'preview-overlay':overlayPreview}" :attachment="preview" :proposed="proposed" :style="overlayPreview?undefined:{width:`${previewWidth}px`,flexBasis:`${previewWidth}px`}" @close="preview=null"/></MotionTransition>
  </div>
 </section>
 <MotionTransition name="motion-modal" appear teleport><BaseModal v-if="active && usageOpen" title="会话用量" @close="usageOpen=false"><div class="usage-summary"><article v-for="(value,key) in totals" :key="key"><span>{{ {chat:'本会话',today:'今日',month:'本月'}[key] }}</span><strong>{{ value.tokens.toLocaleString() }} Token</strong><small>估算费用 ${{ value.cost.toFixed(4) }}</small></article></div><p class="hint">输入与输出为 Provider 返回值；未返回时记为 0。思考 Token 和费用可能是客户端估算。</p></BaseModal></MotionTransition>
 <MotionTransition name="motion-modal" appear teleport><BaseModal v-if="active && contextOpen" title="上下文管理" wide @close="contextOpen=false"><div class="context-mode"><label>包含的历史<select v-model="chat.settings.contextMode" @change="persistContext"><option value="full">完整历史</option><option value="recent">最近 N 轮</option><option value="smart">智能压缩</option></select></label><label v-if="chat.settings.contextMode==='recent'">轮数<input v-model.number="chat.settings.recentTurns" type="number" min="1" max="100" @change="persistContext"/></label><span>约 {{ contextTokens.toLocaleString() }} Token · 字符估算</span></div><button class="secondary" @click="chat.settings.contextMode='full';chat.settings.selectedMessageIds=[];chat.settings.selectedAttachmentIds=[];persistContext()">全选</button><button class="secondary" @click="chat.settings.contextMode='recent';persistContext()">仅最近 N 轮</button><button class="secondary" @click="chat.settings.contextMode='full';chat.settings.selectedMessageIds=chat.active?.messages.filter(m=>m.role==='user' || m.role==='assistant').map(m=>m.id) || [];persistContext()">不含工具结果</button><div class="context-picker"><div v-for="m in chat.active?.messages.filter(x=>!x.pending)" :key="m.id"><label><input type="checkbox" :checked="!chat.settings.selectedMessageIds.length || chat.settings.selectedMessageIds.includes(m.id)" @change="toggleMessage(m.id)"/>{{ m.role==='user'?'你':'助手' }} · {{ m.content.slice(0,100) }}</label><label v-for="a in m.attachments" :key="a.id" class="context-attachment"><input type="checkbox" :checked="!chat.settings.selectedAttachmentIds.length || chat.settings.selectedAttachmentIds.includes(a.id)" @change="toggleAttachment(a.id)"/>附件 {{ a.name }}</label></div></div></BaseModal></MotionTransition>
 <MotionTransition name="motion-modal" appear teleport><BaseModal v-if="active && presetsOpen" title="应用 Prompt 预设" @close="presetsOpen=false"><div class="preset-list"><button v-for="preset in chat.presets" :key="preset.id" :disabled="chat.loading" @click="chat.applyPreset(preset.id).then(()=>{presetsOpen=false;ui.notify('预设已应用')}).catch(ui.failure)"><Sparkles :size="16"/>{{ preset.name }}</button><p v-if="!chat.presets.length" class="hint">还没有预设，可在设置中保存常用提示词。</p><button class="secondary" @click="presetsOpen=false;emit('openSettings')">管理预设</button></div></BaseModal></MotionTransition>
</template>
