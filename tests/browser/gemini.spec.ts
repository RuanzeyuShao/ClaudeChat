import {test,expect} from '@playwright/test'
import {mkdirSync} from 'node:fs'
test('Gemini can be configured, selected and reopened with independent preferences',async({page})=>{
 await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async()=>{const path='/src/services/tauri.ts',api=(await import(path)).api;api.getProviderModels=async settings=>{if(settings.provider!=='gemini')throw Error('wrong provider');return [{id:'gemini-2.5-flash'},{id:'gemini-2.5-pro'}]}})
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('combobox',{name:'服务类型',exact:true}).selectOption('gemini')
 await expect(page.getByRole('textbox',{name:/API 地址/})).toHaveValue('https://generativelanguage.googleapis.com/v1beta/openai')
 await page.locator('.api-key-input input').fill('fixture-key');await page.getByRole('button',{name:'获取模型',exact:true}).click();await page.getByRole('group',{name:'API 模型列表'}).getByRole('button',{name:'gemini-2.5-flash',exact:true}).click();await page.getByRole('button',{name:'保存并启用',exact:true}).click();await page.getByRole('button',{name:'关闭设置',exact:true}).click()
 await expect(page.locator('.composer-provider-button')).toContainText('Gemini Chat');await expect(page.locator('.composer-provider-button')).toContainText('gemini-2.5-flash')
 await page.locator('.composer-provider-button').click();const panel=page.locator('#chat-provider-panel');await expect(panel.getByRole('combobox',{name:'选择聊天服务'})).toHaveValue('gemini');await panel.getByRole('textbox',{name:'自定义对话模型',exact:true}).fill('gemini-2.5-pro');await panel.getByRole('button',{name:'选择',exact:true}).click();await panel.getByRole('button',{name:'应用配置',exact:true}).click();await expect(page.locator('.composer-provider-button')).toContainText('gemini-2.5-pro')
 const state=await page.evaluate(async()=>{const p='/src/stores/chat.ts',s=(await import(p)).useChatStore();return {provider:s.settings.provider,model:s.settings.model,preference:s.providerPreferences.gemini,search:s.settings.searchProvider}});expect(state.provider).toBe('gemini');expect(state.model).toBe('gemini-2.5-pro');expect(state.preference?.model).toBe('gemini-2.5-pro');expect(state.search).toBe('searxng')
 await expect(panel).toHaveCount(0);await expect(page.locator('.toast')).toHaveCount(0,{timeout:10000});
 mkdirSync('dist-release/v0.1.6-gemini/screenshots',{recursive:true});await page.locator('.chat-header').hover();await page.screenshot({path:'dist-release/v0.1.6-gemini/screenshots/gemini-configured.png'})
})
test('Gemini entry and configuration fit a compact dark window',async({page})=>{
 await page.setViewportSize({width:640,height:480});await page.emulateMedia({colorScheme:'dark'});await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0);await page.getByRole('button',{name:'Gemini Chat',exact:true}).click();await expect(page.locator('#chat-provider-panel')).toBeVisible();await page.keyboard.press('Escape');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
