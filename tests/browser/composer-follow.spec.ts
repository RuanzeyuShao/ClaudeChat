import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

async function seed(page:Page){
 await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async()=>{
  const path='/src/stores/chat.ts';const {useChatStore}=await import(path),chat=useChatStore()
  chat.profiles=[{id:'scroll-api',name:'Scroll Fixture',provider:'anthropic-compatible',baseUrl:'https://api.invalid/v1',model:'claude-opus-example',thinking:'high',hasKey:true,inputPrice:0,outputPrice:0,requestOptions:null}]
  chat.settings={...chat.settings,profileId:'scroll-api',provider:'anthropic-compatible',baseUrl:'https://api.invalid/v1',model:'claude-opus-example',thinking:'high',searchMode:'off',webSearch:false}
  chat.active.messages=Array.from({length:24},(_,i)=>({id:'reading-'+i,role:i%2?'assistant':'user',content:i%2?'## 正文\n\n'+('段落内容供长对话阅读验证。\n\n'.repeat(8)):'问题 '+i,createdAt:new Date().toISOString()}))
  chat.trees[chat.activeId]=chat.active.messages.slice()
 })
 await expect.poll(()=>page.locator('.messages').evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThanOrEqual(4)
}
async function append(page:Page,text:string){await page.evaluate(async text=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);useChatStore().active.messages.at(-1).content+=text},text)}
const gap=(page:Page)=>page.locator('.messages').evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)

test('bottom follows, upward reading pauses immediately, and new-answer prompt sits above the fixed Composer',async({page})=>{
 await seed(page);const list=page.locator('.messages'),composer=page.locator('.input-wrap')
 await append(page,'自动跟随新增段落。\n\n'.repeat(10));await expect.poll(()=>gap(page)).toBeLessThanOrEqual(4)
 const bottom=await composer.boundingBox()
 await list.evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{deltaY:-1,bubbles:true}));el.scrollTop-=80});await expect(page.getByRole('button',{name:'回到最新消息',exact:true})).toBeVisible()
 const reading=await list.evaluate(el=>el.scrollTop);await append(page,'用户正在阅读时继续输出。\n\n'.repeat(12))
 const prompt=page.getByRole('button',{name:'有新回答，滚动至最新消息',exact:true});await expect(prompt).toBeVisible();expect(await list.evaluate(el=>el.scrollTop)).toBeCloseTo(reading,0)
 const listBox=await list.boundingBox(),rowBox=await page.locator('.latest-message-row').boundingBox(),inputBox=await page.locator('.input-box').boundingBox(),current=await composer.boundingBox();expect(listBox!.y+listBox!.height).toBeLessThanOrEqual(rowBox!.y+1);expect(rowBox!.y+rowBox!.height).toBeLessThanOrEqual(inputBox!.y);expect(current!.y+current!.height).toBeCloseTo(bottom!.y+bottom!.height,0)
 await prompt.click();await expect.poll(()=>gap(page)).toBeLessThanOrEqual(4);await expect(page.locator('.latest-message-row')).toHaveCount(0);await append(page,'回到底部后继续跟随。\n\n'.repeat(10));await expect.poll(()=>gap(page)).toBeLessThanOrEqual(4)
 await page.setViewportSize({width:800,height:600});await expect.poll(()=>gap(page)).toBeLessThanOrEqual(4)
 await page.setViewportSize({width:1440,height:900});await append(page,'放大窗口后继续跟随。\n\n'.repeat(5));await expect.poll(()=>gap(page)).toBeLessThanOrEqual(4)
})

test('smooth return accepts arriving content and can be interrupted by upward input',async({page})=>{
 await seed(page);const list=page.locator('.messages');await list.evaluate(el=>el.scrollTop=120);await append(page,'到达的新段落。\n\n'.repeat(10));await page.getByRole('button',{name:'有新回答，滚动至最新消息',exact:true}).click();await append(page,'平滑滚动时仍在生成。\n\n'.repeat(10));await expect.poll(()=>gap(page)).toBeLessThanOrEqual(4)
 await list.evaluate(el=>el.scrollTop=120);await append(page,'再次出现新内容。\n\n'.repeat(10));await page.getByRole('button',{name:'有新回答，滚动至最新消息',exact:true}).click()
 await list.dispatchEvent('wheel',{deltaY:-80});await list.evaluate(el=>el.scrollTop=180);await expect(page.getByRole('button',{name:'回到最新消息',exact:true})).toBeVisible();await append(page,'停止跳转后追加。\n\n');await expect(page.getByRole('button',{name:'有新回答，滚动至最新消息',exact:true})).toBeVisible();await page.waitForTimeout(250);expect(await list.evaluate(el=>el.scrollTop)).toBeCloseTo(180,0)
 await list.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(page.locator('.latest-message-row')).toHaveCount(0);await append(page,'手动到底部恢复。\n\n'.repeat(5));await expect.poll(()=>gap(page)).toBeLessThanOrEqual(4)
})

test('larger Composer chips are separated and Thinking opens its existing draft configuration',async({page})=>{
 await seed(page)
 for(const selector of ['.composer-model-name','.thinking-tag','.composer-search select'])expect(parseFloat(await page.locator(selector).evaluate(el=>getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13)
 for(const selector of ['.composer-provider-button','.thinking-tag','.composer-search']){await expect(page.locator(selector)).toHaveCSS('border-top-width','1px');expect((await page.locator(selector).boundingBox())!.height).toBeGreaterThanOrEqual(38)}
 await page.getByRole('button',{name:'配置思考强度',exact:true}).click();const panel=page.locator('#chat-provider-panel');await expect(panel).toBeVisible();await expect(panel.getByRole('group',{name:'模型列表'})).toHaveCount(0);await expect(panel.getByRole('slider',{name:'思考强度'})).toBeFocused();await page.keyboard.press('Home');await expect(page.locator('.thinking-tag')).toContainText('深度思考');await panel.getByRole('button',{name:'应用配置',exact:true}).click();await expect(page.locator('.thinking-tag')).toContainText('思考关闭');await expect(page.locator('.composer-model-name')).toContainText('claude-opus-example')
})

for(const sample of [{width:1440,height:900,scale:1,theme:'light'},{width:800,height:600,scale:1.25,theme:'dark'},{width:640,height:480,scale:1.5,theme:'light'}] as const)test(`last answer and Composer fit ${sample.width}x${sample.height} ${sample.theme} ${sample.scale*100}%`,async({browser})=>{
 const context=await browser.newContext({viewport:{width:sample.width,height:sample.height},deviceScaleFactor:sample.scale,colorScheme:sample.theme}),page=await context.newPage()
 try{
  await seed(page);await page.getByRole('textbox',{name:'聊天输入框',exact:true}).fill('草稿第一行\n第二行\n第三行\n第四行\n第五行\n第六行')
  await append(page,'\n\n```ts\nconst finished = true\n```\n\n最后一条消息的末尾验证标记。')
  await expect.poll(()=>gap(page)).toBeLessThanOrEqual(4)
  const end=await page.locator('.message.assistant').last().boundingBox(),list=await page.locator('.messages').boundingBox(),input=await page.locator('.input-box').boundingBox(),dock=await page.locator('.composer-dock').boundingBox();expect(end!.y+end!.height).toBeLessThanOrEqual(list!.y+list!.height+1);expect(list!.y+list!.height).toBeLessThanOrEqual(dock!.y+1);expect(dock!.y+dock!.height).toBeLessThanOrEqual(sample.height+1);expect(list!.height).toBeGreaterThan(90)
  await expect(page.getByText('最后一条消息的末尾验证标记。',{exact:true})).toBeInViewport();await expect(page.getByRole('button',{name:'配置思考强度',exact:true})).toBeInViewport();expect(await page.locator('.input-footer').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);expect(input!.width).toBeGreaterThan(200)
  mkdirSync('dist-release/v0.1.4/screenshots',{recursive:true});await page.screenshot({path:`dist-release/v0.1.4/screenshots/composer-scroll-${sample.theme}-${sample.scale}.png`})
 }finally{await context.close()}
})
