import type { ProviderKind, Settings } from '../types'

// This describes the implemented API route, not a model or gateway guarantee.
export function hasBuiltinSearchRoute(kind:ProviderKind):boolean {
 return ['anthropic-compatible','openai','moonshot','zhipu'].includes(kind)
}
export function builtinSearchHelp(kind:ProviderKind):string {
 switch(kind){
  case 'anthropic-compatible':return '调用 Claude API 搜索工具。模型、账号和当前 API 地址都须支持；中转站不一定转发搜索工具。'
  case 'openai':return '当前使用 Chat Completions 搜索接口，仅搜索专用模型可用；普通 GPT 模型不能仅靠勾选开启。可填写搜索专用模型，或使用 SearXNG。'
  case 'moonshot':return '当前调用 Kimi 的 $web_search 接口，并非所有 Kimi 模型都支持；新模型可能要求其他搜索接口。不支持时请使用 SearXNG。'
  case 'zhipu':return '当前调用 GLM API 的 web_search 工具；模型、账号和当前 API 地址都须支持。'
  case 'openai-compatible':return '通用 OpenAI 兼容协议没有统一的内置搜索约定，本客户端当前未接入此路径。请使用 SearXNG。'
  case 'grok':return '当前 Grok 适配器使用 Chat Completions，尚未接入 Grok 的专用搜索接口。请使用 SearXNG。'
  case 'deepseek':return '当前 DeepSeek API 适配器未接入内置搜索；网页端的联网功能不等于此 API 的能力。请使用 SearXNG。'
 }
}
export function validateSearch(settings:Pick<Settings,'provider'|'searchMode'|'searchProvider'|'searchBaseUrl'> & {webSearch?:boolean}):void {
 if(settings.searchMode==='off' || (settings.searchMode==='auto' && settings.webSearch===false))return
 if(settings.searchProvider==='claude' && !hasBuiltinSearchRoute(settings.provider))throw new Error(builtinSearchHelp(settings.provider))
 if(settings.searchProvider==='searxng'){
  if(!settings.searchBaseUrl.trim())throw new Error('请先在搜索设置中填写 SearXNG 地址，或选择“不联网”。')
  let url:URL
  try{url=new URL(settings.searchBaseUrl.trim())}catch{throw new Error('搜索地址无效，请填写完整的 HTTP 或 HTTPS 地址（SearXNG）。')}
  if(!['http:','https:'].includes(url.protocol))throw new Error('搜索地址仅支持 HTTP 或 HTTPS（SearXNG）。')
 }
}
