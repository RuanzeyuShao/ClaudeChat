import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from '../src/stores/chat'
import { api } from '../src/services/tauri'
vi.mock('../src/services/tauri',()=>({api:{isTauri:true,createConversation:vi.fn(),selectConversation:vi.fn(),getTree:vi.fn(),saveExtension:vi.fn(),getExtension:vi.fn()}}))
beforeEach(()=>{setActivePinia(createPinia());vi.clearAllMocks();const chat=useChatStore();vi.mocked(api.createConversation).mockImplementation(async()=>({id:crypto.randomUUID(),title:'准备开始',model:'',messages:[],createdAt:'2026-10-14',updatedAt:'2026-10-14',systemPrompt:''}));vi.mocked(api.selectConversation).mockImplementation(async()=>({...chat.settings}));vi.mocked(api.getTree).mockResolvedValue({messages:[],leaf:null});vi.mocked(api.saveExtension).mockResolvedValue(undefined)})
it('reuses the blank conversation and retains its text and attachments across history navigation',async()=>{
 const chat=useChatStore();await chat.newConversation();const blank=chat.activeId
 chat.drafts[blank]={text:'未发送内容',attachments:[{id:'a',name:'a.txt',kind:'text',mime:'text/plain',size:1,text:'a'}]}
 for(let i=0;i<10;i++)await chat.newConversation()
 chat.conversations.push({id:'history',title:'历史',model:'',messages:[],createdAt:'',updatedAt:'',systemPrompt:''});await chat.select('history');await chat.newConversation()
 expect(chat.activeId).toBe(blank);expect(chat.conversations).toHaveLength(2);expect(api.createConversation).toHaveBeenCalledTimes(1);expect(chat.drafts[blank].text).toBe('未发送内容');expect(chat.drafts[blank].attachments).toHaveLength(1)
})
it('creates another conversation only after the previous one contains messages',async()=>{
 const chat=useChatStore();await chat.newConversation();chat.active!.messages.push({id:'u',role:'user',content:'hello',createdAt:''});await chat.newConversation();expect(api.createConversation).toHaveBeenCalledTimes(2)
})
it('guards rapid clicks while checking a recovered empty conversation',async()=>{
 const chat=useChatStore();await chat.newConversation();let finish!:(value:{messages:[];leaf:null})=>void
 vi.mocked(api.getTree).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve))
 const pending=chat.newConversation();await chat.newConversation();finish({messages:[],leaf:null});await pending;expect(api.createConversation).toHaveBeenCalledTimes(1);expect(chat.profileBusy).toBe(false)
})
it('persists and restores font size, and rejects invalid values without changing it',async()=>{
 const chat=useChatStore();await chat.setFontSize(20);expect(api.saveExtension).toHaveBeenCalledWith('v5:fontSize',20);expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe(String(20/14))
 vi.mocked(api.getExtension).mockResolvedValue(18);await chat.loadFontSize();expect(chat.fontSize).toBe(18)
 await expect(chat.setFontSize(50)).rejects.toThrow();expect(chat.fontSize).toBe(18)
 vi.mocked(api.saveExtension).mockRejectedValueOnce(new Error('disk full'));await expect(chat.setFontSize(22)).rejects.toThrow();expect(chat.fontSize).toBe(18)
})
