import type { Source } from '../types'
export interface SourceGroup { key:string; source:Source; numbers:number[]; citations:string[]; href?:string }
export function groupSources(sources:Source[]):SourceGroup[] {
  const groups=new Map<string,SourceGroup>()
  sources.forEach((source,index)=>{
    let href:string|undefined
    try{const url=new URL(source.url.trim());if(['https:','http:'].includes(url.protocol))href=url.href}catch{}
    const key=href || `unresolved:${index}`
    const existing=groups.get(key)
    if(existing){
      existing.numbers.push(index+1)
      if(source.citation && !existing.citations.includes(source.citation))existing.citations.push(source.citation)
      if(!existing.source.title && source.title)existing.source={...existing.source,title:source.title}
      if(!existing.source.snippet && source.snippet)existing.source={...existing.source,snippet:source.snippet}
    }else groups.set(key,{key,source:{...source},numbers:[index+1],citations:source.citation?[source.citation]:[],href})
  })
  return [...groups.values()]
}
