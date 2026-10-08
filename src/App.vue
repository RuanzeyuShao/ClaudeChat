<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import Sidebar from './components/Sidebar.vue'
import PaneResizeHandle from './components/PaneResizeHandle.vue'
import ChatView from './views/ChatView.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { useChatStore } from './stores/chat'

const chat = useChatStore()
import type { ProviderKind } from './types'
const settingsProvider=ref<ProviderKind>()
const settingsProfileId=ref<string>()
const openSettings=(provider?:ProviderKind,profileId?:string)=>{settingsProvider.value=provider;settingsProfileId.value=profileId;showSettings.value=true}
const showSettings = ref(false)
const page = ref<'chat' | 'usage'>('chat')
const UsageDashboard = defineAsyncComponent(() => import('./views/UsageDashboard.vue'))
const viewportWidth = ref(window.innerWidth)
const savedSidebarWidth = Number(localStorage.getItem('claudechat.sidebarWidth'))
const preferredSidebarWidth = ref(savedSidebarWidth >= 180 ? savedSidebarWidth : 264)
const sidebarMaximum = computed(() => Math.min(440, Math.floor(viewportWidth.value * .35), viewportWidth.value - (viewportWidth.value > 1180 ? 834 : 360)))
const sidebarWidth = computed(() => viewportWidth.value <= 680 ? 60 : Math.max(180, Math.min(preferredSidebarWidth.value, sidebarMaximum.value)))
const resizeSidebar = (delta: number) => {
  if (viewportWidth.value <= 680) return
  preferredSidebarWidth.value = Math.max(180, Math.min(sidebarWidth.value + delta, sidebarMaximum.value))
  localStorage.setItem('claudechat.sidebarWidth', String(preferredSidebarWidth.value))
}
const onWindowResize = () => { viewportWidth.value = window.innerWidth }
onMounted(() => { window.addEventListener('resize', onWindowResize); chat.initialize().catch(e=>{chat.error=String(e)}) })
onUnmounted(() => window.removeEventListener('resize', onWindowResize))
</script>

<template>
  <main class="app-shell">
    <Sidebar :page="page" :style="{ width: `${sidebarWidth}px` }" @open-settings="openSettings" @open-usage="page = 'usage'" @open-chat="page = 'chat'" />
    <PaneResizeHandle label="调整侧边栏宽度" @resize="resizeSidebar" @reset="resizeSidebar(264 - sidebarWidth)" />
    <ChatView v-show="page === 'chat'" @open-settings="openSettings" />
    <UsageDashboard v-if="page === 'usage'" />
    <SettingsPanel v-if="showSettings" :initial-provider="settingsProvider" :initial-profile-id="settingsProfileId" @close="showSettings = false" />
  </main>
</template>
