import type { Source } from '../types'
import { webUrl } from './contentLinks'
export interface SourceGroup { key:string; source:Source; numbers:number[]; citations:string[]; href?:string }
export function groupSources(sources:Source[]):SourceGroup[] {
  const groups=new Map<string,SourceGroup>()
  sources.forEach((source,index)=>{
    const citation=source.citation?.startsWith('cc-')?undefined:source.citation
    const href=webUrl(source.url.trim())
    const key=href || `unresolved:${index}`
    const existing=groups.get(key)
    if(existing){
      existing.numbers.push(index+1)
      if(citation && !existing.citations.includes(citation))existing.citations.push(citation)
      if(!existing.source.title && source.title)existing.source={...existing.source,title:source.title}
      if(!existing.source.snippet && source.snippet)existing.source={...existing.source,snippet:source.snippet}
    }else groups.set(key,{key,source:{...source},numbers:[index+1],citations:citation?[citation]:[],href})
  })
  return [...groups.values()]
}
