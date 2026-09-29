<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { modelOptions } from '../models'
import { useChatStore } from '../stores/chat'

const chat = useChatStore()
const text = ref('')
const textarea = ref<HTMLTextAreaElement>()
const modelDraft = ref(chat.settings.model)
const modelOpen = ref(false)
const thinking = computed(() => Math.max(0, ['off', 'low', 'medium', 'high'].indexOf(chat.settings.thinking)))
const labels = ['Off', 'Low', 'Medium', 'High']
watch(() => chat.settings.model, value => { modelDraft.value = value })
const resize = () => { if (!textarea.value) return; textarea.value.style.height = 'auto'; textarea.value.style.height = `${Math.min(textarea.value.scrollHeight, 180)}px` }
const submit = () => { const value = text.value.trim(); if (!value || chat.loading) return; chat.send(value); text.value = ''; nextTick(() => { resize(); textarea.value?.focus() }) }
const keydown = (event: KeyboardEvent) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }
const chooseModel = async (model: string) => { modelDraft.value = model; modelOpen.value = false; await chat.setModel(model) }
const saveCustomModel = () => { if (modelDraft.value.trim()) chooseModel(modelDraft.value.trim()) }
const persistWebSearch = () => chat.saveSettings({ ...chat.settings, apiKey: '' })
</script>

<template>
  <div class="input-wrap">
    <div class="input-box">
      <textarea ref="textarea" v-model="text" rows="1" placeholder="给 Claude 发送消息…" @input="resize" @keydown="keydown" />
      <div class="input-footer">
        <div class="input-options">
          <label class="search-toggle"><input v-model="chat.settings.webSearch" type="checkbox" @change="persistWebSearch" /> 网络搜索</label>
          <label class="thinking-slider"><span>思考 {{ labels[thinking] }}</span><input type="range" min="0" max="3" :value="thinking" @change="chat.setThinking(Number(($event.target as HTMLInputElement).value))" /></label>
        </div>
        <div class="input-actions">
          <div class="model-selector">
            <button class="model-trigger" type="button" :aria-expanded="modelOpen" @click="modelOpen = !modelOpen">{{ modelOptions.find(item => item.id === chat.settings.model)?.label || chat.settings.model }} <span>⌄</span></button>
            <div v-if="modelOpen" class="model-menu">
              <p>选择模型</p>
              <button v-for="item in modelOptions" :key="item.id" type="button" :class="{ selected: chat.settings.model === item.id }" @click="chooseModel(item.id)"><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></button>
              <div class="custom-model"><input v-model="modelDraft" aria-label="自定义模型 ID" placeholder="自定义模型 ID" @keydown.enter.prevent="saveCustomModel" /><button type="button" @click="saveCustomModel">使用</button></div>
            </div>
          </div>
          <button v-if="chat.loading" class="stop" @click="chat.stop">■ 停止</button><button v-else class="send" :disabled="!text.trim()" @click="submit">↑</button>
        </div>
      </div>
    </div>
    <p>Claude 可能会出错，请核查重要信息。</p>
  </div>
</template>
