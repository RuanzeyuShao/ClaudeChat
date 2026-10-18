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
async function shortLines(page:Page){await expect.poll(()=>page.locator('.minimap-line').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).width==='6px'))).toBe(true)}
async function leaveRail(page:Page){await page.mouse.move((page.viewportSize()?.width || 800)-20,20);await expect(page.getByRole('tooltip')).toHaveCount(0);await shortLines(page)}
for(const sample of [{theme:'light',width:1440,height:900},{theme:'dark',width:800,height:600},{theme:'light',width:640,height:480}] as const)test(`minimap widths, hover, smooth navigation and scroll sync ${sample.theme} ${sample.width}`,async({page})=>{
 await page.setViewportSize(sample);await page.emulateMedia({colorScheme:sample.theme,reducedMotion:'no-preference'});await seed(page)
 const rail=page.getByRole('slider',{name:'定位对话消息'}),list=page.locator('.messages');await expect(rail).toBeVisible();await expect(rail).toHaveAttribute('aria-valuemax','24')
 await leaveRail(page);await expect(rail).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(rail).toHaveCSS('border-left-width','0px')
 await rail.focus();await expect(rail).toHaveCSS('outline-style','none');await page.keyboard.press('Home');await expect.poll(()=>list.evaluate(n=>n.scrollTop)).toBeLessThan(30);await expect(rail).toHaveAttribute('aria-valuenow','1')
 const first=page.locator('.minimap-row[data-message-index="0"] .minimap-line'),second=page.locator('.minimap-row[data-message-index="1"] .minimap-line');await expect(first).toBeVisible();await shortLines(page)
 await expect(first).toHaveCSS('height','2px');await expect(first).toHaveCSS('transition-property','width');await expect(first).toHaveCSS('transition-duration','0.15s');await expect(first).toHaveCSS('transition-timing-function','ease')
 const lineBox=(await first.boundingBox())!,secondBox=(await second.boundingBox())!,railBox=(await rail.boundingBox())!,listBox=(await list.boundingBox())!
 expect(secondBox.y-lineBox.y-lineBox.height).toBeCloseTo(8,0);expect(railBox.x-listBox.x).toBeCloseTo(6,0)
 const reading=await list.evaluate(n=>n.scrollTop);await rail.hover({position:{x:12,y:10}});await expect(page.getByRole('tooltip')).toHaveCount(0);await rail.click({position:{x:12,y:10}});expect(await list.evaluate(n=>n.scrollTop)).toBeCloseTo(reading,0)
 await rail.hover({position:{x:12,y:5}});await expect(first).toHaveCSS('width','18px');await expect(page.getByRole('tooltip')).toContainText('用户提问 0');await expect(page.getByRole('tooltip')).toContainText('1 / 24')
 await expect.poll(()=>page.locator('.minimap-row:not(.is-hovered) .minimap-line').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).width==='6px'))).toBe(true)
 const expanded=(await first.boundingBox())!,text=(await page.locator('.message.assistant .message-body').first().boundingBox())!,card=(await page.getByRole('tooltip').boundingBox())!,input=(await page.locator('.composer-dock').boundingBox())!
 expect(text.x-expanded.x-expanded.width).toBeGreaterThanOrEqual(24);expect(card.x).toBeGreaterThan(expanded.x+expanded.width);expect(card.x+card.width).toBeLessThanOrEqual(sample.width);expect(card.y).toBeGreaterThanOrEqual(listBox.y);expect(card.y+card.height).toBeLessThanOrEqual(input.y)
 // The expanded line and transparent hit box must not cause a preview flicker.
 await page.evaluate(()=>{const node=document.querySelector('.minimap-preview')!;(window as any).previewNode=node})
 await rail.hover({position:{x:23,y:5}});await expect(page.getByRole('tooltip')).toBeVisible();expect(await page.evaluate(()=>(window as any).previewNode===document.querySelector('.minimap-preview'))).toBe(true)
 await leaveRail(page);await expect(first).toHaveCSS('width','6px')
 // A click must scroll the real message into place; being current must not leave its line expanded.
 await rail.click({position:{x:12,y:15}});await expect.poll(()=>page.locator('.message[data-message-id="nav-1"]').evaluate(node=>{const list=document.querySelector('.messages')!;return Math.abs(node.getBoundingClientRect().top-list.getBoundingClientRect().top-16)})).toBeLessThan(3)
 await expect(rail).toHaveAttribute('aria-valuenow','2');await leaveRail(page);await expect(page.locator('.minimap-row.is-current .minimap-line')).toHaveCSS('width','6px')
 await list.evaluate(node=>{const target=node.querySelector('[data-message-id="nav-4"]')!;node.scrollTo({top:node.scrollTop+target.getBoundingClientRect().top-node.getBoundingClientRect().top-16,behavior:'instant'})});await expect(rail).toHaveAttribute('aria-valuenow','5');await shortLines(page)
 const box=(await rail.boundingBox())!;await page.mouse.move(box.x+12,box.y+box.height-5);await page.mouse.down();await page.mouse.move(box.x+12,box.y+box.height*.35,{steps:8});await page.mouse.up();await leaveRail(page)
 const paused=await list.evaluate(n=>n.scrollTop);await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);useChatStore().active.messages.at(-1).content+='流式新增内容。'.repeat(100)});await expect.poll(()=>list.evaluate(n=>n.scrollTop)).toBeCloseTo(paused,0)
 await rail.hover({position:{x:12,y:10}});const beforeWheel=await list.evaluate(n=>n.scrollTop);await page.mouse.wheel(0,80);await expect.poll(()=>list.evaluate(n=>n.scrollTop)).toBeGreaterThan(beforeWheel);await expect(page.getByRole('tooltip')).toHaveCount(0);await leaveRail(page)
 await page.getByRole('button',{name:'折叠历史导航'}).click();await expect(rail).toHaveCount(0);await page.getByRole('button',{name:'展开历史导航'}).click();await expect(rail).toBeVisible();await leaveRail(page)
 mkdirSync('dist-release/v0.1.6/screenshots',{recursive:true});await page.screenshot({path:`dist-release/v0.1.6/screenshots/minimap-six-${sample.theme}-${sample.width}.png`})
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);useChatStore().active.messages=[{id:'other-branch',role:'assistant',content:'短分支',createdAt:'1'}]});await expect(rail).toHaveCount(0);await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('minimap uses bounded DOM for a large branch and hides for short conversations',async({page})=>{
 await seed(page,1);await expect(page.locator('.conversation-minimap')).toHaveCount(0);await seed(page,120)
 await expect(page.locator('.minimap-rail')).toBeVisible();expect(await page.locator('.conversation-minimap *').count()).toBeLessThan(60);expect(await page.locator('.minimap-row').count()).toBeLessThanOrEqual(24)
 const rail=page.locator('.minimap-rail');await rail.focus();await page.keyboard.press('Home');await expect(rail).toHaveAttribute('aria-valuenow','1');await page.keyboard.press('End');await expect.poll(async()=>Number(await rail.getAttribute('aria-valuenow'))).toBeGreaterThan(110)
})
test('late provider sources and split streamed citation syntax resolve without shifting the claim',async({page})=>{
 await seed(page,2);await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);const answer=useChatStore().active.messages.at(-1);answer.sources=[];answer.content='检测结论。citeturn1search'})
 await expect(page.locator('.inline-citation')).toHaveCount(0)
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);const answer=useChatStore().active.messages.at(-1);answer.content+='0';answer.sources=[{citation:'turn1search0',title:'Provider 返回来源',url:'https://real.test/article'}]})
 await expect(page.locator('.inline-citation a')).toHaveAttribute('href','https://real.test/article');await expect(page.locator('.message.assistant .rich-content')).toHaveText('检测结论。[1]')
})

test('two enormous messages keep a compact rail instead of a tall empty column',async({page})=>{
 await seed(page,2)
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);useChatStore().active.messages[1].content='很长的回答。\n\n'.repeat(300)})
 const rail=page.locator('.minimap-rail');await expect(rail).toBeVisible();expect((await rail.boundingBox())!.height).toBeLessThan(30)
 await expect(page.getByRole('tooltip')).toHaveCount(0);await rail.hover({position:{x:8,y:9.5}});await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('long user questions offer the complete original, and hover survives streamed layout updates',async({page})=>{
 await page.setViewportSize({width:1100,height:850});await page.emulateMedia({reducedMotion:'no-preference'});await seed(page)
 const full='这是必须完整保存的用户问题。'.repeat(120)+'完整问题结束标记';await page.evaluate(async text=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);useChatStore().active.messages[0].content=text},full)
 const rail=page.locator('.minimap-rail');await rail.focus();await page.keyboard.press('Home');await expect.poll(()=>page.locator('.messages').evaluate(n=>n.scrollTop)).toBeLessThan(30)
 await rail.hover({position:{x:12,y:5}});await expect(page.getByRole('tooltip')).toContainText('点击该横线查看完整问题');await expect(page.getByRole('tooltip')).toContainText('这是必须完整保存的用户问题。');await page.screenshot({path:'dist-release/v0.1.6/screenshots/minimap-full-question.png'})
 await page.evaluate(()=>{(window as any).previewNode=document.querySelector('.minimap-preview')})
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);useChatStore().active.messages.at(-1).content+='新增段落。'.repeat(120)});await page.waitForTimeout(250)
 await expect(page.getByRole('tooltip')).toBeVisible();expect(await page.evaluate(()=>(window as any).previewNode===document.querySelector('.minimap-preview'))).toBe(true)
 await rail.click({position:{x:12,y:5}});await leaveRail(page);await expect(page.locator('.message[data-message-id="nav-0"]')).toContainText('完整问题结束标记');await expect(page.locator('.minimap-row.is-current .minimap-line')).toHaveCSS('width','6px')
})
