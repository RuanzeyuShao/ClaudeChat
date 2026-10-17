// Production Rust IPC + real SQLite. Mock credentials are inline; no system keyring writes.
import {chromium} from '@playwright/test'
import {spawn} from 'node:child_process'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'node:http'
import {createServer as netServer} from 'node:net'
import assert from 'node:assert/strict'
const data=mkdtempSync(join(tmpdir(),'claudechat-recovery-')),exe=resolve('src-tauri/target-v014/release/claude-chat.exe'),requests=[],queue=[]
const frame=v=>`data: ${JSON.stringify(v)}\n\n`
const answer=(text,finish='stop')=>frame({choices:[{delta:{content:text},finish_reason:finish}],usage:{prompt_tokens:11,completion_tokens:5}})+'data: [DONE]\n\n'
const api=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push(JSON.parse(body));const respond=queue.shift();if(!respond){res.writeHead(500);res.end('unexpected mock request');return}respond(res)})
await new Promise(r=>api.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${api.address().port}/v1`
const portServer=netServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r))
let app,browser,page
async function launch(){
 app=spawn(exe,[],{windowsHide:true,stdio:'ignore',env:{...process.env,APPDATA:data,WEBVIEW2_USER_DATA_FOLDER:join(data,'webview'),NO_PROXY:'127.0.0.1,localhost',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}})
 const deadline=Date.now()+30000;while(Date.now()<deadline){try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break}catch{}await new Promise(r=>setTimeout(r,200))}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages()[0];await page.locator('.sidebar-footer').waitFor();await page.locator('.app-boot').waitFor({state:'detached'});return page
}
async function stop(){if(browser){await browser.close().catch(()=>{});browser=undefined}if(app && app.exitCode===null){const finished=new Promise(r=>app.once('exit',r));app.kill();await finished}app=undefined}
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args})
const partial=res=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(frame({choices:[{delta:{content:'已经保存的第一段。',reasoning_content:'思考记录',annotations:[{url_citation:{url:'https://source.test/original',title:'真实测试来源',refer:'7'}}]}}],usage:{prompt_tokens:7,completion_tokens:4}}))}
const finish=text=>res=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(answer(text))}
try{
 await launch();const conversations=await invoke('get_conversations'),id=conversations[0].id,settings={...await invoke('get_settings'),apiKey:'mock-local-only',profileId:'',provider:'openai',baseUrl:base,model:'mock-long',thinking:'off',webSearch:false,searchMode:'off',searchProvider:'claude',requestOptions:null}
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
 assert.equal(queue.length,0);console.log('Native recovery, per-call usage, same-node manual continuation, live checkpoint, process exit and restart resume: passed')
}finally{await stop();api.closeAllConnections();await new Promise(r=>api.close(r))}
