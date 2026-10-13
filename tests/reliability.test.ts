import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../src/services/tauri'
import { useChatStore } from '../src/stores/chat'
import { useUiStore } from '../src/stores/ui'
import ChatView from '../src/views/ChatView.vue'
import MessageItem from '../src/components/MessageItem.vue'
import UsageDashboard from '../src/views/UsageDashboard.vue'
import type { Message, Settings, Usage } from '../src/types'

vi.mock('../src/services/tauri',()=>({api:{isTauri:true,sendMessage:vi.fn(),selectBranch:vi.fn(),getTree:vi.fn(),applyPresetSettings:vi.fn(),selectConversation:vi.fn(),getUsage:vi.fn(async()=>[])}}))
let messages:Message[],leaf:string|null,saved:Settings|undefined
let wrappers:ReturnType<typeof mount>[]=[]
beforeEach(()=>{
 setActivePinia(createPinia());vi.clearAllMocks();saved=undefined
 messages=[{id:'u',role:'user',content:'original question',createdAt:'1'}, {id:'a',parentId:'u',role:'assistant',content:'original answer',createdAt:'2'}, {id:'u2',parentId:'a',role:'user',content:'follow up',createdAt:'3'}, {id:'a2',parentId:'u2',role:'assistant',content:'latest answer',createdAt:'4'}];leaf='a2'
 const chat=useChatStore();chat.conversations=[{id:'c',title:'conversation',model:'model',messages:structuredClone(messages),systemPrompt:'original prompt',createdAt:'1',updatedAt:'1'}];chat.activeId='c';chat.trees.c=structuredClone(messages)
 chat.settings={...chat.settings,baseUrl:'https://api.example/v1',model:'model',profileId:'p',searchMode:'off',webSearch:false}
 chat.profiles=[{id:'p',name:'profile',provider:'anthropic-compatible',baseUrl:'https://api.example/v1',model:'model',thinking:'off',hasKey:true,inputPrice:0,outputPrice:0}]
 vi.mocked(api.selectBranch).mockImplementation(async(_id,next)=>{leaf=next})
 vi.mocked(api.getTree).mockImplementation(async()=>({messages:structuredClone(messages),leaf}))
 vi.mocked(api.applyPresetSettings).mockImplementation(async settings=>{saved=structuredClone(settings);return structuredClone(settings)})
 vi.mocked(api.selectConversation).mockImplementation(async()=>structuredClone(saved || chat.settings))
})
afterEach(()=>{wrappers.forEach(w=>w.unmount());wrappers=[];vi.useRealTimers()})

for(const failure of ['missing model','missing key','invalid search'] as const){
 it(`keeps history and references on edit/continue preflight failure: ${failure}`,async()=>{
  const chat=useChatStore();chat.references=[{messageId:'a',text:'selected quote'}]
  if(failure==='missing model')chat.settings.model=''
  if(failure==='missing key')chat.profiles[0].hasKey=false
  if(failure==='invalid search'){chat.settings.searchMode='force';chat.settings.searchProvider='searxng';chat.settings.searchBaseUrl=''}
  const before=JSON.stringify({messages:chat.active!.messages,tree:chat.trees.c,references:chat.references})
  expect(await chat.editResend(chat.active!.messages[0],'edited')).toBeUndefined()
  expect(await chat.continueReply(chat.active!.messages[1])).toBeUndefined()
  expect(JSON.stringify({messages:chat.active!.messages,tree:chat.trees.c,references:chat.references})).toBe(before)
  expect(api.sendMessage).not.toHaveBeenCalled();expect(chat.loading).toBe(false);expect(chat.error).not.toBe('')
 })
}
for(const operation of ['edit','continue'] as const){
 it(`restores persisted and visible leaf after ${operation} API failure, retaining failed branch`,async()=>{
  const chat=useChatStore(),original=structuredClone(messages)
  vi.mocked(api.sendMessage).mockImplementation(async(_id,content,_settings,_persist,_attachments,parentId)=>{
   messages.push({id:'failed-user',parentId,role:'user',content,createdAt:'5'});leaf='failed-user';throw new Error('API 503')
  })
  if(operation==='edit')await chat.editResend(chat.active!.messages[0],'edited')
  else await chat.continueReply(chat.active!.messages[1])
  await flushPromises()
  expect(api.selectBranch).toHaveBeenCalledWith('c','a2');expect(leaf).toBe('a2');expect(chat.active!.messages).toEqual(original)
  expect(chat.trees.c).toHaveLength(5);expect(chat.loading).toBe(false);expect(chat.error).toContain('服务暂时不可用')
  await chat.retry();await flushPromises();expect(api.sendMessage).toHaveBeenCalledTimes(2)
  expect(vi.mocked(api.sendMessage).mock.calls[1][1]).toBe(operation==='edit'?'edited':'请从上一条回答结束处继续生成，避免重复已有内容。')
  expect(vi.mocked(api.sendMessage).mock.calls[1][5]).toBe(operation==='edit'?null:'a')
 })
}
it('does not edit a different conversation after an asynchronous edit dialog',async()=>{
 const chat=useChatStore(),ui=useUiStore();const operation=chat.editResend(chat.active!.messages[0]);chat.activeId='other';ui.settle('edited');await operation
 expect(api.sendMessage).not.toHaveBeenCalled();expect(chat.conversations[0].messages).toHaveLength(4)
})
it('keeps editor open on validation failure',async()=>{
 const chat=useChatStore();chat.settings.model='';const wrapper=mount(MessageItem,{props:{message:chat.active!.messages[0]}});wrappers.push(wrapper)
 const instance=wrapper.vm as unknown as {editing:boolean;editedText:string};instance.editing=true;instance.editedText='edited';await flushPromises()
 await wrapper.get('.message-edit').trigger('submit');await flushPromises();expect(wrapper.find('.message-edit').exists()).toBe(true)
})
it('persists thinking/search-only preset to the current conversation and restores it after reselect',async()=>{
 const chat=useChatStore();chat.presets=[{id:'p1',name:'preset',thinking:'high',searchMode:'off'}]
 expect(await chat.applyPreset('p1')).toBe(true)
 expect(api.applyPresetSettings).toHaveBeenCalledWith(expect.objectContaining({thinking:'high',searchMode:'off'}),'c',undefined)
 chat.settings.thinking='low';await chat.select('c');expect(chat.settings.thinking).toBe('high');expect(chat.active!.messages).toHaveLength(4)
})
it('applies profile, model, thinking, search and prompt in one operation and preserves state on failure',async()=>{
 const chat=useChatStore();chat.presets=[{id:'preset',name:'all',profileId:'p',model:'custom',thinking:'low',searchMode:'off',systemPrompt:'new prompt'}]
 vi.mocked(api.applyPresetSettings).mockRejectedValueOnce(new Error('disk full'))
 const before=JSON.stringify({settings:chat.settings,conversation:chat.active})
 await expect(chat.applyPreset('preset')).rejects.toThrow('disk full');expect(JSON.stringify({settings:chat.settings,conversation:chat.active})).toBe(before);expect(chat.profileBusy).toBe(false)
 await chat.applyPreset('preset');expect(chat.settings.model).toBe('custom');expect(chat.active!.systemPrompt).toBe('new prompt');expect(api.applyPresetSettings).toHaveBeenCalledTimes(2)
})
it('reports deleted-profile preset as failure and keeps the configuration dialog open',async()=>{
 const chat=useChatStore();chat.presets=[{id:'missing',name:'broken preset',profileId:'deleted'}]
 const wrapper=mount(ChatView);wrappers.push(wrapper)
 const instance=wrapper.vm as unknown as {presetsOpen:boolean};instance.presetsOpen=true;await flushPromises()
 const button=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()==='broken preset')!;button.click();await flushPromises()
 expect(useUiStore().toasts.some(t=>t.kind==='success')).toBe(false);expect(useUiStore().toasts.some(t=>t.message.includes('已删除'))).toBe(true)
 expect(document.querySelector('.preset-list')).not.toBeNull();expect(api.applyPresetSettings).not.toHaveBeenCalled()
})
it('rejects preset application while another configuration operation is in progress',async()=>{
 const chat=useChatStore();chat.profileBusy=true;chat.presets=[{id:'p',name:'preset',thinking:'high'}]
 await expect(chat.applyPreset('p')).rejects.toThrow('等待');expect(api.applyPresetSettings).not.toHaveBeenCalled()
})
it('renders distinct search outcomes and an actionable failure message',async()=>{
 const message:Message={id:'answer',role:'assistant',content:'answer',createdAt:'1',searchTrace:{provider:'claude',mode:'force',query:'',status:'not_used',sources:0}}
 const wrapper=mount(MessageItem,{props:{message}});wrappers.push(wrapper)
 for(const [status,label] of [['allowed','已允许搜索'],['not_used','未调用搜索'],['empty','检索完成，无结果'],['completed','检索完成'],['failed','检索失败'],['cancelled','已停止']]){
  await wrapper.setProps({message:{...message,searchTrace:{...message.searchTrace!,status,error:status==='failed'?'搜索服务不可用':undefined}}})
  expect(wrapper.get('.search-trace summary').text()).toContain(label)
 }
 await wrapper.setProps({message:{...message,searchTrace:{...message.searchTrace!,status:'failed',error:'搜索服务不可用'}}});expect(wrapper.get('.search-trace .error').text()).toBe('搜索服务不可用')
})

for(const trigger of ['timer','focus','reopen','usage','visibility'] as const){
 it(`updates retained Dashboard across midnight through ${trigger}, preserving filters`,async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,31,23,59,59))
  const chat=useChatStore();const row:Usage={id:'yesterday',conversationId:'c',profileId:'p',profileName:'profile',model:'model',inputTokens:10,outputTokens:5,thinkingTokens:0,durationMs:100,estimatedCost:0,createdAt:new Date(2026,9,31,23,30).toISOString()};chat.usage=[row]
  const wrapper=mount(UsageDashboard,{props:{active:true}});wrappers.push(wrapper);await flushPromises()
  await wrapper.findAll('.usage-presets button').find(b=>b.text()==='今日')!.trigger('click')
  const model=wrapper.findAll('.usage-selects select')[0];await model.setValue('model');expect(wrapper.findAll('.usage-card strong')[5].text()).toBe('1')
  if(trigger==='reopen')await wrapper.setProps({active:false})
  vi.setSystemTime(new Date(2026,10,1,0,0,1))
  if(trigger==='timer')await vi.advanceTimersByTimeAsync(30000)
  if(trigger==='focus')window.dispatchEvent(new Event('focus'))
  if(trigger==='reopen')await wrapper.setProps({active:true})
  if(trigger==='visibility')document.dispatchEvent(new Event('visibilitychange'))
  if(trigger==='usage')chat.usage.unshift({...row,id:'today',createdAt:new Date().toISOString()})
  await flushPromises();expect(wrapper.findAll('.usage-card strong')[5].text()).toBe(trigger==='usage'?'1':'0');expect(model.element.value).toBe('model')
 })
}
