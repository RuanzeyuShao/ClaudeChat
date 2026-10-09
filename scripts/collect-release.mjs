import { copyFileSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
const version=JSON.parse(readFileSync('package.json','utf8')).version
const directory=resolve('dist-release',`v${version}`)
mkdirSync(directory,{recursive:true})
const filename=`ClaudeChat_${version}_x64-setup.exe`
const candidates=[join(process.env.CARGO_TARGET_DIR || 'src-tauri/target-v014','release/bundle/nsis',filename),join('src-tauri/target/release/bundle/nsis',filename)]
const installer=candidates.find(existsSync)
if(!installer)throw new Error('未找到当前版本的 NSIS 安装包，请先完成 tauri build --bundles nsis')
copyFileSync(installer,join(directory,filename))
const checksum=createHash('sha256').update(readFileSync(installer)).digest('hex')
writeFileSync(join(directory,'SHA256SUMS.txt'),`${checksum}  ${filename}\n`)
for(const file of ['CHANGELOG.md','docs/v0.1.4-test-report.md','docs/v0.1.4-design.md','docs/v0.1.4-ui-fix-report.md','docs/v0.1.4-model-switch-report.md','docs/v0.1.4-composer-picker-report.md','docs/v0.1.4-selector-fix-report.md','docs/v0.1.4-search-confirm-report.md','docs/v0.1.4-model-list-report.md','docs/v0.1.4-api-model-list-report.md','docs/v0.1.4-composer-scroll-report.md'])if(existsSync(file))copyFileSync(file,join(directory,file.split('/').at(-1)))
const files=execFileSync('git',['-c','core.quotepath=false','diff','--name-only'],{encoding:'utf8'}).trim().split('\n')
const added=execFileSync('git',['-c','core.quotepath=false','ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(Boolean)
writeFileSync(join(directory,'CHANGED-FILES.txt'),[...new Set([...files,...added])].sort().join('\n')+'\n')
writeFileSync(join(directory,'manifest.json'),JSON.stringify({product:'ClaudeChat',version,platform:'windows-x64',installer:filename,bytes:statSync(installer).size,sha256:checksum,builtAt:new Date().toISOString(),branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),remotePublished:false},null,2)+'\n')
console.log(`交付目录：${directory}\n${filename}\nSHA-256: ${checksum}`)
