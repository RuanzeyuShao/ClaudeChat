import {nextTick,onBeforeUnmount,watch,type Ref} from 'vue'
import {animate,cancelMotion,reducedMotion} from './runtime'
// A bounded, one-read-before/one-read-after height transition, never attached to streamed text.
export function useHeightMotion(root:Ref<HTMLElement|undefined>,key:()=>unknown,large:()=>boolean=()=>false){
  let revision=0
  watch(key,async()=>{
    const element=root.value;if(!element)return
    const token=++revision,from=element.getBoundingClientRect().height
    await nextTick();if(token!==revision || root.value!==element)return
    cancelMotion(element);element.style.removeProperty('height');element.style.removeProperty('overflow')
    if(reducedMotion.value || large())return
    const to=element.getBoundingClientRect().height;if(Math.abs(to-from)<1)return
    element.style.overflow='clip';animate(element,[{height:`${from}px`},{height:`${to}px`}],'slow',()=>{element.style.removeProperty('height');element.style.removeProperty('overflow')})
  },{flush:'pre'})
  onBeforeUnmount(()=>{revision++;if(root.value)cancelMotion(root.value)})
}
