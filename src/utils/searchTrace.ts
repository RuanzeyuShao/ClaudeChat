import type { Message } from '../types'

export function searchQueries(message: Message): string[] {
  const queries = new Set<string>()
  if (message.searchTrace?.query) queries.add(message.searchTrace.query)
  const read = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      if (['query', 'queries', 'search_query', 'search_queries', 'keywords'].includes(key)) {
        if (typeof item === 'string' && item.trim()) queries.add(item)
        else if (Array.isArray(item)) item.filter((q): q is string => typeof q === 'string').forEach(q => queries.add(q))
      } else if (typeof item === 'object') read(item)
    }
  }
  const fragments = new Map<string, string>()
  for (const event of message.searchTrace?.events || []) {
    read(event)
    const e = event as { index?: number; partial_json?: string; toolCalls?: {index?:number;function?:{arguments?:string}}[] }
    if (e.partial_json) fragments.set(`anthropic:${e.index || 0}`, (fragments.get(`anthropic:${e.index || 0}`) || '') + e.partial_json)
    for (const tool of e.toolCalls || []) if (tool.function?.arguments) fragments.set(`tool:${tool.index || 0}`, (fragments.get(`tool:${tool.index || 0}`) || '') + tool.function.arguments)
  }
  for (const fragment of fragments.values()) { try { read(JSON.parse(fragment)) } catch { /* incomplete provider metadata */ } }
  return [...queries]
}
