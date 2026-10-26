<script setup lang="ts">
import {computed} from 'vue'
import {duration,reducedMotion,setEntering,setLeaving,type MotionSpeed} from './runtime'
const props=withDefaults(defineProps<{name?:string;speed?:MotionSpeed;appear?:boolean;teleport?:boolean}>(),{name:'motion-fade',speed:'normal',appear:false,teleport:false})
const timing=computed(()=>{void reducedMotion.value;return duration(props.speed)})
</script>
<template>
 <Teleport v-if="teleport" to="body"><Transition :name="name" :duration="timing" :appear="appear" @before-enter="setEntering" @before-leave="setLeaving" @leave-cancelled="setEntering"><slot/></Transition></Teleport>
 <Transition v-else :name="name" :duration="timing" :appear="appear" @before-enter="setEntering" @before-leave="setLeaving" @leave-cancelled="setEntering"><slot/></Transition>
</template>
