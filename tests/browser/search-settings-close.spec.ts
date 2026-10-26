import {test,expect} from '@playwright/test'
import {mkdirSync} from 'node:fs'

test('empty search closes immediately and can be reopened with the keyboard',async({page})=>{
 await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0)
 const trigger=page.getByRole('button',{name:'搜索历史对话',exact:true})
 await trigger.click();await expect(page.getByRole('searchbox',{name:'搜索历史对话'})).toBeFocused()
 await page.getByRole('button',{name:'关闭搜索',exact:true}).click()
 await expect(page.locator('.history-search-wrap')).toHaveCount(0);await expect(trigger).toBeFocused();await expect(trigger).toHaveAttribute('aria-expanded','false')
 await page.keyboard.press('Control+k');await expect(page.getByRole('searchbox',{name:'搜索历史对话'})).toHaveValue('')
 await page.keyboard.press('Escape');await expect(page.locator('.history-search-wrap')).toHaveCount(0)
})

test('closing search restores history and ignores an in-flight result',async({page})=>{
 await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0)
 const initial=await page.locator('.conversation-link').count()
 await page.getByRole('textbox',{name:'聊天输入框',exact:true}).fill('保留聊天草稿')
 await page.evaluate(async()=>{const path='/src/services/tauri.ts';const {api}=await import(path);api.isTauri=true;api.searchConversations=()=>new Promise(resolve=>(window as any).finishHistorySearch=resolve)})
 await page.getByRole('button',{name:'搜索历史对话',exact:true}).click();await page.getByRole('searchbox',{name:'搜索历史对话'}).fill('仍在请求')
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).finishHistorySearch)).toBe('function')
 await page.getByRole('button',{name:'关闭搜索',exact:true}).click();await expect(page.locator('.conversation-link')).toHaveCount(initial)
 await page.evaluate(()=>{(window as any).finishHistorySearch([])})
 await expect(page.locator('.history-search-wrap')).toHaveCount(0);await expect(page.locator('.conversation-link')).toHaveCount(initial);await expect(page.getByText('正在搜索…',{exact:true})).toHaveCount(0)
 await expect(page.getByRole('textbox',{name:'聊天输入框',exact:true})).toHaveValue('保留聊天草稿')
 await page.evaluate(async()=>{const path='/src/services/tauri.ts';(await import(path)).api.isTauri=false})
})

for(const scale of [1,1.25,1.5,2])for(const fontSize of [14,24])test(`settings close icon is centered at ${scale*100}% scale and ${fontSize}px font`,async({browser})=>{
 const context=await browser.newContext({viewport:{width:1000,height:800},deviceScaleFactor:scale,colorScheme:fontSize===14?'light':'dark'})
 try{
  const page=await context.newPage();await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0)
  await page.evaluate(async size=>{const path='/src/stores/chat.ts';await (await import(path)).useChatStore().setFontSize(size)},fontSize)
  await page.getByRole('button',{name:'设置',exact:true}).click()
  const button=page.getByRole('button',{name:'关闭设置',exact:true});await expect(button).toBeVisible();await expect(page.locator('.api-settings')).toHaveCSS('transform','none')
  const offsets=await button.evaluate(el=>{const b=el.getBoundingClientRect(),icon=el.querySelector('svg')!.getBoundingClientRect();return {x:(icon.left+icon.right-b.left-b.right)/2,y:(icon.top+icon.bottom-b.top-b.bottom)/2,width:b.width,height:b.height}})
  expect(Math.abs(offsets.x)).toBeLessThan(.5);expect(Math.abs(offsets.y)).toBeLessThan(.5);expect(offsets.width).toBeCloseTo(32,2);expect(offsets.height).toBeCloseTo(32,2)
  if(scale===1.5){mkdirSync('dist-release/v0.1.6/screenshots/ui-close-fixes',{recursive:true});await page.locator('.api-settings-header').screenshot({path:`dist-release/v0.1.6/screenshots/ui-close-fixes/settings-${fontSize}px.png`})}
  await button.click();await expect(page.getByRole('dialog',{name:'设置',exact:true})).toHaveCount(0)
 }finally{await context.close()}
})
