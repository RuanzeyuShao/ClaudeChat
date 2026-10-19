import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
test('repeated new conversation clicks and shortcuts preserve a single blank and its draft',async({page})=>{
 await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.getByRole('textbox',{name:'聊天输入框',exact:true}).fill('保留草稿')
 for(let i=0;i<8;i++){await page.getByRole('button',{name:'新建对话',exact:true}).click();await page.keyboard.press('Control+n')}
 await expect(page.locator('.conversation')).toHaveCount(1);await expect(page.getByRole('textbox',{name:'聊天输入框',exact:true})).toHaveValue('保留草稿')
})
test('font size changes messages and controls and survives reload',async({page})=>{
 await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0)
 const before=await page.locator('body').evaluate(n=>parseFloat(getComputedStyle(n).fontSize))
 await page.keyboard.press('Control+,');await page.getByRole('button',{name:'通用偏好',exact:true}).click();await page.getByRole('spinbutton',{name:'字体大小',exact:true}).fill('20');await page.getByRole('button',{name:'保存偏好',exact:true}).click()
 await expect(page.locator('body')).toHaveCSS('font-size',`${before*20/14}px`)
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.reload();await expect(page.locator('.app-boot')).toHaveCount(0);await expect(page.locator('body')).toHaveCSS('font-size','20px')
})
test('long black titles scroll to the end and reset, short titles stay still',async({page})=>{
 await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.emulateMedia({colorScheme:'light',reducedMotion:'no-preference'})
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);const chat=useChatStore();chat.active.title='这是一个非常长的对话标题，用来验证鼠标悬停时能够完整展示标题直到最后的文字';chat.conversations.push({...chat.active,id:'short',title:'短标题',messages:[]})})
 const title=page.locator('.conversation-title').first(),text=title.locator('.conversation-title-text')
 await expect(title).toHaveClass(/title-overflow/);await expect(title).toHaveCSS('color','rgb(0, 0, 0)');await expect(text).toHaveCSS('text-overflow','ellipsis');await title.hover();await expect(text).toHaveCSS('animation-name','conversation-title-scroll')
 const result=await text.evaluate(n=>{const animation=n.getAnimations()[0];animation.pause();animation.currentTime=Number(animation.effect!.getTiming().duration)*.9;const box=n.parentElement!.getBoundingClientRect(),inner=n.getBoundingClientRect();return {end:inner.right,edge:box.right}});expect(result.end).toBeCloseTo(result.edge,0)
 await page.mouse.move(600,20);await expect(text).toHaveCSS('transform','none');await expect(text).toHaveCSS('text-overflow','ellipsis')
 await page.locator('.conversation-title').last().hover();await expect(page.locator('.conversation-title-text').last()).toHaveCSS('animation-name','none')
 mkdirSync('dist-release/v0.1.6/screenshots',{recursive:true});await page.screenshot({path:'dist-release/v0.1.6/screenshots/titles.png'})
 await page.emulateMedia({reducedMotion:'reduce'});await title.hover();await expect(text).toHaveCSS('animation-name','none');await expect(title).toHaveCSS('white-space','normal')
})
