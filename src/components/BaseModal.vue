<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { X } from '@lucide/vue'
defineProps<{ title: string; wide?: boolean; busy?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const root = ref<HTMLElement>()
const previous = document.activeElement as HTMLElement | null
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); emit('close') }
  if (event.key !== 'Tab') return
  const nodes = Array.from(root.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') || []).filter(n => n.offsetParent !== null)
  if (!nodes.length) return
  const first = nodes[0], last = nodes.at(-1)!
  if (event.shiftKey && (document.activeElement === first || !root.value?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (document.activeElement === last || !root.value?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
}
onMounted(async () => { await nextTick(); (root.value?.querySelector<HTMLElement>('[autofocus],input,textarea') || root.value)?.focus() })
onUnmounted(() => { if (previous?.isConnected) previous.focus() })
</script>
<template>
  <Teleport to="body"><div class="modal-backdrop" @click.self="!busy && emit('close')"><section ref="root" class="modal-surface" :class="{wide}" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown="keyboard"><header><h2>{{ title }}</h2><button class="icon-button" aria-label="关闭弹窗" :disabled="busy" @click="emit('close')"><X :size="18"/></button></header><div class="modal-content"><slot/></div><footer v-if="$slots.footer"><slot name="footer"/></footer></section></div></Teleport>
</template>
