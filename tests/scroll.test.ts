import { afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import ChatView from '../src/views/ChatView.vue'
import { useChatStore } from '../src/stores/chat'
vi.mock('../src/services/tauri',()=>({api:{isTauri:false}}))
let wrapper:ReturnType<typeof mount>
async function setup(){
 setActivePinia(createPinia());const chat=useChatStore();await chat.newConversation();chat.active!.messages=[{id:'answer',role:'assistant',content:'正在生成',createdAt:'2026-10-08',pending:true}]
 wrapper=mount(ChatView);const list=wrapper.get('.messages').element as HTMLElement
 Object.defineProperties(list,{scrollHeight:{value:10000,configurable:true},scrollTop:{value:100,writable:true,configurable:true},clientHeight:{value:500,configurable:true}})
 vi.mocked(Element.prototype.scrollTo).mockClear();return {chat,list}
}
const frame=async()=>{await flushPromises();await new Promise(resolve=>setTimeout(resolve,30))}
afterEach(()=>{wrapper?.unmount();vi.unstubAllGlobals();vi.mocked(Element.prototype.scrollTo).mockClear()})
it('keeps reader position, distinguishes new content, and follows after a smooth return completes',async()=>{
 const {chat,list}=await setup();await wrapper.get('.messages').trigger('scroll');await frame();expect(wrapper.find('[aria-label="有新回答，滚动至最新消息"]').exists()).toBe(false)
 chat.active!.messages[0].content+='更多内容';await frame();expect(Element.prototype.scrollTo).not.toHaveBeenCalled();expect(wrapper.find('[aria-label="有新回答，滚动至最新消息"]').exists()).toBe(true)
 await wrapper.get('[aria-label="有新回答，滚动至最新消息"]').trigger('click');await flushPromises();expect(Element.prototype.scrollTo).toHaveBeenCalledWith({top:10000,behavior:'smooth'})
 list.scrollTop=9500;await wrapper.get('.messages').trigger('scroll');await frame();vi.mocked(Element.prototype.scrollTo).mockClear()
 chat.active!.messages[0].content+='继续';await frame();expect(Element.prototype.scrollTo).toHaveBeenCalledWith({top:10000,behavior:'instant'})
})
it('an upward wheel cancels a queued auto-scroll even while still inside the bottom threshold',async()=>{
 const callbacks:FrameRequestCallback[]=[];vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callbacks.push(callback);return callbacks.length});vi.stubGlobal('cancelAnimationFrame',vi.fn())
 const {chat,list}=await setup();list.scrollTop=9500;await wrapper.get('.messages').trigger('scroll');chat.active!.messages[0].content+='queued';await flushPromises();const queued=callbacks.at(-1)!;expect(queued).toBeDefined()
 await wrapper.get('.messages').trigger('wheel',{deltaY:-1});chat.active!.messages[0].content+='unread';await flushPromises();queued(0)
 expect(Element.prototype.scrollTo).not.toHaveBeenCalled();expect(wrapper.find('[aria-label="有新回答，滚动至最新消息"]').exists()).toBe(true)
})
it('keyboard reading pauses immediately and manually reaching the bottom resumes following',async()=>{
 const {chat,list}=await setup();list.scrollTop=9500;await wrapper.get('.messages').trigger('scroll');await frame();vi.mocked(Element.prototype.scrollTo).mockClear()
 await wrapper.get('.messages').trigger('keydown',{key:'PageUp'});chat.active!.messages[0].content+='keyboard unread';await frame();expect(Element.prototype.scrollTo).not.toHaveBeenCalled()
 list.scrollTop=9300;await wrapper.get('.messages').trigger('scroll');list.scrollTop=9500;await wrapper.get('.messages').trigger('scroll');await frame();expect(wrapper.find('.latest-message-row').exists()).toBe(false)
 vi.mocked(Element.prototype.scrollTo).mockClear();chat.active!.messages[0].content+='at bottom';await frame();expect(Element.prototype.scrollTo).toHaveBeenCalledWith({top:10000,behavior:'instant'})
})
it('upward input interrupts a smooth jump and a late scroll-end cannot reactivate following',async()=>{
 const {chat}=await setup();await wrapper.get('.messages').trigger('scroll');chat.active!.messages[0].content+='new';await frame();await wrapper.get('[aria-label="有新回答，滚动至最新消息"]').trigger('click');await flushPromises()
 await wrapper.get('.messages').trigger('wheel',{deltaY:-50});vi.mocked(Element.prototype.scrollTo).mockClear();await wrapper.get('.messages').trigger('scrollend');chat.active!.messages[0].content+='while reading';await frame()
 expect(Element.prototype.scrollTo).not.toHaveBeenCalled();expect(wrapper.find('[aria-label="有新回答，滚动至最新消息"]').exists()).toBe(true)
})
