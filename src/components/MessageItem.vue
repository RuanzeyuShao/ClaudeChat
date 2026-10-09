<script setup lang="ts">
import { searchQueries } from '../utils/searchTrace'
import { useChatStore } from '../stores/chat'
import { useUiStore } from '../stores/ui'
import { computed, ref } from 'vue'
import { Copy, Check, Quote, RotateCcw, Pencil, ArrowRight, GitCompareArrows, ChevronLeft, ChevronRight, FileText, FileCode2, Sparkles, ChartNoAxesCombined, Globe } from '@lucide/vue'
import type { Attachment, Message, Usage } from '../types'
import { renderMarkdown } from '../utils/markdown'
import { codeAction } from '../utils/codeActions'
import { usageOriginLabel, thinkingOriginLabel } from '../utils/usageOrigin'
import ActionMenu from './ActionMenu.vue'
import BaseModal from './BaseModal.vue'
import SourceList from './SourceList.vue'
import { providerLabel } from '../chatProviders'
const props=defineProps<{message:Message;canRegenerate?:boolean;codeAttachments?:Attachment[];usage?:Usage}>()
const emit=defineEmits<{regenerate:[];preview:[attachment:Attachment];diff:[attachment:Attachment,proposed:string]}>()
const chat=useChatStore(), ui=useUiStore(), article=ref<HTMLElement>(), copied=ref(false), editing=ref(false), editedText=ref(''), usageOpen=ref(false), chooseCode=ref(false)
const html=computed(()=>renderMarkdown(props.message.content))
const origin=computed(()=>props.message.usageId?chat.requestOrigins[props.message.usageId]:chat.pendingOrigins[props.message.id])
async function copy(){try{await navigator.clipboard.writeText(props.message.content);copied.value=true;ui.notify('消息已复制');setTimeout(()=>copied.value=false,1400)}catch(e){ui.failure(e)}}
function edit(){editedText.value=props.message.content;editing.value=true}
async function resend(){if(!editedText.value.trim())return;try{await chat.editResend(props.message,editedText.value);editing.value=false}catch(e){ui.failure(e)}}
function quote(){const selection=window.getSelection();const selected=selection?.anchorNode && selection.focusNode && article.value?.querySelector('.markdown')?.contains(selection.anchorNode) && article.value?.querySelector('.markdown')?.contains(selection.focusNode)?selection.toString().trim():'';chat.quote(props.message,selected || undefined);ui.notify('已加入回复引用','info')}
const versions=computed(()=>chat.versions(props.message)), versionIndex=computed(()=>versions.value.findIndex(m=>m.id===props.message.id))
const proposal=computed(()=>/```(?:[\w.+-]+)?\s*\n([\s\S]*?)\n```/.exec(props.message.content)?.[1] || '')
function reviewCode(){const files=props.codeAttachments || [];if(!proposal.value || !files.length)return;if(files.length===1)emit('diff',files[0],proposal.value);else chooseCode.value=true}

</script>
<template>
 <article ref="article" :class="['message',message.role]">
  <div v-if="message.role==='assistant'" class="message-name"><Sparkles :size="16"/>ClaudeChat <span v-if="origin || usage" class="message-connection" :title="origin?`${providerLabel(origin.provider)} · ${origin.model} · ${origin.profileName || origin.profileId}`:'历史记录仅保留 Usage 模型；Provider 来源未记录'">{{ origin?providerLabel(origin.provider):'历史模型' }} · {{ origin?.model || usage?.model }}</span></div>
  <div class="message-body">
   <div v-if="message.attachments?.length" class="attachment-list"><button v-for="item in message.attachments" :key="item.id" class="attachment-card attachment-open" :aria-label="`预览 ${item.name}`" @click="emit('preview',item)"><img v-if="item.kind==='image'" :src="`data:${item.mime};base64,${item.data}`" :alt="item.name"/><component v-else :is="item.kind==='code'?FileCode2:FileText" :size="23"/><span><strong>{{ item.name }}</strong><small>{{ Math.ceil(item.size/1024) }} KB · 点击预览</small></span></button></div>
   <blockquote v-for="reference in message.references" :key="reference.messageId" class="message-reference"><button :disabled="chat.loading" @click="chat.jumpNode(reference.messageId)">查看引用来源</button><p>{{ reference.text }}</p></blockquote>
   <details v-if="message.reasoningContent" class="reasoning-panel"><summary><Sparkles :size="14"/>{{ message.pending?'思考过程':'已思考' }}<span>{{ message.reasoningContent.length.toLocaleString() }} 字符</span></summary><pre>{{ message.reasoningContent }}</pre></details>
   <details v-if="message.searchTrace && message.searchTrace.status!=='off'" class="search-trace"><summary><Globe :size="14"/>搜索过程 · {{ ({completed:'完成',cancelled:'已停止',searching:'搜索中',generating:'生成回答'} as Record<string,string>)[message.searchTrace.status] || message.searchTrace.status }}<span>{{ message.searchTrace.sources }} 个来源</span></summary><p v-if="searchQueries(message).length">关键词：{{ searchQueries(message).join(' · ') }}</p><p v-else>Provider 未返回搜索关键词。</p><button :disabled="chat.loading" @click="chat.reSearch(message)">重新搜索并生成新版本</button></details>
   <form v-if="editing" class="message-edit" @submit.prevent="resend"><textarea v-model="editedText" rows="5" aria-label="编辑历史消息"/><div><button class="primary" type="submit" :disabled="chat.loading || !editedText.trim()">创建分支并重发</button><button class="secondary" type="button" @click="editing=false">取消</button></div></form>
   <div v-else-if="message.content" class="markdown" v-html="html" @click="codeAction"/>
   <div v-else-if="message.pending" class="thinking" aria-hidden="true"><i/><i/><i/></div>
   <SourceList v-if="message.sources?.length" :key="message.id" :sources="message.sources"/>
  </div>
  <div v-if="message.content && !message.pending" class="message-toolbar">
   <div class="message-tools"><button class="icon-button" :aria-label="copied?'已复制':'复制消息'" title="复制" @click="copy"><component :is="copied?Check:Copy" :size="16"/></button><button v-if="canRegenerate" class="icon-button" aria-label="重新生成" title="重新生成" @click="emit('regenerate')"><RotateCcw :size="16"/></button><button class="icon-button" aria-label="引用消息或选中文字" title="引用（支持选中文字）" :disabled="chat.loading" @click="quote"><Quote :size="16"/></button><ActionMenu label="消息更多操作"><button v-if="message.role==='user'" role="menuitem" :disabled="chat.loading" @click="edit"><Pencil :size="16"/>编辑并重发</button><button v-if="message.role==='assistant'" role="menuitem" :disabled="chat.loading" @click="chat.continueReply(message)"><ArrowRight :size="16"/>继续生成</button><button v-if="message.searchTrace && message.searchTrace.status!=='off'" role="menuitem" :disabled="chat.loading" @click="chat.reSearch(message)"><Globe :size="16"/>重新搜索</button><button v-if="proposal && codeAttachments?.length" role="menuitem" @click="reviewCode"><GitCompareArrows :size="16"/>查看代码 Diff</button><button v-if="usage" role="menuitem" @click="usageOpen=!usageOpen"><ChartNoAxesCombined :size="16"/>{{ usageOpen?'收起':'查看' }}用量</button></ActionMenu></div>
   <div v-if="versions.length>1" class="message-versions"><button class="icon-button" aria-label="上一个回答版本" title="上一个版本" :disabled="chat.loading || versionIndex<=0" @click="chat.selectVersion(message,-1)"><ChevronLeft :size="15"/></button><span>{{ versionIndex+1 }} / {{ versions.length }}</span><button class="icon-button" aria-label="下一个回答版本" title="下一个版本" :disabled="chat.loading || versionIndex>=versions.length-1" @click="chat.selectVersion(message,1)"><ChevronRight :size="15"/></button></div>
  </div>
  <div v-if="usage && usageOpen" class="message-usage"><span>{{ usageOriginLabel(chat.usageOrigins[usage.id]) }} · 输入 {{ usage.inputTokens.toLocaleString() }} · 输出 {{ usage.outputTokens.toLocaleString() }}</span><span>思考 {{ usage.thinkingTokens.toLocaleString() }} Token（{{ thinkingOriginLabel(chat.usageOrigins[usage.id]) }}） · {{ (usage.durationMs/1000).toFixed(1) }}s · 估算费用 ${{ usage.estimatedCost.toFixed(4) }}</span></div>
 </article>
 <BaseModal v-if="chooseCode" title="选择要比较的代码文件" @close="chooseCode=false"><div class="preset-list"><button v-for="file in codeAttachments" :key="file.id" @click="emit('diff',file,proposal);chooseCode=false"><FileCode2 :size="16"/>{{ file.name }}</button></div></BaseModal>
</template>
