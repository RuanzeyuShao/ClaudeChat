<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChevronsLeft, ChevronsRight } from '@lucide/vue'
import type { Message } from '../types'
import { readableCitations } from '../utils/citations'
const props=defineProps<{scroller?:HTMLElement;messages:Message[];active:boolean}>()
const emit=defineEmits<{navigate:[];visibility:[visible:boolean]}>()
const rail=ref<HTMLElement>(),canvas=ref<HTMLCanvasElement>(),preview=ref<HTMLElement>()
const visible=ref(false),collapsed=ref(localStorage.getItem('claudechat.minimapCollapsed')==='true')
const height=ref(120),top=ref(36),current=ref(0),hovered=ref(-1),dragging=ref(false)
const markerTop=ref(4),card=ref({left:0,top:0,width:220,maxHeight:112})
const previewReady=ref(false)
const padding=4
// Only IDs and roles affect marker data. Streaming text updates the hovered summary alone.
const entries=computed(()=>props.messages.map(message=>({id:message.id,role:message.role})))
const summary=computed(()=>{const message=props.messages[hovered.value];return message?readableCitations(message.content.slice(0,800),message.sources).replace(/```[\s\S]*?```/g,'[代码]').replace(/[#*`>\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,180) || '正在生成…':''})
const role=computed(()=>props.messages[hovered.value]?.role==='user'?'用户':'AI')
const progress=computed(()=>Math.round(hovered.value/Math.max(1,entries.value.length-1)*100))
let offsets:number[]=[],frame=0,timer:ReturnType<typeof setTimeout>|undefined,observer:ResizeObserver|undefined,bound:HTMLElement|undefined,startY=0,pressed=-1,moved=false,disposed=false
function markerY(index:number){return padding+index/Math.max(1,entries.value.length-1)*(height.value-padding*2)}
function markerWidth(index:number){return index===current.value?14:entries.value[index]?.role==='user'?6:10}
function draw(){
 const element=canvas.value;if(!element || !visible.value || collapsed.value)return
 const scale=window.devicePixelRatio || 1;element.width=18*scale;element.height=height.value*scale
 const ctx=element.getContext('2d');if(!ctx)return;ctx.scale(scale,scale)
 ctx.fillStyle=getComputedStyle(element).getPropertyValue('--muted').trim();ctx.globalAlpha=.4
 entries.value.forEach((entry,index)=>ctx.fillRect(2,markerY(index),entry.role==='user'?6:10,1))
}
function clearPreview(){hovered.value=-1;previewReady.value=false}
function read(){
 const scroller=props.scroller;if(!scroller || !offsets.length)return
 const reading=scroller.scrollTop+24;let low=0,high=offsets.length
 while(low<high){const mid=(low+high)>>>1;if(offsets[mid]<=reading)low=mid+1;else high=mid}
 current.value=Math.max(0,low-1);markerTop.value=markerY(current.value)
}
function scheduleRead(){clearPreview();if(!frame)frame=requestAnimationFrame(()=>{frame=0;read()})}
function measure(){
 const scroller=props.scroller;if(!scroller || disposed)return
 visible.value=props.active && scroller.clientHeight>72 && entries.value.length>=2 && scroller.scrollHeight>Math.max(scroller.clientHeight*1.6,scroller.clientHeight+500)
 // Message ordinal, rather than paragraph height, keeps the rail compact even with giant answers.
 const nextHeight=Math.min(220,Math.max(18,(entries.value.length-1)*11+padding*2),Math.max(18,scroller.clientHeight-64))
 const nextTop=scroller.offsetTop+Math.max(28,(scroller.clientHeight-nextHeight)/2)
 if(height.value!==nextHeight || top.value!==nextTop)clearPreview()
 height.value=nextHeight;top.value=nextTop
 const rect=scroller.getBoundingClientRect(),elements=new Map(Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]')).map(node=>[node.dataset.messageId,node]))
 offsets=entries.value.map(entry=>{const node=elements.get(entry.id);return node?node.getBoundingClientRect().top-rect.top+scroller.scrollTop:0})
 void nextTick(()=>{read();draw();positionPreview()})
}
function scheduleMeasure(){if(!timer)timer=setTimeout(()=>{timer=undefined;measure()},80)}
function bind(){bound?.removeEventListener('scroll',scheduleRead);observer?.disconnect();bound=props.scroller;if(!bound)return;bound.addEventListener('scroll',scheduleRead,{passive:true});observer=new ResizeObserver(scheduleMeasure);observer.observe(bound);const flow=bound.querySelector('.message-flow');if(flow)observer.observe(flow);measure()}
function toggle(){collapsed.value=!collapsed.value;localStorage.setItem('claudechat.minimapCollapsed',String(collapsed.value));clearPreview();void nextTick(draw)}
function pointer(event:PointerEvent){const box=rail.value!.getBoundingClientRect();return {x:event.clientX-box.left,y:event.clientY-box.top}}
function indexAt(y:number){return Math.max(0,Math.min(entries.value.length-1,Math.round((y-padding)/Math.max(1,height.value-padding*2)*(entries.value.length-1))))}
function hit(event:PointerEvent){
 const {x,y}=pointer(event),index=indexAt(y),pitch=(height.value-padding*2)/Math.max(1,entries.value.length-1)
 return Math.abs(y-markerY(index))<=Math.min(3,pitch*.3) && x>=0 && x<=2+Math.max(markerWidth(index),hovered.value===index?16:0)+2?index:-1
}
function positionPreview(){
 if(hovered.value<0 || !rail.value || !props.scroller || !preview.value)return
 const target=hovered.value
 const railBox=rail.value.getBoundingClientRect(),bounds=props.scroller.getBoundingClientRect()
 const minLeft=Math.max(8,bounds.left+8),maxRight=Math.min(window.innerWidth-8,bounds.right-8)
 const leftSpace=railBox.left-minLeft-10
 const width=leftSpace>=144?Math.min(280,leftSpace):Math.min(260,Math.max(200,bounds.width*.38),maxRight-minLeft-28)
 const left=leftSpace>=144?railBox.left-10-width:Math.max(minLeft,Math.min(railBox.right+10,maxRight-width))
 const minTop=Math.max(8,bounds.top+8),maxBottom=Math.min(window.innerHeight-8,bounds.bottom-8),maxHeight=Math.max(40,Math.min(112,maxBottom-minTop))
 card.value={left,top:previewReady.value?card.value.top:minTop,width,maxHeight}
 void nextTick(()=>{if(hovered.value!==target || !preview.value)return;const actualHeight=preview.value.getBoundingClientRect().height;card.value={left,width,maxHeight,top:Math.max(minTop,Math.min(railBox.top+markerY(target)-actualHeight/2,maxBottom-actualHeight))};previewReady.value=true})
}
function jump(index:number){const scroller=props.scroller;if(!scroller || index<0)return;clearPreview();emit('navigate');scroller.scrollTo({top:Math.max(0,offsets[index]-16),behavior:'instant'});read()}
function hover(event:PointerEvent){
 if(dragging.value){moved ||= Math.abs(event.clientY-startY)>3;if(moved){clearPreview();jump(indexAt(pointer(event).y))}return}
 const index=hit(event);if(index===hovered.value)return;previewReady.value=false;hovered.value=index;if(index>=0)void nextTick(positionPreview)
}
function down(event:PointerEvent){if(event.button!==0)return;pressed=hit(event);dragging.value=true;startY=event.clientY;moved=false;clearPreview();rail.value?.setPointerCapture(event.pointerId)}
function up(event:PointerEvent){if(!dragging.value)return;dragging.value=false;if(!moved && pressed>=0)jump(pressed);if(rail.value?.hasPointerCapture(event.pointerId))rail.value.releasePointerCapture(event.pointerId);pressed=-1;clearPreview()}
function cancel(){dragging.value=false;pressed=-1;clearPreview()}
function wheel(event:WheelEvent){clearPreview();emit('navigate');props.scroller?.scrollBy({top:event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?props.scroller.clientHeight:1),behavior:'instant'})}
function keys(event:KeyboardEvent){let target=current.value;if(event.key==='ArrowUp')target--;else if(event.key==='ArrowDown')target++;else if(event.key==='Home')target=0;else if(event.key==='End')target=entries.value.length-1;else if(event.key==='PageUp'||event.key==='PageDown'){event.preventDefault();clearPreview();emit('navigate');props.scroller?.scrollBy({top:(event.key==='PageUp'?-1:1)*(props.scroller?.clientHeight || 0)*.8,behavior:'instant'});return}else return;event.preventDefault();jump(Math.max(0,Math.min(entries.value.length-1,target)))}
watch(()=>props.scroller,()=>nextTick(bind));watch(entries,()=>{clearPreview();void nextTick(scheduleMeasure)});watch(()=>props.active,()=>{clearPreview();scheduleMeasure()})
watch(visible,value=>{if(!value)clearPreview();emit('visibility',value)});onMounted(bind)
const themeObserver=new MutationObserver(()=>draw())
onMounted(()=>themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style']}))
onUnmounted(()=>{disposed=true;bound?.removeEventListener('scroll',scheduleRead);observer?.disconnect();themeObserver.disconnect();clearTimeout(timer);cancelAnimationFrame(frame)})
</script>
<template>
 <nav v-if="visible" class="conversation-minimap" :class="{collapsed}" :style="{top:`${top}px`}" aria-label="历史对话导航" @pointerleave="clearPreview">
  <button class="minimap-toggle" :aria-label="collapsed?'展开历史导航':'折叠历史导航'" :aria-expanded="!collapsed" @click="toggle"><component :is="collapsed?ChevronsRight:ChevronsLeft" :size="12"/></button>
  <div v-if="!collapsed" ref="rail" class="minimap-rail" :class="{'is-hovering':hovered>=0,'is-dragging':dragging}" :style="{height:`${height}px`}" role="slider" tabindex="0" aria-label="定位对话消息" aria-orientation="vertical" :aria-valuemin="1" :aria-valuemax="entries.length" :aria-valuenow="current+1" :aria-valuetext="`第 ${current+1} 条，共 ${entries.length} 条消息`" @pointerdown.prevent="down" @pointermove="hover" @pointerup="up" @pointercancel="cancel" @pointerleave="clearPreview" @keydown="keys" @wheel.passive="wheel">
   <canvas ref="canvas" :style="{width:'18px',height:`${height}px`}" aria-hidden="true"/>
   <span class="minimap-current" :style="{top:`${markerTop}px`}" aria-hidden="true"/>
   <span v-if="hovered>=0" class="minimap-hover" :style="{top:`${markerY(hovered)}px`}" aria-hidden="true"/>
  </div>
 </nav>
 <Teleport to="body"><section v-if="visible && !collapsed && hovered>=0 && !dragging" ref="preview" class="minimap-preview" role="tooltip" :style="{left:`${card.left}px`,top:`${card.top}px`,width:`${card.width}px`,maxHeight:`${card.maxHeight}px`,visibility:previewReady?'visible':'hidden'}"><header><strong>{{ role }}</strong><span>{{ hovered+1 }} / {{ entries.length }} · {{ progress }}%</span></header><p>{{ summary }}</p></section></Teleport>
</template>
<style scoped>
.conversation-minimap{position:absolute;left:max(6px,calc((100% - 800px)/2 - 24px));width:18px;z-index:3;background:transparent;border:0;box-shadow:none}.minimap-toggle{display:flex;align-items:center;justify-content:center;width:18px;height:18px;margin-top:-22px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--muted);opacity:0;transition:opacity var(--motion-fast)}.conversation-minimap:hover .minimap-toggle,.conversation-minimap:focus-within .minimap-toggle,.conversation-minimap.collapsed .minimap-toggle{opacity:.6}.minimap-toggle:hover{color:var(--text);opacity:1!important}.minimap-rail{position:relative;width:18px;background:transparent;border:0;box-shadow:none;touch-action:none;cursor:default;outline-offset:2px}.minimap-rail.is-hovering{cursor:pointer}.minimap-rail.is-dragging{cursor:ns-resize}.minimap-rail:focus-visible{outline:1px solid var(--accent);border-radius:3px}canvas{display:block;pointer-events:none}.minimap-current,.minimap-hover{position:absolute;left:2px;height:2px;background:var(--text);border-radius:1px;pointer-events:none}.minimap-current{width:14px;opacity:.8}.minimap-hover{width:16px;opacity:1}.minimap-preview{position:fixed;z-index:30;padding:10px 12px;border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow-sm);color:var(--text);background:var(--panel);pointer-events:none;overflow:hidden;font-size:calc(12px * var(--font-scale,1));line-height:1.5}.minimap-preview header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:3px 8px;margin-bottom:5px;font-size:.85em}.minimap-preview strong{font-weight:500}.minimap-preview header span{color:var(--muted);white-space:nowrap;font-size:.9em}.minimap-preview p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;margin:0}
</style>
