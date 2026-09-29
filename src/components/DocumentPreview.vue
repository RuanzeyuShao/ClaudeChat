<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { Attachment } from '../types'
import { api } from '../services/tauri'
import { renderMarkdown } from '../utils/markdown'

const props = defineProps<{ attachment: Attachment }>()
const emit = defineEmits<{ close: [] }>()
const previewData = ref<string | null>(null)
const pdfUrl = ref('')
const loading = ref(false)
const error = ref('')
const showExtractedText = ref(false)
const isMarkdown = computed(() => props.attachment.mime === 'text/markdown')
const isPdf = computed(() => props.attachment.mime === 'application/pdf')
const isDocx = computed(() => props.attachment.name.toLowerCase().endsWith('.docx'))
let requestVersion = 0

const releasePdf = () => { if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value); pdfUrl.value = '' }
watch(() => props.attachment, async attachment => {
  const version = ++requestVersion
  releasePdf(); previewData.value = attachment.data || null; loading.value = false; error.value = ''; showExtractedText.value = false
  if (!previewData.value && api.isTauri && (attachment.mime === 'application/pdf' || attachment.mime === 'text/markdown' || attachment.name.toLowerCase().endsWith('.docx'))) {
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
const subtitle = computed(() => isPdf.value ? 'PDF 原文预览' : isDocx.value ? 'Word 图文预览' : isMarkdown.value ? 'Markdown 图文预览' : '提取文本预览')
</script>

<template>
  <aside class="document-preview" aria-label="文档预览">
    <header class="document-preview-header">
      <div><strong :title="attachment.name">{{ attachment.name }}</strong><span>{{ subtitle }}</span></div>
      <button type="button" aria-label="关闭文档预览" @click="emit('close')">×</button>
    </header>
    <div v-if="isPdf && pdfUrl" class="pdf-preview-controls"><button type="button" @click="showExtractedText = !showExtractedText">{{ showExtractedText ? '查看原始 PDF' : '查看提取文本' }}</button></div>
    <div class="document-preview-body" :class="{ 'pdf-body': isPdf && pdfUrl && !showExtractedText }">
      <p v-if="loading" class="preview-notice">正在加载文档预览…</p>
      <p v-if="error" class="preview-notice preview-error">{{ error }}</p>
      <template v-if="!loading">
        <iframe v-if="isPdf && pdfUrl && !showExtractedText" class="pdf-preview-frame" :src="pdfUrl" :title="attachment.name" />
        <template v-else-if="isMarkdown"><p v-if="markdownPreview.missing" class="preview-notice">{{ markdownPreview.missing }} 张相对路径图片未找到。请通过“附件”按钮重新选择原始 Markdown 文件，并将图片放在同目录或子目录。</p><div class="markdown" v-html="markdownPreview.html" /></template>
        <template v-else-if="isDocx && previewData"><div class="docx-preview" v-html="previewData" /></template>
        <template v-else><p v-if="isPdf && !pdfUrl" class="preview-notice">此附件没有保存原始 PDF，重新上传后可查看其中的图片。</p><pre>{{ attachment.text || '此文档没有可预览的文本。' }}</pre></template>
      </template>
    </div>
  </aside>
</template>
