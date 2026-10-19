import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
async function seed(page:Page){
 await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path),chat=useChatStore();chat.profiles=[['claude','anthropic-compatible'],['deep','deepseek'],['gpt','openai']].map(([id,provider])=>({id,provider,name:id+' Profile',model:id+'-model',baseUrl:'https://'+id+'.invalid/v1',thinking:'off',hasKey:true,inputPrice:0,outputPrice:0,requestOptions:null}));chat.settings={...chat.settings,profileId:'claude',provider:'anthropic-compatible',model:'claude-model',baseUrl:'https://claude.invalid/v1',searchMode:'off',webSearch:false}})
}
test('Composer picker switches service, Profile and model without expanding or using the sidebar',async({page})=>{
 await seed(page);await page.getByRole('button',{name:'折叠或展开聊天服务'}).click();await expect(page.locator('#chat-provider-list')).toBeHidden()
 await page.getByRole('button',{name:'配置当前聊天服务'}).click();const panel=page.locator('.composer-model-panel'),trigger=page.locator('.composer-provider-button')
 await expect(panel).toBeVisible();await expect(panel).toHaveCSS('opacity','1');await expect(page.locator('#chat-provider-list')).toBeHidden()
 const before=await trigger.boundingBox(),box=await panel.boundingBox();expect(box!.x).toBeCloseTo(before!.x,0);expect(box!.y+box!.height).toBeLessThanOrEqual(before!.y-6)
 await panel.getByRole('combobox',{name:'选择聊天服务'}).selectOption('deepseek');await panel.getByRole('textbox',{name:'自定义对话模型'}).fill('deep-custom');await panel.getByRole('button',{name:'选择',exact:true}).click();await expect(panel).toBeVisible();await expect(panel.getByRole('group',{name:'模型列表'})).toHaveCount(0);await panel.getByRole('button',{name:'应用配置'}).click()
 await expect(trigger).toContainText('DeepSeek Chat');await expect(trigger).toContainText('deep-custom');await expect(trigger).toBeFocused();await expect(page.locator('#chat-provider-list')).toBeHidden()
 await trigger.click();await panel.getByRole('combobox',{name:'选择聊天服务'}).selectOption('gpt');await panel.getByRole('button',{name:'应用配置'}).click();await expect(trigger).toContainText('GPT Chat');await expect(trigger).toContainText('gpt-model')
})
test('Composer picker handles toggle, outside click, Escape and focus return',async({page})=>{
 await seed(page);const trigger=page.getByRole('button',{name:'配置当前聊天服务'}),panel=page.locator('.composer-model-panel')
 await trigger.click();await expect(panel).toBeVisible();await trigger.click();await expect(panel).toHaveCount(0)
 await trigger.click();await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused()
 await trigger.click();const input=page.getByRole('textbox',{name:'聊天输入框',exact:true}),inputBox=await input.boundingBox();await input.click({position:{x:inputBox!.width-60,y:40}});await expect(panel).toHaveCount(0);await expect(input).toBeFocused()
})
for(const theme of ['light','dark'] as const)test(`Composer picker fits small windows and remains above its trigger in ${theme}`,async({page})=>{
 await page.setViewportSize({width:640,height:480});await page.emulateMedia({colorScheme:theme});await seed(page)
 await page.getByRole('button',{name:'配置当前聊天服务'}).click();const panel=page.locator('.composer-model-panel')
 await expect(panel).toBeVisible();await expect(panel).toHaveCSS('opacity','1');const box=await panel.boundingBox(),trigger=await page.locator('.composer-provider-button').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(640);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(trigger!.y-6)
 await expect(panel.getByRole('button',{name:'应用配置'})).toBeInViewport();await panel.getByRole('combobox',{name:'选择聊天服务'}).selectOption('deepseek');await expect(panel.getByRole('button',{name:'应用配置'})).toBeInViewport()
 await page.setViewportSize({width:1024,height:700});await expect(panel.getByRole('button',{name:'应用配置'})).toBeInViewport()
 mkdirSync('dist-release/v0.1.4/screenshots',{recursive:true});await page.screenshot({path:`dist-release/v0.1.4/screenshots/composer-picker-fixture-${theme}.png`})
})
