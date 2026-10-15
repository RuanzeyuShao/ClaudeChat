import {test,expect,type Page} from '@playwright/test'
import {mkdirSync} from 'node:fs'
async function seed(page:Page,count=24){
 await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async count=>{
  const path='/src/stores/chat.ts';const {useChatStore}=await import(path),chat=useChatStore()
  const messages=Array.from({length:count},(_,i)=>({id:'nav-'+i,role:i%2?'assistant':'user',createdAt:'2026-10-15',content:i%2?'## 回答 '+i+'\n\n'+'这是当前分支的详细结论。\n\n'.repeat(8)+'检测结论。[1][2]':'用户提问 '+i,sources:i%2?[{citation:'1',title:'真实搜索来源 A',url:'https://sources.test/a'},{citation:'2',title:'真实搜索来源 B',url:'https://sources.test/b'}]:undefined}))
  chat.active.messages=messages;chat.trees[chat.activeId]=messages.slice()
 },count)
}
for(const theme of ['light','dark'] as const)test(`verified citations and source cards share original navigation in ${theme}`,async({page})=>{
 await page.emulateMedia({colorScheme:theme});await seed(page,2)
 await page.evaluate(()=>{(window as any).opened=[];window.open=((url:string)=>(window as any).opened.push(url)) as any})
 const first=page.locator('.inline-citation a').first();await expect(first).toHaveText('[1]');await expect(first).toHaveAttribute('title',/真实搜索来源 A\nsources.test\nhttps:\/\/sources.test\/a/)
 await first.click();await page.locator('.inline-citation a').nth(1).click();await page.locator('.source-link').first().click();expect(await page.evaluate(()=>(window as any).opened)).toEqual(['https://sources.test/a','https://sources.test/b','https://sources.test/a'])
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);const answer=useChatStore().active.messages.at(-1);answer.content='[1]不能确认这是前一句还是后一句。';answer.sources=[{citation:'1',title:'真实来源',url:'https://sources.test/a'}]})
 await expect(page.locator('.inline-citation')).toHaveCount(0);await expect(page.locator('.citation-warning')).toContainText('引用不可验证');await expect(page.locator('.message.assistant .rich-content')).toContainText('[1]不能确认这是前一句还是后一句。')
})
for(const sample of [{theme:'light',width:1440,height:900},{theme:'dark',width:800,height:600},{theme:'light',width:640,height:480}] as const)test(`minimap hover, click, drag, keyboard and collapse ${sample.theme} ${sample.width}`,async({page})=>{
 await page.setViewportSize(sample);await page.emulateMedia({colorScheme:sample.theme});await seed(page)
 const rail=page.getByRole('slider',{name:'定位对话消息'});await expect(rail).toBeVisible();await expect(rail).toHaveAttribute('aria-valuemax','24')
 const box=(await rail.boundingBox())!,list=page.locator('.messages'),input=(await page.locator('.composer-dock').boundingBox())!
 expect(box.y+box.height).toBeLessThan(input.y);expect(box.x+box.width).toBeLessThan((await page.locator('.message-body').first().boundingBox())!.x)
 await rail.hover({position:{x:8,y:.2}});await expect(page.getByRole('tooltip')).toContainText('用户提问 0')
 await rail.click({position:{x:8,y:.2}});await expect.poll(()=>list.evaluate(n=>n.scrollTop)).toBeLessThan(30);await expect(rail).toHaveAttribute('aria-valuenow','1')
 await rail.focus();await page.keyboard.press('ArrowDown');await expect(rail).toHaveAttribute('aria-valuenow','2');await page.keyboard.press('End');await expect.poll(async()=>Number(await rail.getAttribute('aria-valuenow'))).toBeGreaterThan(20)
 await page.mouse.move(box.x+10,box.y+box.height-4);await page.mouse.down();await page.mouse.move(box.x+10,box.y+box.height*.35,{steps:8});await page.mouse.up();const reading=await list.evaluate(n=>n.scrollTop);expect(reading).toBeGreaterThan(30)
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);useChatStore().active.messages.at(-1).content+='流式新增内容。'.repeat(100)})
 await expect.poll(()=>list.evaluate(n=>n.scrollTop)).toBeCloseTo(reading,0)
 await page.getByRole('button',{name:'折叠历史导航'}).click();await expect(rail).toHaveCount(0);await page.getByRole('button',{name:'展开历史导航'}).click();await expect(rail).toBeVisible()
 mkdirSync('dist-release/v0.1.5/screenshots',{recursive:true});await page.screenshot({path:`dist-release/v0.1.5/screenshots/minimap-${sample.theme}-${sample.width}.png`})
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);const chat=useChatStore();chat.active.messages=[{id:'other-branch',role:'assistant',content:'当前选择的新分支短回答',createdAt:'1'}]})
 await expect(rail).toHaveCount(0);await expect(page.locator('.conversation-minimap')).toHaveCount(0)
})
test('minimap uses bounded DOM for a large branch and hides for short conversations',async({page})=>{
 await seed(page,1);await expect(page.locator('.conversation-minimap')).toHaveCount(0);await seed(page,120)
 await expect(page.locator('.minimap-rail')).toBeVisible();expect(await page.locator('.conversation-minimap *').count()).toBeLessThan(12)
 const rail=page.locator('.minimap-rail');await rail.focus();await page.keyboard.press('Home');await expect(rail).toHaveAttribute('aria-valuenow','1');await page.keyboard.press('End');await expect.poll(async()=>Number(await rail.getAttribute('aria-valuenow'))).toBeGreaterThan(110)
})
test('late provider sources and split streamed citation syntax resolve without shifting the claim',async({page})=>{
 await seed(page,2);await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);const answer=useChatStore().active.messages.at(-1);answer.sources=[];answer.content='检测结论。citeturn1search'})
 await expect(page.locator('.inline-citation')).toHaveCount(0)
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);const answer=useChatStore().active.messages.at(-1);answer.content+='0';answer.sources=[{citation:'turn1search0',title:'Provider 返回来源',url:'https://real.test/article'}]})
 await expect(page.locator('.inline-citation a')).toHaveAttribute('href','https://real.test/article');await expect(page.locator('.message.assistant .rich-content')).toHaveText('检测结论。[1]')
})
