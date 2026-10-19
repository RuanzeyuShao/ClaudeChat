import { describe, expect, it } from 'vitest'
import { shouldSend, nearBottom, friendlyError, treeRows, historyGroup } from '../src/utils/experience'
import { codeDiff } from '../src/utils/codeDiff'
import { renderMarkdown } from '../src/utils/markdown'
import type { Message } from '../src/types'
const event={key:'Enter',shiftKey:false,ctrlKey:false,metaKey:false,altKey:false,isComposing:false,keyCode:13}
describe('IME and send preferences',()=>{
 it('never sends while committing Chinese candidates',()=>{expect(shouldSend({...event,isComposing:true},false,'enter')).toBe(false);expect(shouldSend({...event,keyCode:229},false,'enter')).toBe(false);expect(shouldSend(event,true,'enter')).toBe(false)})
 it('respects Enter, Shift+Enter and Ctrl+Enter',()=>{expect(shouldSend(event,false,'enter')).toBe(true);expect(shouldSend({...event,shiftKey:true},false,'enter')).toBe(false);expect(shouldSend(event,false,'ctrl-enter')).toBe(false);expect(shouldSend({...event,ctrlKey:true},false,'ctrl-enter')).toBe(true);expect(shouldSend({...event,ctrlKey:true},false,'enter')).toBe(false)})
})
it('follows only within 100px of the bottom',()=>{expect(nearBottom({scrollHeight:1200,scrollTop:801,clientHeight:300})).toBe(true);expect(nearBottom({scrollHeight:1200,scrollTop:400,clientHeight:300})).toBe(false)})
it('groups local dates across month boundaries',()=>{expect(historyGroup('2026-09-30T12:00:00',new Date('2026-10-01T10:00:00'))).toBe('昨天')})
it('does not leak raw error bodies or credentials',()=>{expect(friendlyError('401 Bearer sk-secret')).not.toContain('sk-secret');expect(friendlyError('<html>remote exception</html>')).not.toContain('html');expect(friendlyError('请填写模型 ID')).toBe('请填写模型 ID')})
it('renders connected branches in DFS order and prunes collapsed descendants',()=>{
 const nodes=[{id:'root',parentId:null},{id:'a',parentId:'root'},{id:'b',parentId:'root'},{id:'leaf',parentId:'a'}] as Message[]
 expect(treeRows(nodes,new Set()).map(r=>r.message.id)).toEqual(['root','a','leaf','b'])
 expect(treeRows(nodes,new Set(['a'])).map(r=>r.message.id)).toEqual(['root','a','b'])
})
it('handles a 5000-node path without recursion overflow',()=>{const nodes=Array.from({length:5000},(_,i)=>({id:String(i),parentId:i?String(i-1):null})) as Message[];expect(treeRows(nodes,new Set())).toHaveLength(5000)})
it('produces accurate insert/delete line numbering including repeated lines',()=>{const rows=codeDiff('a\nb\nc\n','a\nx\nb\nc\n');expect(rows.find(r=>r.kind==='add')).toEqual({kind:'add',text:'x',after:2});expect(rows.at(-1)).toEqual({kind:'same',text:'c',before:3,after:4})})
it('escapes code and labels while rendering math and real toolbar controls',()=>{const html=renderMarkdown('```unknown\n<script>alert(1)</script>\n```\n\n$x^2$');expect(html).toContain('&lt;script&gt;');expect(html).toContain('data-code-action="copy"');expect(html).toContain('katex');expect(html).not.toContain('<script>')})
it('supports multiline display math, escaped dollars and currency',()=>{expect(renderMarkdown('$$\n\\frac{a}{b}\n$$')).toContain('katex-display');expect(renderMarkdown('$$x^2$$')).toContain('katex-display');expect(renderMarkdown('\\$x and $ 10 and $20')).not.toContain('class="katex"');expect(renderMarkdown('$1 and $2')).not.toContain('class="katex"')})
it('does not execute trusted HTML commands in equations',()=>{expect(renderMarkdown('$\\href{javascript:alert(1)}{click}$')).not.toContain('href="javascript:');expect(renderMarkdown('$\\htmlClass{injected}{x}$')).not.toContain('class="injected"')})
