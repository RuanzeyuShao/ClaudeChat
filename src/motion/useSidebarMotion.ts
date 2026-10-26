import {nextTick,onBeforeUnmount,watch,type Ref} from 'vue'
import {animate,cancelMotion,reducedMotion} from './runtime'
export function useSidebarMotion(root:Ref<HTMLElement|undefined>,collapsed:()=>boolean){
  const ghosts=new Set<HTMLElement>();let revision=0
  const clear=()=>{for(const ghost of ghosts){cancelMotion(ghost);ghost.remove()}ghosts.clear()}
  watch(collapsed,async value=>{
    const current=++revision;clear();const panel=root.value;if(!panel || reducedMotion.value)return
    const icons=Array.from(panel.querySelectorAll<HTMLElement>('.provider-mark,.brand>svg,.new-chat>svg,.usage-nav>svg,.settings-button>svg,.sidebar-toggle>svg')).slice(0,16)
    const previous=icons.map(el=>({el,rect:el.getBoundingClientRect()}))
    if(value){const bounds=panel.getBoundingClientRect();for(const label of Array.from(panel.querySelectorAll<HTMLElement>('.brand-name,.provider-name,.new-chat>span,.usage-nav>span,.settings-button>span,.conversation-title')).slice(0,24)){
      const rect=label.getBoundingClientRect();if(!rect.width || !rect.height)continue
      const ghost=document.createElement('span'),style=getComputedStyle(label);ghost.className='sidebar-motion-ghost';ghost.setAttribute('aria-hidden','true');ghost.textContent=label.textContent;Object.assign(ghost.style,{left:`${rect.left-bounds.left}px`,top:`${rect.top-bounds.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,font:style.font,color:style.color});panel.append(ghost);ghosts.add(ghost);animate(ghost,[{opacity:1},{opacity:0}],'fast',()=>{ghost.remove();ghosts.delete(ghost)})
    }}
    await nextTick();if(current!==revision || !root.value)return
    for(const {el,rect} of previous){cancelMotion(el);const target=el.getBoundingClientRect();animate(el,[{transform:`translate(${rect.left-target.left}px,${rect.top-target.top}px)`},{transform:'translate(0,0)'}],'slow')}
    if(!value)for(const label of Array.from(panel.querySelectorAll<HTMLElement>('.brand-name,.provider-name,.new-chat>span,.usage-nav>span,.settings-button>span')).slice(0,12))animate(label,[{opacity:0},{opacity:1}],'normal')
  },{flush:'pre'})
  onBeforeUnmount(()=>{revision++;clear();for(const el of Array.from(root.value?.querySelectorAll('*') || []))cancelMotion(el)})
}
