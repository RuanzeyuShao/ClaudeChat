import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import DocumentPreview from '../src/components/DocumentPreview.vue'
import { useUiStore } from '../src/stores/ui'
import { api } from '../src/services/tauri'
vi.mock('../src/services/tauri',()=>({api:{isTauri:true,saveCodeCopy:vi.fn(),saveCodeFile:vi.fn(),getAttachmentData:vi.fn()}}))
vi.mock('@tauri-apps/plugin-dialog',()=>({save:vi.fn().mockResolvedValue('copy.rs'),open:vi.fn().mockResolvedValue('original.rs')}))
const attachment={id:'code',name:'main.rs',kind:'code' as const,mime:'text/plain',size:30,text:'let original = 1;\nlet second = 2;'}
beforeEach(()=>setActivePinia(createPinia()))
it('renders line numbers, finds code and copies exact original text',async()=>{const wrapper=mount(DocumentPreview,{props:{attachment}});expect(wrapper.findAll('.code-line')).toHaveLength(2);await wrapper.get('[aria-label="在代码中查找"]').setValue('second');expect(wrapper.findAll('.code-line.match')).toHaveLength(1);await wrapper.get('[aria-label="下一个匹配"]').trigger('click');expect(Element.prototype.scrollIntoView).toHaveBeenCalled();await wrapper.findAll('.preview-controls button').at(-1)!.trigger('click');expect(navigator.clipboard.writeText).toHaveBeenCalledWith(attachment.text);wrapper.unmount()})
it('requires confirmation to save a copy and two confirmations to overwrite',async()=>{
 const ui=useUiStore(),wrapper=mount(DocumentPreview,{props:{attachment,proposed:'let modified = 3;'}})
 expect(wrapper.findAll('.diff-remove')).toHaveLength(2)
 await wrapper.findAll('.preview-controls button')[2].trigger('click');expect(ui.dialog?.title).toBe('保存修改副本？');expect(api.saveCodeCopy).not.toHaveBeenCalled();ui.settle('');await flushPromises();expect(api.saveCodeCopy).toHaveBeenCalledWith('copy.rs','let modified = 3;')
 await wrapper.findAll('.preview-controls button')[3].trigger('click');expect(ui.dialog?.title).toBe('应用 Diff 并覆盖原文件？');ui.settle('');await flushPromises();expect(ui.dialog?.title).toBe('再次确认覆盖');expect(api.saveCodeFile).not.toHaveBeenCalled();ui.settle(null);await flushPromises();expect(api.saveCodeFile).not.toHaveBeenCalled();wrapper.unmount()
})
