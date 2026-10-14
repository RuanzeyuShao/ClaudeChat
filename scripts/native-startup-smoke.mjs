// Verify the production WebView against real Rust IPC and an isolated SQLite database.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { strict as assert } from 'node:assert'
import { createServer } from 'node:net'

const executable=resolve(process.argv[2] || 'src-tauri/target-v014/release/claude-chat.exe')
const data=mkdtempSync(join(tmpdir(),'claudechat-v015-smoke-'))
const output=resolve('dist-release/v0.1.5/screenshots')
mkdirSync(output,{recursive:true})
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const port=server.address().port;await new Promise(resolve=>server.close(resolve))
let app, browser
async function launch(){
 app=spawn(executable,[],{windowsHide:true,stdio:'ignore',env:{...process.env,APPDATA:data,WEBVIEW2_USER_DATA_FOLDER:join(data,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}})
 app.on('error',error=>console.error(error.message))
 const deadline=Date.now()+30000
 while(Date.now()<deadline){try{const response=await fetch(`http://127.0.0.1:${port}/json/version`);if(response.ok)break}catch{}await new Promise(resolve=>setTimeout(resolve,250))}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
 const page=browser.contexts()[0].pages()[0] || await browser.contexts()[0].waitForEvent('page')
 await page.locator('.sidebar-footer').waitFor()
 await page.locator('.app-boot').waitFor({state:'detached'})
 assert.equal(await page.locator('.startup-error').count(),0,await page.locator('body').innerText())
 await page.getByRole('heading',{name:'从一个想法开始'}).waitFor()
 return page
}
async function stop(){
 if(browser){await browser.close().catch(()=>{});browser=undefined}
 if(app && app.exitCode===null){const exited=new Promise(resolve=>app.once('exit',resolve));app.kill();await exited}
 app=undefined
}
try{
 let page=await launch()
 assert.equal(await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_extension',{key:'v5:fontSize'})),null)
 await page.getByRole('button',{name:'设置',exact:true}).click()
 await page.getByRole('button',{name:'通用偏好',exact:true}).click()
 await page.getByRole('spinbutton',{name:'字体大小',exact:true}).fill('20')
 await page.getByRole('button',{name:'保存偏好',exact:true}).click()
 await page.getByText('偏好已保存。',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_extension',{key:'v5:fontSize'})),20)
 await page.getByRole('button',{name:'关闭设置',exact:true}).click()
 await page.getByRole('textbox',{name:'聊天输入框',exact:true}).fill('原生重启保留草稿')
 for(let i=0;i<6;i++)await page.getByRole('button',{name:'新建对话',exact:true}).click()
 assert.equal(await page.locator('.conversation').count(),1)
 const blank=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_extension',{key:'v5:blankConversation'}))
 assert.equal(typeof blank,'string');assert.ok(blank)
 // Allow the normal draft debounce to persist before restarting the native process.
 await page.waitForTimeout(800)
 const drafts=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_extension',{key:'v4:drafts'}))
 assert.equal(drafts[blank]?.text,'原生重启保留草稿')
 await page.screenshot({path:join(output,'native-startup.png')})
 await stop()
 page=await launch()
 assert.equal(await page.locator('body').evaluate(n=>getComputedStyle(n).fontSize),'20px')
 assert.equal(await page.getByRole('textbox',{name:'聊天输入框',exact:true}).inputValue(),'原生重启保留草稿')
 await page.getByRole('button',{name:'新建对话',exact:true}).click()
 assert.equal(await page.locator('.conversation').count(),1)
 assert.equal(await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_extension',{key:'v5:blankConversation'})),blank)
 await page.screenshot({path:join(output,'native-restart.png')})
 console.log('Native startup, real IPC preferences, repeated new chat and restart persistence: passed')
}finally{await stop()}
