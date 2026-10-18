<script setup lang="ts">
import { CheckCircle2, AlertCircle, Info, X } from '@lucide/vue'
import { ref, watch } from 'vue'
import { useUiStore } from '../stores/ui'
import BaseModal from './BaseModal.vue'
const ui = useUiStore(), value = ref('')
watch(() => ui.dialog, dialog => { value.value = dialog?.value || '' })
</script>
<template>
  <Teleport to="body"><div class="toast-stack" aria-live="polite"><TransitionGroup name="toast"><div v-for="toast in ui.toasts" :key="toast.id" class="toast" :class="toast.kind" :role="toast.kind==='error'?'alert':'status'"><component :is="toast.kind==='error'?AlertCircle:toast.kind==='info'?Info:CheckCircle2" :size="18"/><span>{{ toast.message }}</span><button v-if="toast.details" @click="ui.errorDetail=toast.details">查看详情</button><button v-if="toast.action" @click="toast.action();ui.dismiss(toast.id)">{{ toast.actionLabel }}</button><button class="icon-button" aria-label="关闭通知" @click="ui.dismiss(toast.id)"><X :size="15"/></button></div></TransitionGroup></div></Teleport>
  <BaseModal v-if="ui.errorDetail" title="错误详情" wide @close="ui.errorDetail=''"><pre class="error-detail">{{ ui.errorDetail }}</pre><template #footer><button class="secondary" @click="ui.copyError">复制原始错误</button><button class="primary" @click="ui.errorDetail=''">关闭</button></template></BaseModal>
  <BaseModal v-if="ui.dialog" :title="ui.dialog.title" @close="ui.settle(null)"><form id="shared-dialog" @submit.prevent="ui.settle(value)"><p v-if="ui.dialog.description" class="hint">{{ ui.dialog.description }}</p><template v-if="ui.dialog.value !== undefined"><textarea v-if="ui.dialog.multiline" v-model="value" :readonly="ui.dialog.readonly" rows="8" :aria-label="ui.dialog.title" autofocus/><input v-else v-model="value" :aria-label="ui.dialog.title" autofocus/></template></form><template #footer><button class="secondary" @click="ui.settle(null)">取消</button><button type="submit" form="shared-dialog" :class="ui.dialog.danger?'danger-button':'primary'">{{ ui.dialog.confirm }}</button></template></BaseModal>
</template>
