<script setup lang="ts">
import { onMounted,onUnmounted,ref,watch } from 'vue'
import { Image,LoaderCircle } from '@lucide/vue'
import type { Attachment } from '../types'
import { api } from '../services/tauri'
const props=defineProps<{attachment:Attachment}>()
const root=ref<HTMLElement>(),source=ref(''),loading=ref(false),error=ref(false)
let observer:IntersectionObserver|undefined,version=0
async function load(){
 if(loading.value || source.value || !api.isTauri)return
 const current=++version,id=props.attachment.id,mime=props.attachment.mime;loading.value=true
 try{const data=await api.getAttachmentData(id);if(current===version){if(data)source.value=`data:${mime};base64,${data}`;else error.value=true}}catch{if(current===version)error.value=true}finally{if(current===version)loading.value=false}
}
function prepare(){version++;observer?.disconnect();loading.value=false;error.value=false;source.value=props.attachment.data?`data:${props.attachment.mime};base64,${props.attachment.data}`:'';if(source.value)return;if(root.value && typeof IntersectionObserver!=='undefined'){observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer?.disconnect();void load()}},{rootMargin:'160px'});observer.observe(root.value)}else void load()}
watch(()=>[props.attachment.id,props.attachment.data],prepare,{flush:'post'});onMounted(prepare);onUnmounted(()=>{version++;observer?.disconnect()})
</script>
<template><span ref="root" class="attachment-thumbnail" :title="error?'缩略图未加载，点击附件可重新查看':attachment.name"><img v-if="source && !error" :src="source" :alt="attachment.name" @error="error=true"/><LoaderCircle v-else-if="loading" :size="21" class="spin"/><Image v-else :size="23"/></span></template>
<style scoped>.attachment-thumbnail{display:grid;place-items:center;flex:none;width:36px;height:36px;color:var(--accent)}.attachment-thumbnail img{width:36px;height:36px;object-fit:cover;border-radius:6px}</style>
