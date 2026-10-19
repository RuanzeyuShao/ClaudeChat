import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {flushPromises} from '@vue/test-utils'
import {themePresets,contrastRatio,getThemePreset} from '../src/themes/themePresets'
import {themeManager,normalizeAppearance,type Appearance} from '../src/themes/themeManager'
import {useChatStore} from '../src/stores/chat'
import {api} from '../src/services/tauri'
vi.mock('../src/services/tauri',()=>({api:{isTauri:true,saveAppearance:vi.fn()}}))
beforeEach(()=>{themeManager.stop();localStorage.clear();setActivePinia(createPinia());vi.mocked(api.saveAppearance).mockReset().mockImplementation(async value=>value)})
afterEach(()=>themeManager.stop())
it('includes the exact eight supplied accent/soft pairs and contrast-safe text in both modes',()=>{
 expect(themePresets.map(p=>[p.name,p.accent,p.soft])).toEqual([['经典翡翠','#277B69','#EAF2ED'],['海洋蓝','#3869C5','#E9F0FD'],['紫罗兰','#7959B5','#F0EBFC'],['珊瑚橙','#BD7046','#FCEEE6'],['樱花粉','#B95F82','#FBEAF1'],['森林绿','#4E7950','#EAF3E8'],['琥珀金','#96701E','#FBF2D9'],['石墨灰','#566672','#E9EEF1']])
 for(const preset of themePresets)for(const mode of ['light','dark'] as const){const colors=preset[mode];for(const surface of ['bg','panel','soft','user-bubble','code-bg']){expect(contrastRatio(colors.text,colors[surface]),`${preset.id}/${mode} text on ${surface}`).toBeGreaterThanOrEqual(4.5)}
  for(const surface of ['bg','panel','soft'])expect(contrastRatio(colors['accent-ink'],colors[surface]),`${preset.id}/${mode} accent ink`).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(colors['on-accent'],colors.accent),`${preset.id}/${mode} button`).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(colors.muted,colors.bg),`${preset.id}/${mode} muted`).toBeGreaterThanOrEqual(4.5)
 }
 expect(contrastRatio('#000000','#ffffff')).toBe(21)
})
it('normalizes legacy settings and invalid cached values without applying arbitrary CSS',()=>{
 expect(normalizeAppearance({theme:'dark'})).toEqual({theme:'dark',colorTheme:'emerald'})
 expect(normalizeAppearance({theme:'bad',colorTheme:'url(javascript:bad)'})).toEqual({theme:'system',colorTheme:'emerald'})
 localStorage.setItem('claudechat.appearance','not json');expect(themeManager.cached()).toEqual({theme:'system',colorTheme:'emerald'})
 document.documentElement.style.setProperty('--font-scale','1.7');document.documentElement.style.setProperty('--error','#bd4b4b')
 themeManager.apply({theme:'dark',colorTheme:'ocean'});expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.7');expect(document.documentElement.style.getPropertyValue('--error')).toBe('#bd4b4b')
})
it('responds to system changes only in system mode and removes its listener',()=>{
 let dark=false;const callbacks=new Set<()=>void>()
 vi.spyOn(window,'matchMedia').mockImplementation(()=>({get matches(){return dark},addEventListener:(_event:string,callback:()=>void)=>callbacks.add(callback),removeEventListener:(_event:string,callback:()=>void)=>callbacks.delete(callback)}) as unknown as MediaQueryList)
 themeManager.apply({theme:'system',colorTheme:'violet'});themeManager.start();expect(callbacks.size).toBe(1)
 dark=true;callbacks.forEach(fn=>fn());expect(document.documentElement.dataset.theme).toBe('dark');expect(document.documentElement.style.getPropertyValue('--bg')).toBe(getThemePreset('violet').dark.bg)
 themeManager.apply({theme:'light',colorTheme:'violet'});callbacks.forEach(fn=>fn());expect(document.documentElement.dataset.theme).toBe('light');themeManager.stop();expect(callbacks.size).toBe(0)
})
it('serializes rapid saves while retaining the most recent immediate preview',async()=>{
 const chat=useChatStore(),complete:((value?:unknown)=>void)[]=[],values:Appearance[]=[]
 vi.mocked(api.saveAppearance).mockImplementation(value=>new Promise(resolve=>{values.push(value);complete.push(()=>resolve(value))}))
 const first=chat.setAppearance('dark','ocean'),second=chat.setAppearance('light','violet');expect(document.documentElement.dataset.colorTheme).toBe('violet');await flushPromises();expect(values).toHaveLength(1)
 complete[0]();await flushPromises();expect(values).toHaveLength(2);expect(document.documentElement.dataset.colorTheme).toBe('violet');complete[1]();await Promise.all([first,second])
 expect(themeManager.cached()).toEqual({theme:'light',colorTheme:'violet'});expect(chat.appearanceBusy).toBe(false)
})
it('rolls back failed writes to the last successful appearance and preserves chat configuration',async()=>{
 const chat=useChatStore();chat.settings.model='keep-model';chat.settings.baseUrl='https://keep.test';chat.fontSize=20;chat.drafts.c={text:'keep draft',attachments:[]}
 await chat.setAppearance('dark','forest');vi.mocked(api.saveAppearance).mockRejectedValueOnce(new Error('disk full'))
 await expect(chat.setAppearance('light','amber')).rejects.toThrow('disk full');expect(chat.settings.colorTheme).toBe('forest');expect(chat.settings.theme).toBe('dark');expect(document.documentElement.dataset.colorTheme).toBe('forest')
 expect(chat.settings.model).toBe('keep-model');expect(chat.fontSize).toBe(20);expect(chat.drafts.c.text).toBe('keep draft')
})
it('applies exactly one global palette and tolerates legacy settings responses without a palette field',async()=>{
 const chat=useChatStore();await chat.setAppearance('light','sakura');const {colorTheme:_oldField,...legacy}=chat.settings;chat.acceptSettings({...legacy,model:'other-model'})
 expect(chat.settings.colorTheme).toBe('sakura');expect(chat.settings.model).toBe('other-model');expect(document.documentElement.style.getPropertyValue('--soft')).toBe('#FBEAF1')
})
