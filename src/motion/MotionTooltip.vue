<script setup lang="ts">
import {nextTick,onMounted,onUnmounted,ref,useId} from 'vue'
import MotionTransition from './MotionTransition.vue'
const id=`motion-tooltip-${useId()}`,text=ref(''),shown=ref(false),position=ref({left:'0px',top:'0px'}),card=ref<HTMLElement>()
let target:HTMLElement|undefined,originalTitle='',description:string|null=null,timer:ReturnType<typeof setTimeout>|undefined,observer:MutationObserver|undefined,revision=0
function hide(){
  revision++;clearTimeout(timer);shown.value=false;observer?.disconnect()
  if(target){if(!target.hasAttribute('title'))target.setAttribute('title',originalTitle);delete target.dataset.motionTooltip;if(description===null)target.removeAttribute('aria-describedby');else target.setAttribute('aria-describedby',description)}
  target=undefined
}
function begin(event:Event){
  const node=(event.target as Element)?.closest<HTMLElement>('button[title],.inline-citation a[title],.source-link[title],button[data-motion-tooltip],.inline-citation a[data-motion-tooltip],.source-link[data-motion-tooltip]')
  if(!node || node.closest('[inert],.conversation-minimap') || node instanceof HTMLButtonElement && node.disabled){hide();return}
  if(target===node)return
  hide();target=node;originalTitle=node.getAttribute('title') || node.dataset.motionTooltip || '';if(!originalTitle)return
  description=node.getAttribute('aria-describedby');node.dataset.motionTooltip=originalTitle;node.removeAttribute('title');const token=revision
  timer=setTimeout(async()=>{
    if(target!==node || token!==revision)return;if(!node.isConnected){hide();return}
    text.value=originalTitle;const bounds=node.getBoundingClientRect();position.value={left:`${Math.max(12,Math.min(bounds.left,window.innerWidth-372))}px`,top:`${bounds.bottom+8}px`};shown.value=true
    await nextTick();if(target!==node || token!==revision)return
    const height=card.value?.getBoundingClientRect().height || 0
    position.value={...position.value,top:`${bounds.bottom+height+16>window.innerHeight?Math.max(8,bounds.top-height-8):bounds.bottom+8}px`}
    node.setAttribute('aria-describedby',[description,id].filter(Boolean).join(' '))
    observer=new MutationObserver(()=>{if(!node.isConnected)hide()});observer.observe(document.body,{childList:true,subtree:true})
  },180)
}
function leave(event:Event){if(!target || !(event.target instanceof Node) || !target.contains(event.target))return;const next=(event as MouseEvent).relatedTarget;if(!(next instanceof Node) || !target.contains(next))hide()}
function keyboard(event:KeyboardEvent){if(event.key==='Escape')hide()}
onMounted(()=>{document.addEventListener('pointerover',begin);document.addEventListener('pointerout',leave);document.addEventListener('focusin',begin);document.addEventListener('focusout',leave);document.addEventListener('keydown',keyboard);window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide)})
onUnmounted(()=>{hide();document.removeEventListener('pointerover',begin);document.removeEventListener('pointerout',leave);document.removeEventListener('focusin',begin);document.removeEventListener('focusout',leave);document.removeEventListener('keydown',keyboard);window.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide)})
</script>
<template><Teleport to="body"><MotionTransition name="motion-tooltip" speed="fast"><section v-if="shown" :id="id" ref="card" class="motion-tooltip" role="tooltip" :style="position">{{ text }}</section></MotionTransition></Teleport></template>
