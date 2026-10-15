import type MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import type { Source } from '../types'
import { webUrl } from './contentLinks'

interface Context { citationSources?:Source[]; citationWarnings?:Set<string> }
interface Reference { raw:string; ids:string[]; source?:number }
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))
// No positional fallback: an array position alone does not establish a provider's numbering scheme.
function sourceFor(id:string,sources:Source[]):number|undefined {
 const matches=sources.map((source,index)=>({source,index})).filter(({source})=>source.citation===id && webUrl(source.url))
 if(new Set(matches.map(({source})=>webUrl(source.url))).size!==1)return
 return matches[0]?.index
}
export function readableCitations(content:string,sources:Source[]=[]){
 for(const source of sources){if(!source.citation?.startsWith('cc-'))continue;const index=sourceFor(source.citation,sources);if(index!==undefined)content=content.split(`[${source.citation}]`).join(`[${index+1}]`)}
 return content
}
function marker(value:string):Reference|undefined {
 const double=/^\[\[(\d+)\]\]/.exec(value)
 if(double)return {raw:double[0],ids:[double[1]]}
 const basic=/^\[(\d+|cc-[\w-]+|ref[_-][\w-]+)\]/.exec(value)
 if(basic)return {raw:basic[0],ids:[basic[1]]}
 const provider=/^cite([^]+)/.exec(value)
 if(provider)return {raw:provider[0],ids:provider[1].split('')}
 const bracket=/^【([^】\n]+)】/.exec(value)
 if(bracket && /^(?:\d+|[\w-]+(?:†source|†[^】]+))$/.test(bracket[1]))return {raw:bracket[0],ids:[bracket[1].split('†')[0]]}
}
export function citationPlugin(md:MarkdownIt){
 md.inline.ruler.before('link','citation_reference',(state,silent)=>{
  if(!(state.env as Context).citationSources || (state as typeof state & {linkLevel:number}).linkLevel>0)return false
  const ref=marker(state.src.slice(state.pos));if(!ref)return false
  // Preserve Markdown links and reference links for the normal Markdown parser.
  const next=state.src[state.pos+ref.raw.length]
  const label=next==='['?/^\[([^\]]*)\]/.exec(state.src.slice(state.pos+ref.raw.length))?.[1]:undefined
  if(ref.raw.startsWith('[') && (next==='(' || (label && state.env.references?.[label.toUpperCase()]) || state.env.references?.[ref.ids[0]]))return false
  if(!silent){const token=state.push('citation_reference','sup',0);token.content=ref.raw;token.meta=ref}
  state.pos+=ref.raw.length;return true
 })
 md.core.ruler.after('inline','citation_mapping',state=>{
  const env=state.env as Context,sources=env.citationSources;if(!sources)return
  const blocks=state.tokens.filter(token=>token.type==='inline')
  // Markdown's text rule consumes Unicode provider markers as plain text; split only text nodes.
  for(const block of blocks){const output:Token[]=[];let linked=0
   for(const token of block.children || []){
    if(token.type==='link_open')linked++;if(token.type==='link_close')linked--
    if(token.type!=='text' || linked){output.push(token);continue}
    let start=0;const candidates=/【|cite/g
    for(const match of token.content.matchAll(candidates)){
     if(match.index!<start)continue
     const ref=marker(token.content.slice(match.index));if(!ref)continue
     const before=new state.Token('text','',0);before.content=token.content.slice(start,match.index);output.push(before)
     const cite=new state.Token('citation_reference','sup',0);cite.content=ref.raw;cite.meta=ref;output.push(cite);start=match.index!+ref.raw.length
    }
    if(start){const tail=new state.Token('text','',0);tail.content=token.content.slice(start);output.push(tail)}else output.push(token)
   }
   block.children=output
  }
  // An annotated response span may locate a citation even if the provider put its marker first.
  // Only one exact plain-text occurrence is accepted, never a guessed next sentence or paragraph.
  for(const [index,source] of sources.entries()){
   const anchor=source.anchor;if(!anchor || !webUrl(source.url) || /^\[\d+\]$/.test(anchor))continue
   const candidates:{children:Token[];token:Token;at:number}[]=[]
   for(const block of blocks){let linked=0;for(const token of block.children || []){
    if(token.type==='link_open')linked++;if(token.type==='link_close')linked--
    if(token.type!=='text' || linked)continue
    let at=token.content.indexOf(anchor);while(at>=0){candidates.push({children:block.children!,token,at});at=token.content.indexOf(anchor,at+1)}
   }}
   if(candidates.length!==1){env.citationWarnings?.add('来源标注的文本范围无法唯一定位');continue}
   const {children,token,at}=candidates[0],end=at+anchor.length
   // A mid-sentence annotation cannot justify extending support to the remaining assertions.
   const punctuation=/^[。！？.!?](?:[”’"）)]?)/.exec(token.content.slice(end))?.[0] || ''
   if(end<token.content.length && !punctuation && !/[。！？.!?][”’"）)]?$/.test(anchor)){env.citationWarnings?.add('来源文本范围未落在可确认的句末');continue}
   const duplicates=children.filter(child=>child.type==='citation_reference' && (child.meta as Reference).ids.includes(source.citation || ''))
   if(duplicates.some(child=>children.indexOf(child)>children.indexOf(token))){continue}
   if(duplicates.length){
    const duplicate=duplicates[0],before=children.slice(0,children.indexOf(duplicate)).map(child=>child.content).join('').trim()
    if(duplicates.length!==1 || before){env.citationWarnings?.add('引用位置与标注范围无法唯一对应');continue}
    children.splice(children.indexOf(duplicate),1)
   }
   const position=children.indexOf(token),before=new state.Token('text','',0),after=new state.Token('text','',0),cite=new state.Token('citation_reference','sup',0)
   before.content=token.content.slice(0,end+punctuation.length);after.content=token.content.slice(end+punctuation.length)
   cite.content=source.citation?`[${source.citation}]`:`[${index+1}]`;cite.meta={raw:cite.content,ids:[],source:index} satisfies Reference
   children.splice(position,1,before,cite,after)
  }
  for(const block of blocks){const children=block.children || []
   // Explicit Markdown citation links are verified against actual returned sources.
   for(let i=0;i<children.length-2;i++){
    if(children[i].type!=='link_open' || children[i+1].type!=='text' || children[i+2].type!=='link_close' || !/^\[?\d+\]?$/.test(children[i+1].content))continue
    const href=webUrl(children[i].attrGet('href') || ''),source=href?sources.findIndex(item=>webUrl(item.url)===href):-1
    if(source<0){env.citationWarnings?.add('数字链接未出现在实际返回的来源中');continue}
    const token=new state.Token('citation_reference','sup',0);token.content=children[i+1].content;token.meta={raw:token.content,ids:[],source} satisfies Reference;children.splice(i,3,token)
   }
   for(let i=0;i<children.length;i++){
    const token=children[i];if(token.type!=='citation_reference')continue
    // Punctuation immediately following a postfix reference belongs to the same sentence.
    // Move only this adjacent punctuation, never the citation across any content.
    let end=i;while(children[end+1]?.type==='citation_reference')end++
    const next=children[end+1],punctuation=next?.type==='text'?/^[。！？.!?][”’"）)]?/.exec(next.content)?.[0]:undefined
    const beforeGroup=children.slice(0,i).filter(child=>child.type!=='citation_reference').map(child=>child.content).join('').trim()
    if(punctuation && beforeGroup && !/[：:]$/.test(beforeGroup)){const text=new state.Token('text','',0);text.content=punctuation;children.splice(i,0,text);next.content=next.content.slice(punctuation.length);i++;end++}
    const preceding=children.slice(0,i).filter(child=>child.type!=='citation_reference').map(child=>child.type==='image'||child.type==='code_inline'?' ':child.content).join('').trim()
    const trailing=children.slice(end+1).map(child=>child.content).join('')
    const boundary=/[。！？.!?][”’"）)]?$/.test(preceding) || !trailing.trim() || /^\s*\n/.test(trailing)
    token.meta={...token.meta,postfix:!!preceding && !/[\n：:]$/.test(preceding) && boundary}
   }
  }
 })
 md.renderer.rules.citation_reference=(tokens,index,_options,environment)=>{
  const env=environment as Context,sources=env.citationSources || [],ref=tokens[index].meta as Reference & {postfix:boolean}
  const indices=ref.source!==undefined?[ref.source]:ref.ids.map(id=>sourceFor(id,sources))
  if(!ref.postfix || indices.some(value=>value===undefined) || !indices.length){env.citationWarnings?.add(!ref.postfix?'句首引用缺少可确认的对应论述':'引用编号与来源没有唯一映射');return `<span class="citation-unverified" title="引用不可验证：保留原始位置与文本">${escape(ref.raw)}</span>`}
  return indices.map(index=>{const source=sources[index!],url=webUrl(source.url)!,label=index!+1,title=`${source.title || new URL(url).hostname}\n${new URL(url).hostname}\n${url}`;return `<sup class="inline-citation"><a href="${escape(url)}" target="_blank" rel="noopener noreferrer" title="${escape(title)}" aria-label="引用 ${label}：${escape(source.title || new URL(url).hostname)}">[${label}]</a></sup>`}).join('')
 }
}
