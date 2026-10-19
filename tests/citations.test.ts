import { expect, it } from 'vitest'
import { renderMarkdown } from '../src/utils/markdown'
import { readableCitations } from '../src/utils/citations'
import type { Source } from '../src/types'
const sources:Source[]=[{citation:'1',title:'观测方法',url:'https://observatory.test/transit'},{citation:'2',title:'统计方法',url:'https://science.test/detection'}]
const render=(text:string,items=sources)=>{const node=document.createElement('div');node.innerHTML=renderMarkdown(text,false,items);return node}
it('maps adjacent numeric postfix citations to their actual URLs and renders superscript tooltips',()=>{
 const node=render('该方法适用于单次凌星检测。[1][2]'),links=node.querySelectorAll('.inline-citation a')
 expect(links).toHaveLength(2);expect(links[0].getAttribute('href')).toBe(sources[0].url);expect(links[1].getAttribute('href')).toBe(sources[1].url);expect(links[0].title).toContain('观测方法\nobservatory.test\nhttps://observatory.test/transit');expect(node.querySelector('.citation-warning')).toBeNull()
})
it('places immediately adjacent sentence punctuation before a postfix citation group without moving citations across text',()=>{
 const node=render('检测结论[1][2]。下一句。');expect(node.querySelector('p')!.textContent).toBe('检测结论。[1][2]下一句。')
 expect(node.querySelectorAll('.inline-citation')).toHaveLength(2)
 const ambiguous=render('另一结论[1]仍有争议。');expect(ambiguous.querySelectorAll('.inline-citation')).toHaveLength(0);expect(ambiguous.textContent).toContain('另一结论[1]仍有争议。')
})
it('never guesses source order or silently moves a leading citation',()=>{
 for(const content of ['[1][2]该方法有效。','[1]\n\n另一段结论。','[1]。未知归属。','前一条结论。\n[1]下一条结论。']){const node=render(content);expect(node.querySelectorAll('.inline-citation')).toHaveLength(0);expect(node.querySelector('.citation-warning')?.textContent).toContain('引用不可验证');expect(node.textContent).toContain('[1]')}
 const node=render('结论。[1]',[{title:'未知编号',url:'https://actual.test'}]);expect(node.querySelector('.inline-citation')).toBeNull()
})
it('uses one unambiguous provider answer span to relocate a leading marker to the supported sentence only',()=>{
 const node=render('[1]检测结论。另一种方法仍待验证。',[{...sources[0],anchor:'检测结论'}]);expect(node.querySelector('p')?.textContent).toBe('检测结论。[1]另一种方法仍待验证。');expect(node.querySelector('.inline-citation a')?.getAttribute('href')).toBe(sources[0].url)
})
it('does not relocate repeated, absent or mid-sentence annotated spans',()=>{
 for(const text of ['[1]检测结论。检测结论。','[1]完全不同的结论。','[1]检测结论尚不能确定。']){const node=render(text,[{...sources[0],anchor:'检测结论'}]);expect(node.textContent).toContain(text);expect(node.querySelector('.citation-warning')).not.toBeNull()}
})
it('injects exact OpenAI annotation spans and supports explicit numeric Markdown links',()=>{
 const node=render('检测结论。',[{title:'真实标注',url:sources[0].url,anchor:'检测结论。'}]);expect(node.querySelector('.inline-citation a')?.getAttribute('href')).toBe(sources[0].url)
 expect(render('检测结论。[1](https://observatory.test/transit)').querySelector('.inline-citation')).not.toBeNull()
 expect(render('检测结论。[1](https://invented.test)').querySelector('.citation-warning')).not.toBeNull()
})
it('normalizes provider aliases and unique native IDs without conflating continuation numbers',()=>{
 const refs=[{...sources[0],citation:'turn0search0'},{...sources[1],citation:'turn1search0'},{...sources[0],citation:'cc-unique-1'},{...sources[1],citation:'ref_2'}]
 const node=render('结论。citeturn0search0turn1search0 下一结论。[cc-unique-1] 再一个结论。【ref_2†source】',refs)
 expect(Array.from(node.querySelectorAll('.inline-citation a')).map(link=>link.getAttribute('href'))).toEqual([sources[0].url,sources[1].url,sources[0].url,sources[1].url])
})
it('rejects conflicting aliases, unsafe URLs and hostile tooltip markup',()=>{
 const conflicting=render('结论。[1]',[{...sources[0]},{...sources[1],citation:'1'}]);expect(conflicting.querySelector('.inline-citation')).toBeNull()
 for(const url of ['javascript:alert(1)','https://name:secret@example.com'])expect(render('结论。[1]',[{...sources[0],url}]).querySelector('.inline-citation')).toBeNull()
 const node=render('结论。[1]',[{...sources[0],title:'" onmouseover="alert(1)<img src=x>'}]);expect(node.querySelector('img')).toBeNull();expect(node.querySelector('[onmouseover]')).toBeNull()
})
it('leaves code, math, URLs, user text and partial streamed markers intact',()=>{
 const node=render('`[1]`\n\n```txt\n[1]\n```\n\n$x[1]$\n\n结论。citeturn0search');expect(node.querySelector('.inline-citation')).toBeNull();expect(node.querySelector('code')?.textContent).toBe('[1]');expect(node.textContent).toContain('citeturn0search')
 expect(renderMarkdown('用户原文。[1]')).not.toContain('inline-citation')
})
it('resolves late source snapshots without mutating the streamed message',()=>{
 const text='流式结论。[cc-new]';expect(render(text,[]).querySelector('.inline-citation')).toBeNull();expect(render(text,[{...sources[0],citation:'cc-new'}]).querySelector('.inline-citation')).not.toBeNull();expect(text).toBe('流式结论。[cc-new]')
})
it('copies native references as human-readable numbers without guessing conflicting IDs',()=>{
 const text='结论。[cc-copy]';expect(readableCitations(text,[{...sources[0],citation:'cc-copy'}])).toBe('结论。[1]');expect(text).toBe('结论。[cc-copy]')
 expect(render('[cc-copy]未确认的位置。',[{...sources[0],citation:'cc-copy'}]).querySelector('.citation-unverified')?.textContent).toBe('[1]')
 expect(readableCitations(text,[{...sources[0],citation:'cc-copy'},{...sources[1],citation:'cc-copy'}])).toBe(text)
})
