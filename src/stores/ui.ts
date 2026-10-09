import { defineStore } from 'pinia'
import { ref } from 'vue'
import { friendlyError } from '../utils/experience'

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<{ id: number; message: string; kind: 'success' | 'error' | 'info'; action?: () => void; actionLabel?: string }[]>([])
  let sequence = 0
  const dismiss = (id: number) => { toasts.value = toasts.value.filter(t => t.id !== id) }
  function notify(message: string, kind: 'success' | 'error' | 'info' = 'success', action?: () => void, actionLabel = '重试') {
    const id = ++sequence
    toasts.value.push({ id, message, kind, action, actionLabel })
    if (toasts.value.length > 4) dismiss(toasts.value[0].id)
    setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 4500)
  }
  const failure = (error: unknown) => notify(friendlyError(error), 'error')
  const dialog = ref<{ title: string; description?: string; value?: string; multiline?: boolean; danger?: boolean; confirm: string } | null>(null)
  let resolveDialog: ((value: string | null) => void) | undefined
  function request(options: NonNullable<typeof dialog.value>): Promise<string | null> {
    resolveDialog?.(null)
    dialog.value = options
    return new Promise(resolve => { resolveDialog = resolve })
  }
  function settle(value: string | null) { dialog.value = null; resolveDialog?.(value); resolveDialog = undefined }
  return { toasts, notify, dismiss, failure, dialog, request, settle }
})
