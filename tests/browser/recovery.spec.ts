import {test,expect,type Page} from '@playwright/test'
async function seed(page:Page,status:'interrupted'|'complete'|'blocked'='interrupted'){
 await page.goto('/');await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async status=>{
  const chatPath='/src/stores/chat.ts',apiPath='/src/services/tauri.ts';const {useChatStore}=await import(chatPath),{api}=await import(apiPath),chat=useChatStore()
  chat.settings={...chat.settings,baseUrl:'https://mock.test',model:'mock',profileId:'',searchMode:'off',webSearch:false}
  chat.active.messages=[{id:'u',role:'user',content:'原始问题',createdAt:'1'},{id:'a',parentId:'u',role:'assistant',content:'已经保存的前半段。',createdAt:'2',generation:{status,reason:status==='complete'?'stop':status==='blocked'?'content_filter':'interrupted',continuations:1,recoveries:3},sources:[{citation:'7',title:'真实来源',url:'https://source.test/original'}]}]
  chat.trees[chat.activeId]=[...chat.active.messages];api.isTauri=true
  api.sendMessage=async(...args)=>{window.recoveryArgs=args;const message=chat.active.messages.at(-1);message.content+='接回后的结尾。';message.generation={status:'complete',reason:'stop',continuations:0};return message.generation}
  api.getTree=async()=>({leaf:'a',messages:chat.active.messages.map(m=>({...m,pending:false}))});api.getUsage=async()=>[];api.getExtension=async()=>({});api.saveExtension=async()=>{}
 },status)
}
test('incomplete reply resumes in place and keeps source cards',async({page})=>{
 await seed(page);await expect(page.locator('.generation-notice')).toContainText('回答未完成');await expect(page.locator('.generation-notice')).toContainText('已自动恢复 3 次');await page.locator('.generation-notice').getByRole('button',{name:'继续生成',exact:true}).click();await expect(page.locator('.message')).toHaveCount(2);await expect(page.locator('.message.assistant .markdown')).toContainText('已经保存的前半段。接回后的结尾。');await expect(page.locator('.source-entry')).toContainText('真实来源')
 const args=await page.evaluate(()=>window.recoveryArgs);expect(args[3]).toBe(false);expect(args[8]).toBe('a');expect(args[9]).toBe(false)
})
test('normal completion offers a user-triggered check while safety blocks continuation',async({page})=>{
 await seed(page,'complete');await page.getByRole('button',{name:'消息更多操作'}).last().click();await page.getByRole('menuitem',{name:'检查并继续'}).click();expect((await page.evaluate(()=>window.recoveryArgs))[9]).toBe(true)
 await seed(page,'blocked');await expect(page.locator('.generation-notice')).toContainText('内容安全');await expect(page.locator('.generation-notice button')).toHaveCount(0);await page.getByRole('button',{name:'消息更多操作'}).last().click();await expect(page.getByRole('menuitem',{name:/检查并继续|继续生成/})).toHaveCount(0)
})
test('recovery number remains visible during generation and Stop cancels the pending continuation',async({page})=>{
 await seed(page);await page.evaluate(async()=>{const chatPath='/src/stores/chat.ts',apiPath='/src/services/tauri.ts';const {useChatStore}=await import(chatPath),{api}=await import(apiPath),chat=useChatStore();let settle;api.sendMessage=()=>new Promise(resolve=>{settle=resolve;chat.continuationNotice='正在自动续写（第 2 次） · 正在恢复连接'});api.stopGeneration=async()=>settle({status:'stopped',reason:'cancelled',continuations:0,recoveries:2})})
 await page.locator('.generation-notice').getByRole('button',{name:'继续生成',exact:true}).click();await expect(page.locator('.request-status')).toContainText('正在自动续写（第 2 次）');await page.getByRole('button',{name:'停止生成',exact:true}).click();await expect(page.locator('.request-status')).toContainText('已停止');await expect(page.locator('.message')).toHaveCount(2);await expect(page.locator('.message.assistant .markdown')).toContainText('已经保存的前半段。')
})
