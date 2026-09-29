<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Sidebar from './components/Sidebar.vue'
import ChatView from './views/ChatView.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { useChatStore } from './stores/chat'

const chat = useChatStore()
const showSettings = ref(false)
onMounted(() => chat.initialize())
</script>

<template>
  <main class="app-shell">
    <Sidebar @open-settings="showSettings = true" />
    <ChatView @open-settings="showSettings = true" />
    <SettingsPanel v-if="showSettings" @close="showSettings = false" />
  </main>
</template>
