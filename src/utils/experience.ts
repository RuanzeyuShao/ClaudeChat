import type { Message } from '../types'

export function shouldSend(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing' | 'keyCode'>, composing: boolean, mode: 'enter' | 'ctrl-enter') {
  if (composing || event.isComposing || event.keyCode === 229 || event.key !== 'Enter' || event.shiftKey || event.altKey) return false
  return mode === 'ctrl-enter' ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey
}
export const nearBottom = (element: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>, threshold = 100) => element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
export function friendlyError(error: unknown): string {
  const text = String(error).replace(/^Error:\s*/,'')
  if (/401|unauthori|invalid.*key|密钥/i.test(text)) return 'API 密钥无效或缺失，请检查当前 API 配置。'
  if (/403|forbidden/i.test(text)) return '此连接没有访问权限，请检查账户或模型权限。'
  if (/429|rate.limit/i.test(text)) return '请求过于频繁或额度不足，请稍后重试。'
  if (/timeout|timed.out|超时/i.test(text)) return '连接超时，请检查网络和 API 地址后重试。'
  if (/502|503|504|500|网关/i.test(text)) return '服务暂时不可用，请稍后重试或切换 API 配置。'
  if (/network|fetch|connect|dns|error sending request/i.test(text)) return '无法连接服务，请检查网络和 API 地址。'
  if (/No such file|os error 2|系统找不到|cannot find/i.test(text)) return '文件未找到，请重新选择或上传原文件。'
  if (/^[\u4e00-\u9fa5]/.test(text) && text.length < 180 && !/https?:|Bearer|sk-/i.test(text)) return text
  return '操作未完成，请检查配置或文件后重试。'
}
export function historyGroup(timestamp: string, now = new Date()): string {
  const date = new Date(timestamp)
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const other = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const age = Math.round((day - other) / 86400000)
  return age <= 0 ? '今天' : age === 1 ? '昨天' : age < 7 ? '过去 7 天' : age < 30 ? '过去 30 天' : '更早'
}
export function treeRows(messages: Message[], collapsed: Set<string>) {
  const ids = new Set(messages.map(m => m.id))
  const children = new Map<string | null, Message[]>()
  for (const message of messages) {
    const key = message.parentId && ids.has(message.parentId) ? message.parentId : null
    const siblings = children.get(key) || []; siblings.push(message); children.set(key, siblings)
  }
  const rows: { message: Message; depth: number; hasChildren: boolean }[] = []
  const stack = (children.get(null) || []).slice().reverse().map(message => ({ message, depth: 0 }))
  const seen = new Set<string>()
  while (stack.length) {
    const row = stack.pop()!
    if (seen.has(row.message.id)) continue
    seen.add(row.message.id)
    const next = children.get(row.message.id) || []
    rows.push({ ...row, hasChildren: next.length > 0 })
    if (!collapsed.has(row.message.id)) for (let i = next.length - 1; i >= 0; i--) stack.push({ message: next[i], depth: row.depth + 1 })
  }
  return rows
}
