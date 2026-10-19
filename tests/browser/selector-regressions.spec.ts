import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

async function seed(page:Page){
 await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async()=>{
  const path='/src/stores/chat.ts';const {useChatStore}=await import(path),chat=useChatStore()
  chat.profiles=[['claude','anthropic-compatible'],['claude-alt','anthropic-compatible'],['deep','deepseek']].map(([id,provider])=>({id,provider,name:id+' Profile',model:id+'-model',baseUrl:'https://'+id+'.invalid/v1',thinking:'off',hasKey:true,inputPrice:0,outputPrice:0,requestOptions:null}))
  chat.settings={...chat.settings,profileId:'claude',provider:'anthropic-compatible',model:'claude-model',baseUrl:'https://claude.invalid/v1',searchMode:'off',webSearch:false}
 })
}

test('expanding services preserves the sidebar width and horizontal position of chat and history',async({page})=>{
 await page.setViewportSize({width:1280,height:700});await seed(page)
 const geometry=()=>page.evaluate(()=>Object.fromEntries(['.sidebar','.chat-view','.input-box','.history-heading','.conversation-list'].map(selector=>{const rect=document.querySelector(selector)!.getBoundingClientRect();return [selector,{x:rect.x,width:rect.width}]})))
 const before=await geometry();expect(before['.sidebar'].width).toBe(264)
 for(const many of [false,true]){
  if(many)await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path),chat=useChatStore();const original=chat.active;chat.conversations=[original,...Array.from({length:40},(_,i)=>({...original,id:'history-'+i,title:'历史会话 '+i}))]})
  const baseline=await geometry()
  for(let i=0;i<4;i++){await page.getByRole('button',{name:'折叠或展开聊天服务'}).click();expect(await geometry()).toEqual(baseline)}
 }
 await page.getByRole('button',{name:'折叠侧边栏',exact:true}).click();await expect(page.locator('.sidebar')).toHaveCSS('width','68px')
 await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();expect((await geometry())['.sidebar'].width).toBe(264)
})

test('selecting a model collapses only its list, then Apply commits the connection or preserves it on failure',async({page})=>{
 await seed(page);const trigger=page.getByRole('button',{name:'配置当前聊天服务'}),panel=page.locator('#chat-provider-panel')
 await trigger.click();await panel.getByRole('group',{name:'模型列表'}).getByRole('button',{name:'claude-alt-model',exact:true}).click()
 await expect(panel).toBeVisible();await expect(panel.getByRole('group',{name:'模型列表'})).toHaveCount(0);await expect(trigger).toContainText('claude-model');await panel.getByRole('button',{name:'应用配置',exact:true}).click()
 await expect(panel).toHaveCount(0);await expect(trigger).toContainText('claude-alt-model');await expect(page.getByText('已切换到 Claude Chat · claude-alt-model',{exact:true})).toBeVisible()
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);useChatStore().profiles.find(p=>p.id==='deep').hasKey=false})
 await trigger.click();await panel.getByRole('combobox',{name:'选择聊天服务'}).selectOption('deepseek');await panel.getByRole('group',{name:'模型列表'}).getByRole('button',{name:'deep-model',exact:true}).click()
 await expect(panel).toBeVisible();await panel.getByRole('button',{name:'应用配置',exact:true}).click()
 await expect(panel.getByRole('alert')).toContainText('API Key');await expect(trigger).toContainText('claude-alt-model')
})

test('custom-model choice keeps configuration open for further Thinking and search changes',async({page})=>{
 await seed(page);const trigger=page.getByRole('button',{name:'配置当前聊天服务'}),panel=page.locator('#chat-provider-panel')
 await trigger.click();await panel.getByRole('textbox',{name:'自定义对话模型'}).fill('claude-direct-confirm');await panel.getByRole('button',{name:'选择',exact:true}).click()
 await expect(panel).toBeVisible();await expect(panel.getByRole('group',{name:'模型列表'})).toHaveCount(0);await expect(panel.getByRole('button',{name:'选择对话模型',exact:true})).toBeFocused();await expect(trigger).toContainText('claude-model')
 await panel.getByRole('slider',{name:'思考强度'}).focus();await page.keyboard.press('End')
 await panel.getByRole('button',{name:'选择对话模型',exact:true}).click();await expect(panel.getByRole('group',{name:'模型列表'}).getByRole('button',{name:'claude-direct-confirm',exact:true})).toHaveAttribute('aria-pressed','true')
 await panel.getByRole('group',{name:'模型列表'}).getByRole('button',{name:'claude-direct-confirm',exact:true}).click();await expect(panel.getByRole('slider',{name:'思考强度'})).toHaveValue('3')
 await panel.locator('summary').click();await panel.getByRole('combobox',{name:'搜索服务'}).selectOption('searxng');await panel.getByRole('textbox',{name:'搜索地址'}).fill('https://search.invalid');await panel.getByRole('group',{name:'联网搜索模式'}).getByRole('button',{name:'始终搜索',exact:true}).click()
 await panel.getByRole('button',{name:'应用配置',exact:true}).click();await expect(panel).toHaveCount(0);await expect(trigger).toContainText('claude-direct-confirm');await expect(page.locator('.thinking-tag')).toContainText('深度思考')
 const settings=await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);return {...useChatStore().settings}});expect(settings.model).toBe('claude-direct-confirm');expect(settings.thinking).toBe('high');expect(settings.searchMode).toBe('force');expect(settings.searchBaseUrl).toBe('https://search.invalid')
})

test('closing configuration after choosing a model discards its draft without changing the actual connection',async({page})=>{
 await seed(page);const trigger=page.getByRole('button',{name:'配置当前聊天服务'}),panel=page.locator('#chat-provider-panel')
 await trigger.click();await panel.getByRole('textbox',{name:'自定义对话模型'}).fill('discard-this-model');await panel.getByRole('button',{name:'选择',exact:true}).click();await expect(panel).toBeVisible();await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(trigger).toContainText('claude-model')
 await trigger.click();await expect(panel.getByRole('button',{name:'选择对话模型',exact:true})).toContainText('claude-model');await expect(panel.getByRole('group',{name:'模型列表'})).not.toContainText('discard-this-model')
})

test('general preferences and the picker explain and disable unimplemented builtin search routes',async({page})=>{
 await seed(page)
 await page.getByRole('button',{name:'配置当前聊天服务'}).click();let panel=page.locator('#chat-provider-panel');await panel.getByRole('combobox',{name:'选择聊天服务'}).selectOption('deepseek');await panel.getByRole('button',{name:'应用配置'}).click()
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'通用偏好',exact:true}).click()
 const preferences=page.locator('.api-settings-secondary').filter({has:page.getByRole('combobox',{name:'默认搜索服务'})});await expect(preferences.getByRole('combobox',{name:'默认搜索服务'}).locator('option[value="claude"]')).toHaveAttribute('disabled','');await expect(preferences).toContainText('DeepSeek API 适配器未接入')
 await page.keyboard.press('Escape');await page.getByRole('combobox',{name:'联网模式',exact:true}).selectOption('force');await expect(page.getByRole('combobox',{name:'联网模式',exact:true})).toHaveValue('off');await expect(page.getByText(/请先在搜索设置中填写 SearXNG/)).toBeVisible()
 await page.getByRole('button',{name:'配置当前聊天服务'}).click();await panel.locator('summary').click();await expect(panel.getByRole('combobox',{name:'搜索服务'}).locator('option[value="claude"]')).toHaveAttribute('disabled','');await expect(panel).toContainText('DeepSeek API 适配器未接入')
})

for(const scale of [1,1.25,1.5])test(`Thinking track fills both endpoints and layout is stable at device scale ${scale}`,async({browser})=>{
 const context=await browser.newContext({viewport:{width:1024,height:700},deviceScaleFactor:scale}),page=await context.newPage()
 try{
  await seed(page);await page.getByRole('button',{name:'配置当前聊天服务'}).click();const panel=page.locator('#chat-provider-panel'),slider=panel.getByRole('slider',{name:'思考强度'})
  await slider.focus();await page.keyboard.press('End');await expect(slider).toHaveValue('3');await expect(slider).toHaveCSS('--thinking-progress','100%');await expect(slider).toHaveCSS('padding','0px');await expect(slider).toHaveCSS('border-width','0px')
  await page.keyboard.press('Home');await expect(slider).toHaveValue('0');await expect(slider).toHaveCSS('--thinking-progress','0%')
  await page.keyboard.press('ArrowRight');await expect(slider).toHaveValue('1');await page.keyboard.press('ArrowRight');await expect(slider).toHaveValue('2');await page.keyboard.press('End')
  await panel.getByRole('button',{name:'应用配置'}).click();await expect(page.locator('.thinking-tag')).toContainText('深度思考')
  await page.getByRole('button',{name:'配置当前聊天服务'}).click();await expect(slider).toHaveValue('3');await expect(slider).toHaveCSS('--thinking-progress','100%')
  await slider.scrollIntoViewIfNeeded();await expect(panel).toHaveCSS('opacity','1');const sliderBox=await slider.boundingBox(),scrollBox=await panel.locator('.provider-panel-scroll').boundingBox();expect(sliderBox!.y).toBeGreaterThanOrEqual(scrollBox!.y);expect(sliderBox!.y+sliderBox!.height).toBeLessThanOrEqual(scrollBox!.y+scrollBox!.height);mkdirSync('dist-release/v0.1.4/screenshots',{recursive:true});await panel.screenshot({path:`dist-release/v0.1.4/screenshots/selector-high-${scale}.png`})
  const bounds=await panel.boundingBox();expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(1024);expect(bounds!.y).toBeGreaterThanOrEqual(0)
 }finally{await context.close()}
})
