<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
const props=defineProps<{title:string;folder?:string}>()
const viewport=ref<HTMLElement>(), text=ref<HTMLElement>(), distance=ref(0)
let observer:ResizeObserver|undefined
function measure(){distance.value=Math.max(0,(text.value?.scrollWidth || 0)-(viewport.value?.clientWidth || 0))}
const style=computed(()=>({'--title-distance':`${-distance.value}px`,'--title-duration':`${Math.max(3,distance.value/35+2)}s`}))
watch(()=>[props.title,props.folder],async()=>{await nextTick();measure()})
onMounted(()=>{observer=new ResizeObserver(measure);if(viewport.value)observer.observe(viewport.value);measure()})
onUnmounted(()=>observer?.disconnect())
</script>
<template>
 <span ref="viewport" class="conversation-title" :class="{'title-overflow':distance>0}" :style="style"><span ref="text" class="conversation-title-text">{{ title }}<small v-if="folder">{{ folder }}</small></span></span>
</template>
