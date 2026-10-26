import {onMounted,onUnmounted,ref,watch,type Ref} from 'vue'
import {dataEasing,duration,reducedMotion} from './runtime'
// Presentation-only values. The original statistics, filters and costs remain authoritative.
export function useDataMotion(target:()=>number[],enabled:()=>boolean,large:()=>boolean){
  const display=ref<number[]>([]),progress=ref(1)
  let frame=0,generation=0,mounted=false,painted=false
  const stop=()=>{generation++;cancelAnimationFrame(frame);frame=0}
  const update=()=>{
    stop();const end=[...target()];if(!mounted || !enabled() || reducedMotion.value || large() || document.hidden || !duration('data') || display.value.length===end.length && end.every((v,i)=>v===display.value[i])){display.value=end;progress.value=1;return}
    const from=end.map((value,i)=>display.value[i] ?? (i<7?0:value)),start=performance.now(),time=duration('data'),revision=generation,ease=dataEasing(),draw=!painted && end.length>7;progress.value=draw?0:1;if(end.length>7)painted=true
    const tick=(now:number)=>{if(revision!==generation)return;const t=time?Math.min(1,(now-start)/time):1,eased=ease(t);display.value=end.map((value,i)=>from[i]+(value-from[i])*eased);if(draw)progress.value=eased;if(t<1)frame=requestAnimationFrame(tick);else{display.value=end;frame=0}}
    frame=requestAnimationFrame(tick)
  }
  const visibility=()=>{if(document.hidden){stop();display.value=[...target()];progress.value=1}}
  watch([target,enabled,large,reducedMotion],update,{deep:true})
  onMounted(()=>{mounted=true;document.addEventListener('visibilitychange',visibility);update()})
  onUnmounted(()=>{stop();document.removeEventListener('visibilitychange',visibility)})
  const finish=()=>{if(!frame)return;stop();display.value=[...target()];progress.value=1}
  return {display:display as Ref<number[]>,progress,finish}
}
