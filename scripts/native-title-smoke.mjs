// Production WebView + isolated SQLite + local model fixture; no real API credentials.
import {chromium} from '@playwright/test'
import {spawn} from 'node:child_process'
import {mkdtempSync,existsSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
const data=mkdtempSync(join(tmpdir(),'claudechat-title-')),exe=resolve(process.argv[2] || 'src-tauri/target-v014/release/claude-chat.exe')
const titles=[],main=[],held=[];let mode='hold'
const titleReply=(res,title='Python 数据分析学习路线')=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:title}}],usage:{prompt_tokens:18,completion_tokens:9}}))}
const server=createServer(async(req,res)=>{let text='';for await(const part of req)text+=part;const body=JSON.parse(text)
 if(body.stream===false){titles.push(body);if(mode==='hold')held.push(res);else if(mode==='fail'){res.writeHead(503,{'Content-Type':'application/json'});res.end('{}')}else titleReply(res);return}
 main.push(body);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'正文回答已完成。'},finish_reason:'stop'}],usage:{prompt_tokens:11,completion_tokens:5}})+'\n\ndata: [DONE]\n\n')
})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/v1`
const portServer=createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r))
let app,browser,page
async function launch(){
 app=spawn(exe,['--data-dir',join(data,'application')],{windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:join(data,'webview'),NO_PROXY:'localhost,127.0.0.1',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}})
 const deadline=Date.now()+30000;while(Date.now()<deadline){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});break}catch{await new Promise(r=>setTimeout(r,200))}}
 if(!browser)throw new Error('Native WebView unavailable');page=browser.contexts()[0].pages()[0];await page.locator('.sidebar-footer').waitFor();await page.locator('.app-boot').waitFor({state:'detached'});assert.ok(existsSync(join(data,'application','claudechat.db')))
}
async function stop(){if(browser){await browser.close().catch(()=>{});browser=undefined}if(app && app.exitCode===null){const done=new Promise(r=>app.once('exit',r));app.kill();await done}app=undefined;await new Promise(r=>setTimeout(r,400))}
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args})
async function until(check,label){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,60))}throw new Error(label)}
try{
 await launch();const id=(await invoke('get_conversations'))[0].id
 const settings={...await invoke('get_settings'),provider:'openai-compatible',baseUrl:base,model:'title-test-model',apiKey:'local-mock',profileId:'',thinking:'off',searchMode:'off',webSearch:false,autoContinuations:0,autoRecoveries:0}
 const send=async(conversationId,content,attachments=[],persistUser=true)=>{const tree=await invoke('get_tree',{conversationId});const parentId=persistUser?tree.leaf:tree.messages.find(m=>m.id===tree.leaf)?.parentId;return invoke('send_message',{conversationId,content,settings,persistUser,attachments,parentId,references:[],requestId:crypto.randomUUID(),continueMessageId:null,checkCompletion:false})}
 await send(id,'我是刚接触编程的新手，想用 Python 处理 Excel 和可视化数据，请帮我安排学习计划。')
 await until(()=>titles.length===1,'first title request missing');assert.equal(main.length,1);assert.equal(held.length,1);assert.equal((await invoke('get_conversations')).find(c=>c.id===id).title,'新对话')
 // The answer invoke has returned even though the title response is still deliberately held.
 await send(id,'请把计划细化到第一周');assert.equal(main.length,2);assert.equal(titles.length,1)
 titleReply(held.shift());await until(async()=>(await invoke('get_conversations')).find(c=>c.id===id).title==='Python 数据分析学习路线','AI title not persisted')
 await page.locator('.conversation-title').filter({hasText:'Python 数据分析学习路线'}).waitFor()
 let usage=await invoke('get_usage');assert.equal(usage.filter(u=>u.id.startsWith('title:')).length,1);assert.equal(usage.filter(u=>u.id.startsWith('title:'))[0].inputTokens,18)
 const origins=await invoke('get_extension',{key:'v4:requestOrigins'});assert.equal(origins[usage.find(u=>u.id.startsWith('title:')).id].purpose,'conversation_title')
 await page.getByRole('button',{name:'用量统计',exact:true}).click();await page.locator('.usage-records tbody tr').filter({hasText:'AI 标题'}).first().click();await page.getByRole('dialog',{name:'单次请求'}).getByText('AI 标题（仅首次发送）',{exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('button',{name:'关闭用量统计',exact:true}).click()
 mkdirSync('dist-release/v0.1.6/screenshots',{recursive:true});await page.screenshot({path:'dist-release/v0.1.6/screenshots/ai-title-native.png'})
 await stop();await launch();await send(id,'重启后继续同一个话题');await send(id,'重生成原回答',[],false);assert.equal(titles.length,1)
 const manual=await invoke('create_conversation',{model:settings.model});await send(manual.id,'第二份新会话');await until(()=>titles.length===2,'manual race title request missing');await invoke('rename_conversation',{conversationId:manual.id,title:'自己指定的标题'});titleReply(held.shift(),'不应覆盖手动名称');await until(async()=>(await invoke('get_usage')).filter(u=>u.id.startsWith('title:')).length===2,'title usage missing');assert.equal((await invoke('get_conversations')).find(c=>c.id===manual.id).title,'自己指定的标题')
 mode='fail';const failed=await invoke('create_conversation',{model:settings.model});await send(failed.id,'标题服务故障的会话');await until(async()=>(await invoke('get_usage')).filter(u=>u.id.startsWith('title:')).length===3,'failed title attempt not recorded');await send(failed.id,'继续发送不要再次生成标题');assert.equal(titles.length,3)
 mode='auto';const doc=await invoke('create_conversation',{model:settings.model});const attachment=await invoke('parse_attachment',{conversationId:doc.id,name:'计划.md',mime:'text/markdown',data:Buffer.from('目标：学习数据分析与可视化').toString('base64')});await send(doc.id,'',[attachment]);await until(()=>titles.length===4,'attachment title request missing');assert.ok(titles[3].messages.at(-1).content.includes('计划.md'));assert.ok(titles[3].messages.at(-1).content.includes('学习数据分析'));assert.equal(titles[3].web_search_options,undefined)
 mode='hold';const deleted=await invoke('create_conversation',{model:settings.model});await send(deleted.id,'删除会话的竞态');await until(()=>titles.length===5,'deletion race request missing');await invoke('delete_conversation',{conversationId:deleted.id});titleReply(held.shift());await new Promise(r=>setTimeout(r,300));assert.equal((await invoke('get_conversations')).some(c=>c.id===deleted.id),false)
 console.log('Native AI titles passed: one call per first send, nonblocking reply, persisted restart, regenerate/follow-up exclusion, manual rename, failure without retry, attachment context, separate usage and deletion race.')
}finally{for(const res of held)res.destroy();await stop();server.closeAllConnections();await new Promise(r=>server.close(r))}
