<script setup lang="ts">
import { computed, nextTick, ref, onMounted, onUnmounted } from 'vue'
import { chatProviders, providerEntry } from '../chatProviders'
import { useChatStore } from '../stores/chat'
import { api } from '../services/tauri'
import type { Attachment } from '../types'

const chat = useChatStore()
const activeProvider = computed(()=>chatProviders.find(p=>p.id===providerEntry(chat.settings.provider))!)
const openProvider=()=>window.dispatchEvent(new Event('chat-provider-config'))
const emit = defineEmits<{ preview: [attachment: Attachment] }>()
const text = ref('')
const attachments = ref<Attachment[]>([])
const uploading = ref(false)
const uploadError = ref('')
const fileInput = ref<HTMLInputElement>()
const textarea = ref<HTMLTextAreaElement>()
const resize = () => { if (!textarea.value) return; textarea.value.style.height = 'auto'; textarea.value.style.height = `${Math.min(textarea.value.scrollHeight, 180)}px` }
const submit = () => { const value = text.value.trim(); if ((!value && !attachments.value.length) || chat.loading || uploading.value) return; chat.send(value, [...attachments.value]); text.value = ''; attachments.value = []; nextTick(() => { resize(); textarea.value?.focus() }) }
const addFiles = async (files: FileList | File[]) => { uploadError.value = ''; uploading.value = true; for (const file of Array.from(files)) { try { if (attachments.value.length >= 8) throw new Error('每条消息最多 8 个附件'); if (attachments.value.reduce((sum, item) => sum + item.size, 0) + file.size > 30 * 1024 * 1024) throw new Error('每条消息附件总大小最多 30 MB'); const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) }); const extension = file.name.split('.').at(-1)?.toLowerCase(); const mime = file.type || (extension === 'md' ? 'text/markdown' : extension === 'txt' ? 'text/plain' : ''); attachments.value.push(await api.parseAttachment(file.name, mime, data)) } catch (e) { uploadError.value = `${file.name}: ${String(e)}` } } uploading.value = false }
const onPaste = (event: ClipboardEvent) => { const files = event.clipboardData?.files; if (files?.length) { event.preventDefault(); addFiles(files) } }
const onDropFiles = (event: Event) => { if (!api.isTauri) addFiles((event as CustomEvent<File[]>).detail) }
const addPaths = async (paths: string[]) => { uploadError.value = ''; uploading.value = true; for (const path of paths) { try { if (attachments.value.length >= 8) throw new Error('每条消息最多 8 个附件'); const attachment = await api.parseAttachmentPath(path); if (attachments.value.reduce((sum, item) => sum + item.size, 0) + attachment.size > 30 * 1024 * 1024) throw new Error('每条消息附件总大小最多 30 MB'); attachments.value.push(attachment) } catch (e) { uploadError.value = `${path}: ${String(e)}` } } uploading.value = false }
const onDropPaths = (event: Event) => addPaths((event as CustomEvent<string[]>).detail)
const chooseFiles = async () => { if (!api.isTauri) { fileInput.value?.click(); return } try { const { open } = await import('@tauri-apps/plugin-dialog'); const selected = await open({ multiple: true, filters: [{ name: '图片、文档与代码', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'docx', 'txt', 'md', 'py', 'cpp', 'c', 'h', 'hpp', 'java', 'js', 'ts', 'vue', 'rs', 'go', 'sh', 'json', 'yaml', 'yml'] }] }); if (selected) await addPaths(Array.isArray(selected) ? selected : [selected]) } catch (error) { uploadError.value = String(error) } }
onMounted(() => { window.addEventListener('chat-drop-files', onDropFiles); window.addEventListener('chat-drop-paths', onDropPaths) })
onUnmounted(() => { window.removeEventListener('chat-drop-files', onDropFiles); window.removeEventListener('chat-drop-paths', onDropPaths) })
const keydown = (event: KeyboardEvent) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }
const persistWebSearch = () => chat.saveSettings({ ...chat.settings, apiKey: '' })
</script>

<template>
  <div class="input-wrap">
    <div class="input-box">
      <div v-if="attachments.length" class="attachment-list"><div v-for="(item,index) in attachments" :key="item.id" class="attachment-card"><img v-if="item.kind === 'image'" :src="`data:${item.mime};base64,${item.data}`" :alt="item.name"/><span v-else class="attachment-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/><path v-if="item.kind === 'code'" d="m10 12-2 2 2 2m4-4 2 2-2 2"/><path v-else d="M9 13h6m-6 3h6"/></svg></span><button v-if="item.kind === 'document' || item.kind === 'code'" class="attachment-preview-trigger" type="button" :aria-label="`预览 ${item.name}`" @click="emit('preview', item)"><strong>{{ item.name }}</strong><small>{{ Math.ceil(item.size / 1024) }} KB · {{ item.text && item.text.length > 16000 ? '仅发送前 16,000 字符' : '点击预览' }}</small></button><div v-else><strong>{{ item.name }}</strong><small>{{ Math.ceil(item.size / 1024) }} KB · 图片</small></div><button aria-label="移除附件" @click="attachments.splice(index,1)">×</button></div></div><p v-if="attachments.some(item => item.kind !== 'image')" class="attachment-hint">每个文本附件最多发送前 16,000 字符；本次请求的附件文本合计最多 24,000 字符，较旧附件可能不再发送。</p>
      <p v-if="uploadError" class="upload-error">{{ uploadError }}</p><p v-if="uploading" class="upload-status">正在解析附件…</p>
      <textarea ref="textarea" v-model="text" rows="1" placeholder="发送消息…" @input="resize" @keydown="keydown" @paste="onPaste" />
      <div class="input-footer">
        <div class="input-options">
          <input ref="fileInput" class="hidden-file" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.docx,.txt,.md,.py,.cpp,.c,.h,.hpp,.java,.js,.ts,.vue,.rs,.go,.sh,.json,.yaml,.yml" @change="addFiles(($event.target as HTMLInputElement).files || []); ($event.target as HTMLInputElement).value = ''"/><button class="attach-button" type="button" @click="chooseFiles">＋ 附件</button>
          <label class="search-toggle">上下文 <select v-model="chat.settings.contextMode" @change="persistWebSearch"><option value="full">完整</option><option value="recent">最近 N 轮</option><option value="smart">智能压缩</option></select></label><input v-if="chat.settings.contextMode === 'recent'" v-model.number="chat.settings.recentTurns" type="number" min="1" max="100" style="width:3.5rem" @change="persistWebSearch" />
        </div>
        <div class="input-actions">
          <button class="composer-provider-button" aria-label="配置当前聊天服务" :disabled="chat.loading" @click="openProvider"><span>{{ chat.settings.baseUrl ? activeProvider.name : '配置 API' }}</span><small>{{ chat.settings.model || '开始聊天' }}</small><span>⌄</span></button>
          <button v-if="chat.loading" class="stop" @click="chat.stop">■ 停止</button><button v-else class="send" :disabled="(!text.trim() && !attachments.length) || uploading" @click="submit">↑</button>
        </div>
      </div>
    </div>
    <p>AI 可能会出错，请核查重要信息。</p>
  </div>
</template>
