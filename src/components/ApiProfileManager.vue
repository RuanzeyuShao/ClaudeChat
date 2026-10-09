<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { api } from '../services/tauri'
import { useUiStore } from '../stores/ui'
import { friendlyError } from '../utils/experience'
import { useChatStore } from '../stores/chat'
import { chatProviders, providerEntry } from '../chatProviders'
import type { ApiProfile, ModelPrice, ProviderKind, ProviderModel, Settings } from '../types'
import { ChevronDown, ChevronRight } from '@lucide/vue'

const props=defineProps<{initialProvider?:ProviderKind; initialProfileId?:string}>()
const chat=useChatStore(),ui=useUiStore()

const providerName=(kind:ProviderKind)=>kind==='openai-compatible'?'自定义兼容服务':chatProviders.find(p=>p.kind===kind)?.name || kind
const blank=(kind:ProviderKind=props.initialProvider || chat.settings.provider):ApiProfile=>({id:crypto.randomUUID(),name:'',baseUrl:'',provider:kind,model:'',thinking:'off',inputPrice:0,outputPrice:0,hasKey:false,requestOptions:null})
const draft=reactive<ApiProfile>(blank()), key=ref(''), reveal=ref(false), options=ref('{}')
const editorScroll=ref<HTMLElement>()
const selected=ref(''), filter=ref(''), modelQuery=ref(''), catalog=ref<ProviderModel[]>([])
const modelPickerOpen=ref(false), modelInput=ref<HTMLInputElement>()
const operation=ref(''), error=ref(''), notice=ref(''), testResult=ref<{ok:boolean;message:string}|null>(null)
watch(error,value=>{if(value)ui.notify(value,'error')})
watch(notice,value=>{if(value)ui.notify(value)})
const fieldErrors=ref<Record<string,string>>({}), snapshot=ref(''), discardOpen=ref(false), deleteOpen=ref(false)
const modelPrices=ref<ModelPrice[]>([]), priceModel=ref(''), priceInput=ref(0), priceOutput=ref(0)
let pendingNavigation:(()=>void)|undefined
const signature=()=>JSON.stringify({...draft,requestOptions:options.value})
const dirty=computed(()=>signature()!==snapshot.value || !!key.value)
const busy=computed(()=>!!operation.value || chat.profileBusy)
const blocked=computed(()=>busy.value || chat.loading)
const editing=computed(()=>chat.profiles.find(p=>p.id===selected.value))
const current=computed(()=>!!selected.value && chat.settings.profileId===selected.value && !!chat.settings.model && !!editing.value?.hasKey)
const ready=computed(()=>!!draft.model.trim() && (!!key.value.trim() || !!editing.value?.hasKey))
const filteredProfiles=computed(()=>chat.profiles.filter(p=>`${p.name} ${p.baseUrl} ${providerName(p.provider)} ${p.model}`.toLowerCase().includes(filter.value.trim().toLowerCase())))
const filteredModels=computed(()=>catalog.value.filter(m=>`${m.id} ${m.name || ''}`.toLowerCase().includes(modelQuery.value.trim().toLowerCase())))
const legacyAvailable=computed(()=>!chat.settings.profileId && !!chat.settings.baseUrl && !chat.profiles.some(p=>p.id==='legacy-global-api'))
const autoName=computed(()=>{let base=providerName(draft.provider);try{base+=` · ${new URL(draft.baseUrl).hostname}`}catch{}const names=new Set(chat.profiles.filter(p=>p.id!==draft.id).map(p=>p.name));let name=base,n=2;while(names.has(name))name=`${base} (${n++})`;return name})
const addressHost=(url:string)=>{try{return new URL(url).host}catch{return url}}
const configStatus=(profile:ApiProfile)=>!profile.hasKey?'待填写密钥':!profile.model.trim()?'待选择模型':chat.settings.profileId===profile.id?'使用中':'已保存'

function reset(profile?:ApiProfile){
 selected.value=profile?.id || '';Object.assign(draft,profile?JSON.parse(JSON.stringify(profile)):blank())
 options.value=JSON.stringify(profile?.requestOptions || {},null,2);key.value='';reveal.value=false;catalog.value=[];modelPickerOpen.value=false;modelQuery.value='';error.value='';fieldErrors.value={};testResult.value=null;deleteOpen.value=false;snapshot.value=signature()
}
function guard(action:()=>void){if(busy.value)return;if(dirty.value){pendingNavigation=action;discardOpen.value=true}else action()}
function discard(){discardOpen.value=false;const action=pendingNavigation;pendingNavigation=undefined;reset(editing.value);action?.()}
function cancelDiscard(){discardOpen.value=false;pendingNavigation=undefined}
function select(profile:ApiProfile){guard(()=>{notice.value='';reset(profile)})}
function create(){guard(()=>{notice.value='';filter.value='';reset()})}
function duplicate(){if(!editing.value)return;const source=JSON.parse(JSON.stringify(editing.value)) as ApiProfile;guard(()=>{reset();Object.assign(draft,source,{id:crypto.randomUUID(),name:`${source.name} 副本`,hasKey:false});options.value=JSON.stringify(source.requestOptions || {},null,2);notice.value='已复制连接信息，请为副本填写 API Key。';snapshot.value=''})}
defineExpose({requestLeave:guard,busy,confirmOpen:computed(()=>discardOpen.value || deleteOpen.value),cancelModal:()=>{if(busy.value)return;cancelDiscard();deleteOpen.value=false}})

watch(()=>[draft.provider,draft.baseUrl,key.value],()=>{catalog.value=[];modelPickerOpen.value=false;modelQuery.value=''})
watch(()=>[draft.provider,draft.baseUrl,draft.model,options.value,key.value],()=>{testResult.value=null;fieldErrors.value={};error.value=''})

function validate(requireKey=false,requireModel=false){
 const errors:Record<string,string>={}
 try {const url=new URL(draft.baseUrl.trim());if(!['https:','http:'].includes(url.protocol)||!url.hostname)throw new Error();if(url.username||url.password||url.search||url.hash)errors.baseUrl='地址中请勿包含用户名、密码或查询参数；密钥填写在 API Key 中。'}catch{errors.baseUrl='请输入完整 API 地址，例如 https://api.example.com/v1'}
 if(requireKey && !key.value.trim() && !editing.value?.hasKey)errors.key='请填写 API Key。'
 if(requireModel && !draft.model.trim())errors.model='请获取模型列表，或手动填写一个模型 ID。'
 if(!Number.isFinite(draft.inputPrice)||!Number.isFinite(draft.outputPrice)||draft.inputPrice<0||draft.outputPrice<0)errors.prices='价格必须是大于等于 0 的数字。'
 try {const parsed=JSON.parse(options.value || '{}');if(!parsed || Array.isArray(parsed)||typeof parsed!=='object')throw new Error();const protectedKeys=['messages','model','system','tools','stream'];if(Object.keys(parsed).some(k=>protectedKeys.includes(k)))throw new Error();draft.requestOptions=parsed}catch{errors.options='请输入有效 JSON 对象，且不要覆盖 model、messages、system、tools 或 stream。'}
 fieldErrors.value=errors;if(Object.keys(errors).length){error.value='请检查标出的配置项。';void nextTick(()=>{const field=editorScroll.value?.querySelector<HTMLElement>('[aria-invalid="true"]');if(field){field.scrollIntoView({block:'center'});field.focus()}else editorScroll.value?.scrollTo({top:0})});return false}return true
}
function requestSettings():Settings{return {...chat.settings,profileId:draft.id,provider:draft.provider,baseUrl:draft.baseUrl.trim().replace(/\/+$/,''),model:draft.model.trim(),thinking:draft.thinking,requestOptions:draft.requestOptions,apiKey:key.value.trim()}}
async function fetchModels(){
 if(blocked.value || !validate(true))return;operation.value='models';error.value=''
 try {catalog.value=await api.getProviderModels(requestSettings());modelPickerOpen.value=!!catalog.value.length;notice.value=catalog.value.length?`已读取 ${catalog.value.length} 个模型，请选择默认模型。`:'服务未返回模型，可以手动填写模型 ID。'}catch(e){error.value=`${friendlyError(e)}；也可以手动填写模型 ID。`}finally{operation.value=''}
}
function toggleModels(){if(blocked.value)return;if(catalog.value.length)modelPickerOpen.value=!modelPickerOpen.value;else void fetchModels()}
async function selectModel(model:string){
 if(blocked.value)return
 const clean=model.trim();if(!clean){fieldErrors.value={...fieldErrors.value,model:'请先填写模型 ID。'};return}
 draft.model=clean;modelPickerOpen.value=false;modelQuery.value=''
 await nextTick();modelInput.value?.focus({preventScroll:true})
}
async function test(){
 if(blocked.value || !validate(true,true))return;operation.value='test';error.value=''
 try{testResult.value=await api.testConnection(requestSettings());if(!testResult.value.ok)testResult.value.message=friendlyError(testResult.value.message);ui.notify(testResult.value.ok?'连接正常':testResult.value.message,testResult.value.ok?'success':'error')}catch(e){testResult.value={ok:false,message:friendlyError(e)}}finally{operation.value=''}
}
async function save(activate=false){
 if(blocked.value || !validate(activate,activate))return;operation.value='save';error.value='';notice.value=''
 let stored=false
 try {
  const saved=await chat.storeProfile({...draft,name:draft.name.trim() || autoName.value,baseUrl:draft.baseUrl.trim().replace(/\/+$/,''),model:draft.model.trim()},key.value)
  stored=true;reset(saved);filter.value=''
  notice.value=api.isTauri?'配置已保存。':'预览模式：配置仅保存在本次页面内存中。'
  if(activate){await chat.useProfile(saved.id);notice.value=`已保存并启用 ${saved.name}，可以开始聊天。`}
  else if(!saved.hasKey || !saved.model)notice.value+=' 补充密钥和默认模型后即可启用。'
 }catch(e){error.value=`${stored?'配置已保存，但启用失败：':''}${friendlyError(e)}`}finally{operation.value=''}
}
async function activate(){if(!selected.value || blocked.value)return;if(dirty.value){await save(true);return}operation.value='activate';error.value='';try{await chat.useProfile(selected.value);notice.value=`已启用 ${draft.name}。`}catch(e){error.value=friendlyError(e)}finally{operation.value=''}}
async function remove(){if(!selected.value || blocked.value)return;operation.value='delete';error.value='';try{const name=draft.name;await chat.removeProfile(selected.value);reset(chat.profiles.find(p=>p.id===chat.settings.profileId) || chat.profiles[0]);notice.value=`已删除 ${name}。聊天记录和用量统计已保留。`}catch(e){error.value=friendlyError(e);deleteOpen.value=false}finally{operation.value=''}}
async function importLegacy(){if(blocked.value)return;operation.value='import';error.value='';try{const p=await api.importLegacyProfile();await chat.refreshProfiles();reset(p);if(p.hasKey && p.model)await chat.useProfile(p.id);notice.value='旧版连接已导入，原始配置和密钥均已保留。'}catch(e){error.value=friendlyError(e)}finally{operation.value=''}}
async function savePrice(){if(blocked.value || !selected.value)return;if(!priceModel.value.trim()||![priceInput.value,priceOutput.value].every(n=>Number.isFinite(n)&&n>=0)){error.value='请填写模型 ID 和有效单价。';return}operation.value='price';try{await api.saveModelPrice({profileId:selected.value,model:priceModel.value.trim(),inputPrice:priceInput.value,outputPrice:priceOutput.value});modelPrices.value=await api.getModelPrices();notice.value='模型单价已保存。'}catch(e){error.value=friendlyError(e)}finally{operation.value=''}}
onMounted(async()=>{
 const chosen=props.initialProfileId==='new'?undefined:chat.profiles.find(p=>p.id===props.initialProfileId) || chat.profiles.find(p=>p.id===chat.settings.profileId && (!props.initialProvider || p.provider===props.initialProvider)) || chat.profiles.find(p=>!props.initialProvider || p.provider===props.initialProvider)
 reset(chosen)
 if(api.isTauri)try{modelPrices.value=await api.getModelPrices()}catch(e){error.value=friendlyError(e)}
})
</script>

<template>
 <div class="api-manager">
  <aside class="api-config-list" aria-label="已保存的 API 配置">
   <div class="api-list-heading"><strong>我的 API</strong><span>{{ chat.profiles.length }}</span><button :disabled="blocked" aria-label="新建 API 配置" @click="create">＋ 新建</button></div>
   <input v-model="filter" class="api-list-search" type="search" aria-label="搜索 API 配置" placeholder="搜索名称、服务或地址…"/>
   <div class="api-config-cards">
    <button v-for="p in filteredProfiles" :key="p.id" class="api-config-card" :class="{selected:p.id===selected}" :disabled="blocked" @click="select(p)">
     <span class="api-card-top"><strong>{{ p.name }}</strong><span class="api-status-badge" :class="{active:p.id===chat.settings.profileId && !!p.model && p.hasKey,incomplete:!p.hasKey || !p.model}">{{ configStatus(p) }}</span></span>
     <span>{{ providerName(p.provider) }}</span><small>{{ addressHost(p.baseUrl) }}</small><small>{{ p.model || '尚未选择模型' }}</small>
    </button>
    <p v-if="!chat.profiles.length" class="api-list-empty">还没有 API 配置<br/>在右侧添加第一个连接。</p><p v-else-if="!filteredProfiles.length" class="api-list-empty">没有匹配的配置</p>
   </div>
   <p class="api-local-note">API Key 保存在系统凭据管理器中。</p>
  </aside>
  <section class="api-editor">
   <div class="api-editor-heading"><div><h3>{{ selected?'编辑 API 配置':'添加 API 配置' }}</h3><p>{{ selected?'保存连接信息，按需启用。':'选择服务 → 填写连接 → 选择模型' }}</p></div><span v-if="dirty" class="api-dirty">未保存</span><span v-else-if="selected" class="api-status-badge">已保存</span></div>
   <div ref="editorScroll" class="api-editor-scroll">
    <p v-if="chat.loading" class="api-notice">当前正在生成回答，完成后可修改连接。</p><p v-if="!api.isTauri" class="api-notice">浏览器预览仅用于界面检查，配置不会写入桌面数据库。</p>
    <div v-if="legacyAvailable && api.isTauri" class="api-notice">发现旧版全局 API 连接。<button :disabled="blocked" @click="guard(()=>{void importLegacy()})">导入已有连接与密钥</button></div>
    <p v-if="notice" class="api-success" role="status">{{ notice }}</p><p v-if="error" class="api-error" role="alert">{{ error }}</p>
    <fieldset :disabled="blocked" class="api-editor-fields">
     <section class="api-form-section"><h4><span>1</span>聊天服务</h4><label>服务类型<select v-model="draft.provider"><option v-for="p in chatProviders" :key="p.kind" :value="p.kind">{{ p.name }}</option><option value="openai-compatible">自定义 · OpenAI 兼容服务</option></select></label></section>
     <section class="api-form-section"><h4><span>2</span>连接信息</h4>
      <label>API 地址 <em>必填</em><input v-model="draft.baseUrl" type="url" autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1" :aria-invalid="!!fieldErrors.baseUrl"/></label><p class="api-help">粘贴服务提供的 Base URL，也支持完整接口地址。</p><p v-if="fieldErrors.baseUrl" class="api-error">{{ fieldErrors.baseUrl }}</p>
      <label>API Key <span v-if="editing?.hasKey" class="api-key-saved">✓ 已安全保存</span><span class="api-key-input"><input v-model="key" :type="reveal?'text':'password'" autocomplete="new-password" spellcheck="false" :placeholder="editing?.hasKey?'留空保留现有密钥；输入新密钥即可更换':'粘贴 API Key，也可稍后补充'" :aria-invalid="!!fieldErrors.key"/><button type="button" :aria-label="reveal?'隐藏 API Key':'显示输入的 API Key'" @click="reveal=!reveal">{{ reveal?'隐藏':'显示' }}</button></span></label><p v-if="fieldErrors.key" class="api-error">{{ fieldErrors.key }}</p>
     </section>
     <section class="api-form-section"><h4><span>3</span>默认模型</h4><div class="api-model-row"><label>模型 ID<input ref="modelInput" v-model="draft.model" spellcheck="false" placeholder="获取模型后选择，或手动填写" :aria-invalid="!!fieldErrors.model"/></label><button type="button" class="api-secondary" aria-label="确认 API 模型" :disabled="!draft.model.trim() || blocked" @click="selectModel(draft.model)">选择</button><button type="button" class="api-secondary api-model-toggle" :aria-expanded="modelPickerOpen" aria-controls="api-model-options" @click="toggleModels">{{ operation==='models'?'获取中…':catalog.length?(modelPickerOpen?'收起模型列表':'展开模型列表'):'获取模型' }}<component :is="modelPickerOpen?ChevronDown:ChevronRight" :size="14"/></button></div><p v-if="fieldErrors.model" class="api-error">{{ fieldErrors.model }}</p>
      <div v-if="modelPickerOpen && catalog.length" id="api-model-options" class="api-model-picker"><header class="api-model-picker-heading"><span>可用模型</span><button type="button" @click="fetchModels">刷新列表</button></header><input v-model="modelQuery" type="search" aria-label="筛选 API 模型" placeholder="筛选模型…"/><div role="group" aria-label="API 模型列表"><button v-for="m in filteredModels" :key="m.id" type="button" :class="{chosen:draft.model===m.id}" :aria-pressed="draft.model===m.id" @click="selectModel(m.id)"><span>{{ m.name || m.id }}<small v-if="m.name">{{ m.id }}</small></span><span v-if="draft.model===m.id" aria-hidden="true">✓</span></button><p v-if="!filteredModels.length" class="api-help">没有匹配模型</p></div></div>
      <p class="api-help">选择列表或自定义模型后仅收起模型列表，配置界面保持打开；所有修改点击“保存配置”或“保存并启用”后生效。可先保存连接，稍后补充模型和密钥。</p>
      <button type="button" class="api-secondary" @click="test">{{ operation==='test'?'正在测试…':'测试连接' }}</button><span class="api-test-note">一次简短请求，可能产生少量用量</span><p v-if="testResult" :class="testResult.ok?'api-success':'api-error'" role="status">{{ testResult.ok?'✓ 连接正常，可保存并启用。':testResult.message }}</p>
     </section>
     <label>配置名称 <em>可选</em><input v-model="draft.name" :placeholder="autoName"/></label>
     <details class="api-advanced" :open="!!fieldErrors.options || !!fieldErrors.prices"><summary>高级设置 · 思考、价格与附加参数</summary>
      <label>默认思考强度<select v-model="draft.thinking"><option value="off">Off · 使用模型默认行为</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <div class="api-price-grid"><label>输入单价 / 百万 Token<input v-model.number="draft.inputPrice" type="number" min="0" step="0.01"/></label><label>输出单价 / 百万 Token<input v-model.number="draft.outputPrice" type="number" min="0" step="0.01"/></label></div><p v-if="fieldErrors.prices" class="api-error">{{ fieldErrors.prices }}</p>
      <label>附加请求参数（JSON）<textarea v-model="options" :aria-invalid="!!fieldErrors.options" rows="4" spellcheck="false"/></label><p class="api-help">通常保持 {} 即可。仅在服务要求特殊参数时修改。</p><p v-if="fieldErrors.options" class="api-error">{{ fieldErrors.options }}</p>
      <div v-if="selected" class="api-price-overrides"><h4>模型单价覆盖</h4><label>单独定价的模型<input v-model="priceModel"/></label><div class="api-price-grid"><label>输入单价<input v-model.number="priceInput" type="number" min="0" step="0.01"/></label><label>输出单价<input v-model.number="priceOutput" type="number" min="0" step="0.01"/></label></div><button type="button" class="api-secondary" @click="savePrice">保存模型单价</button><p v-for="price in modelPrices.filter(p=>p.profileId===selected)" :key="price.model" class="api-help">{{ price.model }} · 输入 ${{ price.inputPrice }} / 输出 ${{ price.outputPrice }}</p></div>
     </details>
    </fieldset>
   </div>
   <footer class="api-editor-footer"><div class="api-editor-actions"><button v-if="selected" :disabled="blocked" @click="duplicate">复制配置</button><button v-if="selected" class="api-danger" :disabled="blocked" @click="deleteOpen=true">删除</button></div><div><button class="api-secondary" :disabled="blocked || (selected!=='' && !dirty)" @click="save(false)">{{ operation==='save'?'保存中…':'保存配置' }}</button><button class="api-primary" :disabled="blocked || !ready || (current && !dirty)" @click="selected && !dirty ? activate() : save(true)">{{ current && !dirty?'当前使用中':selected && !dirty?'启用此配置':'保存并启用' }}</button></div></footer>
  </section>
  <div v-if="discardOpen" class="api-confirm-backdrop"><section class="api-confirm" role="alertdialog" aria-modal="true" aria-labelledby="api-discard-title"><h3 id="api-discard-title">有未保存的修改</h3><p>离开后，当前编辑内容和新输入的密钥将被放弃。</p><footer><button class="api-secondary" @click="cancelDiscard">继续编辑</button><button class="api-primary" @click="discard">放弃修改并继续</button></footer></section></div>
  <div v-if="deleteOpen" class="api-confirm-backdrop"><section class="api-confirm" role="alertdialog" aria-modal="true" aria-labelledby="api-delete-title"><h3 id="api-delete-title">删除“{{ draft.name }}”？</h3><p>将删除此配置及其系统密钥，聊天记录和历史用量会保留。{{ current?'当前 API 会停用，请重新选择其他配置。':'' }}</p><p v-if="chat.presets.some(p=>p.profileId===selected)" class="api-help">使用此配置的 Prompt 预设需要重新选择 API。</p><footer><button class="api-secondary" :disabled="busy" @click="deleteOpen=false">取消</button><button class="api-delete-button" :disabled="busy" @click="remove">{{ operation==='delete'?'删除中…':'确认删除配置' }}</button></footer></section></div>
 </div>
</template>
