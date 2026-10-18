import type { Attachment, Message, Settings } from '../types'

// Keep the conservative intent vocabulary in sync with commands::search_intent.
export function searchIntent(settings:Settings,content:string):boolean {
  if(settings.searchMode==='off')return false
  if(settings.searchMode==='force')return true
  if(!settings.webSearch)return false
  const text=content.toLowerCase()
  return ['搜索','检索','查一下','查找资料','联网','最新','今天','今日','实时','新闻','天气','股价','汇率','search the web','look up','latest','today','current price','weather','news'].some(word=>text.includes(word))
}

export function contextSummary(history:Message[],settings:Settings,text='',attachments:Attachment[]=[]){
  const current=text.trim() || attachments.length?'__current__':null
  let messages=history.filter(m=>!m.pending)
  if(current)messages=[...messages,{id:current,role:'user',content:text,attachments,createdAt:''}]
  if(settings.contextMode==='recent')messages=messages.slice(-Math.max(1,settings.recentTurns)*2)
  if(settings.contextMode==='smart' && messages.length>20){const summary=messages.slice(0,-16).map(m=>`${m.role}: ${m.content.slice(0,180)}`).join('\n').slice(0,5000);messages=[{id:'summary',role:'user',content:`早期对话摘要：\n${summary}`,createdAt:''},...messages.slice(-16)]}
  if(settings.selectedMessageIds.length)messages=messages.filter(m=>m.id===current || settings.selectedMessageIds.includes(m.id))
  let budget=24000,count=0,chars=settings.systemPrompt.length
  for(const message of messages){
    chars+=message.content.length+(message.references || []).reduce((n,r)=>n+r.text.length,0)
    for(const file of message.attachments || []){
      if(message.id!==current && settings.selectedAttachmentIds.length && !settings.selectedAttachmentIds.includes(file.id))continue
      count++;const length=Math.min(file.text?.length || 0,16000,budget);chars+=length;budget-=length
    }
  }
  // Images have model-dependent token costs; the UI explicitly labels this a text estimate.
  return {messages:messages.length,attachments:count,tokens:Math.ceil(chars/4)}
}
