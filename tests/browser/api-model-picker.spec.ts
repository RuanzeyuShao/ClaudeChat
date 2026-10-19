import { test, expect, type Page } from '@playwright/test'

async function seed(page:Page){
 await page.route('**/src/services/tauri.ts*',async route=>{
  const response=await route.fetch(),body=await response.text()
  await route.fulfill({response,body:body+'\napi.getProviderModels=async()=>{window.__apiCatalogReads=(window.__apiCatalogReads || 0)+1;return [{id:"original-model"},{id:"next-model"}];};\n'})
 })
 await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async()=>{
  const storePath='/src/stores/chat.ts';const {useChatStore}=await import(storePath),chat=useChatStore()
  chat.profiles=[{id:'api-fixture',name:'API Fixture',provider:'anthropic-compatible',baseUrl:'https://api.invalid/v1',model:'original-model',thinking:'off',hasKey:true,inputPrice:1,outputPrice:2,requestOptions:{}}]
  chat.settings={...chat.settings,profileId:'api-fixture',provider:'anthropic-compatible',baseUrl:'https://api.invalid/v1',model:'original-model',searchMode:'off',webSearch:false}
  ;(window as any).__apiCatalogReads=0
 })
 await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.locator('.api-editor')).toBeVisible()
}

test('API list selection keeps configuration open and preserves other edits until Save',async({page})=>{
 await seed(page);const editor=page.locator('.api-editor')
 await editor.getByRole('textbox',{name:/配置名称/}).fill('Edited API Fixture');await editor.locator('.api-advanced summary').click();await editor.getByRole('combobox',{name:'默认思考强度'}).selectOption('high');await editor.getByRole('textbox',{name:'附加请求参数（JSON）'}).fill('{"temperature":0.3}');await editor.getByRole('spinbutton',{name:'输入单价 / 百万 Token'}).fill('3')
 await editor.getByRole('button',{name:'获取模型',exact:true}).click();await editor.getByRole('group',{name:'API 模型列表'}).getByRole('button',{name:'next-model',exact:true}).click()
 await expect(editor.getByRole('group',{name:'API 模型列表'})).toHaveCount(0);await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible();await expect(editor.getByRole('textbox',{name:'模型 ID',exact:true})).toHaveValue('next-model');await expect(editor.getByRole('textbox',{name:/配置名称/})).toHaveValue('Edited API Fixture')
 await editor.getByRole('button',{name:'展开模型列表',exact:true}).click();await expect(editor.getByRole('group',{name:'API 模型列表'}).getByRole('button',{name:'next-model',exact:true})).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>(window as any).__apiCatalogReads)).toBe(1)
 await editor.getByRole('group',{name:'API 模型列表'}).getByRole('button',{name:'next-model',exact:true}).click();await expect(editor.getByRole('combobox',{name:'默认思考强度'})).toHaveValue('high');await expect(editor.getByRole('textbox',{name:'附加请求参数（JSON）'})).toHaveValue('{"temperature":0.3}')
 const before=await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);return useChatStore().settings.model});expect(before).toBe('original-model')
 await editor.getByRole('button',{name:'保存配置',exact:true}).click();await expect(editor.getByText('未保存',{exact:true})).toHaveCount(0)
 const saved=await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);return {...useChatStore().profiles[0]}});expect(saved.model).toBe('next-model');expect(saved.thinking).toBe('high');expect(saved.inputPrice).toBe(3);expect(saved.requestOptions).toEqual({temperature:0.3})
})

test('custom API model confirmation closes only the list; discarding changes preserves the original Profile',async({page})=>{
 await seed(page);const editor=page.locator('.api-editor')
 await editor.getByRole('button',{name:'获取模型',exact:true}).click();await expect(editor.getByRole('group',{name:'API 模型列表'})).toBeVisible();await editor.getByRole('textbox',{name:'模型 ID',exact:true}).fill('custom-api-model');await editor.getByRole('button',{name:'确认 API 模型'}).click()
 await expect(editor.getByRole('group',{name:'API 模型列表'})).toHaveCount(0);await expect(editor.getByRole('textbox',{name:'模型 ID',exact:true})).toBeFocused();await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'关闭设置'}).click();await expect(page.getByRole('alertdialog')).toBeVisible();await page.getByRole('button',{name:'放弃修改并继续'}).click();await expect(page.getByRole('dialog',{name:'设置',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByRole('textbox',{name:'模型 ID',exact:true})).toHaveValue('original-model')
})

test('API model controls fit a small window and remain editable after choosing',async({page})=>{
 await page.setViewportSize({width:640,height:480});await seed(page);const editor=page.locator('.api-editor')
 await editor.getByRole('button',{name:'获取模型',exact:true}).click();await editor.getByRole('group',{name:'API 模型列表'}).getByRole('button',{name:'next-model',exact:true}).click();await expect(editor.getByRole('group',{name:'API 模型列表'})).toHaveCount(0);await expect(editor.getByRole('button',{name:'保存配置',exact:true})).toBeInViewport()
 const row=await editor.locator('.api-model-row').boundingBox(),bounds=await editor.boundingBox();expect(row!.x+row!.width).toBeLessThanOrEqual(bounds!.x+bounds!.width);expect(await editor.locator('.api-editor-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
 await editor.locator('.api-advanced summary').click();await editor.getByRole('combobox',{name:'默认思考强度'}).selectOption('high');await expect(editor.getByRole('textbox',{name:'模型 ID',exact:true})).toHaveValue('next-model')
})
