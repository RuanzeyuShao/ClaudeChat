import {ref, type ObjectDirective} from 'vue'

export type MotionSpeed='fast'|'normal'|'slow'|'data'
export const reducedMotion=ref(false)
const active=new Map<Element,{animation:Animation;settle:()=>void}>()
let media:MediaQueryList|undefined,readyFrame=0,secondFrame=0,started=false,themeTimer:ReturnType<typeof setTimeout>|undefined
export function duration(speed:MotionSpeed='normal'):number{
  if(reducedMotion.value)return 0
  // Production CSS minification may serialize 180ms as .18s.
  const value=getComputedStyle(document.documentElement).getPropertyValue(`--motion-${speed}`).trim()
  return (parseFloat(value) || 0)*(value.endsWith('ms')?1:1000)
}
export function easing(){return getComputedStyle(document.documentElement).getPropertyValue('--motion-ease').trim() || 'ease-out'}
export function dataEasing(){const values=/cubic-bezier\(([^)]+)\)/.exec(easing())?.[1].split(',').map(Number);if(!values || values.length!==4)return (t:number)=>t;const [x1,y1,x2,y2]=values;const axis=(t:number,a:number,b:number)=>3*(1-t)*(1-t)*t*a+3*(1-t)*t*t*b+t*t*t;return (x:number)=>{let low=0,high=1,t=x;for(let i=0;i<12;i++){t=(low+high)/2;if(axis(t,x1,x2)<x)low=t;else high=t}return axis(t,y1,y2)}}
export function cancelMotion(element:Element){const current=active.get(element);if(current){current.animation.cancel();current.settle()}}
export function animate(element:Element,frames:Keyframe[],speed:MotionSpeed='normal',done?:()=>void){
  cancelMotion(element)
  if(reducedMotion.value || document.hidden || !element.animate || !duration(speed)){done?.();return}
  let settled=false
  const animation=element.animate(frames,{duration:duration(speed),easing:easing()})
  const settle=()=>{if(settled)return;settled=true;if(active.get(element)?.animation===animation)active.delete(element);done?.()}
  active.set(element,{animation,settle});animation.onfinish=settle;animation.oncancel=settle
}
function finishAll(){for(const [element,current] of [...active]){try{current.animation.finish()}catch{current.animation.cancel()}current.settle();active.delete(element)}}
function preference(){reducedMotion.value=!!media?.matches;document.documentElement.dataset.motion=reducedMotion.value?'reduce':'full';if(reducedMotion.value)finishAll()}
function visibility(){document.documentElement.dataset.motionHidden=String(document.hidden);if(document.hidden)finishAll()}
export const motionManager={
  start(){if(started)return;started=true;media=window.matchMedia('(prefers-reduced-motion: reduce)');preference();visibility();media.addEventListener('change',preference);document.addEventListener('visibilitychange',visibility);readyFrame=requestAnimationFrame(()=>{secondFrame=requestAnimationFrame(()=>document.documentElement.dataset.motionReady='true')})},
  themeChanged(){if(!document.documentElement.dataset.motionReady)return;clearTimeout(themeTimer);document.documentElement.dataset.motionThemeChange='true';themeTimer=setTimeout(()=>delete document.documentElement.dataset.motionThemeChange,duration('normal'))},
  stop(){media?.removeEventListener('change',preference);document.removeEventListener('visibilitychange',visibility);cancelAnimationFrame(readyFrame);cancelAnimationFrame(secondFrame);clearTimeout(themeTimer);finishAll();media=undefined;started=false;delete document.documentElement.dataset.motionReady;delete document.documentElement.dataset.motionThemeChange},
  activeCount:()=>active.size,
}
export function scrollBehavior(smooth=true):ScrollBehavior{return smooth && !reducedMotion.value && !window.matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant'}
export function focusOrigin():HTMLElement|null{const node=document.activeElement as HTMLElement|null;const opener=node?.closest<HTMLElement>('[data-motion-opener]')?.dataset.motionOpener;return opener?document.getElementById(opener) || node:node}
export const vMotion:ObjectDirective<HTMLElement,string|false|undefined>={
  mounted(element,{value}){if(!value)return;animate(element,value==='bar'?[{transform:'scaleX(0)'},{transform:element.style.transform}]:value==='message-assistant'?[{opacity:0},{opacity:1}]:[{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],value==='bar'?'data':'normal')},
  beforeUnmount:cancelMotion,
}
export function setLeaving(element:Element){const el=element as HTMLElement;el.inert=true;el.style.setProperty('--motion-loop-state','paused');el.setAttribute('aria-hidden','true');for(const modal of [el,...Array.from(el.querySelectorAll<HTMLElement>('[aria-modal=true]'))])if(modal.getAttribute('aria-modal')==='true'){modal.dataset.motionWasModal='true';modal.setAttribute('aria-modal','false')}}
export function setEntering(element:Element){const el=element as HTMLElement;el.inert=false;el.style.removeProperty('--motion-loop-state');el.removeAttribute('aria-hidden');for(const modal of [el,...Array.from(el.querySelectorAll<HTMLElement>('[data-motion-was-modal]'))])if(modal.dataset.motionWasModal){modal.setAttribute('aria-modal','true');delete modal.dataset.motionWasModal}}
