import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SourceList from '../src/components/SourceList.vue'
import { groupSources } from '../src/utils/sources'
const sources=[
 {title:'第一篇',url:'https://EXAMPLE.com:443/a',citation:'ref-A'},
 {title:'第二篇',url:'https://example.com/b'},
 {title:'第三篇',url:'https://example.com/c'},
 {title:'重复第一篇',url:'https://example.com/a',citation:'ref-D',snippet:'保留摘要'},
 {title:'第四篇',url:'https://example.com/d'},
 {title:'第五篇',url:'https://example.com/e'}
]
it('merges canonical URLs without renumbering or mutating source data',()=>{
 const before=JSON.stringify(sources),groups=groupSources(sources)
 expect(groups).toHaveLength(5);expect(groups[0].numbers).toEqual([1,4]);expect(groups[0].citations).toEqual(['ref-A','ref-D']);expect(groups[0].source.snippet).toBe('保留摘要');expect(groups[3].numbers).toEqual([5]);expect(JSON.stringify(sources)).toBe(before)
})
it('keeps query strings and page anchors distinct and rejects unsafe links',()=>{
 const groups=groupSources([{title:'x',url:'https://example.com/a?q=1#one'},{title:'x',url:'https://example.com/a?q=2#one'},{title:'x',url:'https://example.com/a?q=1#two'},{title:'unsafe',url:'javascript:alert(1)'}])
 expect(groups).toHaveLength(4);expect(groups[3].href).toBeUndefined()
})
it('shows three distinct cards, expands all and retains full title tooltips',async()=>{
 const wrapper=mount(SourceList,{props:{sources}})
 expect(wrapper.findAll('.source-entry')).toHaveLength(3);expect(wrapper.get('.source-number').text()).toBe('[1] [4]');expect(wrapper.get('.source-link').attributes('title')).toContain('第一篇');expect(wrapper.get('.source-link').attributes('rel')).toBe('noopener noreferrer')
 await wrapper.get('.source-expand').trigger('click');expect(wrapper.findAll('.source-entry')).toHaveLength(5);expect(wrapper.get('.source-expand').attributes('aria-expanded')).toBe('true')
 await wrapper.get('.source-expand').trigger('click');expect(wrapper.findAll('.source-entry')).toHaveLength(3);wrapper.unmount()
})
