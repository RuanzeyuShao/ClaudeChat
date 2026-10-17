import { test, expect } from '@playwright/test'

for(const viewport of [{width:1440,height:900},{width:800,height:600},{width:640,height:480}]){
 test(`long answer remains complete, visible and continuable at ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.locator('.app-boot')).toHaveCount(0)
  await page.evaluate(async()=>{
   const path='/src/stores/chat.ts';const {useChatStore}=await import(path),chat=useChatStore()
   chat.settings.searchMode='off';chat.settings.webSearch=false
   chat.active.messages=[{id:'u',role:'user',content:'请生成完整长报告',createdAt:'1'},{id:'a',parentId:'u',role:'assistant',content:'# 长报告\n\n'+Array.from({length:1800},(_,i)=>`第 ${i+1} 段：这是持续生成的长文本，不能在客户端被丢弃。\n\n`).join('')+'最后一段仍然完整保留。',generation:{status:'complete',reason:'stop',continuations:2},createdAt:'2'}]
   chat.trees[chat.activeId]=chat.active.messages.slice();chat.status='completed'
  })
  await expect(page.locator('.message.assistant .markdown')).toContainText('最后一段仍然完整保留。');await expect(page.locator('.generation-notice')).toContainText('已自动续写 2 次，回答已完成')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.locator('.messages').evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{deltaY:-1,bubbles:true}));el.scrollTop=0})
  await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);const chat=useChatStore();chat.active.messages.at(-1).generation={status:'interrupted',reason:'interrupted',continuations:2};chat.status='incomplete'})
  await expect(page.locator('.generation-notice')).toContainText('生成中断');await expect(page.locator('.message.assistant .markdown')).toContainText('第 1800 段')
  await page.locator('.messages').evaluate(el=>el.scrollTop=el.scrollHeight)
  await expect(page.locator('.generation-notice button')).toBeVisible()
  const notice=await page.locator('.generation-notice').boundingBox(),composer=await page.locator('.input-wrap').boundingBox();expect(notice!.y+notice!.height).toBeLessThanOrEqual(composer!.y)
  await page.locator('.generation-notice button').click();await expect(page.locator('.message')).toHaveCount(2);await expect(page.locator('.message.assistant .markdown').first()).toContainText('最后一段仍然完整保留。')
 })
}
