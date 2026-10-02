<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'; import { useChatStore } from '../stores/chat'; import { api } from '../services/tauri'; import type { Conversation } from '../types'
defineProps<{ page: 'chat' | 'usage' }>()
const emit = defineEmits<{ openSettings: []; openUsage: []; openChat: [] }>(); const chat = useChatStore()
const query = ref(''); const results = ref<Conversation[]>([]); let sequence = 0
const searchOpen = ref(false); const searchInput = ref<HTMLInputElement>()
const toggleSearch = async () => { searchOpen.value = !searchOpen.value; if (searchOpen.value) { await nextTick(); searchInput.value?.focus() } else query.value = '' }
watch(query, async value => { const current = ++sequence; if (!value.trim()) { results.value = []; return } try { const found = api.isTauri ? await api.searchConversations(value.trim()) : chat.conversations.filter(c => c.title.includes(value)); if (current === sequence) results.value = found } catch { if (current === sequence) results.value = [] } })
const rename = async (id: string, old: string) => { const title = prompt('会话名称', old)?.trim(); if (title) await chat.rename(id, title) }
const deleteTarget = ref<Conversation | null>(null); const deleting = ref(false); const deleteError = ref('')
const confirmDelete = async () => { if (!deleteTarget.value || deleting.value) return; deleting.value = true; deleteError.value = ''; try { await chat.remove(deleteTarget.value.id); deleteTarget.value = null } catch (error) { deleteError.value = String(error) } finally { deleting.value = false } }
</script>
<template>
  <aside class="sidebar">
    <div class="brand"><span>✦</span> ClaudeChat</div>
    <button class="new-chat" @click="chat.newConversation(); emit('openChat')">＋ 新建对话</button>
    <button class="usage-nav" :class="{ active: page === 'usage' }" type="button" @click="emit('openUsage')">▤ 用量统计</button>
    <div class="history-heading"><span class="history-label">历史会话</span><button class="history-search-toggle" type="button" :aria-label="searchOpen ? '关闭搜索' : '搜索历史对话'" :aria-expanded="searchOpen" @click="toggleSearch"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2"/></svg></button></div><input v-if="searchOpen" ref="searchInput" v-model="query" class="history-search" type="search" placeholder="搜索历史对话" aria-label="搜索历史对话" @keydown.esc="toggleSearch" />
    <nav class="conversation-list"><div v-for="item in (query.trim() ? results : chat.conversations)" :key="item.id" :class="['conversation', { active: item.id === chat.activeId && page === 'chat' }]" @click="chat.select(item.id); emit('openChat')"><span class="conversation-title">{{ item.title }}</span><span class="conversation-actions"><button @click.stop="rename(item.id, item.title)">✎</button><button @click.stop="deleteTarget = item; deleteError = ''" :aria-label="`删除 ${item.title}`">×</button></span></div><p v-if="query.trim() && !results.length" class="search-empty">没有匹配的对话</p></nav>
    <button class="settings-button" @click="emit('openSettings')">⚙ 设置</button>
    <div v-if="deleteTarget" class="modal-backdrop" @click.self="!deleting && (deleteTarget = null)"><section class="delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title"><h2 id="delete-dialog-title">删除对话？</h2><p>“{{ deleteTarget.title }}”及其消息和附件将从本地历史中删除。</p><p v-if="deleteError" class="upload-error">{{ deleteError }}</p><footer><button class="secondary" type="button" :disabled="deleting" @click="deleteTarget = null">取消</button><button class="delete-confirm" type="button" :disabled="deleting" @click="confirmDelete">{{ deleting ? '正在删除…' : '确认删除' }}</button></footer></section></div>
  </aside>
</template>
