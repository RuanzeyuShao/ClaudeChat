<script setup lang="ts">
import { nextTick, ref, watch, onMounted, onUnmounted } from 'vue'; import { useChatStore } from '../stores/chat'; import MessageItem from '../components/MessageItem.vue'; import ChatInput from '../components/ChatInput.vue'; import DocumentPreview from '../components/DocumentPreview.vue'; import { api } from '../services/tauri'; import type { Attachment } from '../types'
const chat = useChatStore(); const list = ref<HTMLElement>(); watch(() => chat.active?.messages.length, async () => { await nextTick(); list.value?.scrollTo({ top: list.value.scrollHeight, behavior: 'smooth' }) })
const preview = ref<Attachment | null>(null); watch(() => chat.activeId, () => preview.value = null)
const dragging = ref(false); const exportError = ref(''); const exportStatus = ref(''); const exporting = ref(false)
const drop = (event: DragEvent) => { event.preventDefault(); dragging.value = false; if (event.dataTransfer?.files.length) window.dispatchEvent(new CustomEvent('chat-drop-files', { detail: Array.from(event.dataTransfer.files) })) }
let unlisten: (() => void) | undefined
onMounted(async () => { if (!api.isTauri) return; const { getCurrentWebview } = await import('@tauri-apps/api/webview'); unlisten = await getCurrentWebview().onDragDropEvent(event => { if (event.payload.type === 'over') dragging.value = true; if (event.payload.type === 'leave') dragging.value = false; if (event.payload.type === 'drop') { dragging.value = false; window.dispatchEvent(new CustomEvent('chat-drop-paths', { detail: event.payload.paths })) } }) })
onUnmounted(() => unlisten?.())
const exportChat = async (format: 'md' | 'pdf') => { if (!chat.active || !api.isTauri) return; exportError.value = ''; exportStatus.value = ''; try { const { save } = await import('@tauri-apps/plugin-dialog'); const path = await save({ defaultPath: `${chat.active.title}.${format}`, filters: [{ name: format === 'md' ? 'Markdown' : 'PDF', extensions: [format] }] }); if (!path) return; exporting.value = true; await api.exportConversation(chat.active.id, format, path); exportStatus.value = `已导出到 ${path}` } catch (e) { exportError.value = String(e) } finally { exporting.value = false } }
const editPrompt = async () => { const prompt = window.prompt('此会话的 System Prompt（留空使用全局默认）', chat.active?.systemPrompt || ''); if (prompt !== null) await chat.setConversationPrompt(prompt) }
</script>
<template>
  <section class="chat-view" :class="{ 'drag-over': dragging }" @dragenter.prevent="dragging = true" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop="drop">
    <header class="chat-header"><strong>{{ chat.active?.title || 'ClaudeChat' }}</strong><div class="header-actions"><span v-if="exportStatus" class="export-status" :title="exportStatus">导出完成 ✓</span><button @click="editPrompt">⌘ 会话 Prompt</button><button :disabled="exporting" @click="exportChat('md')">{{ exporting ? '导出中…' : '导出 MD' }}</button><button :disabled="exporting" @click="exportChat('pdf')">{{ exporting ? '导出中…' : '导出 PDF' }}</button></div></header>
    <div v-if="dragging" class="drop-overlay">松开以添加图片或文档</div>
    <div class="chat-content">
      <div class="chat-main">
        <div ref="list" class="messages"><div v-if="!chat.active?.messages.length" class="empty"><div class="star">✦</div><h1>今天想一起做什么？</h1><p>ClaudeChat 在本地保存你的会话历史。</p></div><MessageItem v-for="(message, index) in chat.active?.messages" :key="message.id" :message="message" :can-regenerate="message.role === 'assistant' && index === (chat.active?.messages.length ?? 0) - 1 && !chat.loading" @regenerate="chat.regenerate" @preview="preview = $event"/><p v-if="chat.error || exportError" class="error">{{ chat.error || exportError }}</p></div>
        <ChatInput @preview="preview = $event" />
      </div>
      <DocumentPreview v-if="preview" :attachment="preview" @close="preview = null" />
    </div>
  </section>
</template>
