import { test, expect, type Page } from '@playwright/test'

async function seed(page:Page){
 await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async()=>{
  const path='/src/stores/chat.ts';const {useChatStore}=await import(path),chat=useChatStore()
  chat.active.messages=[{id:'u',role:'user',content:'原始问题',createdAt:'1'},{id:'a',parentId:'u',role:'assistant',content:'原始回答',createdAt:'2'}];chat.trees[chat.activeId]=chat.active.messages.slice()
 })
}
test('invalid search configuration does not erase history or dismiss an unsent edit',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await seed(page)
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);const chat=useChatStore();chat.settings.searchMode='force';chat.settings.searchProvider='searxng';chat.settings.searchBaseUrl=''})
 await page.locator('.message.user').getByRole('button',{name:'消息更多操作'}).click();await page.getByRole('menuitem',{name:'编辑并重发'}).click()
 await page.getByRole('textbox',{name:'编辑历史消息'}).fill('改写的问题');await page.getByRole('button',{name:'创建分支并重发'}).click()
 await expect(page.getByRole('textbox',{name:'编辑历史消息'})).toHaveValue('改写的问题');await expect(page.locator('.message.assistant .markdown')).toHaveText('原始回答');await expect(page.locator('.request-error')).toContainText('SearXNG')
 await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.message.user .markdown')).toHaveText('原始问题')
 await page.locator('.message.assistant').getByRole('button',{name:'消息更多操作'}).click();await page.getByRole('menuitem',{name:'检查并继续'}).click();await expect(page.locator('.message')).toHaveCount(2)
})
test('deleted-profile preset reports failure and keeps the preset dialog open',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await seed(page)
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);useChatStore().presets=[{id:'bad',name:'失效预设',profileId:'deleted'}]})
 await page.getByRole('button',{name:'会话更多操作'}).click();await page.getByRole('menuitem',{name:'应用 Prompt 预设'}).click();await page.getByRole('button',{name:'失效预设',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'应用 Prompt 预设'})).toBeVisible();await expect(page.getByText('预设绑定的 API Profile 已删除',{exact:true})).toBeVisible();await expect(page.getByText('预设已应用',{exact:true})).toHaveCount(0)
 await expect(page.locator('.message')).toHaveCount(2)
})
test('retained Today dashboard refreshes across month boundary and keeps model filters',async({page})=>{
 await page.clock.install({time:new Date(2026,9,31,23,50,0)});await page.goto('/',{waitUntil:'domcontentloaded'});await seed(page)
 await page.evaluate(async()=>{
  const path='/src/stores/chat.ts';const {useChatStore}=await import(path);const chat=useChatStore()
  chat.usage=[{id:'old',conversationId:chat.activeId,profileId:'p',profileName:'profile',model:'model',inputTokens:10,outputTokens:5,thinkingTokens:0,durationMs:100,estimatedCost:0,createdAt:new Date(2026,9,31,23,30).toISOString()}]
 })
 await page.getByRole('button',{name:'用量统计',exact:true}).click();await page.getByRole('button',{name:'今日',exact:true}).click();await page.locator('.usage-selects select').first().selectOption('model');await expect(page.locator('.usage-card strong').nth(5)).toHaveText('1')
 await page.getByRole('button',{name:'关闭用量统计'}).click();await page.clock.setSystemTime(new Date(2026,10,1,0,0,1));await page.getByRole('button',{name:'用量统计',exact:true}).click()
 await expect(page.locator('.usage-card strong').nth(5)).toHaveText('0');await expect(page.locator('.usage-selects select').first()).toHaveValue('model');await page.getByRole('button',{name:'关闭用量统计'}).click();await expect(page.locator('.message')).toHaveCount(2)
})
