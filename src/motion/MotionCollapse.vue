<script setup lang="ts">
import {animate,cancelMotion,setEntering,setLeaving} from './runtime'
function clear(element:Element){const el=element as HTMLElement;el.style.removeProperty('height');el.style.removeProperty('overflow')}
function enter(element:Element,done:()=>void){const el=element as HTMLElement;setEntering(el);el.style.overflow='clip';const height=el.scrollHeight;animate(el,[{height:'0px',opacity:0},{height:`${height}px`,opacity:1}],'slow',()=>{clear(el);done()})}
function leave(element:Element,done:()=>void){const el=element as HTMLElement;setLeaving(el);const height=el.getBoundingClientRect().height;el.style.overflow='clip';animate(el,[{height:`${height}px`,opacity:1},{height:'0px',opacity:0}],'slow',()=>{clear(el);done()})}
function cancel(element:Element){cancelMotion(element);clear(element)}
</script>
<template><Transition :css="false" @enter="enter" @leave="leave" @enter-cancelled="cancel" @leave-cancelled="cancel"><slot/></Transition></template>
