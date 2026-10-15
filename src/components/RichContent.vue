<script setup lang="ts">
import { computed,nextTick,onMounted,onUnmounted,ref,watch } from 'vue'
import { renderMarkdown } from '../utils/markdown'
import { codeAction } from '../utils/codeActions'
import { contentLink,openWebLink,webUrl } from '../utils/contentLinks'
import { forgetRemoteImage,remoteImage } from '../utils/remoteImages'
import { api } from '../services/tauri'
import BaseModal from './BaseModal.vue'
import type { Source } from '../types'
const props=defineProps<{content?:string;html?:string;sources?:Source[]}>()
const rendered=computed(()=>props.html ?? renderMarkdown(props.content || '',true,props.sources))
const root=ref<HTMLElement>(),viewer=ref<{src:string;alt:string;url:string}|null>(null)
let disposed=false
function available(image:HTMLImageElement){return !disposed && !!root.value?.contains(image)}
function status(image:HTMLImageElement,text:string,failed=false){
 if(!available(image))return
 const figure=image.closest<HTMLElement>('.content-image')!,notice=figure.querySelector<HTMLElement>('.content-image-status')!
 notice.textContent=text;notice.hidden=false;figure.classList.toggle('failed',failed);image.hidden=failed
 figure.querySelector<HTMLButtonElement>('[data-image-action="retry"]')!.hidden=!failed
 figure.querySelector<HTMLButtonElement>('[data-image-action="zoom"]')!.disabled=true
}
function loaded(event:Event){const image=event.target;if(!(image instanceof HTMLImageElement) || !image.closest('.content-image'))return;image.hidden=false;const figure=image.closest('.content-image')!;figure.classList.remove('failed');figure.querySelector<HTMLElement>('.content-image-status')!.hidden=true;figure.querySelector<HTMLButtonElement>('[data-image-action="retry"]')!.hidden=true;figure.querySelector<HTMLButtonElement>('[data-image-action="zoom"]')!.disabled=false}
function failed(event:Event){const image=event.target;if(image instanceof HTMLImageElement && image.closest('.content-image'))status(image,'图片加载失败，请重试或打开原链接。',true)}
async function load(image:HTMLImageElement,retry=false){
 const source=image.dataset.mediaSrc || image.getAttribute('src') || '',url=webUrl(source)
 if(!url){if(source.startsWith('data:image/')){if(image.complete){if(image.naturalWidth)loaded({target:image} as unknown as Event);else status(image,'图片无法解码，请重新上传或更换图片。',true)}return}status(image,'图片地址无效，请打开来源或更换链接。',true);return}
 image.dataset.mediaSrc=url
 if(retry)forgetRemoteImage(url)
 status(image,'正在加载图片…');image.hidden=true
 try{
  if(api.isTauri){const result=await remoteImage(url);if(available(image)){image.src=result.dataUrl;image.dataset.resolvedUrl=result.resolvedUrl;image.hidden=false;if(image.complete && image.naturalWidth)loaded({target:image} as unknown as Event)}}
  else{image.src=url;image.hidden=false;if(image.complete && image.naturalWidth)loaded({target:image} as unknown as Event)}
 }catch(error){status(image,String(error).replace(/^Error:\s*/,''),true)}
}
async function prepare(){
 await nextTick();if(disposed || !root.value)return
 for(const image of Array.from(root.value.querySelectorAll<HTMLImageElement>('img:not([data-image-ready])'))){
  image.dataset.imageReady='true';image.referrerPolicy='no-referrer';image.decoding='async'
  const figure=document.createElement('span');figure.className='content-image';const caption=document.createElement('span');caption.className='content-image-status';caption.setAttribute('role','status')
  const tools=document.createElement('span');tools.className='content-image-tools'
  for(const [action,text] of [['zoom','查看大图'],['retry','重试图片'],['source','打开原链接']]){const button=document.createElement('button');button.type='button';button.dataset.imageAction=action;button.textContent=text;tools.append(button)}
  tools.querySelector<HTMLButtonElement>('[data-image-action="zoom"]')!.disabled=true;tools.querySelector<HTMLButtonElement>('[data-image-action="retry"]')!.hidden=true;tools.querySelector<HTMLButtonElement>('[data-image-action="source"]')!.hidden=!webUrl(image.dataset.mediaSrc || image.getAttribute('src') || '')
  image.replaceWith(figure);figure.append(image,caption,tools);void load(image)
 }
}
function click(event:MouseEvent){
 const target=event.target as Element,button=target.closest<HTMLButtonElement>('[data-image-action]'),image=target instanceof HTMLImageElement?target:button?.closest('.content-image')?.querySelector('img')
 if(image && available(image)){
  event.preventDefault()
  if(button?.dataset.imageAction==='retry'){void load(image,true);return}
  if(button?.dataset.imageAction==='source'){void openWebLink(image.dataset.mediaSrc || image.src);return}
  if(image.naturalWidth && !image.hidden)viewer.value={src:image.src,alt:image.alt,url:image.dataset.mediaSrc || ''}
  return
 }
 if(!contentLink(event))void codeAction(event)
}
watch(rendered,prepare,{flush:'post'});onMounted(prepare);onUnmounted(()=>{disposed=true})
</script>
<template>
 <div ref="root" class="markdown rich-content" v-html="rendered" @click="click" @load.capture="loaded" @error.capture="failed"/>
 <BaseModal v-if="viewer" title="图片预览" wide @close="viewer=null"><img class="content-image-full" :src="viewer.src" :alt="viewer.alt"/><template #footer><button class="secondary" @click="viewer=null">返回聊天</button><button v-if="webUrl(viewer.url)" class="primary" @click="openWebLink(viewer.url)">打开原链接</button></template></BaseModal>
</template>
<style>
.content-image{display:flex;flex-direction:column;align-items:flex-start;gap:8px;max-width:100%;padding:10px;margin:12px 0;border:1px solid var(--line);border-radius:10px;background:var(--panel)}.content-image img{display:block;max-width:100%;max-height:480px;object-fit:contain;cursor:zoom-in}.content-image img[hidden]{display:none}.content-image-status{font-size:12px;color:var(--muted);padding:10px}.content-image-status[hidden]{display:none}.content-image.failed .content-image-status{color:var(--error)}.content-image-tools{display:flex;flex-wrap:wrap;gap:8px}.content-image-tools button{border:1px solid var(--line);border-radius:7px;background:var(--soft);padding:5px 9px;font-size:12px}.content-image-tools button:hover{color:var(--accent)}.content-image-tools button[hidden]{display:none}.content-image-full{display:block;max-width:100%;max-height:65dvh;object-fit:contain;margin:auto}
</style>
