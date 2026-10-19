import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync,readFileSync,statSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const read=path=>readFileSync(resolve(root,path),'utf8')
const json=path=>JSON.parse(read(path))
const pkg=json('package.json'),version=pkg.version,tag=`v${version}`
const lock=json('package-lock.json'),tauri=json('src-tauri/tauri.conf.json')
const cargoVersion=/^version\s*=\s*"([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))?.[1]
const cargoPackage=read('src-tauri/Cargo.lock').split('[[package]]').find(block=>/^name = "claude-chat"\r?$/m.test(block))
const cargoLockVersion=/^version = "([^"]+)"/m.exec(cargoPackage || '')?.[1]
for(const [file,actual] of [['package-lock.json',lock.version],['package-lock.json packages root',lock.packages?.['']?.version],['tauri.conf.json',tauri.version],['Cargo.toml',cargoVersion],['Cargo.lock',cargoLockVersion]])assert.equal(actual,version,`${file} does not match package.json`)

const directory=`installers/${tag}`,manifest=json(`${directory}/manifest.json`),verification=json(`${directory}/verification.json`)
assert.equal(manifest.version,version,'Installer manifest version mismatch')
assert.equal(manifest.installer,`ClaudeChat_${version}_x64-setup.exe`,'Installer filename mismatch')
const installer=resolve(root,directory,manifest.installer)
assert.equal(statSync(installer).size,manifest.bytes,'Installer byte count mismatch')
const checksum=createHash('sha256').update(readFileSync(installer)).digest('hex')
assert.equal(manifest.sha256,checksum,'Installer SHA-256 mismatch')
assert.equal(read(`${directory}/SHA256SUMS.txt`).trim(),`${checksum}  ${manifest.installer}`,'Checksum file mismatch')
assert.equal(verification.version,version,'Verification version mismatch')
assert.equal(verification.installerSha256,checksum,'Verification checksum mismatch')
assert.equal(verification.sourceCommit,manifest.sourceCommit,'Verification build source mismatch')

const release=`https://github.com/RuanzeyuShao/ClaudeChat/releases/tag/${tag}`
const download=`https://github.com/RuanzeyuShao/ClaudeChat/releases/download/${tag}/${manifest.installer}`
const readme=read('README.md')
assert.ok(readme.includes(`<h1>ClaudeChat · ${tag}</h1>`),'Homepage title does not advertise current version')
assert.ok(readme.includes(download),'Homepage must link to the official current installer')
assert.ok(readme.includes(release),'Homepage must link to the official current Release')
for(const match of readme.matchAll(/https:\/\/github\.com\/RuanzeyuShao\/ClaudeChat\/releases\/(?:tag|download)\/(v[^/"\s<)]+)/g))assert.equal(match[1],tag,'Homepage still advertises an old Release')
for(const path of [`docs/${tag}-test-report.md`,`${directory}/README.md`,'CHANGELOG.md'])assert.ok(existsSync(resolve(root,path)),`Missing release material: ${path}`)
for(const match of readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){const path=match[1].split('#')[0];if(path && !/^[a-z][a-z0-9+.-]*:/i.test(path))assert.ok(existsSync(resolve(root,path)),`Broken homepage file link: ${path}`)}
assert.ok(read(`docs/${tag}-test-report.md`).includes(checksum),'Current checksum is absent from release report')
assert.equal(manifest.releaseUrl,release,'Manifest points at another Release')
console.log(`Release consistency passed: ${tag}; version files, homepage, release materials and installer SHA-256 agree.`)

if(process.argv.includes('--github')){
  const headers={Accept:'application/vnd.github+json','User-Agent':'ClaudeChat-release-consistency','X-GitHub-Api-Version':'2022-11-28'}
  if(process.env.GITHUB_TOKEN)headers.Authorization=`Bearer ${process.env.GITHUB_TOKEN}`
  const github=async path=>{const response=await fetch(`https://api.github.com/repos/RuanzeyuShao/ClaudeChat${path}`,{headers,signal:AbortSignal.timeout(30000)});assert.ok(response.ok,`GitHub verification HTTP ${response.status}: ${path}`);return response.json()}
  const [repository,latest]=await Promise.all([github(''),github('/releases/latest')])
  assert.equal(repository.default_branch,'main','GitHub default branch is not main')
  assert.equal(latest.tag_name,tag,'Default-branch version differs from latest formal Release')
  assert.equal(latest.draft,false);assert.equal(latest.prerelease,false)
  const asset=latest.assets.find(asset=>asset.name===manifest.installer)
  assert.ok(asset,'Latest Release is missing the current installer')
  assert.equal(asset.size,manifest.bytes,'Release installer size differs from repository artifact')
  assert.equal(asset.digest,`sha256:${checksum}`,'Release installer checksum differs from repository artifact')
  assert.match(manifest.sourceCommit,/^[a-f0-9]{40}$/,'Invalid build source commit')
  const comparison=await github(`/compare/${manifest.sourceCommit}...main?per_page=1`)
  assert.ok(['ahead','identical'].includes(comparison.status),'Published build source has not been merged into main')
  console.log(`GitHub verification passed: default main, latest ${tag}, build source ancestry and published installer digest agree.`)
}
