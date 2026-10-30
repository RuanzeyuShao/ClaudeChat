import {test,expect} from '@playwright/test'
import {mkdirSync} from 'node:fs'
for(const mode of ['light','dark'] as const)test(`workbench layout and existing actions ${mode}`,async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({colorScheme:mode});await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async mode=>{const p='/src/stores/chat.ts',chat=(await import(p)).useChatStore();await chat.setAppearance(mode,'emerald');chat.active.title='产品工作区 · 交互优化评审';chat.active.messages=[{id:'review-u',role:'user',content:'请总结这次工作区优化，并给出接下来的建议。',createdAt:'1'},{id:'review-a',parentId:'review-u',role:'assistant',content:'## 让注意力回到内容本身\n\n这次优化围绕导航、阅读和输入三条路径展开，保留熟悉的操作方式，让每一次切换更清楚、每一段内容更好读。\n\n> **设计结论**\n>\n> 清晰的层级比增加装饰更重要。将常用入口放在固定位置，让内容、工具和状态各有归属。\n\n### 我的建议\n\n1. **导航保持稳定**：图标轨提供快捷入口，详细侧栏保留服务与历史。\n2. **阅读减少干扰**：约束正文宽度，统一段落、标题和信息块。\n3. **输入集中呈现**：模型、思考与联网模式放在同一张卡片内。\n\n后续可以继续使用现有的搜索、对话树和附件工具完成工作。',createdAt:'2'}];chat.trees[chat.activeId]=chat.active.messages.slice();chat.settings.model='claude-sonnet';chat.settings.thinking='high'},mode)
 await expect(page.getByRole('navigation',{name:'工作区导航'})).toBeVisible();await expect(page.locator('.markdown blockquote')).toBeVisible()
 await page.getByRole('button',{name:'打开设置面板',exact:true}).click();await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible();await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'打开历史搜索',exact:true}).click();await expect(page.getByRole('searchbox',{name:'搜索历史对话'})).toBeFocused();await page.getByRole('button',{name:'关闭搜索',exact:true}).click()
 await page.getByRole('button',{name:'打开用量工作区',exact:true}).click();await expect(page.locator('.usage-dashboard')).toBeVisible();await page.getByRole('button',{name:'打开聊天工作区',exact:true}).click();await expect(page.getByRole('textbox',{name:'聊天输入框',exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.locator('.chat-header').hover();await page.waitForTimeout(300);mkdirSync('dist-release/v0.1.6-workbench/screenshots',{recursive:true});await page.screenshot({path:`dist-release/v0.1.6-workbench/screenshots/workbench-${mode}.png`})
 await page.setViewportSize({width:640,height:480});await expect(page.locator('.workspace-rail')).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('button',{name:'发送消息',exact:true})).toBeInViewport()
 await page.screenshot({path:`dist-release/v0.1.6-workbench/screenshots/workbench-${mode}-compact.png`})
})
