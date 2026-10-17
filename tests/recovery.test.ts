import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {mount} from '@vue/test-utils'
import {api} from '../src/services/tauri'
import {useChatStore} from '../src/stores/chat'
import MessageItem from '../src/components/MessageItem.vue'
import type {Message,Usage} from '../src/types'
vi.mock('../src/services/tauri',()=>({api:{isTauri:true,sendMessage:vi.fn(),getTree:vi.fn(),getUsage:vi.fn(async()=>[]),getExtension:vi.fn(async()=>({})),selectBranch:vi.fn()}}))
beforeEach(()=>{
 setActivePinia(createPinia());vi.clearAllMocks();const chat=useChatStore()
 chat.conversations=[{id:'c',title:'c',model:'m',createdAt:'1',updatedAt:'1',messages:[{id:'u',role:'user',content:'原问题',createdAt:'1'},{id:'a',parentId:'u',role:'assistant',content:'已有内容。',reasoningContent:'已有思考',createdAt:'2',generation:{status:'interrupted',reason:'interrupted',continuations:1}}]}];chat.activeId='c';chat.trees.c=[...chat.active!.messages];chat.settings.baseUrl='https://mock.test';chat.settings.model='m';chat.settings.profileId='p';chat.settings.searchMode='off';chat.profiles=[{id:'p',name:'p',model:'m',baseUrl:'https://mock.test',provider:'openai',thinking:'off',hasKey:true,inputPrice:1,outputPrice:2}]
})
it('manual continuation targets the same assistant without adding a user or changing its history',async()=>{
 const chat=useChatStore(),message=chat.active!.messages[1]
 vi.mocked(api.sendMessage).mockImplementation(async(_id,_content,_settings,persist,_attachments,_parent,_refs,_request,target)=>{expect(persist).toBe(false);expect(target).toBe('a');expect(chat.active!.messages).toHaveLength(2);message.content+='接回的结尾。';return {status:'complete',reason:'stop',continuations:0,recoveries:1}})
 vi.mocked(api.getTree).mockImplementation(async()=>({leaf:'a',messages:chat.active!.messages.map(m=>({...m,pending:false}))}))
 await chat.continueReply(message);expect(api.sendMessage).toHaveBeenCalledTimes(1);expect(chat.active!.messages).toHaveLength(2);expect(chat.active!.messages[1].content).toBe('已有内容。接回的结尾。');expect(chat.status).toBe('completed');expect(chat.loading).toBe(false)
})
it('failed manual continuation retains visible partial output and a retry resumes the same node',async()=>{
 const chat=useChatStore(),message=chat.active!.messages[1];vi.mocked(api.sendMessage).mockImplementation(async()=>{message.content+='追加后断流。';throw new Error('local save failed')})
 await chat.continueReply(message);expect(message.content).toContain('追加后断流。');expect(chat.active!.messages).toHaveLength(2);expect(chat.status).toBe('incomplete');expect(api.selectBranch).not.toHaveBeenCalled();await chat.retry();expect(api.sendMessage).toHaveBeenCalledTimes(2);expect(vi.mocked(api.sendMessage).mock.calls[1][8]).toBe('a')
})
it('blocked output cannot be continued, and ancestor nodes cannot be overwritten',async()=>{
 const chat=useChatStore(),message=chat.active!.messages[1];message.generation!.status='blocked';await chat.continueReply(message);expect(api.sendMessage).not.toHaveBeenCalled();message.generation!.status='complete';chat.active!.messages.push({id:'new',role:'user',content:'new',createdAt:'3'});await chat.continueReply(message);expect(api.sendMessage).not.toHaveBeenCalled()
})
it('Check and continue is explicit and passes a distinct flag without judging punctuation',async()=>{
 const chat=useChatStore(),message=chat.active!.messages[1];message.generation={status:'complete',reason:'stop',continuations:0};message.content='末尾没有标点';vi.mocked(api.sendMessage).mockRejectedValue(new Error('mock'));await chat.continueReply(message,true);expect(vi.mocked(api.sendMessage).mock.calls[0][9]).toBe(true)
})
it('sums independent call usage for one visible answer while keeping Dashboard rows separate',()=>{
 const chat=useChatStore(),message=chat.active!.messages[1];message.usageId='reply:a';chat.requestOrigins['reply:a']={usageIds:['one','two']} as never
 const row={conversationId:'c',profileId:'p',profileName:'p',model:'m',inputTokens:10,outputTokens:20,thinkingTokens:5,durationMs:100,estimatedCost:.001,createdAt:'1'}
 chat.usage=[{...row,id:'one'},{...row,id:'two'}];expect(chat.usageFor(message)).toMatchObject({inputTokens:20,outputTokens:40,thinkingTokens:10,estimatedCost:.002});expect(chat.usage).toHaveLength(2)
})
it('shows incomplete and recovery count, and offers an explicit completeness check for normal endings',async()=>{
 const chat=useChatStore(),message=chat.active!.messages[1];message.generation!.recoveries=3;const wrapper=mount(MessageItem,{props:{message}})
 expect(wrapper.text()).toContain('回答未完成');expect(wrapper.text()).toContain('已自动恢复 3 次');expect(wrapper.text()).toContain('继续生成');wrapper.unmount()
})
