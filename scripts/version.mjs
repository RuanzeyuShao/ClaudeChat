import { readFileSync, writeFileSync } from 'node:fs'
const version='0.1.4'
for(const file of ['package.json','package-lock.json','src-tauri/tauri.conf.json']){
  const value=JSON.parse(readFileSync(file,'utf8'))
  value.version=version
  if(value.packages?.[''])value.packages[''].version=version
  if(file==='package.json')Object.assign(value.scripts,{'typecheck':'vue-tsc --noEmit','test':'vitest run','test:ui':'playwright test','release:collect':'node scripts/collect-release.mjs'})
  writeFileSync(file,JSON.stringify(value,null,2)+'\n')
}
const cargo=readFileSync('src-tauri/Cargo.toml','utf8').replace('version = "0.1.3"','version = "0.1.4"')
writeFileSync('src-tauri/Cargo.toml',cargo)
