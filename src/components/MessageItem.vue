<script setup lang="ts">
import {vMotion} from '../motion/runtime'
import MotionTransition from '../motion/MotionTransition.vue'
import { searchQueries } from '../utils/searchTrace'
import { searchStatusLabel } from '../utils/searchTrace'
import { useChatStore } from '../stores/chat'
import { useUiStore } from '../stores/ui'
import { computed, onBeforeUnmount, ref } from 'vue'
import { Copy, Check, Quote, RotateCcw, Pencil, ArrowRight, GitCompareArrows, ChevronLeft, ChevronRight, FileText, FileCode2, Sparkles, ChartNoAxesCombined, Globe } from '@lucide/vue'
import type { Attachment, Message, Usage } from '../types'
import RichContent from './RichContent.vue'
import AttachmentThumbnail from './AttachmentThumbnail.vue'

import { usageOriginLabel, thinkingOriginLabel } from '../utils/usageOrigin'
import ActionMenu from './ActionMenu.vue'
import BaseModal from './BaseModal.vue'
import SourceList from './SourceList.vue'
import { providerLabel } from '../chatProviders'
import { readableCitations } from '../utils/citations'
const props=defineProps<{message:Message;animateEntry?:boolean;canRegenerate?:boolean;codeAttachments?:Attachment[];usage?:Usage}>()
const emit=defineEmits<{regenerate:[];preview:[attachment:Attachment];diff:[attachment:Attachment,proposed:string]}>()
const chat=useChatStore(), ui=useUiStore(), article=ref<HTMLElement>(), copied=ref(false), editing=ref(false), editedText=ref(''), usageOpen=ref(false), chooseCode=ref(false)

const origin=computed(()=>props.message.usageId?chat.requestOrigins[props.message.usageId]:chat.pendingOrigins[props.message.id])
const generation=computed(()=>props.message.generation || origin.value?.generation)
const generationText=computed(()=>{
 const info=generation.value;if(!info)return ''
 return ({complete:info.continuations?`已自动续写 ${info.continuations} 次，回答已完成`:`已自动恢复 ${info.recoveries || 0} 次，回答已完成`,length:info.continuations>=(chat.settings.autoContinuations ?? 1)?'回答未完成：已达到自动续写上限，已生成内容已保存。':'回答未完成：输出预算已耗尽，请调整输出预算后继续。',interrupted:'回答未完成：生成中断，已生成内容仍保留。',stopped:'已停止生成，已生成内容已保存。',context_limit:'回答未完成：已达到上下文上限，请减少历史上下文后继续。',paused:'回答未完成：服务商暂停了回答，已生成内容已保存。',blocked:'服务商因内容安全拒绝或过滤结束回答，不会自动重试。'})[info.status]
})
const isLeaf=computed(()=>chat.active?.messages.at(-1)?.id===props.message.id)
const canContinue=computed(()=>isLeaf.value && generation.value && ['length','interrupted','stopped','context_limit','paused'].includes(generation.value.status))
let copyTimer:ReturnType<typeof setTimeout>|undefined
onBeforeUnmount(()=>clearTimeout(copyTimer))
async function copy(){try{await navigator.clipboard.writeText(readableCitations(props.message.content,props.message.sources));copied.value=true;ui.notify('消息已复制');clearTimeout(copyTimer);copyTimer=setTimeout(()=>copied.value=false,1400)}catch(e){ui.failure(e)}}
function edit(){editedText.value=props.message.content;editing.value=true}
async function resend(){if(!editedText.value.trim())return;try{if(await chat.editResend(props.message,editedText.value))editing.value=false}catch(e){ui.failure(e)}}
function quote(){const selection=window.getSelection();const selected=selection?.anchorNode && selection.focusNode && article.value?.querySelector('.markdown')?.contains(selection.anchorNode) && article.value?.querySelector('.markdown')?.contains(selection.focusNode)?selection.toString().trim():'';chat.quote(props.message,selected || undefined);ui.notify('已加入回复引用','info')}
const versions=computed(()=>chat.versions(props.message)), versionIndex=computed(()=>versions.value.findIndex(m=>m.id===props.message.id))
const proposal=computed(()=>/```(?:[\w.+-]+)?\s*\n([\s\S]*?)\n```/.exec(props.message.content)?.[1] || '')
function reviewCode(){const files=props.codeAttachments || [];if(!proposal.value || !files.length)return;if(files.length===1)emit('diff',files[0],proposal.value);else chooseCode.value=true}

</script>
<template>
 <article ref="article" v-motion="animateEntry?(message.role==='user'?'message-user':'message-assistant'):false" :class="['message',message.role]" :data-message-id="message.id">
  <div v-if="message.role==='assistant'" class="message-name"><Sparkles :size="16"/>ClaudeChat <span v-if="origin || usage" class="message-connection" :title="origin?`${providerLabel(origin.provider)} · ${origin.model} · ${origin.profileName || origin.profileId}`:'历史记录仅保留 Usage 模型；Provider 来源未记录'">{{ origin?providerLabel(origin.provider):'历史模型' }} · {{ origin?.model || usage?.model }}</span></div>
  <div class="message-body">
   <div v-if="message.attachments?.length" class="attachment-list"><button v-for="item in message.attachments" :key="item.id" class="attachment-card attachment-open" :aria-label="`预览 ${item.name}`" @click="emit('preview',item)"><AttachmentThumbnail v-if="item.kind==='image'" :attachment="item"/><component v-else :is="item.kind==='code'?FileCode2:FileText" :size="23"/><span><strong>{{ item.name }}</strong><small>{{ Math.ceil(item.size/1024) }} KB · 点击预览</small></span></button></div>
   <blockquote v-for="reference in message.references" :key="reference.messageId+reference.text" class="message-reference"><button :disabled="chat.loading" @click="chat.jumpNode(reference.messageId)">查看引用来源</button><p>{{ reference.text }}</p></blockquote>
   <details v-if="message.reasoningContent" class="reasoning-panel"><summary><Sparkles :size="14"/>{{ message.pending?'思考过程':'已思考' }}<span>{{ message.reasoningContent.length.toLocaleString() }} 字符</span></summary><pre>{{ message.reasoningContent }}</pre></details>
   <details v-if="message.searchTrace && message.searchTrace.status!=='off'" class="search-trace"><summary><Globe :size="14"/>搜索过程 · {{ searchStatusLabel(message.searchTrace.status) }}<span>{{ message.searchTrace.sources }} 个来源</span></summary><p v-if="message.searchTrace.error" class="error">{{ message.searchTrace.error }}</p><p v-if="searchQueries(message).length">关键词：{{ searchQueries(message).join(' · ') }}</p><p v-else>Provider 未返回搜索关键词。</p><button :disabled="chat.loading" @click="chat.reSearch(message)">重新搜索并生成新版本</button></details>
   <form v-if="editing" class="message-edit" @submit.prevent="resend"><textarea v-model="editedText" rows="5" aria-label="编辑历史消息"/><div><button class="primary" type="submit" :disabled="chat.loading || !editedText.trim()">创建分支并重发</button><button class="secondary" type="button" @click="editing=false">取消</button></div></form>
   <RichContent v-else-if="message.content" :content="message.content" :sources="message.role==='assistant'?(message.sources || []):undefined"/>
   <div v-else-if="message.pending" class="thinking" aria-hidden="true"><i/><i/><i/></div>
   <MotionTransition name="motion-fade" speed="fast"><SourceList v-if="message.sources?.length" :key="message.id" :sources="message.sources"/></MotionTransition>
  </div>
  <div v-if="message.role==='assistant' && !message.pending && generation && (generation.status!=='complete' || generation.continuations>0 || generation.recoveries)" class="generation-notice" role="status"><span>{{ generationText }}</span><small v-if="generation.recoveries">已自动恢复 {{ generation.recoveries }} 次</small><small v-if="generation.status!=='complete' && generation.continuations">已自动续写 {{ generation.continuations }} 次</small><button v-if="canContinue" class="secondary" :disabled="chat.loading || chat.profileBusy" @click="chat.continueReply(message)">{{ message.content?'继续生成':'重试' }}</button><details v-if="generation.error"><summary>查看中断原因</summary><p>{{ generation.error }}</p></details></div>
  <div v-if="message.content && !message.pending" class="message-toolbar">
   <div class="message-tools"><button class="icon-button" :aria-label="copied?'已复制':'复制消息'" title="复制" @click="copy"><component :is="copied?Check:Copy" :size="16"/></button><button v-if="canRegenerate" class="icon-button" aria-label="重新生成" title="重新生成" @click="emit('regenerate')"><RotateCcw :size="16"/></button><button class="icon-button" aria-label="引用消息或选中文字" title="引用（支持选中文字）" :disabled="chat.loading" @click="quote"><Quote :size="16"/></button><ActionMenu label="消息更多操作"><button role="menuitem" :disabled="chat.loading || chat.profileBusy" @click="chat.deleteTurn(message)">删除此轮</button><button v-if="message.role==='user'" role="menuitem" :disabled="chat.loading" @click="edit"><Pencil :size="16"/>编辑并重发</button><button v-if="message.role==='assistant' && isLeaf && generation?.status!=='blocked'" role="menuitem" :disabled="chat.loading" @click="chat.continueReply(message,generation?.status==='complete' || !generation)"><ArrowRight :size="16"/>{{ !generation || generation.status==='complete'?'检查并继续':'继续生成' }}</button><button v-if="message.searchTrace && message.searchTrace.status!=='off'" role="menuitem" :disabled="chat.loading" @click="chat.reSearch(message)"><Globe :size="16"/>重新搜索</button><button v-if="proposal && codeAttachments?.length" role="menuitem" @click="reviewCode"><GitCompareArrows :size="16"/>查看代码 Diff</button><button v-if="usage" role="menuitem" @click="usageOpen=!usageOpen"><ChartNoAxesCombined :size="16"/>{{ usageOpen?'收起':'查看' }}用量</button></ActionMenu></div>
   <div v-if="versions.length>1" class="message-versions"><button class="icon-button" aria-label="上一个回答版本" title="上一个版本" :disabled="chat.loading || versionIndex<=0" @click="chat.selectVersion(message,-1)"><ChevronLeft :size="15"/></button><span>{{ versionIndex+1 }} / {{ versions.length }}</span><button class="icon-button" aria-label="下一个回答版本" title="下一个版本" :disabled="chat.loading || versionIndex>=versions.length-1" @click="chat.selectVersion(message,1)"><ChevronRight :size="15"/></button></div>
  </div>
  <div v-if="usage && usageOpen" class="message-usage"><span>{{ usageOriginLabel(chat.usageOrigins[usage.id]) }} · 输入 {{ usage.inputTokens.toLocaleString() }} · 输出 {{ usage.outputTokens.toLocaleString() }}</span><span>思考 {{ usage.thinkingTokens.toLocaleString() }} Token（{{ thinkingOriginLabel(chat.usageOrigins[usage.id]) }}） · {{ (usage.durationMs/1000).toFixed(1) }}s · 估算费用 ${{ usage.estimatedCost.toFixed(4) }}</span></div>
 </article>
 <MotionTransition name="motion-modal" appear teleport><BaseModal v-if="chooseCode" title="选择要比较的代码文件" @close="chooseCode=false"><div class="preset-list"><button v-for="file in codeAttachments" :key="file.id" @click="emit('diff',file,proposal);chooseCode=false"><FileCode2 :size="16"/>{{ file.name }}</button></div></BaseModal></MotionTransition>
</template>
<style scoped>
.generation-notice{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:16px;padding:12px 14px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--panel);color:var(--muted);font-size:12px;line-height:1.7;overflow-wrap:anywhere}.generation-notice span{flex:1;min-width:160px}.generation-notice small{font-size:11px}.generation-notice button{flex:none;min-height:32px}.generation-notice details{flex-basis:100%;min-width:0}.generation-notice details p{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0}
</style>
