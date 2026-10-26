import {test,expect,type Page} from '@playwright/test'
import {mkdirSync} from 'node:fs'
import {themePresets} from '../../src/themes/themePresets'

async function ready(page:Page){await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0);await expect(page.locator('html')).toHaveAttribute('data-motion-ready','true')}
async function seed(page:Page){await page.evaluate(async()=>{const p='/src/stores/chat.ts',chat=(await import(p)).useChatStore();chat.profiles=[{id:'p',name:'Fixture',provider:'anthropic-compatible',baseUrl:'https://fixture.invalid/v1',model:'fixture-model',thinking:'off',hasKey:true,inputPrice:1,outputPrice:2}];Object.assign(chat.settings,{profileId:'p',provider:'anthropic-compatible',baseUrl:'https://fixture.invalid/v1',model:'fixture-model',searchMode:'off',webSearch:false});chat.active.messages=[{id:'u',role:'user',content:'历史问题',createdAt:'1'},{id:'a',parentId:'u',role:'assistant',content:'历史回答',createdAt:'2'}];chat.trees[chat.activeId]=chat.active.messages.slice()})}

test('tokens, reversible sidebar and stationary provider icons',async({page})=>{
 await ready(page)
 const tokens=await page.locator('html').evaluate(el=>{const s=getComputedStyle(el);return ['fast','normal','slow','data'].map(x=>s.getPropertyValue('--motion-'+x).trim())});expect(tokens).toEqual(['120ms','180ms','260ms','450ms'])
 const serialized=await page.evaluate(async()=>{const p='/src/motion/runtime.ts',runtime=await import(p),root=document.documentElement;for(const [name,value] of [['fast','.12s'],['normal','.18s'],['slow','.26s'],['data','.45s']])root.style.setProperty('--motion-'+name,value);const result=['fast','normal','slow','data'].map(name=>runtime.duration(name));for(const name of ['fast','normal','slow','data'])root.style.removeProperty('--motion-'+name);return result});expect(serialized).toEqual([120,180,260,450])
 const mark=page.locator('[data-provider="claude"] .provider-mark'),before=await mark.boundingBox()
 await page.getByRole('button',{name:'折叠侧边栏',exact:true}).click();await expect(page.locator('.sidebar')).toHaveCSS('width','68px')
 const after=await mark.boundingBox();expect(Math.abs(after!.x-before!.x)).toBeLessThan(5)
 await page.evaluate(async()=>{for(let i=0;i<7;i++){(document.querySelector('.sidebar-toggle') as HTMLButtonElement).click();await new Promise(r=>setTimeout(r,30))}})
 await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar-collapsed/);await expect(page.locator('.sidebar')).toHaveCSS('width','264px');await expect.poll(()=>page.locator('.sidebar-motion-ghost').count()).toBe(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('closing an entering modal immediately releases shortcuts and focus',async({page})=>{
 await ready(page);await page.getByRole('button',{name:'会话更多操作'}).click();await page.getByRole('menuitem',{name:'会话 Prompt',exact:true}).click();await expect(page.getByRole('dialog',{name:'会话 Prompt'})).toBeVisible()
 await page.keyboard.press('Escape');await page.keyboard.press('Control+l');await expect(page.getByRole('textbox',{name:'聊天输入框',exact:true})).toBeFocused();await expect(page.getByRole('dialog')).toHaveCount(0)
 await page.keyboard.press('Control+,');await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('textbox',{name:'聊天输入框',exact:true})).toBeFocused()
 await page.keyboard.press('Control+,');await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect.poll(()=>page.locator('.api-settings-backdrop,.modal-backdrop').count()).toBe(0)
 await expect(page.locator('.toast.error')).toHaveCount(0)
})

test('provider exit is inert and rapid reopen preserves model focus',async({page})=>{
 await ready(page);await seed(page);await page.getByRole('button',{name:'配置当前聊天服务',exact:true}).click();await expect(page.getByRole('dialog',{name:'Claude Chat 配置'})).toBeVisible()
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'配置当前聊天服务',exact:true})).toBeFocused()
 await page.getByRole('button',{name:'配置当前聊天服务',exact:true}).click();await expect(page.getByRole('searchbox',{name:'搜索对话模型'})).toBeFocused();await expect(page.getByRole('dialog')).toHaveCount(1)
 const transition=await page.locator('#chat-provider-panel').evaluate(el=>{el.classList.add('motion-provider-enter-active');const style=getComputedStyle(el),result={property:style.transitionProperty,duration:style.transitionDuration};el.classList.remove('motion-provider-enter-active');return result});expect(transition.property).toContain('opacity');expect(transition.property).toContain('transform');expect(transition.duration.split(',').every(value=>value.trim()==='0.18s')).toBe(true)
 await page.keyboard.press('Escape');await expect.poll(()=>page.locator('#chat-provider-panel').count()).toBe(0)
})

test('new messages animate once, streamed text never replays entrance, Stop ends loops',async({page})=>{
 await ready(page);await seed(page)
 await page.evaluate(async()=>{const p='/src/stores/chat.ts',chat=(await import(p)).useChatStore();chat.loading=true;chat.status='thinking';chat.active.messages.push({id:'motion-user',parentId:'a',role:'user',content:'新问题',createdAt:'3'},{id:'motion-ai',parentId:'motion-user',role:'assistant',content:'',pending:true,createdAt:'4'})})
 await expect(page.locator('[data-message-id="motion-ai"] .thinking')).toBeVisible();await page.waitForTimeout(220)
 const before=await page.locator('[data-message-id="motion-ai"]').evaluate(el=>el.getAnimations().length)
 await page.evaluate(async()=>{const p='/src/stores/chat.ts',chat=(await import(p)).useChatStore();for(let i=0;i<100;i++)chat.active.messages.at(-1).content+='流式文字。';chat.status='continuing';chat.continuationNotice='正在自动续写（第 1 次）'})
 await expect(page.locator('.request-status')).toContainText('正在自动续写');expect(await page.locator('[data-message-id="motion-ai"]').evaluate(el=>el.getAnimations().length)).toBe(before)
 await page.getByRole('button',{name:'停止生成',exact:true}).click();await expect(page.locator('.request-status')).toContainText('已停止');expect(await page.locator('.request-status').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0)
})

test('reduced motion changes live, finishes active work and disables smooth navigation',async({page})=>{
 await ready(page);await page.getByRole('button',{name:'折叠侧边栏',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('html')).toHaveAttribute('data-motion','reduce');await expect(page.locator('.sidebar')).toHaveCSS('transition-duration','0s')
 expect(await page.evaluate(async()=>{const p='/src/motion/runtime.ts';return (await import(p)).motionManager.activeCount()})).toBe(0)
 expect(await page.evaluate(async()=>{const p='/src/motion/runtime.ts';return (await import(p)).scrollBehavior()})).toBe('instant')
 await page.emulateMedia({reducedMotion:'no-preference'});await expect(page.locator('html')).toHaveAttribute('data-motion','full')
})

test('statistics animate presentation only, settle exactly, and downgrade large data',async({page})=>{
 await ready(page);await page.evaluate(async()=>{const p='/src/stores/chat.ts',chat=(await import(p)).useChatStore();chat.usage=Array.from({length:4},(_,i)=>({id:'m'+i,conversationId:chat.activeId,profileId:'p',profileName:'Fixture',model:'fixture',inputTokens:1000,outputTokens:500,thinkingTokens:20,durationMs:1000,estimatedCost:.0123,createdAt:new Date().toISOString()}))})
 await page.getByRole('button',{name:'用量统计',exact:true}).click();const total=page.locator('.usage-card').filter({has:page.getByText('总 Token',{exact:true})}).locator('strong');await expect(total).toHaveAttribute('data-value','6,000');await expect(total).toHaveText('6,000')
 const snapshot=await page.evaluate(async()=>{const p='/src/stores/chat.ts';return JSON.stringify((await import(p)).useChatStore().usage)})
 await page.getByRole('button',{name:'今日',exact:true}).click();await expect(total).toHaveText('6,000');expect(await page.evaluate(async()=>{const p='/src/stores/chat.ts';return JSON.stringify((await import(p)).useChatStore().usage)})).toBe(snapshot)
 expect(await page.locator('.usage-line-token').getAttribute('points')).not.toBe('');await expect(page.locator('.usage-bar-total').first()).toHaveCSS('transform-origin',/0px/)
 await page.evaluate(async()=>{const p='/src/stores/chat.ts',chat=(await import(p)).useChatStore();chat.usage=Array.from({length:600},(_,i)=>({...chat.usage[0],id:'large'+i}))});await expect(page.locator('.usage-dashboard')).toHaveClass(/motion-data-static/);await expect(total).toHaveText('900,000')
})

test('source height, Diff scroll and unmount cleanup stay bounded',async({page})=>{
 await ready(page);await seed(page);await page.evaluate(async()=>{const p='/src/stores/chat.ts',chat=(await import(p)).useChatStore();chat.active.messages[1].sources=Array.from({length:6},(_,i)=>({title:'资料 '+i,url:'https://example.com/'+i,snippet:'摘要内容'}))})
 await expect(page.locator('.source-entry')).toHaveCount(3);await page.getByRole('button',{name:'展开全部来源（另 3 个）'}).click();await expect(page.locator('.source-entry')).toHaveCount(6);await page.getByRole('button',{name:'收起来源',exact:true}).click();await expect.poll(()=>page.locator('.source-entry').count()).toBe(3)
 await page.evaluate(async()=>{const p='/src/stores/chat.ts',chat=(await import(p)).useChatStore();const code=Array.from({length:180},(_,i)=>'line '+i).join('\n');chat.active.messages[0].attachments=[{id:'code',name:'test.py',mime:'text/plain',kind:'code',size:1000,text:code}];chat.active.messages[1].content='```python\n'+code.replace('line 80','replacement 80')+'\n```'})
 await page.locator('[data-message-id="a"]').getByRole('button',{name:'消息更多操作'}).click();await page.getByRole('menuitem',{name:'查看代码 Diff'}).click();await page.locator('.document-preview-body').evaluate(el=>el.scrollTop=500);await page.getByRole('button',{name:'并排 Diff',exact:true}).click();expect(await page.locator('.document-preview-body').evaluate(el=>el.scrollTop)).toBeGreaterThan(450)
 await page.evaluate(()=>{(document.querySelector('#app') as any).__vue_app__.unmount()});await expect.poll(()=>page.locator('.motion-tooltip,.modal-backdrop,.api-settings-backdrop,.sidebar-motion-ghost').count()).toBe(0);expect(await page.evaluate(async()=>{const p='/src/motion/runtime.ts';return (await import(p)).motionManager.activeCount()})).toBe(0)
})

for(const reduced of [false,true])for(const mode of ['light','dark'] as const)test(`all eight palettes preserve motion and colors: ${mode}, reduced=${reduced}`,async({page})=>{
 await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference',colorScheme:mode});await ready(page)
 for(const preset of themePresets){await page.evaluate(async({id,mode})=>{const p='/src/stores/chat.ts';await (await import(p)).useChatStore().setAppearance(mode,id)},{id:preset.id,mode});await expect(page.locator('html')).toHaveAttribute('data-color-theme',preset.id);await expect(page.locator('html')).toHaveAttribute('data-theme',mode);const color=await page.locator('.input-box').evaluate(el=>getComputedStyle(el).backgroundColor);expect(color).not.toBe('rgba(0, 0, 0, 0)')}
 mkdirSync('dist-release/v0.1.6-motion/screenshots',{recursive:true});await page.screenshot({path:`dist-release/v0.1.6-motion/screenshots/palette-${mode}-${reduced?'reduced':'full'}.png`})
})
