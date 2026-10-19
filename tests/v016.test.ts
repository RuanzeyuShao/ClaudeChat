import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {flushPromises,mount} from '@vue/test-utils'
import {useChatStore} from '../src/stores/chat'
import {useUiStore} from '../src/stores/ui'
import {api} from '../src/services/tauri'
import {errorDetails,friendlyError} from '../src/utils/experience'
import {searchIntent,contextSummary} from '../src/utils/requestPreview'
import ChatInput from '../src/components/ChatInput.vue'
import type {Message} from '../src/types'

vi.mock('../src/services/tauri',()=>({api:{isTauri:true,selectBranch:vi.fn(),getTree:vi.fn(),saveDraft:vi.fn(),saveExtension:vi.fn(),getUsage:vi.fn(async()=>[]),attachmentLimits:vi.fn(async()=>({file:20*1024*1024,total:30*1024*1024,count:8})),sendMessage:vi.fn()}}))
let wrapper:ReturnType<typeof mount>|undefined
beforeEach(()=>{setActivePinia(createPinia());vi.clearAllMocks();const chat=useChatStore();const messages:Message[]=[{id:'u',role:'user',content:'问题',createdAt:'1'},{id:'a',parentId:'u',role:'assistant',content:'回答',createdAt:'2'},{id:'u2',parentId:'a',role:'user',content:'下一问',createdAt:'3'}];chat.conversations=[{id:'c',title:'test',model:'m',messages,systemPrompt:'',createdAt:'1',updatedAt:'1'}];chat.activeId='c';chat.trees.c=[...messages];vi.mocked(api.getTree).mockResolvedValue({messages,leaf:'u2'});vi.mocked(api.saveDraft).mockResolvedValue();vi.mocked(api.saveExtension).mockResolvedValue()})
afterEach(()=>{wrapper?.unmount();wrapper=undefined;document.body.innerHTML='';vi.useRealTimers()})

it('locates a reference without changing its leaf or the parent of the next turn',async()=>{
 const chat=useChatStore();const element=document.createElement('article');element.dataset.messageId='a';element.scrollIntoView=vi.fn();document.body.append(element)
 await chat.jumpNode('a');expect(element.scrollIntoView).toHaveBeenCalled();expect(element.classList.contains('reference-highlight')).toBe(true);expect(api.selectBranch).not.toHaveBeenCalled();expect(chat.active!.messages.at(-1)?.id).toBe('u2')
})
it('shows an off-branch reference read-only and leaves the active path intact',async()=>{
 const chat=useChatStore(),ui=useUiStore();chat.trees.c.push({id:'other',role:'assistant',content:'其他分支原文',createdAt:'0'})
 const pending=chat.jumpNode('other');expect(ui.dialog?.value).toBe('其他分支原文');ui.settle('');await pending;expect(api.selectBranch).not.toHaveBeenCalled();expect(chat.active!.messages).toHaveLength(3)
})
it('requires confirmation to restore context and reports native failures',async()=>{
 const chat=useChatStore(),ui=useUiStore();const pending=chat.restoreNode('a');expect(api.selectBranch).not.toHaveBeenCalled();ui.settle(null);await pending;expect(api.selectBranch).not.toHaveBeenCalled()
 vi.mocked(api.selectBranch).mockRejectedValueOnce(new Error('HTTP 403 detail'));const second=chat.restoreNode('a');ui.settle('');await second;expect(ui.toasts.at(-1)?.details).toContain('HTTP 403')
})
it('persists only the selected draft metadata and rejects oversized drafts',async()=>{
 const chat=useChatStore();chat.drafts.c={text:'当前草稿',attachments:[{id:'image',name:'x.png',kind:'image',mime:'image/png',size:5,data:'HUGE'.repeat(100000)}]};chat.drafts.other={text:'其他草稿',attachments:[]}
 await chat.persistDrafts('c');const [id,draft]=vi.mocked(api.saveDraft).mock.calls[0] as [string,any];expect(id).toBe('c');expect(draft.attachments[0].data).toBeUndefined();expect(JSON.stringify(draft).length).toBeLessThan(200);expect(api.saveExtension).not.toHaveBeenCalled()
 chat.drafts.c.text='字'.repeat(100000);await expect(chat.persistDrafts('c')).rejects.toThrow('256 KB');expect(api.saveDraft).toHaveBeenCalledTimes(1)
})
it('preserves independent conversation context selections including select-none',async()=>{
 const chat=useChatStore();chat.settings.selectedMessageIds=['__none__'];chat.settings.selectedAttachmentIds=['__none__'];await chat.persistContext();chat.restoreLocalContext('other');expect(chat.settings.selectedMessageIds).toEqual([]);chat.restoreLocalContext('c');expect(chat.settings.selectedMessageIds).toEqual(['__none__']);expect(api.saveExtension).toHaveBeenCalledWith('v6:context:c',expect.objectContaining({selectedMessageIds:['__none__']}))
})
it('uses intent instead of punctuation and previews a per-message search override',async()=>{
 const chat=useChatStore();expect(searchIntent(chat.settings,'如何写函数？')).toBe(false);expect(searchIntent(chat.settings,'What is recursion?')).toBe(false);expect(searchIntent(chat.settings,'搜索最新消息')).toBe(true)
 wrapper=mount(ChatInput);await wrapper.get('[aria-label="联网模式"]').setValue('off');expect(chat.effectiveSettings().searchMode).toBe('off');expect(chat.settings.searchMode).toBe('auto');expect(wrapper.text()).toContain('本条不联网');await flushPromises()
})
it('accumulates and deduplicates references',()=>{
 const chat=useChatStore(),[first,second]=chat.active!.messages;chat.quote(first);chat.quote(second);chat.quote(first);expect(chat.references).toHaveLength(2);chat.references.splice(0,1);expect(chat.references[0].messageId).toBe('a')
})
it('keeps original HTTP 400 details without mistaking a token budget for HTTP 500',()=>{
 const raw='API 返回 HTTP 400: {"error":"invalid request_options", "max_tokens":1500, "connection":"tenant"}'
 expect(friendlyError(raw)).not.toContain('服务暂时不可用');expect(friendlyError(raw)).not.toContain('无法连接服务');expect(errorDetails(raw)).toBe(raw);expect(friendlyError('HTTP 503: unavailable')).toContain('服务暂时不可用');expect(errorDetails('Bearer sk-secret api_key="secret"')).not.toContain('secret')
})
it('previews the selected message and attachment count',()=>{
 const chat=useChatStore();chat.active!.messages[0].attachments=[{id:'f',name:'a.txt',mime:'text/plain',kind:'document',size:3,text:'document'}];const summary=contextSummary(chat.active!.messages,{...chat.settings,selectedMessageIds:['u'],selectedAttachmentIds:['f']},'new',[]);expect(summary.messages).toBe(2);expect(summary.attachments).toBe(1);expect(summary.tokens).toBeGreaterThan(0)
})
it('includes the new turn inside the recent context budget',()=>{
 const chat=useChatStore();const result=contextSummary(chat.active!.messages,{...chat.settings,contextMode:'recent',recentTurns:1},'next');expect(result.messages).toBe(2)
})
