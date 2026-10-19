import { defineStore } from 'pinia'
import { ref } from 'vue'
import { friendlyError, errorDetails } from '../utils/experience'

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<{ id: number; message: string; kind: 'success' | 'error' | 'info'; action?: () => void; actionLabel?: string; details?:string }[]>([])
  const errorDetail=ref('')
  let sequence = 0
  const dismiss = (id: number) => { toasts.value = toasts.value.filter(t => t.id !== id) }
  function notify(message: string, kind: 'success' | 'error' | 'info' = 'success', action?: () => void, actionLabel = '重试', details?:string) {
    const id = ++sequence
    toasts.value.push({ id, message, kind, action, actionLabel, details })
    if (toasts.value.length > 4) dismiss(toasts.value[0].id)
    setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 4500)
  }
  const failure = (error: unknown) => notify(friendlyError(error), 'error',undefined,'重试',errorDetails(error))
  async function copyError(){try{await navigator.clipboard.writeText(errorDetail.value);notify('错误详情已复制')}catch{notify('复制失败，请手动选择详情复制','error')}}
  const dialog = ref<{ title: string; description?: string; value?: string; multiline?: boolean; readonly?:boolean; danger?: boolean; confirm: string } | null>(null)
  let resolveDialog: ((value: string | null) => void) | undefined
  function request(options: NonNullable<typeof dialog.value>): Promise<string | null> {
    resolveDialog?.(null)
    dialog.value = options
    return new Promise(resolve => { resolveDialog = resolve })
  }
  function settle(value: string | null) { dialog.value = null; resolveDialog?.(value); resolveDialog = undefined }
  return { toasts, notify, dismiss, failure, errorDetail, copyError, dialog, request, settle }
})
