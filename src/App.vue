<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue'
import Sidebar from './components/Sidebar.vue'
import PaneResizeHandle from './components/PaneResizeHandle.vue'
import ChatView from './views/ChatView.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import FeedbackHost from './components/FeedbackHost.vue'
import { useUiStore } from './stores/ui'
import { useChatStore } from './stores/chat'

const chat = useChatStore()
const ui = useUiStore()
const booting=ref(true),startupFailed=ref(false)
async function initialize(){booting.value=true;startupFailed.value=false;try{await chat.initialize()}catch(e){chat.dispose();startupFailed.value=true;ui.failure(e)}finally{booting.value=false}}
const collapsed = ref(localStorage.getItem('claudechat.sidebarCollapsed') === 'true')
const sidebarCollapsed = computed(() => collapsed.value || viewportWidth.value < 760)
const toggleSidebar = () => { collapsed.value=!collapsed.value;localStorage.setItem('claudechat.sidebarCollapsed',String(collapsed.value)) }
import type { ProviderKind } from './types'
const settingsProvider=ref<ProviderKind>()
const settingsProfileId=ref<string>()
const openSettings=(provider?:ProviderKind,profileId?:string)=>{settingsProvider.value=provider;settingsProfileId.value=profileId;showSettings.value=true}
const showSettings = ref(false)
const page = ref<'chat' | 'usage'>('chat')
const usageVisited=ref(false)
function openUsage(){usageVisited.value=true;page.value='usage'}
async function closeUsage(){page.value='chat';await nextTick();document.querySelector<HTMLTextAreaElement>('[aria-label="聊天输入框"]')?.focus({preventScroll:true})}
const UsageDashboard = defineAsyncComponent(() => import('./views/UsageDashboard.vue'))
const viewportWidth = ref(window.innerWidth)
const savedSidebarWidth = Number(localStorage.getItem('claudechat.sidebarWidth'))
const preferredSidebarWidth = ref(savedSidebarWidth >= 180 ? savedSidebarWidth : 264)
const sidebarMaximum = computed(() => Math.min(440, Math.floor(viewportWidth.value * .35), viewportWidth.value - (viewportWidth.value > 1180 ? 834 : 360)))
const sidebarWidth = computed(() => sidebarCollapsed.value ? 68 : Math.max(210, Math.min(preferredSidebarWidth.value, sidebarMaximum.value)))
const resizeSidebar = (delta: number) => {
  if (viewportWidth.value <= 680) return
  preferredSidebarWidth.value = Math.max(180, Math.min(sidebarWidth.value + delta, sidebarMaximum.value))
  localStorage.setItem('claudechat.sidebarWidth', String(preferredSidebarWidth.value))
}
const onWindowResize = () => { viewportWidth.value = window.innerWidth }
function keyboard(event: KeyboardEvent) {
  if(event.defaultPrevented || event.isComposing || event.keyCode===229)return
  if(event.key==='Escape' && page.value==='usage' && !showSettings.value && !ui.dialog && !document.querySelector('[aria-modal="true"],[role="menu"],#chat-provider-panel')){event.preventDefault();void closeUsage();return}
  if(event.altKey || !(event.ctrlKey || event.metaKey) || event.shiftKey)return
  if(document.querySelector('[aria-modal="true"]'))return
  const key=event.key.toLowerCase()
  if(key==='n'){event.preventDefault();void chat.newConversation().then(()=>page.value='chat').catch(ui.failure)}
  if(key==='k'){event.preventDefault();if(collapsed.value)toggleSidebar();window.dispatchEvent(new Event('chat-search-history'))}
  if(key===','){event.preventDefault();openSettings()}
  if(key==='l'){event.preventDefault();void closeUsage()}
}
onMounted(() => { window.addEventListener('resize', onWindowResize); window.addEventListener('keydown',keyboard); void initialize() })
onUnmounted(() => {window.removeEventListener('resize', onWindowResize);window.removeEventListener('keydown',keyboard);chat.dispose()})
</script>

<template>
  <main class="app-shell">
    <div v-if="booting" class="app-boot" role="status" aria-label="正在载入本地会话"><div class="boot-sidebar"/><div class="boot-content"><div/><div/><div/><p>正在载入本地会话…</p></div></div>
    <div v-else-if="startupFailed" class="startup-error" role="alert"><p>本地数据未能载入，请重试。</p><button class="primary" @click="initialize">重新载入</button></div>
    <Sidebar :page="page" :collapsed="sidebarCollapsed" :width="sidebarWidth" @toggle="toggleSidebar" @open-settings="openSettings" @open-usage="openUsage" @open-chat="page = 'chat'" />
    <PaneResizeHandle v-if="!sidebarCollapsed" label="调整侧边栏宽度" @resize="resizeSidebar" @reset="preferredSidebarWidth=264" />
    <ChatView :active="page==='chat'" @open-settings="openSettings" />
    <UsageDashboard v-if="usageVisited" v-show="page==='usage'" :active="page==='usage'" @close="closeUsage" />
    <SettingsPanel v-if="showSettings" :initial-provider="settingsProvider" :initial-profile-id="settingsProfileId" @close="showSettings = false" />
    <FeedbackHost/>
  </main>
</template>
