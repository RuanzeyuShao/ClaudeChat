import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
// Fixtures are injected only into this browser test's in-memory Pinia instance.
// The shipped app continues to use SQLite and real Provider data.
async function seed(page:Page){
 await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async()=>{
  const modulePath='/src/stores/chat.ts'
  const {useChatStore}=await import(modulePath),chat=useChatStore()
  chat.usage=Array.from({length:18},(_,i)=>({id:'ui-usage-'+i,conversationId:chat.activeId,profileId:'test-profile',profileName:'测试连接 '+ 'Profile'.repeat(18),model:i%2?'second-model':'test-model-'+ 'long-model-'.repeat(12),inputTokens:i?2048:1234567890,outputTokens:1024,thinkingTokens:128,durationMs:1350,estimatedCost:.015,createdAt:new Date(Date.now()-(i%4)*86400000).toISOString()}))
  chat.active.messages=Array.from({length:30},(_,i)=>({id:'ui-message-'+i,role:i%2?'assistant':'user',content:i%2?'## 正文示例\n\n段落文字，用于验证长对话阅读位置。\n\n'+ '阅读内容。'.repeat(40):'测试问题 '+i,createdAt:new Date().toISOString()}))
  chat.active.messages.at(-1).sources=[{title:'第一篇来源的完整长标题 '+ '来源标题'.repeat(16),url:'https://example.com/a',citation:'ref-A'},{title:'第二篇',url:'https://example.com/b'},{title:'第三篇',url:'https://example.com/c'},{title:'重复链接',url:'https://example.com/a',citation:'ref-D'},{title:'第五篇',url:'https://example.com/d'},{title:'第六篇',url:'https://example.com/e'}]
  chat.settings.model='test-model-'+ 'very-long-model-'.repeat(10);chat.settings.thinking='high'
 })
}
async function assertWidth(page:Page){
 await expect(page.locator('.chat-view')).toBeHidden()
 const shell=await page.locator('.app-shell').boundingBox(),dashboard=await page.locator('.usage-dashboard').boundingBox(),sidebar=await page.locator('.sidebar').boundingBox();expect(dashboard!.width).toBeGreaterThanOrEqual(shell!.width-sidebar!.width-6)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 expect(await page.locator('.usage-scroll').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true)
 const invalid=await page.locator('.usage-scroll').evaluate(node=>{
  const box=node.getBoundingClientRect()
  return [...node.querySelectorAll('.usage-card,.usage-chart-card,.usage-presets,.usage-selects,.usage-dates')].filter(item=>{const r=item.getBoundingClientRect();return r.left<box.left-1 || r.right>box.right+1}).length
 })
 expect(invalid).toBe(0)
}
test('Dashboard closes by button/Escape and retains filters, draft, tree and reading position',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await seed(page)
 await page.getByRole('textbox',{name:'聊天输入框',exact:true}).fill('需要保留的草稿')
 await page.getByRole('button',{name:'对话树',exact:true}).click()
 await page.locator('.messages').evaluate(node=>node.scrollTop=120)
 await page.waitForFunction(()=>document.querySelector('.latest-message-row')!==null)
 const reading=await page.locator('.messages').evaluate(node=>node.scrollTop)
 await page.getByRole('button',{name:'用量统计',exact:true}).click()
 await expect(page.getByRole('button',{name:'关闭用量统计'})).toBeVisible()
 await page.getByRole('button',{name:'30天',exact:true}).click();await assertWidth(page)
 await page.getByRole('button',{name:'GPT Chat',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'关闭用量统计'})).toBeVisible()
 await page.getByRole('button',{name:'关闭用量统计'}).click()
 await expect(page.getByRole('textbox',{name:'聊天输入框',exact:true})).toHaveValue('需要保留的草稿')
 await expect(page.getByRole('region',{name:'对话树'})).toBeVisible()
 expect(await page.locator('.messages').evaluate(node=>node.scrollTop)).toBeCloseTo(reading,0)
 await page.getByRole('button',{name:'用量统计',exact:true}).click();await expect(page.getByRole('button',{name:'30天',exact:true})).toHaveClass(/active/)
 await page.locator('.usage-table-wrap tbody tr').first().click();await expect(page.getByRole('dialog',{name:'单次请求'})).toBeVisible();await page.keyboard.press('Escape')
 await expect(page.getByRole('dialog',{name:'单次请求'})).toHaveCount(0);await expect(page.getByRole('button',{name:'关闭用量统计'})).toBeVisible()
 await page.keyboard.press('Escape');await expect(page.locator('.usage-dashboard')).toBeHidden();await expect(page.getByRole('region',{name:'对话树'})).toBeVisible()
})
for(const scale of [1,1.25,1.5])for(const theme of ['light','dark'] as const)test(`populated Dashboard ${theme} Windows browser ${scale*100}%`,async({browser})=>{
 const context=await browser.newContext({viewport:{width:800,height:600},deviceScaleFactor:scale,colorScheme:theme}),page=await context.newPage()
 await page.goto('http://127.0.0.1:1420',{waitUntil:'domcontentloaded'});await seed(page);await page.getByRole('button',{name:'用量统计',exact:true}).click()
 await expect(page.locator('.usage-card')).toHaveCount(7);await assertWidth(page)
 for(const card of await page.locator('.usage-card').all()){await card.scrollIntoViewIfNeeded();await expect(card).toBeInViewport();expect(await card.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)}
 await page.getByRole('button',{name:'折叠侧边栏',exact:true}).click();await assertWidth(page);await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();await assertWidth(page)
 await page.locator('.usage-table-wrap').scrollIntoViewIfNeeded();expect(await page.locator('.usage-table-wrap').evaluate(node=>node.scrollWidth>node.clientWidth)).toBe(true)
 await page.locator('.usage-table-wrap').evaluate(node=>node.scrollLeft=node.scrollWidth);expect(await page.locator('.usage-table-wrap').evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);await assertWidth(page)
 await page.locator('.usage-trend svg').hover({position:{x:12,y:90}});const tip=await page.locator('.usage-tooltip').boundingBox(),chart=await page.locator('.usage-trend').boundingBox();expect(tip!.x).toBeGreaterThanOrEqual(chart!.x-1);expect(tip!.x+tip!.width).toBeLessThanOrEqual(chart!.x+chart!.width+1)
 await page.getByRole('button',{name:'自定义',exact:true}).click();await assertWidth(page)
 await page.setViewportSize({width:640,height:480});await assertWidth(page);await expect(page.getByRole('button',{name:'关闭用量统计'})).toBeInViewport()
 await page.locator('.usage-scroll').evaluate(node=>node.scrollTop=0);mkdirSync('dist-release/v0.1.4/screenshots',{recursive:true});await page.screenshot({path:`dist-release/v0.1.4/screenshots/usage-fixture-${theme}-${scale*100}.png`})
 await page.keyboard.press('Escape');await expect(page.getByRole('textbox',{name:'聊天输入框',exact:true})).toBeVisible();await context.close()
})
test('source cards collapse duplicates and show original citation aliases',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await seed(page)
 const list=page.locator('.message-sources');await expect(list.locator('.source-entry')).toHaveCount(3);await expect(list.locator('.source-number').first()).toHaveText('[1] [4]');await expect(list.locator('.source-link').first()).toHaveAttribute('title',/完整长标题/)
 await list.getByRole('button',{name:/展开全部来源/}).click();await expect(list.locator('.source-entry')).toHaveCount(5);await expect(list.locator('a[href="https://example.com/a"]')).toHaveCount(1)
 await list.getByRole('button',{name:'收起来源'}).click();await expect(list.locator('.source-entry')).toHaveCount(3)
 const footer=await page.locator('.input-footer').boundingBox(),send=await page.getByRole('button',{name:'发送消息',exact:true}).boundingBox();expect(send!.x+send!.width).toBeLessThanOrEqual(footer!.x+footer!.width+1);await expect(page.locator('.thinking-tag')).toBeVisible()
})
