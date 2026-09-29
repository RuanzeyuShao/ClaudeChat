<script setup lang="ts">
import { useChatStore } from '../stores/chat'
const emit = defineEmits<{ openSettings: [] }>(); const chat = useChatStore()
const rename = async (id: string, old: string) => { const title = prompt('会话名称', old)?.trim(); if (title) await chat.rename(id, title) }
</script>
<template>
  <aside class="sidebar">
    <div class="brand"><span>✦</span> ClaudeChat</div>
    <button class="new-chat" @click="chat.newConversation">＋ 新建对话</button>
    <div class="history-label">历史会话</div>
    <nav class="conversation-list"><div v-for="item in chat.conversations" :key="item.id" :class="['conversation', { active: item.id === chat.activeId }]" @click="chat.select(item.id)"><span class="conversation-title">{{ item.title }}</span><span class="conversation-actions"><button @click.stop="rename(item.id, item.title)">✎</button><button @click.stop="chat.remove(item.id)">×</button></span></div></nav>
    <button class="settings-button" @click="emit('openSettings')">⚙ 设置</button>
  </aside>
</template>
