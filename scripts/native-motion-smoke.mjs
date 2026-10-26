// Production WebView + real isolated SQLite. No development-only imports or user data.
import {chromium,expect} from '@playwright/test'
import {spawn} from 'node:child_process'
import {mkdtempSync,mkdirSync,existsSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'node:net'
import assert from 'node:assert/strict'

const executable=resolve(process.argv[2] || 'src-tauri/target-v014/release/claude-chat.exe')
const data=mkdtempSync(join(tmpdir(),'claudechat-motion-')),output=resolve('dist-release/v0.1.6-motion')
mkdirSync(join(output,'screenshots'),{recursive:true})
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r))
let app,browser
try{
 app=spawn(executable,['--data-dir',join(data,'application')],{windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:join(data,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}})
 const deadline=Date.now()+30000
 while(Date.now()<deadline){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});break}catch{await new Promise(r=>setTimeout(r,200))}}
 assert.ok(browser,'production WebView unavailable')
 const context=browser.contexts()[0],page=context.pages()[0]
 await expect(page.locator('.app-boot')).toHaveCount(0);await expect(page.locator('.sidebar-footer small')).toHaveText('v0.1.6')
 assert.ok(existsSync(join(data,'application','claudechat.db')),'isolated database missing')
 await expect(page.locator('html')).toHaveAttribute('data-motion-ready','true')
 assert.deepEqual(await page.locator('html').evaluate(el=>{const s=getComputedStyle(el);return ['fast','normal','slow','data'].map(x=>{const value=s.getPropertyValue('--motion-'+x).trim();return parseFloat(value)*(value.endsWith('ms')?1:1000)})}),[120,180,260,450])
 const cdp=await context.newCDPSession(page),scales=[]
 // Emulate WebView device scales; do not change the user's Windows display settings.
 for(const scale of [1,1.25,1.5]){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:scale,mobile:false})
  assert.ok(Math.abs(await page.evaluate(()=>devicePixelRatio)-scale)<.001)
  await page.getByRole('button',{name:'折叠侧边栏',exact:true}).click();await expect(page.locator('.sidebar')).toHaveCSS('width','68px')
  await page.evaluate(async()=>{for(let i=0;i<7;i++){document.querySelector('.sidebar-toggle').click();await new Promise(r=>setTimeout(r,30))}})
  await expect(page.locator('.sidebar')).toHaveCSS('width','264px');await expect(page.locator('.sidebar-motion-ghost')).toHaveCount(0)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible()
  await expect(page.locator('.api-settings')).toHaveCSS('transform','none')
  const offset=await page.getByRole('button',{name:'关闭设置',exact:true}).evaluate(el=>{const b=el.getBoundingClientRect(),s=el.querySelector('svg').getBoundingClientRect();return Math.max(Math.abs((s.left+s.right-b.left-b.right)/2),Math.abs((s.top+s.bottom-b.top-b.bottom)/2))})
  assert.ok(offset<.5,'close icon alignment')
  await page.screenshot({path:join(output,'screenshots',`native-motion-${scale*100}.png`)})
  if(scale===1){const stillLeaving=await page.evaluate(async()=>{document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await new Promise(r=>setTimeout(r,50));return !!document.querySelector('.api-settings-backdrop[inert]')});assert.ok(stillLeaving,'production CSS seconds must remain a 180ms exit, not .18ms')}
  else await page.keyboard.press('Escape')
  await expect(page.getByRole('button',{name:'设置',exact:true})).toBeFocused();await expect(page.locator('.api-settings-backdrop')).toHaveCount(0)
  scales.push({deviceScaleFactor:scale,viewport:'1100×800',overflow:false,closeIconMaxOffset:offset})
 }
 await page.getByRole('button',{name:'会话更多操作'}).click();await page.getByRole('menuitem',{name:'会话 Prompt',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'会话 Prompt',exact:true})).toBeVisible();await page.keyboard.press('Escape');await page.keyboard.press('Control+l')
 await expect(page.getByRole('textbox',{name:'聊天输入框',exact:true})).toBeFocused();await expect(page.locator('.modal-backdrop')).toHaveCount(0)
 await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('html')).toHaveAttribute('data-motion','reduce');await expect(page.locator('.sidebar')).toHaveCSS('transition-duration','0s')
 await page.getByRole('button',{name:'折叠侧边栏',exact:true}).click();await expect(page.locator('.sidebar')).toHaveCSS('width','68px')
 assert.equal(await page.locator('.sidebar').evaluate(el=>el.getAnimations({subtree:true}).length),0)
 await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();await page.emulateMedia({reducedMotion:'no-preference'});await expect(page.locator('html')).toHaveAttribute('data-motion','full')
 const before=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_settings'))
 await page.getByRole('textbox',{name:'聊天输入框',exact:true}).fill('动画回归草稿')
 await page.keyboard.press('Control+,');await page.keyboard.press('Escape');await expect(page.getByRole('textbox',{name:'聊天输入框',exact:true})).toHaveValue('动画回归草稿')
 assert.deepEqual(await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_settings')),before)
 const result={passed:true,executable,isolatedDatabase:true,deviceScaleEmulation:scales,reducedMotion:true,modalFocus:true,settingsUnchanged:true}
 writeFileSync(join(output,'native-motion-results.json'),JSON.stringify(result,null,2)+'\n')
 console.log('Native motion passed: tokens, rapid sidebar, modal focus, reduced motion, 100/125/150% WebView scale emulation, isolated SQLite and unchanged settings.')
}finally{
 if(browser)await browser.close().catch(()=>{})
 if(app && app.exitCode===null){const done=new Promise(r=>app.once('exit',r));app.kill();await done}
}
