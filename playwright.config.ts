import { defineConfig } from '@playwright/test'
const port=process.env.CLAUDECHAT_TEST_PORT || '14320'
if(!/^\d+$/.test(port) || Number(port)<1 || Number(port)>65535)throw new Error('Invalid CLAUDECHAT_TEST_PORT')
const baseURL=`http://127.0.0.1:${port}`
export default defineConfig({
 testDir:'tests/browser',timeout:60000,workers:1,
 use:{baseURL,channel:'msedge',headless:true,screenshot:'only-on-failure'},
 // Never attach to an unrelated Vite app or to a user's desktop development session.
 webServer:{command:`npm run dev -- --host 127.0.0.1 --port ${port}`,url:baseURL,reuseExistingServer:false,timeout:60000},
 reporter:[['list'],['json',{outputFile:'dist-release/v0.1.6-motion/browser-results.json'}]],
})
