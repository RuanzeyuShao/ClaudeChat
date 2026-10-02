<script setup lang="ts">
import { onUnmounted } from 'vue'
defineProps<{ label: string }>()
const emit = defineEmits<{ resize: [delta: number]; reset: [] }>()
let lastX: number | null = null

const start = (event: PointerEvent) => {
  event.preventDefault()
  lastX = event.clientX
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  document.body.classList.add('resizing-panes')
}
const move = (event: PointerEvent) => {
  if (lastX === null) return
  const delta = event.clientX - lastX
  lastX = event.clientX
  if (delta) emit('resize', delta)
}
const stop = (event: PointerEvent) => {
  if (lastX === null) return
  lastX = null
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  document.body.classList.remove('resizing-panes')
}
const keydown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    emit('resize', event.key === 'ArrowLeft' ? -20 : 20)
  }
}
onUnmounted(() => document.body.classList.remove('resizing-panes'))
</script>

<template>
  <div class="pane-resize-handle" role="separator" aria-orientation="vertical" :aria-label="label" tabindex="0" title="拖动调整宽度，双击恢复默认" @pointerdown="start" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop" @dblclick="emit('reset')" @keydown="keydown" />
</template>
