<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { Attachment } from '../types'
import { api } from '../services/tauri'
import { renderMarkdown } from '../utils/markdown'
import { codeAction } from '../utils/codeActions'
import hljs from 'highlight.js'

const props = defineProps<{ attachment: Attachment; proposed?: string }>()
const emit = defineEmits<{ close: [] }>()
const previewData = ref<string | null>(null)
const pdfUrl = ref('')
const loading = ref(false)
const error = ref('')
const showExtractedText = ref(false)
const isMarkdown = computed(() => props.attachment.mime === 'text/markdown')
const isPdf = computed(() => props.attachment.mime === 'application/pdf')
const isDocx = computed(() => props.attachment.name.toLowerCase().endsWith('.docx'))
const isCode = computed(() => props.attachment.kind === 'code')
const language = computed(() => ({ py: 'python', cpp: 'cpp', c: 'c', h: 'cpp', hpp: 'cpp', java: 'java', js: 'javascript', ts: 'typescript', vue: 'xml', rs: 'rust', go: 'go', sh: 'bash', json: 'json', yaml: 'yaml', yml: 'yaml' } as Record<string,string>)[props.attachment.name.split('.').at(-1)?.toLowerCase() || ''] || 'plaintext')
import { useUiStore } from '../stores/ui'
import { codeDiff } from '../utils/codeDiff'
import { X, Copy, Search, ChevronUp, ChevronDown, WrapText } from '@lucide/vue'
const ui=useUiStore()
const sideBySide=ref(false), wrap=ref(false), search=ref(''), matchIndex=ref(0), codeRoot=ref<HTMLElement>(), saving=ref(false)
const isImage=computed(()=>props.attachment.kind==='image')
const matches=computed(()=>{if(!search.value)return [];const term=search.value.toLowerCase();return (props.attachment.text || '').split('\n').flatMap((line,index)=>line.toLowerCase().includes(term)?[index]:[])})
const highlightedLines=computed(()=>(props.attachment.text || '').split('\n').map(line=>hljs.highlight(line,{language:language.value}).value))
const proposedLines=computed(()=>props.proposed===undefined?[]:codeDiff(props.attachment.text || '',props.proposed))
watch(search,()=>matchIndex.value=0)
async function findNext(delta:number){if(!matches.value.length)return;matchIndex.value=(matchIndex.value+delta+matches.value.length)%matches.value.length;await nextTick();codeRoot.value?.querySelector('[data-line="'+matches.value[matchIndex.value]+'"]')?.scrollIntoView({block:'center',behavior:'smooth'})}
async function copyCode(){try{await navigator.clipboard.writeText(props.proposed ?? props.attachment.text ?? '');ui.notify('内容已复制')}catch(e){ui.failure(e)}}
async function saveProposal(overwrite=false){
 if(props.proposed===undefined || !api.isTauri || saving.value)return
 const content=props.proposed, expected=props.attachment.text || '', name=props.attachment.name
 const ok=await ui.request({title:overwrite?'应用 Diff 并覆盖原文件？':'保存修改副本？',description:overwrite?'下一步选择原文件，随后再次确认覆盖。文件内容变化时会拒绝写入。':'查看 Diff 后，将修改另存为新文件。',confirm:'继续',danger:overwrite})
 if(ok===null)return
 saving.value=true
 try{
  if(overwrite){
   const {open}=await import('@tauri-apps/plugin-dialog')
   const path=await open({title:'选择要覆盖的原文件 '+name,multiple:false})
   if(!path || Array.isArray(path))return
   const confirmed=await ui.request({title:'再次确认覆盖',description:'将覆盖 '+path+'。此操作无法撤销。',danger:true,confirm:'覆盖原文件'})
   if(confirmed===null)return
   await api.saveCodeFile(path,content,expected)
  }else{
   const {save}=await import('@tauri-apps/plugin-dialog')
   const index=name.lastIndexOf('.'),copyName=index>0?name.slice(0,index)+'.updated'+name.slice(index):name+'.updated'
   const path=await save({title:'保存修改副本',defaultPath:copyName})
   if(!path)return
   await api.saveCodeCopy(path,content)
  }
  ui.notify(overwrite?'原文件已更新':'修改副本已保存')
 }catch(e){ui.failure(e)}finally{saving.value=false}
}

let requestVersion = 0

const releasePdf = () => { if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value); pdfUrl.value = '' }
watch(() => props.attachment, async attachment => {
  const version = ++requestVersion
  releasePdf(); previewData.value = attachment.data || null; loading.value = false; error.value = ''; showExtractedText.value = false
  if (!previewData.value && api.isTauri && (attachment.kind === 'image' || attachment.mime === 'application/pdf' || attachment.mime === 'text/markdown' || attachment.name.toLowerCase().endsWith('.docx'))) {
    loading.value = true
    try { const fetched = await api.getAttachmentData(attachment.id); if (version === requestVersion) previewData.value = fetched } catch (cause) { if (version === requestVersion) error.value = String(cause) } finally { if (version === requestVersion) loading.value = false }
  }
  if (version !== requestVersion || attachment.mime !== 'application/pdf' || !previewData.value) return
  try {
    const binary = atob(previewData.value)
    const buffer = new ArrayBuffer(binary.length)
    const bytes = new Uint8Array(buffer)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    pdfUrl.value = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }))
  } catch (cause) { error.value = `PDF 预览失败：${String(cause)}` }
}, { immediate: true })
onUnmounted(() => { requestVersion++; releasePdf() })

const decodeURIComponentSafe = (value: string) => { try { return decodeURIComponent(value) } catch { return value } }
const markdownPreview = computed(() => {
  if (!isMarkdown.value) return { html: '', missing: 0 }
  const document = new DOMParser().parseFromString(renderMarkdown(props.attachment.text || ''), 'text/html')
  let images: Record<string, string> = {}
  try { if (previewData.value) images = JSON.parse(previewData.value) as Record<string, string> } catch { /* Legacy attachment without bundled images. */ }
  let missing = 0
  document.querySelectorAll('img').forEach(image => {
    const source = image.getAttribute('src') || ''
    if (/^(https?:|data:)/i.test(source)) return
    const resolved = images[source] || images[decodeURIComponentSafe(source)]
    if (resolved) image.setAttribute('src', resolved)
    else { missing++; const notice = document.createElement('span'); notice.className = 'missing-image'; notice.textContent = `图片未找到：${source}`; image.replaceWith(notice) }
  })
  return { html: document.body.innerHTML, missing }
})
const subtitle = computed(() => isCode.value ? (props.proposed ? '代码变更 Diff · 确认后保存' : '代码预览') : isPdf.value ? 'PDF 原文预览' : isDocx.value ? 'Word 图文预览' : isMarkdown.value ? 'Markdown 图文预览' : '提取文本预览')
</script>

<template>
 <aside class="document-preview" aria-label="文档预览"><header class="document-preview-header"><div><strong :title="attachment.name">{{ attachment.name }}</strong><span>{{ subtitle }}</span></div><button class="icon-button" aria-label="关闭文档预览" @click="emit('close')"><X :size="18"/></button></header>
  <div v-if="isPdf && pdfUrl" class="preview-controls"><button @click="showExtractedText=!showExtractedText">{{ showExtractedText?'查看原始 PDF':'查看提取文本' }}</button></div>
  <div v-if="isCode" class="preview-controls"><template v-if="proposed!==undefined && proposed!==''"><button :class="{chosen:!sideBySide}" @click="sideBySide=false">逐行 Diff</button><button :class="{chosen:sideBySide}" @click="sideBySide=true">并排 Diff</button><button :disabled="saving" @click="saveProposal()">保存副本</button><button :disabled="saving" @click="saveProposal(true)">覆盖原文件…</button></template><button v-else :class="{chosen:wrap}" @click="wrap=!wrap"><WrapText :size="13"/>换行</button><button @click="copyCode"><Copy :size="13"/>复制</button></div>
  <div v-if="isCode && !proposed" class="preview-search"><Search :size="14"/><input v-model="search" aria-label="在代码中查找" placeholder="查找代码…" @keydown.enter.prevent="findNext($event.shiftKey?-1:1)"/><span>{{ matches.length?matchIndex+1:0 }}/{{ matches.length }}</span><button class="icon-button" aria-label="上一个匹配" :disabled="!matches.length" @click="findNext(-1)"><ChevronUp :size="14"/></button><button class="icon-button" aria-label="下一个匹配" :disabled="!matches.length" @click="findNext(1)"><ChevronDown :size="14"/></button></div>
  <div ref="codeRoot" class="document-preview-body" :class="{'pdf-body':isPdf && pdfUrl && !showExtractedText,'code-body':isCode}">
   <p v-if="loading" class="preview-notice">正在加载预览…</p><p v-if="error" class="preview-notice preview-error">{{ error }}</p>
   <template v-if="!loading">
    <div v-if="isCode && proposed && sideBySide" class="diff-side-by-side"><div v-for="side in ['before','after'] as const" :key="side"><h4>{{ side==='before'?'原始文件':'修改后' }}</h4><div class="code-diff"><div v-for="(line,index) in proposedLines.filter(l=>side==='before'?l.kind!=='add':l.kind!=='remove')" :key="index" class="diff-row" :class="`diff-${line.kind}`"><span>{{ line[side] }}</span><b>{{ line.kind==='add'?'+':line.kind==='remove'?'-':' ' }}</b><code>{{ line.text }}</code></div></div></div></div>
    <div v-else-if="isCode && proposed" class="code-diff"><div v-for="(line,index) in proposedLines" :key="index" class="diff-row" :class="`diff-${line.kind}`"><span>{{ line.before }}</span><span>{{ line.after }}</span><b>{{ line.kind==='add'?'+':line.kind==='remove'?'-':' ' }}</b><code>{{ line.text }}</code></div></div>
    <div v-else-if="isCode" class="code-lines hljs" :class="{wrap}"><div v-for="(line,index) in highlightedLines" :key="index" class="code-line" :class="{match:matches.includes(index)}" :data-line="index"><span>{{ index+1 }}</span><code v-html="line || ' '"/></div></div>
    <div v-else-if="isImage" class="image-preview"><img v-if="previewData" :src="`data:${attachment.mime};base64,${previewData}`" :alt="attachment.name"/><p v-else class="preview-notice">图片原文缺失，请重新上传。</p></div>
    <iframe v-else-if="isPdf && pdfUrl && !showExtractedText" class="pdf-preview-frame" :src="pdfUrl" :title="attachment.name"/>
    <template v-else-if="isMarkdown"><p v-if="markdownPreview.missing" class="preview-notice">{{ markdownPreview.missing }} 张相对路径图片未找到，请重新上传原始文件。</p><div class="markdown" v-html="markdownPreview.html" @click="codeAction"/></template>
    <div v-else-if="isDocx && previewData" class="docx-preview" v-html="previewData"/>
    <template v-else><p v-if="isPdf && !pdfUrl" class="preview-notice">原始 PDF 未保存，重新上传后可查看原文。</p><pre>{{ attachment.text || '此文档没有可预览的文本。' }}</pre></template>
   </template>
  </div>
 </aside>
</template>
