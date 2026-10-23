// Production Rust IPC + real SQLite. Mock credentials are inline; no system keyring writes.
import {chromium} from '@playwright/test'
import {spawn} from 'node:child_process'
import {mkdtempSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'node:http'
import {createServer as netServer} from 'node:net'
import assert from 'node:assert/strict'
const data=mkdtempSync(join(tmpdir(),'claudechat-recovery-')),exe=resolve(process.argv[2] || 'src-tauri/target/release/claude-chat.exe'),requests=[],queue=[]
const frame=v=>`data: ${JSON.stringify(v)}\n\n`
const answer=(text,finish='stop')=>frame({choices:[{delta:{content:text},finish_reason:finish}],usage:{prompt_tokens:11,completion_tokens:5}})+'data: [DONE]\n\n'
const api=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push(JSON.parse(body));const respond=queue.shift();if(!respond){res.writeHead(500);res.end('unexpected mock request');return}respond(res)})
await new Promise(r=>api.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${api.address().port}/v1`
const portServer=netServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r))
let app,browser,page
async function launch(){
 app=spawn(exe,['--data-dir',join(data,'application')],{windowsHide:true,stdio:'ignore',env:{...process.env,APPDATA:data,WEBVIEW2_USER_DATA_FOLDER:join(data,'webview'),NO_PROXY:'127.0.0.1,localhost',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}})
 const deadline=Date.now()+30000;while(Date.now()<deadline){try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break}catch{}await new Promise(r=>setTimeout(r,200))}
 while(Date.now()<deadline){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:2000});break}catch{await new Promise(r=>setTimeout(r,200))}}
 if(!browser)throw new Error('The production WebView DevTools endpoint did not become ready')
 page=browser.contexts()[0].pages()[0];await page.locator('.sidebar-footer').waitFor();await page.locator('.app-boot').waitFor({state:'detached'});assert.ok(existsSync(join(data,'application','claudechat.db')),'isolated database missing');return page
}
async function stop(){if(browser){await browser.close().catch(()=>{});browser=undefined}if(app && app.exitCode===null){const finished=new Promise(r=>app.once('exit',r));app.kill();await finished}app=undefined;const deadline=Date.now()+5000;while(Date.now()<deadline){try{if(!(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).ok)break}catch{break}await new Promise(r=>setTimeout(r,100))}}
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args})
const partial=res=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(frame({choices:[{delta:{content:'已经保存的第一段。',reasoning_content:'思考记录',annotations:[{url_citation:{url:'https://source.test/original',title:'真实测试来源',refer:'7'}}]}}],usage:{prompt_tokens:7,completion_tokens:4}}))}
const finish=text=>res=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(answer(text))}
try{
 await launch();const conversations=await invoke('get_conversations'),id=conversations[0].id,settings={...await invoke('get_settings'),autoContinuations:1,autoRecoveries:3,apiKey:'mock-local-only',profileId:'',provider:'openai',baseUrl:base,model:'mock-long',thinking:'off',webSearch:false,searchMode:'off',searchProvider:'claude',requestOptions:null}
 await invoke('rename_conversation',{conversationId:id,title:'原生恢复验证'})
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
 const attachment=await invoke('parse_attachment',{conversationId:id,name:'draft.png',mime:'image/png',data:png});assert.equal(attachment.data,null)
 assert.equal(await invoke('get_attachment_data',{attachmentId:attachment.id}),png)
 await invoke('save_draft',{conversationId:id,draft:{text:'元数据草稿',attachments:[{...attachment,data:'SHOULD_NOT_BE_SAVED'}]}})
 const savedDraft=await invoke('get_drafts');assert.equal(savedDraft[id].attachments[0].data,undefined);assert.equal(savedDraft[id].text,'元数据草稿')
 const other=await invoke('create_conversation',{model:'mock-long'})
 await invoke('save_extension',{key:`v6:context:${id}`,value:{contextMode:'recent',recentTurns:3,selectedMessageIds:['__none__'],selectedAttachmentIds:['__none__']}})
 assert.deepEqual((await invoke('select_conversation',{conversationId:id})).selectedMessageIds,['__none__'])
 assert.deepEqual((await invoke('select_conversation',{conversationId:other.id})).selectedMessageIds,[])
 assert.deepEqual((await invoke('select_conversation',{conversationId:id})).selectedMessageIds,['__none__'])
 const send=(node,content,continueMessageId=null)=>invoke('send_message',{conversationId:id,content,settings,persistUser:!continueMessageId,attachments:[],parentId:continueMessageId?null:undefined,references:[],requestId:node,continueMessageId,checkCompletion:false})
 queue.push(partial,finish('接着完成第二段。'));let completion=await send('native-answer','完成完整任务');assert.equal(completion.status,'complete');assert.equal(completion.recoveries,1)
 let tree=await invoke('get_tree',{conversationId:id});assert.equal(tree.messages.length,2);let message=tree.messages.find(m=>m.id==='native-answer');assert.equal(message.content,'已经保存的第一段。接着完成第二段。');assert.equal(message.reasoningContent,'思考记录');assert.equal(message.sources[0].citation,'7')
 let usage=await invoke('get_usage');assert.equal(usage.length,2);assert.equal(usage.reduce((n,u)=>n+u.inputTokens,0),18);assert.equal(usage.reduce((n,u)=>n+u.outputTokens,0),9)
 queue.push(finish('用户指定继续的补充。'));completion=await send('native-manual','',message.id);tree=await invoke('get_tree',{conversationId:id});assert.equal(tree.messages.length,2);assert.equal(tree.leaf,'native-answer');assert.ok(tree.messages.find(m=>m.id===message.id).content.endsWith('用户指定继续的补充。'));assert.equal((await invoke('get_usage')).length,3)
 // Force a process exit after a live checkpoint, before any terminal stream event.
 queue.push(res=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(frame({choices:[{delta:{content:'程序退出前的断点。'}}]}));setTimeout(()=>{if(!res.destroyed)res.write(frame({choices:[{delta:{content:'第二段已写入检查点。'}}]}))},900)})
 await page.evaluate(args=>{window.nativePending=window.__TAURI_INTERNALS__.invoke('send_message',args).catch(()=>{})},{conversationId:id,content:'断点恢复任务',settings,persistUser:true,attachments:[],parentId:'native-answer',references:[],requestId:'crash-answer',continueMessageId:null,checkCompletion:false})
 const checkpointDeadline=Date.now()+10000;let checkpointed=false;
 while(Date.now()<checkpointDeadline){const snapshot=await invoke('get_tree',{conversationId:id});if(snapshot.messages.some(m=>m.id==='crash-answer' && m.content.endsWith('第二段已写入检查点。'))){checkpointed=true;break}await new Promise(r=>setTimeout(r,100))}
 assert.equal(checkpointed,true,'live SQLite checkpoint was not committed before the process exit')
 await stop();await launch();tree=await invoke('get_tree',{conversationId:id});message=tree.messages.find(m=>m.id==='crash-answer');assert.equal(message.content,'程序退出前的断点。第二段已写入检查点。')
 const origins=await invoke('get_extension',{key:'v4:requestOrigins'});assert.equal(origins[message.usageId].generation.status,'interrupted')
 queue.push(finish('重启后接回完整结尾。'));completion=await send('restart-request','',message.id);assert.equal(completion.status,'complete');tree=await invoke('get_tree',{conversationId:id});assert.equal(tree.messages.length,4);assert.ok(tree.messages.find(m=>m.id==='crash-answer').content.endsWith('重启后接回完整结尾。'))
 for(const request of requests.slice(1))assert.equal(request.web_search_options,undefined)
 // A separate search model's safety refusal must abort the answering stage, with its call still recorded.
 const before=requests.length,usageBefore=(await invoke('get_usage')).length;
 queue.push(res=>{res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'content_filter',message:'search safety refusal'}}))});
 await assert.rejects(invoke('send_message',{conversationId:id,content:'独立搜索模型被拒绝',settings:{...settings,searchMode:'force',webSearch:true,searchModel:'mock-search'},persistUser:true,attachments:[],parentId:'crash-answer',references:[],requestId:'search-refusal',continueMessageId:null,checkCompletion:false}),/搜索未完成/);
 assert.equal(requests.length,before+1);assert.equal((await invoke('get_usage')).length,usageBefore+1)
 // A length-limited search response still allows the main answer, and keeps its warning.
 queue.push(res=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(answer('有限的搜索结果','length'))},finish('在检索受限下完成回答。'))
 const partialSearch=await invoke('send_message',{conversationId:id,content:'最新资料',settings:{...settings,autoContinuations:0,searchMode:'force',webSearch:true,searchModel:'mock-search'},persistUser:true,attachments:[attachment],parentId:'crash-answer',references:[],requestId:'partial-search',continueMessageId:null,checkCompletion:false});assert.equal(partialSearch.status,'complete')
 const finalTree=await invoke('get_tree',{conversationId:id});const partialAnswer=finalTree.messages.find(m=>m.id==='partial-search');assert.equal(partialAnswer.searchTrace.status,'failed');assert.ok(partialAnswer.searchTrace.error.includes('搜索未完成'))
 assert.equal(requests.at(-1).messages.some(m=>JSON.stringify(m).includes(png)),true)
 await invoke('delete_turn',{conversationId:id,messageId:'partial-search'});assert.equal((await invoke('get_tree',{conversationId:id})).messages.some(m=>m.id==='partial-search'),false)
 assert.equal(queue.length,0);console.log('v0.1.6 metadata drafts, cached images, isolated context, incomplete search fallback and permanent turn deletion: passed');console.log('Native recovery, per-call usage, same-node manual continuation, live checkpoint, process exit and restart resume: passed')
}finally{await stop();api.closeAllConnections();await new Promise(r=>api.close(r))}
