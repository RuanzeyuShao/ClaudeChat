import {test,expect,type Page} from '@playwright/test'
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
async function seed(page:Page,fail=false){
 await page.route('**/src/services/tauri.ts*',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:body+`\nwindow.installMediaFixtures=()=>{api.isTauri=true;api.getExtension=async()=>null;api.saveExtension=async()=>{};api.getModelPrices=async()=>[];api.getRemoteImage=async(url)=>{window.imageReads=(window.imageReads||0)+1;if(window.imageFail)throw new Error('图片不存在（404），请打开来源或更换链接');return {dataUrl:'data:image/png;base64,${png}',resolvedUrl:url}};api.getAttachmentData=async()=> '${png}';api.openLinkPreview=async(url)=>{window.linkViews=(window.linkViews||[]).concat(url)};};\n`})})
 await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async fail=>{
  const path='/src/stores/chat.ts';const {useChatStore}=await import(path),chat=useChatStore();(window as any).imageFail=fail;(window as any).installMediaFixtures()
  chat.active.messages=[{id:'media-answer',role:'assistant',content:'图片示例：\n\n![创生之柱](https://image.test/photo.png)\n\n[查看图片来源](https://commons.wikimedia.org/wiki/File:Example.jpg)',createdAt:'1',attachments:[{id:'saved-image',kind:'image',name:'旧图片.png',mime:'image/png',size:100}],sources:[{title:'来源资料',url:'https://source.test/article'}]}];chat.trees[chat.activeId]=chat.active.messages.slice()
 },fail)
}
test('a decoded remote image opens a preview with Return to chat and restores saved image thumbnails',async({page})=>{
 await seed(page);const image=page.locator('.rich-content .content-image>img')
 await expect.poll(()=>image.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);await expect(page.locator('.attachment-thumbnail img')).toBeVisible();expect(await page.locator('.attachment-thumbnail img').getAttribute('src')).not.toContain('undefined')
 await page.getByRole('textbox',{name:'聊天输入框',exact:true}).fill('返回后继续编辑的草稿');await page.getByRole('button',{name:'查看大图',exact:true}).click();await expect(page.getByRole('dialog',{name:'图片预览'})).toBeVisible();await page.getByRole('button',{name:'返回聊天',exact:true}).click();await expect(page.getByRole('dialog',{name:'图片预览'})).toHaveCount(0);await expect(page.getByRole('textbox',{name:'聊天输入框',exact:true})).toHaveValue('返回后继续编辑的草稿')
})
test('missing images show a clear error and recover on retry without rewriting their message',async({page})=>{
 await seed(page,true);await expect(page.locator('.content-image-status')).toContainText('404');await expect(page.locator('.content-image>img')).toBeHidden();await expect(page.getByRole('button',{name:'查看大图',exact:true})).toBeDisabled()
 const before=await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);return useChatStore().active.messages[0].content});await page.evaluate(()=>(window as any).imageFail=false);await page.getByRole('button',{name:'重试图片',exact:true}).click();await expect.poll(()=>page.locator('.content-image>img').evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
 const after=await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);return useChatStore().active.messages[0].content});expect(after).toBe(before);expect(await page.evaluate(()=>(window as any).imageReads)).toBe(2)
})
test('body links and source cards call independent navigation while preserving the main chat and draft',async({page})=>{
 await seed(page);const before=page.url();await page.getByRole('textbox',{name:'聊天输入框',exact:true}).fill('链接返回后保留');await page.getByRole('link',{name:'查看图片来源',exact:true}).click();await page.locator('.source-link').click();await expect.poll(()=>page.evaluate(()=>(window as any).linkViews?.length)).toBe(2);expect(page.url()).toBe(before);await expect(page.getByRole('textbox',{name:'聊天输入框',exact:true})).toHaveValue('链接返回后保留');await expect(page.locator('.message.assistant')).toHaveCount(1)
})
