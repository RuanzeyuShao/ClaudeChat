import { test, expect, type Page } from '@playwright/test'
async function seed(page:Page,generating=false){
 await expect(page.locator('.app-boot')).toHaveCount(0)
 await page.evaluate(async generating=>{
  const path='/src/stores/chat.ts';const {useChatStore}=await import(path),chat=useChatStore()
  chat.profiles=[['claude','anthropic-compatible'],['deep','deepseek'],['gpt','openai'],['claude-alt','anthropic-compatible']].map(([id,provider])=>({id,provider,name:id+' Profile',model:id+'-default',baseUrl:'https://'+id+'.invalid/v1',hasKey:true,thinking:'off',requestOptions:null,inputPrice:1,outputPrice:2}))
  chat.settings={...chat.settings,provider:'anthropic-compatible',profileId:'claude',baseUrl:'https://claude.invalid/v1',model:'claude-current',searchMode:'off',webSearch:false}
  chat.active.messages=[{id:'original-user',role:'user',parentId:null,content:'历史问题保持不变',createdAt:'1',attachments:[{id:'file',name:'original.md',kind:'document',mime:'text/markdown',size:3,text:'original attachment'}]},{id:'original-assistant',role:'assistant',parentId:'original-user',content:'历史回答保持不变',createdAt:'2'}]
  chat.trees[chat.activeId]=chat.active.messages.slice()
  if(generating){chat.loading=true;chat.status='generating';chat.requestSettings=JSON.parse(JSON.stringify(chat.settings));chat.active.messages.at(-1).pending=true}
 },generating)
}
test('same-conversation provider/profile/model choices update the actual Composer label without erasing history',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await seed(page)
 for(const [name,model] of [['Claude Chat','claude-custom'],['DeepSeek Chat','deep-custom'],['GPT Chat','gpt-custom'],['Claude Chat','claude-return']]){
  await page.getByRole('button',{name,exact:true}).click();const panel=page.getByRole('dialog',{name:name+' 配置'})
  if(model==='claude-return')await panel.getByRole('combobox',{name:/API 配置/}).selectOption('claude-alt')
  await panel.getByRole('textbox',{name:'自定义对话模型'}).fill(model);await panel.getByRole('button',{name:'选择',exact:true}).click();await expect(panel).toBeVisible();await panel.getByRole('button',{name:'应用配置',exact:true}).click()
  await expect(panel).toHaveCount(0);await expect(page.locator('.composer-provider-button')).toContainText(name);await expect(page.locator('.composer-provider-button')).toContainText(model);await expect(page.getByText('已切换到 '+name+' · '+model,{exact:true})).toBeVisible()
  await expect(page.locator('.message.user .markdown')).toHaveText('历史问题保持不变');await expect(page.locator('.message.assistant .markdown')).toHaveText('历史回答保持不变');await expect(page.locator('.message .attachment-card')).toContainText('original.md')
 }
 await page.getByRole('button',{name:'对话树',exact:true}).click();await expect(page.locator('.tree-node')).toHaveCount(2)
})
test('a generating conversation allows browsing choices, locks Apply, and switches after stopping',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await seed(page,true)
 await page.getByRole('button',{name:'配置当前聊天服务'}).click();await expect(page.getByRole('dialog',{name:'Claude Chat 配置'})).toBeVisible()
 await page.getByRole('button',{name:'DeepSeek Chat',exact:true}).click();const panel=page.getByRole('dialog',{name:'DeepSeek Chat 配置'})
 await expect(panel.getByRole('button',{name:'应用配置'})).toBeDisabled();await expect(panel.getByText('当前回答继续使用原模型')).toBeVisible();await expect(page.locator('.composer-provider-button')).toContainText('claude-current')
 await panel.getByRole('textbox',{name:'自定义对话模型'}).fill('next-deep');await panel.getByRole('button',{name:'选择',exact:true}).click();await expect(page.locator('.composer-provider-button')).not.toContainText('next-deep')
 await panel.getByRole('button',{name:'停止当前生成'}).click();await expect(panel.getByRole('button',{name:'应用配置'})).toBeEnabled();await panel.getByRole('button',{name:'应用配置'}).click();await expect(page.locator('.composer-provider-button')).toContainText('DeepSeek Chat');await expect(page.locator('.composer-provider-button')).toContainText('next-deep')
})
test('a failed selection keeps the original applied connection and shows an error',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await seed(page)
 await page.evaluate(async()=>{const path='/src/stores/chat.ts';const {useChatStore}=await import(path);useChatStore().profiles.find(p=>p.id==='deep').hasKey=false})
 await page.getByRole('button',{name:'DeepSeek Chat',exact:true}).click();const panel=page.getByRole('dialog',{name:'DeepSeek Chat 配置'});await panel.getByRole('button',{name:'应用配置'}).click();await expect(panel.getByRole('alert')).toContainText('API Key');await expect(page.locator('.composer-provider-button')).toContainText('Claude Chat');await expect(page.locator('.composer-provider-button')).toContainText('claude-current')
})
