import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import ApiProfileManager from '../src/components/ApiProfileManager.vue'
import { useChatStore } from '../src/stores/chat'
import { api } from '../src/services/tauri'
vi.mock('../src/services/tauri',()=>({api:{isTauri:false,getProviderModels:vi.fn()}}))
let wrapper:ReturnType<typeof mount>
beforeEach(()=>{
 setActivePinia(createPinia());const chat=useChatStore()
 chat.profiles=[{id:'profile',name:'Original',provider:'anthropic-compatible',baseUrl:'https://api.invalid/v1',model:'original-model',thinking:'off',hasKey:true,inputPrice:1,outputPrice:2,requestOptions:{}}]
 chat.settings={...chat.settings,profileId:'profile',provider:'anthropic-compatible',baseUrl:'https://api.invalid/v1',model:'original-model',searchMode:'off',webSearch:false}
 vi.mocked(api.getProviderModels).mockResolvedValue([{id:'original-model'},{id:'next-model'}])
})
afterEach(()=>{wrapper?.unmount();vi.clearAllMocks();document.body.innerHTML=''})
it('collapses only the API model list and preserves other edits and the cached catalog until explicit save',async()=>{
 const chat=useChatStore();wrapper=mount(ApiProfileManager,{attachTo:document.body});await flushPromises()
 await wrapper.get('.api-model-toggle').trigger('click');await flushPromises()
 await wrapper.get('.api-editor-fields>label input').setValue('Unsaved name');await wrapper.get('.api-advanced select').setValue('high');await wrapper.get('.api-advanced textarea').setValue('{"temperature":0.3}')
 wrapper.findAll('.api-model-picker button').find(b=>b.text()==='next-model')!.element.dispatchEvent(new MouseEvent('click',{bubbles:true}));await flushPromises()
 expect(wrapper.find('.api-model-picker').exists()).toBe(false);expect(wrapper.find('.api-editor').exists()).toBe(true);expect(wrapper.get('.api-model-row input').element).toHaveProperty('value','next-model');expect(chat.settings.model).toBe('original-model');expect(chat.profiles[0].name).toBe('Original')
 await wrapper.get('.api-model-toggle').trigger('click');await flushPromises();expect(api.getProviderModels).toHaveBeenCalledTimes(1);expect(wrapper.get('.api-advanced select').element).toHaveProperty('value','high');expect(wrapper.get('.api-advanced textarea').element).toHaveProperty('value','{"temperature":0.3}')
 await wrapper.get('.api-editor-footer .api-secondary').trigger('click');await flushPromises();expect(chat.profiles[0].model).toBe('next-model');expect(chat.profiles[0].name).toBe('Unsaved name');expect(chat.profiles[0].thinking).toBe('high');expect(chat.profiles[0].requestOptions).toEqual({temperature:0.3})
})
it('custom model confirmation closes the list without saving; save failure retains every draft field',async()=>{
 const chat=useChatStore(),save=vi.spyOn(chat,'storeProfile').mockRejectedValueOnce(new Error('保存失败'));wrapper=mount(ApiProfileManager,{attachTo:document.body});await flushPromises()
 await wrapper.get('.api-model-toggle').trigger('click');await flushPromises();await wrapper.get('.api-model-row input').setValue(' custom-model ');await wrapper.get('[aria-label="确认 API 模型"]').trigger('click');await flushPromises()
 expect(wrapper.find('.api-model-picker').exists()).toBe(false);expect(wrapper.get('.api-model-row input').element).toHaveProperty('value','custom-model');expect(save).not.toHaveBeenCalled()
 await wrapper.get('.api-editor-footer .api-secondary').trigger('click');await flushPromises();expect(wrapper.get('[role="alert"]').text()).toContain('保存失败');expect(wrapper.get('.api-model-row input').element).toHaveProperty('value','custom-model');expect(chat.settings.model).toBe('original-model');expect(chat.profiles[0].model).toBe('original-model')
})
it('fetching a single model does not choose it or persist an incomplete configuration automatically',async()=>{
 useChatStore().profiles[0].model='';vi.mocked(api.getProviderModels).mockResolvedValueOnce([{id:'only-model'}]);wrapper=mount(ApiProfileManager,{attachTo:document.body});await flushPromises();await wrapper.get('.api-model-toggle').trigger('click');await flushPromises()
 expect(wrapper.get('.api-model-row input').element).toHaveProperty('value','');expect(wrapper.get('.api-model-picker').text()).toContain('only-model');expect(useChatStore().profiles[0].model).toBe('')
})
