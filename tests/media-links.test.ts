import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { createPinia,setActivePinia } from 'pinia'
import { mount,flushPromises } from '@vue/test-utils'
import RichContent from '../src/components/RichContent.vue'
import AttachmentThumbnail from '../src/components/AttachmentThumbnail.vue'
import { api } from '../src/services/tauri'
import { remoteImage,forgetRemoteImage } from '../src/utils/remoteImages'
import { renderMarkdown } from '../src/utils/markdown'
import { webUrl } from '../src/utils/contentLinks'
vi.mock('../src/services/tauri',()=>({api:{isTauri:true,getRemoteImage:vi.fn(),openLinkPreview:vi.fn(),getAttachmentData:vi.fn()}}))
let wrapper:ReturnType<typeof mount>
beforeEach(()=>{setActivePinia(createPinia());vi.mocked(api.openLinkPreview).mockResolvedValue(undefined);vi.mocked(api.getRemoteImage).mockResolvedValue({dataUrl:'data:image/png;base64,dGVzdA==',resolvedUrl:'https://cdn.test/photo.png'});forgetRemoteImage('https://image.test/photo.png')})
afterEach(()=>{wrapper?.unmount();vi.clearAllMocks();document.body.innerHTML=''})
it('defers external images, preserves bundled image sources and rejects non-web navigation',()=>{
 const html=renderMarkdown('![photo](https://image.test/photo.png)',true);expect(html).toContain('data-media-src="https://image.test/photo.png"');expect(new DOMParser().parseFromString(html,'text/html').querySelector('img')!.getAttribute('src')).toBeNull();expect(html).toContain('referrerpolicy="no-referrer"')
 expect(renderMarkdown('![local](images/a.png)',true)).toContain('src="images/a.png"');expect(webUrl('javascript:alert(1)')).toBeUndefined();expect(webUrl('file:///C:/data')).toBeUndefined();expect(webUrl('https://user:secret@example.com')).toBeUndefined()
})
it('coalesces repeated loads until explicit retry',async()=>{const a=remoteImage('https://image.test/photo.png'),b=remoteImage('https://image.test/photo.png');await Promise.all([a,b]);expect(api.getRemoteImage).toHaveBeenCalledTimes(1);forgetRemoteImage('https://image.test/photo.png');await remoteImage('https://image.test/photo.png');expect(api.getRemoteImage).toHaveBeenCalledTimes(2)})
it('shows a missing-file error and retry, while leaving the original message untouched',async()=>{
 const content='![创生之柱](https://image.test/photo.png)';vi.mocked(api.getRemoteImage).mockRejectedValueOnce(new Error('图片不存在（404），请打开来源或更换链接'))
 wrapper=mount(RichContent,{props:{content},attachTo:document.body});await flushPromises();expect(wrapper.get('.content-image-status').text()).toContain('404');expect(wrapper.get('img').element).toHaveProperty('hidden',true);expect(wrapper.props('content')).toBe(content)
 await wrapper.get('[data-image-action="retry"]').trigger('click');await flushPromises();expect(api.getRemoteImage).toHaveBeenCalledTimes(2);expect(wrapper.get('img').attributes('src')).toContain('data:image/png')
})
it('opens body links through the independent preview command and does not replace the main page',async()=>{
 wrapper=mount(RichContent,{props:{content:'[查看来源](https://commons.wikimedia.org/wiki/File:Example.jpg)'},attachTo:document.body});await flushPromises();const before=window.location.href
 await wrapper.get('a').trigger('click');await flushPromises();expect(api.openLinkPreview).toHaveBeenCalledWith('https://commons.wikimedia.org/wiki/File:Example.jpg');expect(window.location.href).toBe(before)
})
it('restores thumbnails from saved attachment data rather than generating an undefined data URL',async()=>{
 vi.mocked(api.getAttachmentData).mockResolvedValueOnce('saved-image');wrapper=mount(AttachmentThumbnail,{props:{attachment:{id:'saved',name:'image.png',mime:'image/png',kind:'image',size:10}}});await flushPromises();expect(api.getAttachmentData).toHaveBeenCalledWith('saved');expect(wrapper.get('img').attributes('src')).toBe('data:image/png;base64,saved-image')
})
