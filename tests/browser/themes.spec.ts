import {test,expect,type Page} from '@playwright/test'
import {mkdirSync} from 'node:fs'
import {themePresets} from '../../src/themes/themePresets'
const rgb=(hex:string)=>`rgb(${[0,2,4].map(index=>parseInt(hex.slice(index+1,index+3),16)).join(', ')})`
async function seed(page:Page){
 await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async()=>{
  const path='/src/stores/chat.ts';const {useChatStore}=await import(path),chat=useChatStore(),now=new Date().toISOString()
  chat.profiles=[{id:'theme-api',name:'主题验证连接',provider:'anthropic-compatible',baseUrl:'https://theme.invalid/v1',model:'theme-model',thinking:'high',hasKey:true,inputPrice:0,outputPrice:0}]
  chat.settings={...chat.settings,profileId:'theme-api',provider:'anthropic-compatible',baseUrl:'https://theme.invalid/v1',model:'theme-model',thinking:'high',searchMode:'off',webSearch:false}
  chat.active.messages=Array.from({length:20},(_,i)=>({id:'theme-msg-'+i,parentId:i?'theme-msg-'+(i-1):null,role:i%2?'assistant':'user',content:i%2?'## 主题验证\n\n'+'可读性与长对话验证。\n\n'.repeat(6)+'```ts\nconst palette = "theme"\n```':'这是一条用户消息 '+i,createdAt:now}))
  chat.active.messages.at(-1).attachments=[{id:'theme-doc',kind:'document',name:'主题验证.md',mime:'text/markdown',size:30,text:'# 文档预览\n\n颜色主题同步验证。'}]
  chat.trees[chat.activeId]=chat.active.messages.slice();chat.status='completed'
  chat.usage=Array.from({length:8},(_,i)=>({id:'theme-usage-'+i,conversationId:chat.activeId,profileId:'theme-api',profileName:'主题连接',model:'theme-model',inputTokens:1000+i*100,outputTokens:500+i*90,thinkingTokens:100,durationMs:1200,estimatedCost:.01+i*.002,createdAt:new Date(Date.now()-i*86400000).toISOString()}))
 })
 await page.getByRole('textbox',{name:'聊天输入框',exact:true}).fill('配色切换期间保留草稿')
}
async function settings(page:Page){await page.keyboard.press('Control+,');await page.getByRole('button',{name:'个性化',exact:true}).click();await expect(page.getByRole('radiogroup',{name:'颜色主题'})).toBeVisible()}
async function assertScreens(page:Page,preset:typeof themePresets[number],resolved:'light'|'dark'){
 const colors=preset[resolved],dialog=page.getByRole('dialog',{name:'设置',exact:true})
 await expect(page.locator('html')).toHaveAttribute('data-theme',resolved);await expect(page.locator('html')).toHaveAttribute('data-color-theme',preset.id)
 await expect(dialog).toHaveCSS('background-color',rgb(colors.panel));await expect(page.locator('.sidebar')).toHaveCSS('background-color',rgb(colors.sidebar))
 await page.getByRole('button',{name:/^API 配置/}).click();await expect(page.locator('.api-manager')).toBeVisible();const field=dialog.locator('input').first();await field.focus();await expect(field).toHaveCSS('border-color',rgb(colors.accent))
 await page.getByRole('button',{name:'关闭设置',exact:true}).click()
 await expect(page.locator('.input-box')).toHaveCSS('background-color',rgb(colors.panel));await expect(page.locator('.message.user .message-body').first()).toHaveCSS('background-color',rgb(colors['user-bubble']))
 await expect(page.locator('.code-frame pre').last()).toHaveCSS('background-color',rgb(colors['code-bg']))
 await expect(page.getByRole('button',{name:'发送消息',exact:true})).toHaveCSS('background-color',rgb(colors.accent));await expect(page.getByRole('button',{name:'发送消息',exact:true})).toHaveCSS('color',rgb(colors['on-accent']))
 await expect(page.locator('.minimap-row.is-current .minimap-line')).toHaveCSS('background-color',rgb(colors['accent-ink']));await expect(page.locator('.minimap-row.is-current .minimap-line')).toHaveCSS('width','6px')
 // Brand identifiers remain untouched while selected states, controls and Thinking follow the palette.
 await expect(page.locator('[data-provider="claude"] .provider-mark')).toHaveCSS('color','rgb(200, 120, 83)')
 await page.getByRole('button',{name:'配置当前聊天服务'}).click();const panel=page.locator('#chat-provider-panel');await expect(panel).toHaveCSS('background-color',rgb(colors.panel));await expect(panel.locator('.provider-primary')).toHaveCSS('background-color',rgb(colors.accent));await expect(panel.locator('.provider-thinking-range')).toHaveCSS('accent-color',rgb(colors.accent));await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'预览 主题验证.md',exact:true}).click();await expect(page.locator('.document-preview')).toHaveCSS('background-color',rgb(colors.panel));await page.getByRole('button',{name:'关闭文档预览'}).click()
 await page.getByRole('button',{name:'对话树',exact:true}).click();await expect(page.locator('.conversation-tree')).toBeVisible();await page.getByRole('button',{name:'对话树',exact:true}).click()
 await page.getByRole('button',{name:'用量统计',exact:true}).click();await expect(page.locator('.usage-dashboard')).toHaveCSS('background-color',rgb(colors.bg));await expect(page.locator('.usage-line-token')).toHaveCSS('stroke',rgb(colors.accent));await expect(page.locator('.usage-line-cost')).toHaveCSS('stroke',rgb(colors['chart-secondary']))
 await page.getByRole('button',{name:'关闭用量统计'}).click();await expect(page.getByRole('textbox',{name:'聊天输入框',exact:true})).toHaveValue('配色切换期间保留草稿')
}
for(const preset of themePresets)for(const mode of ['light','dark','system'] as const)test(`theme ${preset.id} × ${mode}: all surfaces and controls`,async({page})=>{
 await page.emulateMedia({colorScheme:'light'});await seed(page);await settings(page)
 const group=page.getByRole('radiogroup',{name:'颜色主题'});await expect(group.getByRole('radio')).toHaveCount(8)
 await group.getByRole('radio',{name:preset.name,exact:true}).click();await page.getByRole('radiogroup',{name:'外观模式'}).getByRole('radio',{name:{light:'浅色',dark:'深色',system:'跟随系统'}[mode],exact:true}).click();await expect(page.locator('.appearance-save-state')).toHaveText('外观已自动保存')
 await expect(group.getByRole('radio',{name:preset.name,exact:true})).toHaveAttribute('aria-checked','true');await expect(page.locator('.swatch-check')).toHaveCount(1)
 await expect(page.getByRole('dialog',{name:'设置',exact:true})).toHaveCSS('background-color',rgb(preset[mode==='dark'?'dark':'light'].panel))
 await expect(page.getByRole('radiogroup',{name:'外观模式'}).getByRole('radio',{name:{light:'浅色',dark:'深色',system:'跟随系统'}[mode],exact:true})).toHaveCSS('color',rgb(preset[mode==='dark'?'dark':'light']['accent-ink']))
 mkdirSync('dist-release/v0.1.5/screenshots/themes',{recursive:true});await page.screenshot({path:`dist-release/v0.1.5/screenshots/themes/${preset.id}-${mode}.png`})
 await assertScreens(page,preset,mode==='dark'?'dark':'light')
 if(mode==='system'){
  await page.emulateMedia({colorScheme:'dark'});await settings(page);await assertScreens(page,preset,'dark');await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');await expect(page.locator('html')).toHaveAttribute('data-color-theme',preset.id)
 }
})
test('appearance survives reload, resets to warm white, and preserves connection and font preferences',async({page})=>{
 await seed(page);await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);await useChatStore().setFontSize(20)});await settings(page);await page.getByRole('radiogroup',{name:'颜色主题'}).getByRole('radio',{name:'海洋蓝'}).click();await page.getByRole('radiogroup',{name:'外观模式'}).getByRole('radio',{name:'深色',exact:true}).click();await expect(page.locator('.appearance-save-state')).toHaveText('外观已自动保存')
 expect(await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);const chat=useChatStore();return [chat.settings.profileId,chat.settings.model,chat.fontSize]})).toEqual(['theme-api','theme-model',20])
 await page.reload();await expect(page.locator('.app-boot')).toHaveCount(0);await expect(page.locator('html')).toHaveAttribute('data-color-theme','ocean');await expect(page.locator('html')).toHaveAttribute('data-theme','dark')
 await settings(page);await page.getByRole('button',{name:'恢复默认',exact:true}).click();await expect(page.locator('.appearance-save-state')).toHaveText('外观已自动保存');await expect(page.locator('html')).toHaveAttribute('data-color-theme','emerald');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await expect(page.locator('body')).toHaveCSS('background-color','rgb(250, 249, 246)')
 await expect(page.locator('body')).toHaveCSS('font-size','20px')
})
test('a rejected SQLite appearance save restores the last choice and reports the failure',async({page})=>{
 await seed(page);await settings(page)
 await page.evaluate(async()=>{const path='/src/services/tauri.ts';const {api}=await import(path);api.isTauri=true;api.saveAppearance=async()=>{throw new Error('disk full')};api.saveExtension=async()=>{};api.getModelPrices=async()=>[]})
 await page.getByRole('radio',{name:'紫罗兰',exact:true}).click();await expect(page.locator('.appearance-save-state')).toContainText('外观未能保存');await expect(page.locator('html')).toHaveAttribute('data-color-theme','emerald');await expect(page.getByRole('radio',{name:'经典翡翠',exact:true})).toHaveAttribute('aria-checked','true')
})
test('rapid palette changes and keyboard selection save the final choice without leaving the settings focus trap',async({page})=>{
 await seed(page);await settings(page);const group=page.getByRole('radiogroup',{name:'颜色主题'})
 await group.getByRole('radio',{name:'海洋蓝'}).click();await page.keyboard.press('ArrowRight');await expect(group.getByRole('radio',{name:'紫罗兰'})).toBeFocused();await expect(page.locator('html')).toHaveAttribute('data-color-theme','violet');await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'关闭设置',exact:true})).toBeFocused()
 await group.getByRole('radio',{name:'樱花粉'}).click();await group.getByRole('radio',{name:'石墨灰'}).click();await expect(page.locator('.appearance-save-state')).toHaveText('外观已自动保存');await page.reload();await expect(page.locator('.app-boot')).toHaveCount(0);await expect(page.locator('html')).toHaveAttribute('data-color-theme','graphite')
})
for(const scale of [1,1.5,2])test(`personalization fits a 640px Windows window at ${scale*100}% scale`,async({browser})=>{
 const context=await browser.newContext({viewport:{width:640,height:480},deviceScaleFactor:scale}),page=await context.newPage()
 try{await seed(page);await settings(page);const panel=page.locator('.personalization-panel');expect(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);await page.getByRole('radio',{name:'琥珀金'}).click();await expect(page.locator('html')).toHaveAttribute('data-color-theme','amber');await page.getByRole('button',{name:'恢复默认',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'恢复默认',exact:true})).toBeInViewport()}finally{await context.close()}
})
