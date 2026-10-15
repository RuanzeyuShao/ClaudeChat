<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChevronsLeft, ChevronsRight } from '@lucide/vue'
import type { Message } from '../types'
const props=defineProps<{scroller?:HTMLElement;messages:Message[];active:boolean}>()
const emit=defineEmits<{navigate:[];visibility:[visible:boolean]}>()
const rail=ref<HTMLElement>(),canvas=ref<HTMLCanvasElement>(),visible=ref(false),collapsed=ref(localStorage.getItem('claudechat.minimapCollapsed')==='true')
const height=ref(180),top=ref(36),current=ref(0),hovered=ref(-1),pointerY=ref(0),viewport=ref({top:0,height:100})
const markerTop=ref(0),markerWidth=ref(15)
// Content is deliberately absent from this computation: streamed text does not rebuild marker data.
const entries=computed(()=>props.messages.map(message=>({id:message.id,role:message.role})))
const summary=computed(()=>{const message=props.messages[hovered.value];return message?`${message.role==='user'?'你':'助手'}：${message.content.slice(0,600).replace(/```[\s\S]*?```/g,'[代码]').replace(/[#*`>\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,180) || '正在生成…'}`:''})
let offsets:number[]=[],total=1,frame=0,timer:ReturnType<typeof setTimeout>|undefined,observer:ResizeObserver|undefined,bound:HTMLElement|undefined,dragging=false,startY=0,moved=false,disposed=false
function closest(value:number){let low=0,high=offsets.length;while(low<high){const mid=(low+high)>>>1;if(offsets[mid]<value)low=mid+1;else high=mid}return low===0?0:low===offsets.length?low-1:value-offsets[low-1]<=offsets[low]-value?low-1:low}
function draw(){
 const element=canvas.value;if(!element || !visible.value || collapsed.value)return
 const scale=window.devicePixelRatio || 1;element.width=20*scale;element.height=height.value*scale
 const ctx=element.getContext('2d');if(!ctx)return;ctx.scale(scale,scale)
 const muted=getComputedStyle(element).getPropertyValue('--muted').trim()
 // One canvas, even for thousands of messages; no per-message DOM or scroll listeners.
 ctx.fillStyle=muted;ctx.globalAlpha=.45
 offsets.forEach((offset,index)=>{const width=entries.value[index]?.role==='user'?9:15;ctx.fillRect(2,Math.min(height.value-2,offset/total*height.value),width,1.5)})
}
function read(){
 const scroller=props.scroller;if(!scroller || !offsets.length)return
 const reading=scroller.scrollTop+24;let low=0,high=offsets.length;while(low<high){const mid=(low+high)>>>1;if(offsets[mid]<=reading)low=mid+1;else high=mid}
 current.value=Math.max(0,low-1);viewport.value={top:scroller.scrollTop/total*100,height:Math.min(100,scroller.clientHeight/total*100)};markerTop.value=(offsets[current.value] || 0)/total*100;markerWidth.value=entries.value[current.value]?.role==='user'?9:15
}
function scheduleRead(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;read()})}
function measure(){
 const scroller=props.scroller;if(!scroller || disposed)return
 total=Math.max(1,scroller.scrollHeight);const next=props.active && entries.value.length>=2 && total>Math.max(scroller.clientHeight*1.6,scroller.clientHeight+500)
 visible.value=next;height.value=Math.max(60,Math.min(240,scroller.clientHeight-80));top.value=scroller.offsetTop+Math.max(28,(scroller.clientHeight-height.value)/2)
 const rect=scroller.getBoundingClientRect(),elements=new Map(Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]')).map(node=>[node.dataset.messageId,node]))
 offsets=entries.value.map(entry=>{const node=elements.get(entry.id);return node?node.getBoundingClientRect().top-rect.top+scroller.scrollTop:0})
 void nextTick(()=>{read();draw()})
}
function scheduleMeasure(){if(!timer)timer=setTimeout(()=>{timer=undefined;measure()},80)}
function bind(){bound?.removeEventListener('scroll',scheduleRead);observer?.disconnect();bound=props.scroller;if(!bound)return;bound.addEventListener('scroll',scheduleRead,{passive:true});observer=new ResizeObserver(scheduleMeasure);observer.observe(bound);const flow=bound.querySelector('.message-flow');if(flow)observer.observe(flow);measure()}
function toggle(){collapsed.value=!collapsed.value;localStorage.setItem('claudechat.minimapCollapsed',String(collapsed.value));hovered.value=-1;void nextTick(draw)}
function fraction(event:PointerEvent){const box=rail.value!.getBoundingClientRect();pointerY.value=Math.max(0,Math.min(height.value,event.clientY-box.top));return pointerY.value/box.height}
function jump(index:number){const scroller=props.scroller;if(!scroller || index<0)return;emit('navigate');scroller.scrollTo({top:Math.max(0,offsets[index]-16),behavior:'instant'});read()}
function hover(event:PointerEvent){const ratio=fraction(event);hovered.value=closest(ratio*total);if(dragging){moved ||= Math.abs(event.clientY-startY)>3;if(moved){emit('navigate');props.scroller?.scrollTo({top:Math.max(0,ratio*total-(props.scroller?.clientHeight || 0)/2),behavior:'instant'});read()}}}
function down(event:PointerEvent){if(event.button!==0)return;dragging=true;startY=event.clientY;moved=false;rail.value?.setPointerCapture(event.pointerId);hover(event)}
function up(event:PointerEvent){if(!dragging)return;dragging=false;if(!moved)jump(closest(fraction(event)*total));rail.value?.releasePointerCapture(event.pointerId)}
function keys(event:KeyboardEvent){let target=current.value;if(event.key==='ArrowUp')target--;else if(event.key==='ArrowDown')target++;else if(event.key==='Home')target=0;else if(event.key==='End')target=entries.value.length-1;else if(event.key==='PageUp'||event.key==='PageDown'){event.preventDefault();emit('navigate');props.scroller?.scrollBy({top:(event.key==='PageUp'?-1:1)*(props.scroller?.clientHeight || 0)*.8,behavior:'instant'});return}else return;event.preventDefault();jump(Math.max(0,Math.min(entries.value.length-1,target)))}
watch(()=>props.scroller,()=>nextTick(bind));watch(entries,()=>{hovered.value=-1;void nextTick(scheduleMeasure)});watch(()=>props.active,scheduleMeasure)
watch(visible,value=>emit('visibility',value));onMounted(bind)
const themeObserver=new MutationObserver(()=>draw())
onMounted(()=>themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style']}))
onUnmounted(()=>{disposed=true;bound?.removeEventListener('scroll',scheduleRead);observer?.disconnect();themeObserver.disconnect();clearTimeout(timer);cancelAnimationFrame(frame)})
</script>
<template>
 <nav v-if="visible" class="conversation-minimap" :class="{collapsed}" :style="{top:`${top}px`}" aria-label="历史对话导航">
  <button class="minimap-toggle" :aria-label="collapsed?'展开历史导航':'折叠历史导航'" :aria-expanded="!collapsed" @click="toggle"><component :is="collapsed?ChevronsRight:ChevronsLeft" :size="13"/></button>
  <div v-if="!collapsed" ref="rail" class="minimap-rail" :style="{height:`${height}px`}" role="slider" tabindex="0" aria-label="定位对话消息" aria-orientation="vertical" :aria-valuemin="1" :aria-valuemax="entries.length" :aria-valuenow="current+1" :aria-valuetext="`第 ${current+1} 条，共 ${entries.length} 条消息`" @pointerdown.prevent="down" @pointermove="hover" @pointerup="up" @pointercancel="dragging=false" @pointerleave="!dragging && (hovered=-1)" @keydown="keys">
   <span class="minimap-viewport" :style="{top:`${viewport.top}%`,height:`${viewport.height}%`}"/><canvas ref="canvas" :style="{width:'20px',height:`${height}px`}" aria-hidden="true"/><span class="minimap-current" :style="{top:`${markerTop}%`,width:`${markerWidth}px`}" aria-hidden="true"/>
   <span v-if="hovered>=0" class="minimap-tooltip" role="tooltip" :style="{top:`${Math.min(pointerY,Math.max(0,height-70))}px`}">{{ summary }}</span>
  </div>
 </nav>
</template>
<style scoped>
.conversation-minimap{position:absolute;left:3px;width:22px;z-index:3;opacity:.65;transition:opacity var(--motion-fast)}.conversation-minimap:hover,.conversation-minimap:focus-within{opacity:1}.minimap-toggle{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:5px;background:var(--bg);color:var(--muted);margin-top:-24px}.minimap-toggle:hover{background:var(--soft);color:var(--text)}.minimap-rail{position:relative;width:22px;touch-action:none;cursor:ns-resize;border-radius:5px;outline-offset:2px}.minimap-rail:focus-visible{outline:2px solid var(--accent)}canvas{position:relative;display:block;pointer-events:none}.minimap-viewport{position:absolute;left:0;width:20px;min-height:4px;background:var(--accent-soft);border-left:2px solid var(--accent);border-radius:3px;pointer-events:none}.minimap-tooltip{position:absolute;left:28px;display:block;width:220px;max-width:calc(100vw - 130px);padding:9px 11px;border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow-sm);color:var(--text);background:var(--panel);font-size:12px;line-height:1.6;overflow-wrap:anywhere;pointer-events:none}
</style>
