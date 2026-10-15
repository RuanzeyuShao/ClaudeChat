<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChevronsLeft, ChevronsRight } from '@lucide/vue'
import type { Message } from '../types'
import { readableCitations } from '../utils/citations'
const props=defineProps<{scroller?:HTMLElement;messages:Message[];active:boolean}>()
const emit=defineEmits<{navigate:[];visibility:[visible:boolean]}>()
const rail=ref<HTMLElement>(),preview=ref<HTMLElement>(),previewText=ref<HTMLElement>()
const visible=ref(false),collapsed=ref(localStorage.getItem('claudechat.minimapCollapsed')==='true')
const height=ref(120),top=ref(36),current=ref(0),hovered=ref(-1),dragging=ref(false),windowStart=ref(0),windowSize=ref(12)
const card=ref({left:0,top:0,width:240,maxHeight:180}),previewReady=ref(false),truncated=ref(false)
const pitch=10 // Every visual line is 2px high, followed by exactly 8px of space.
const entries=computed(()=>props.messages.map(message=>({id:message.id,role:message.role})))
const rows=computed(()=>entries.value.slice(windowStart.value,windowStart.value+windowSize.value).map((entry,slot)=>({...entry,index:windowStart.value+slot,slot})))
const userPreview=computed(()=>props.messages[hovered.value]?.role==='user')
const summary=computed(()=>{
 const message=props.messages[hovered.value];if(!message)return ''
 if(message.role==='user')return message.content.trim().slice(0,1000) || (message.attachments || []).map(file=>file.name).join('、') || '空消息'
 return readableCitations(message.content.slice(0,1200),message.sources).replace(/```[\s\S]*?```/g,'[代码]').replace(/[#*`>\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,240) || '正在生成…'
})
const role=computed(()=>userPreview.value?'用户':'AI')
const progress=computed(()=>Math.round(hovered.value/Math.max(1,entries.value.length-1)*100))
let offsets:number[]=[],frame=0,timer:ReturnType<typeof setTimeout>|undefined,seekTimer:ReturnType<typeof setTimeout>|undefined,observer:ResizeObserver|undefined,bound:HTMLElement|undefined,startY=0,pressed=-1,moved=false,disposed=false,seekId:string|null=null,lastWidth=0
function markerY(index:number){return (index-windowStart.value)*pitch+5}
function hideCard(){previewReady.value=false;truncated.value=false}
function clearHover(){hovered.value=-1;hideCard()}
function syncWindow(){
 const max=Math.max(0,entries.value.length-windowSize.value)
 let start=Math.min(windowStart.value,max)
 if(current.value<start || current.value>=start+windowSize.value)start=Math.max(0,Math.min(max,current.value-Math.floor(windowSize.value/2)))
 if(start!==windowStart.value){clearHover();windowStart.value=start}
}
function read(){
 const scroller=props.scroller;if(!scroller || !offsets.length)return
 const reading=scroller.scrollTop+24;let low=0,high=offsets.length
 while(low<high){const mid=(low+high)>>>1;if(offsets[mid]<=reading)low=mid+1;else high=mid}
 current.value=Math.max(0,low-1);syncWindow()
}
function finishSeek(){seekId=null;clearTimeout(seekTimer)}
function cancelSeek(){if(!seekId)return;finishSeek();bound?.scrollTo({top:bound.scrollTop,behavior:'instant'})}
function scheduleRead(){
 if(seekId){clearTimeout(seekTimer);seekTimer=setTimeout(finishSeek,180)}
 if(!frame)frame=requestAnimationFrame(()=>{frame=0;read()})
}
function measure(){
 const scroller=props.scroller;if(!scroller || disposed)return
 visible.value=props.active && scroller.clientHeight>72 && entries.value.length>=2 && scroller.scrollHeight>Math.max(scroller.clientHeight*1.6,scroller.clientHeight+500)
 windowSize.value=Math.max(1,Math.min(entries.value.length,24,Math.max(2,Math.floor((scroller.clientHeight-64)/pitch))))
 const nextHeight=windowSize.value*pitch,nextTop=scroller.offsetTop+Math.max(24,(scroller.clientHeight-nextHeight)/2)
 if(height.value!==nextHeight || top.value!==nextTop || lastWidth!==scroller.clientWidth)clearHover()
 height.value=nextHeight;top.value=nextTop;lastWidth=scroller.clientWidth
 const rect=scroller.getBoundingClientRect(),elements=new Map(Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]')).map(node=>[node.dataset.messageId,node]))
 offsets=entries.value.map(entry=>{const node=elements.get(entry.id);return node?node.getBoundingClientRect().top-rect.top+scroller.scrollTop:0})
 read()
 if(seekId && !entries.value.some(entry=>entry.id===seekId))cancelSeek()
 void nextTick(positionPreview)
}
function scheduleMeasure(){if(!timer)timer=setTimeout(()=>{timer=undefined;measure()},80)}
function unbind(){bound?.removeEventListener('scroll',scheduleRead);bound?.removeEventListener('scrollend',finishSeek);bound?.removeEventListener('wheel',cancelSeek);bound?.removeEventListener('pointerdown',cancelSeek);observer?.disconnect()}
function bind(){unbind();bound=props.scroller;if(!bound)return;bound.addEventListener('scroll',scheduleRead,{passive:true});bound.addEventListener('scrollend',finishSeek);bound.addEventListener('wheel',cancelSeek,{passive:true});bound.addEventListener('pointerdown',cancelSeek);observer=new ResizeObserver(scheduleMeasure);observer.observe(bound);const flow=bound.querySelector('.message-flow');if(flow)observer.observe(flow);measure()}
function toggle(){collapsed.value=!collapsed.value;localStorage.setItem('claudechat.minimapCollapsed',String(collapsed.value));clearHover()}
function pointer(event:PointerEvent){const box=rail.value!.getBoundingClientRect();return {x:event.clientX-box.left,y:event.clientY-box.top}}
function hit(event:PointerEvent){
 const {x,y}=pointer(event),slot=Math.floor(y/pitch)
 return x>=0 && x<=26 && slot>=0 && slot<windowSize.value && Math.abs(y-(slot*pitch+5))<4?windowStart.value+slot:-1
}
function setHover(index:number){if(index===hovered.value)return;hideCard();hovered.value=index;if(index>=0)void nextTick(positionPreview)}
function positionPreview(){
 if(hovered.value<0 || !rail.value || !props.scroller || !preview.value)return
 const target=hovered.value,railBox=rail.value.getBoundingClientRect(),bounds=props.scroller.getBoundingClientRect()
 const left=railBox.left+32,maxRight=Math.min(window.innerWidth-10,bounds.right-8)
 const width=Math.max(1,Math.min(320,Math.max(210,bounds.width*.34),maxRight-left))
 const minTop=Math.max(8,bounds.top+8),maxBottom=Math.min(window.innerHeight-8,bounds.bottom-8),maxHeight=Math.max(40,Math.min(userPreview.value?220:144,maxBottom-minTop))
 card.value={left,top:previewReady.value?card.value.top:minTop,width,maxHeight}
 void nextTick(()=>{
  if(hovered.value!==target || !preview.value || !previewText.value)return
  truncated.value=userPreview.value && ((props.messages[target]?.content.trim().length || 0)>1000 || previewText.value.scrollHeight>previewText.value.clientHeight+1)
  void nextTick(()=>{if(hovered.value!==target || !preview.value)return;const actual=preview.value.getBoundingClientRect().height;card.value={left,width,maxHeight,top:Math.max(minTop,Math.min(railBox.top+markerY(target)-actual/2,maxBottom-actual))};previewReady.value=true})
 })
}
function jump(index:number,smooth=true){
 const scroller=props.scroller;if(!scroller || index<0 || !offsets.length)return
 cancelSeek();emit('navigate');seekId=entries.value[index]?.id || null
 const behavior=smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant'
 scroller.scrollTo({top:Math.max(0,offsets[index]-16),behavior});read()
 clearTimeout(seekTimer);seekTimer=setTimeout(finishSeek,350)
}
function dragIndex(y:number){return Math.max(0,Math.min(entries.value.length-1,Math.round(y/height.value*(entries.value.length-1))))}
function hover(event:PointerEvent){
 if(dragging.value){moved ||= Math.abs(event.clientY-startY)>3;if(moved){clearHover();jump(dragIndex(pointer(event).y),false)}return}
 setHover(hit(event))
}
function down(event:PointerEvent){if(event.button!==0)return;cancelSeek();pressed=hit(event);dragging.value=true;startY=event.clientY;moved=false;hideCard();rail.value?.setPointerCapture(event.pointerId)}
function up(event:PointerEvent){
 if(!dragging.value)return;dragging.value=false
 if(!moved && pressed>=0)jump(pressed)
 if(rail.value?.hasPointerCapture(event.pointerId))rail.value.releasePointerCapture(event.pointerId)
 pressed=-1
 if(moved)clearHover();else {const index=hit(event);hovered.value=index;if(index>=0)void nextTick(positionPreview)}
}
function cancel(){dragging.value=false;pressed=-1;clearHover();cancelSeek()}
function wheel(event:WheelEvent){cancelSeek();emit('navigate');props.scroller?.scrollBy({top:event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?props.scroller.clientHeight:1),behavior:'instant'})}
function keys(event:KeyboardEvent){let target=current.value;if(event.key==='ArrowUp')target--;else if(event.key==='ArrowDown')target++;else if(event.key==='Home')target=0;else if(event.key==='End')target=entries.value.length-1;else if(event.key==='PageUp'||event.key==='PageDown'){event.preventDefault();cancelSeek();clearHover();emit('navigate');props.scroller?.scrollBy({top:(event.key==='PageUp'?-1:1)*(props.scroller?.clientHeight || 0)*.8,behavior:'instant'});return}else return;event.preventDefault();clearHover();jump(Math.max(0,Math.min(entries.value.length-1,target)))}
watch(()=>props.scroller,()=>nextTick(bind));watch(entries,()=>{cancelSeek();clearHover();void nextTick(scheduleMeasure)});watch(()=>props.active,()=>{cancelSeek();clearHover();scheduleMeasure()})
watch(visible,value=>{if(!value)clearHover();emit('visibility',value)});onMounted(bind)
onUnmounted(()=>{disposed=true;cancelSeek();unbind();clearTimeout(timer);clearTimeout(seekTimer);cancelAnimationFrame(frame)})
</script>
<template>
 <nav v-if="visible" class="conversation-minimap" :class="{collapsed}" :style="{top:`${top}px`}" aria-label="历史对话导航" @pointerleave="clearHover">
  <button class="minimap-toggle" :aria-label="collapsed?'展开历史导航':'折叠历史导航'" :aria-expanded="!collapsed" @click="toggle"><component :is="collapsed?ChevronsRight:ChevronsLeft" :size="12"/></button>
  <div v-if="!collapsed" ref="rail" class="minimap-rail" :class="{'is-hovering':hovered>=0,'is-dragging':dragging}" :style="{height:`${height}px`}" role="slider" tabindex="0" aria-label="定位对话消息" aria-orientation="vertical" :aria-valuemin="1" :aria-valuemax="entries.length" :aria-valuenow="current+1" :aria-valuetext="`第 ${current+1} 条，共 ${entries.length} 条消息`" @pointerdown.prevent="down" @pointermove="hover" @pointerup="up" @pointercancel="cancel" @pointerleave="clearHover" @keydown="keys" @wheel.passive="wheel">
   <span v-for="row in rows" :key="row.id" class="minimap-row" :class="{'is-current':row.index===current,'is-hovered':row.index===hovered}" :data-message-index="row.index" :data-message-id="row.id" :style="{top:`${row.slot*pitch}px`}" aria-hidden="true"><span class="minimap-line"/></span>
  </div>
 </nav>
 <Teleport to="body"><section v-if="visible && !collapsed && hovered>=0 && !dragging" ref="preview" class="minimap-preview" :class="{'is-user':userPreview}" role="tooltip" :style="{left:`${card.left}px`,top:`${card.top}px`,width:`${card.width}px`,maxHeight:`${card.maxHeight}px`,visibility:previewReady?'visible':'hidden'}"><header><strong>{{ role }}</strong><span>{{ hovered+1 }} / {{ entries.length }} · {{ progress }}%</span></header><p ref="previewText">{{ summary }}</p><small v-if="truncated" class="minimap-full-hint">点击该横线查看完整问题</small></section></Teleport>
</template>
<style scoped>
.conversation-minimap{position:absolute;left:6px;width:26px;z-index:3;background:transparent;border:0;box-shadow:none}.minimap-toggle{display:flex;align-items:center;justify-content:center;width:20px;height:18px;margin-top:-22px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--muted);opacity:0;transition:opacity var(--motion-fast)}.conversation-minimap:hover .minimap-toggle,.minimap-toggle:focus-visible,.conversation-minimap.collapsed .minimap-toggle{opacity:.6}.minimap-toggle:hover{color:var(--text);opacity:1}.minimap-rail{position:relative;width:26px;background:transparent;border:0;box-shadow:none;touch-action:none;cursor:default;outline:none}.minimap-rail.is-hovering{cursor:pointer}.minimap-rail.is-dragging{cursor:ns-resize}.minimap-rail:focus-visible{outline:none}.minimap-row{position:absolute;left:0;display:block;width:26px;height:10px;pointer-events:none}.minimap-line{position:absolute;left:2px;top:4px;display:block;width:6px;height:2px;border-radius:1px;background:var(--muted);opacity:.45;transition:width 150ms ease}.minimap-row.is-current .minimap-line{background:var(--accent-ink);opacity:.9}.minimap-row.is-hovered .minimap-line{width:18px;background:var(--text);opacity:1}.minimap-rail:focus-visible .is-current .minimap-line{background:var(--accent);opacity:1}.minimap-preview{position:fixed;z-index:30;display:flex;flex-direction:column;padding:10px 12px;border:1px solid var(--tooltip-line);border-radius:10px;box-shadow:var(--shadow-sm);color:var(--tooltip-text);background:var(--tooltip-bg);pointer-events:none;overflow:hidden;font-size:calc(12px * var(--font-scale,1));line-height:1.5}.minimap-preview header{display:flex;justify-content:space-between;align-items:center;flex:none;flex-wrap:wrap;gap:3px 8px;margin-bottom:5px;font-size:.85em}.minimap-preview strong{font-weight:500}.minimap-preview header span{color:var(--tooltip-muted);white-space:nowrap;font-size:.9em}.minimap-preview p{display:-webkit-box;flex:0 1 auto;min-height:0;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;white-space:pre-wrap;margin:0}.minimap-preview.is-user p{-webkit-line-clamp:8}.minimap-full-hint{flex:none;display:block;margin-top:6px;font-size:.9em;color:var(--tooltip-muted)}:global(html[data-theme=dark]) .minimap-preview{color:var(--text);background:var(--panel);border-color:var(--line)}
</style>
