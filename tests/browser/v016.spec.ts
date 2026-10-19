import {test,expect,type Page} from '@playwright/test'
import {mkdirSync} from 'node:fs'
async function seed(page:Page){
 await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);const chat=useChatStore();chat.active.messages=[{id:'u',role:'user',content:'原问题',createdAt:'1'},{id:'a',parentId:'u',role:'assistant',content:'原始回答',createdAt:'2'},{id:'u2',parentId:'a',role:'user',content:'引用上文',references:[{messageId:'a',text:'原始回答'}],createdAt:'3'},{id:'a2',parentId:'u2',role:'assistant',content:'末尾回答',createdAt:'4'}];chat.trees[chat.activeId]=chat.active.messages.slice()})
}
test('reference navigation preserves the active branch and highlights its source',async({page})=>{
 await seed(page);await page.getByRole('button',{name:'查看引用来源'}).click();await expect(page.locator('[data-message-id="a"]')).toHaveClass(/reference-highlight/);await expect(page.locator('.message')).toHaveCount(4)
 expect(await page.evaluate(async()=>{const p='/src/stores/chat.ts';return (await import(p)).useChatStore().active.messages.at(-1).id})).toBe('a2')
})
test('tree restoration and deleting a turn require explicit confirmation',async({page})=>{
 await seed(page);await page.getByRole('button',{name:'对话树',exact:true}).click();await page.getByRole('button',{name:'恢复上下文：原始回答',exact:true}).click();await expect(page.getByRole('dialog',{name:'恢复此节点的上下文？'})).toBeVisible();await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.message')).toHaveCount(4)
 await page.getByRole('button',{name:'关闭对话树'}).click();await page.locator('[data-message-id="a2"]').getByRole('button',{name:'消息更多操作'}).click();await page.getByRole('menuitem',{name:'删除此轮',exact:true}).click();await expect(page.getByRole('dialog',{name:'删除此轮？'})).toBeVisible();await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.message')).toHaveCount(4)
})
test('composer previews intent and message context without persisting its override',async({page})=>{
 await seed(page);await page.getByRole('textbox',{name:'聊天输入框',exact:true}).fill('什么是递归？');await expect(page.locator('.request-preview')).toContainText('本条不联网');await expect(page.locator('.request-preview')).toContainText('5 条消息')
 await page.getByRole('textbox',{name:'聊天输入框',exact:true}).fill('搜索最新消息');await expect(page.locator('.request-preview')).toContainText('将联网检索');await page.getByRole('combobox',{name:'联网模式',exact:true}).selectOption('off');await expect(page.locator('.request-preview')).toContainText('本条不联网')
 mkdirSync('dist-release/v0.1.6/screenshots',{recursive:true});await page.screenshot({path:'dist-release/v0.1.6/screenshots/request-preview.png'})
})
test('multiple references deduplicate and each can be removed',async({page})=>{
 await seed(page);for(const id of ['u','a','u'])await page.locator(`[data-message-id="${id}"]`).getByRole('button',{name:'引用消息或选中文字'}).click()
 await expect(page.locator('.composer-references p')).toHaveCount(2);await page.getByRole('button',{name:'移除引用 1',exact:true}).click();await expect(page.locator('.composer-references p')).toHaveCount(1)
})
test('raw HTTP errors are expandable and budget numbers do not masquerade as status codes',async({page})=>{
 await seed(page);await page.evaluate(async()=>{const p='/src/stores/ui.ts';(await import(p)).useUiStore().failure('API 返回 HTTP 400: invalid request_options; max_tokens=1500')})
 await expect(page.locator('.toast.error')).not.toContainText('服务暂时不可用');await page.getByRole('button',{name:'查看详情',exact:true}).click();await expect(page.getByRole('dialog',{name:'错误详情'})).toContainText('max_tokens=1500');await expect(page.getByRole('button',{name:'复制原始错误'})).toBeVisible()
})
