<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { MoreHorizontal } from '@lucide/vue'
defineProps<{ label?: string }>()
const open = ref(false), root = ref<HTMLElement>(), popup = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>()
const position = ref({ left: '0px', top: '0px', maxHeight: '400px' })
async function toggle() {
  open.value = !open.value
  if (!open.value) return
  await nextTick()
  const r = trigger.value!.getBoundingClientRect(), height = popup.value!.offsetHeight
  const top = r.bottom + height + 8 > window.innerHeight ? Math.max(8, r.top - height - 8) : r.bottom + 8
  position.value = { left: `${Math.max(8, Math.min(r.right - 224, window.innerWidth - 232))}px`, top: `${top}px`, maxHeight: `${window.innerHeight - top - 8}px` }
  popup.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
}
function close() { open.value = false }
defineExpose({ show: () => { if (!open.value) void toggle() } })
function outside(event: PointerEvent) { if (!root.value?.contains(event.target as Node) && !popup.value?.contains(event.target as Node)) close() }
function keyboard(event: KeyboardEvent) {
  if (!open.value) return
  if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); trigger.value?.focus() }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const nodes = Array.from(popup.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
    const index = nodes.indexOf(document.activeElement as HTMLButtonElement)
    nodes[(index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus()
  }
  if (event.key === 'Tab') close()
}
onMounted(() => { document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keyboard, true); window.addEventListener('resize', close) })
onUnmounted(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard, true); window.removeEventListener('resize', close) })
</script>
<template><span ref="root" class="action-menu"><button ref="trigger" class="icon-button" :aria-label="label || '更多操作'" :title="label || '更多操作'" :aria-expanded="open" aria-haspopup="menu" @click.stop="toggle"><slot name="trigger"><MoreHorizontal :size="18"/></slot></button><Teleport to="body"><div v-if="open" ref="popup" role="menu" :aria-label="label || '更多操作'" class="menu-popover" :style="position" @click="close"><slot/></div></Teleport></span></template>
