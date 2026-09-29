<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onUnmounted } from 'vue'
import { modelOptions } from '../models'
import { useChatStore } from '../stores/chat'
import { api } from '../services/tauri'
import type { Attachment } from '../types'

const chat = useChatStore()
const emit = defineEmits<{ preview: [attachment: Attachment] }>()
const text = ref('')
const attachments = ref<Attachment[]>([])
const uploading = ref(false)
const uploadError = ref('')
const fileInput = ref<HTMLInputElement>()
const textarea = ref<HTMLTextAreaElement>()
const modelDraft = ref(chat.settings.model)
const modelOpen = ref(false)
const thinking = computed(() => Math.max(0, ['off', 'low', 'medium', 'high'].indexOf(chat.settings.thinking)))
const labels = ['Off', 'Low', 'Medium', 'High']
watch(() => chat.settings.model, value => { modelDraft.value = value })
const resize = () => { if (!textarea.value) return; textarea.value.style.height = 'auto'; textarea.value.style.height = `${Math.min(textarea.value.scrollHeight, 180)}px` }
const submit = () => { const value = text.value.trim(); if ((!value && !attachments.value.length) || chat.loading || uploading.value) return; chat.send(value, [...attachments.value]); text.value = ''; attachments.value = []; nextTick(() => { resize(); textarea.value?.focus() }) }
const addFiles = async (files: FileList | File[]) => { uploadError.value = ''; uploading.value = true; for (const file of Array.from(files)) { try { if (attachments.value.length >= 8) throw new Error('每条消息最多 8 个附件'); if (attachments.value.reduce((sum, item) => sum + item.size, 0) + file.size > 30 * 1024 * 1024) throw new Error('每条消息附件总大小最多 30 MB'); const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) }); const extension = file.name.split('.').at(-1)?.toLowerCase(); const mime = file.type || (extension === 'md' ? 'text/markdown' : extension === 'txt' ? 'text/plain' : ''); attachments.value.push(await api.parseAttachment(file.name, mime, data)) } catch (e) { uploadError.value = `${file.name}: ${String(e)}` } } uploading.value = false }
const onPaste = (event: ClipboardEvent) => { const files = event.clipboardData?.files; if (files?.length) { event.preventDefault(); addFiles(files) } }
const onDropFiles = (event: Event) => { if (!api.isTauri) addFiles((event as CustomEvent<File[]>).detail) }
const addPaths = async (paths: string[]) => { uploadError.value = ''; uploading.value = true; for (const path of paths) { try { if (attachments.value.length >= 8) throw new Error('每条消息最多 8 个附件'); const attachment = await api.parseAttachmentPath(path); if (attachments.value.reduce((sum, item) => sum + item.size, 0) + attachment.size > 30 * 1024 * 1024) throw new Error('每条消息附件总大小最多 30 MB'); attachments.value.push(attachment) } catch (e) { uploadError.value = `${path}: ${String(e)}` } } uploading.value = false }
const onDropPaths = (event: Event) => addPaths((event as CustomEvent<string[]>).detail)
const chooseFiles = async () => { if (!api.isTauri) { fileInput.value?.click(); return } try { const { open } = await import('@tauri-apps/plugin-dialog'); const selected = await open({ multiple: true, filters: [{ name: '图片与文档', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'docx', 'txt', 'md'] }] }); if (selected) await addPaths(Array.isArray(selected) ? selected : [selected]) } catch (error) { uploadError.value = String(error) } }
onMounted(() => { window.addEventListener('chat-drop-files', onDropFiles); window.addEventListener('chat-drop-paths', onDropPaths) })
onUnmounted(() => { window.removeEventListener('chat-drop-files', onDropFiles); window.removeEventListener('chat-drop-paths', onDropPaths) })
const keydown = (event: KeyboardEvent) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }
const chooseModel = async (model: string) => { modelDraft.value = model; modelOpen.value = false; await chat.setModel(model) }
const saveCustomModel = () => { if (modelDraft.value.trim()) chooseModel(modelDraft.value.trim()) }
const persistWebSearch = () => chat.saveSettings({ ...chat.settings, apiKey: '' })
</script>

<template>
  <div class="input-wrap">
    <div class="input-box">
      <div v-if="attachments.length" class="attachment-list"><div v-for="(item,index) in attachments" :key="item.id" class="attachment-card"><img v-if="item.kind === 'image'" :src="`data:${item.mime};base64,${item.data}`" :alt="item.name"/><span v-else>▤</span><button v-if="item.kind === 'document'" class="attachment-preview-trigger" type="button" :aria-label="`预览 ${item.name}`" @click="emit('preview', item)"><strong>{{ item.name }}</strong><small>{{ Math.ceil(item.size / 1024) }} KB · {{ item.text && item.text.length > 16000 ? '仅发送前 16,000 字符' : '点击预览' }}</small></button><div v-else><strong>{{ item.name }}</strong><small>{{ Math.ceil(item.size / 1024) }} KB · 图片</small></div><button aria-label="移除附件" @click="attachments.splice(index,1)">×</button></div></div><p v-if="attachments.some(item => item.kind === 'document')" class="attachment-hint">每个文档最多发送前 16,000 字符；本次请求的文档文本合计最多 24,000 字符，较旧附件可能不再发送。</p>
      <p v-if="uploadError" class="upload-error">{{ uploadError }}</p><p v-if="uploading" class="upload-status">正在解析附件…</p>
      <textarea ref="textarea" v-model="text" rows="1" placeholder="给 Claude 发送消息…" @input="resize" @keydown="keydown" @paste="onPaste" />
      <div class="input-footer">
        <div class="input-options">
          <input ref="fileInput" class="hidden-file" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.docx,.txt,.md,text/markdown" @change="addFiles(($event.target as HTMLInputElement).files || []); ($event.target as HTMLInputElement).value = ''"/><button class="attach-button" type="button" @click="chooseFiles">＋ 附件</button>
          <label class="search-toggle"><input v-model="chat.settings.webSearch" type="checkbox" @change="persistWebSearch" /> 网络搜索</label>
          <label class="thinking-slider"><span>思考 {{ labels[thinking] }}</span><input type="range" min="0" max="3" :value="thinking" @change="chat.setThinking(Number(($event.target as HTMLInputElement).value))" /></label>
        </div>
        <div class="input-actions">
          <div class="model-selector">
            <button class="model-trigger" type="button" :aria-expanded="modelOpen" @click="modelOpen = !modelOpen">{{ modelOptions.find(item => item.id === chat.settings.model)?.label || chat.settings.model }} <span>⌄</span></button>
            <div v-if="modelOpen" class="model-menu">
              <p>选择模型</p>
              <button v-for="item in modelOptions" :key="item.id" type="button" :class="{ selected: chat.settings.model === item.id }" @click="chooseModel(item.id)"><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></button>
              <div class="custom-model"><input v-model="modelDraft" aria-label="自定义模型 ID" placeholder="自定义模型 ID" @keydown.enter.prevent="saveCustomModel" /><button type="button" @click="saveCustomModel">使用</button></div>
            </div>
          </div>
          <button v-if="chat.loading" class="stop" @click="chat.stop">■ 停止</button><button v-else class="send" :disabled="(!text.trim() && !attachments.length) || uploading" @click="submit">↑</button>
        </div>
      </div>
    </div>
    <p>Claude 可能会出错，请核查重要信息。</p>
  </div>
</template>
