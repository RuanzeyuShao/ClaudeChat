<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { api } from '../services/tauri'
import { useChatStore } from '../stores/chat'
import type { ApiProfile, Settings, ModelPrice } from '../types'
const emit = defineEmits<{ close: [] }>()
const chat = useChatStore()
const form = reactive<Settings>({ ...chat.settings })
const testing = ref(false), testResult = ref(''), error = ref('')
const blank = (): ApiProfile => ({ id: crypto.randomUUID(), name: '', baseUrl: 'https://api.anthropic.com', provider: 'anthropic-compatible', model: 'claude-sonnet-5', thinking: 'medium', inputPrice: 0, outputPrice: 0, hasKey: false })
const editing = reactive<ApiProfile>(blank())
const profileKey = ref('')
const modelPrices = ref<ModelPrice[]>([])
const priceModel = ref(''), priceInput = ref(0), priceOutput = ref(0)
onMounted(async () => { if (api.isTauri) modelPrices.value=await api.getModelPrices() })
const savePrice = async () => { error.value=''; try { await api.saveModelPrice({ profileId: editing.id, model: priceModel.value.trim(), inputPrice: priceInput.value, outputPrice: priceOutput.value }); modelPrices.value=await api.getModelPrices() } catch(e){error.value=String(e)} }
const selected = ref('')
const choose = (id: string) => { selected.value = id; Object.assign(editing, chat.profiles.find(p => p.id === id) || blank()); profileKey.value = '' }
const saveProfile = async () => { error.value = ''; try { await api.saveProfile({ ...editing }, profileKey.value); await chat.refreshProfiles(); await chat.switchProfile(editing.id); selected.value = editing.id; profileKey.value = '' } catch (e) { error.value = String(e) } }
const removeProfile = async () => { if (!selected.value || !confirm(`删除 ${editing.name}？`)) return; await api.deleteProfile(selected.value); await chat.refreshProfiles(); if (chat.settings.profileId === selected.value) await chat.saveSettings({ ...chat.settings, profileId: '', apiKey: '' }); choose('') }
const save = async () => { error.value = ''; try { await chat.saveSettings({ ...chat.settings, theme: form.theme, systemPrompt: form.systemPrompt, searchProvider: form.searchProvider, searchBaseUrl: form.searchBaseUrl, apiKey: '' }); emit('close') } catch (e) { error.value = String(e) } }
const test = async () => { testing.value = true; testResult.value = ''; try { testResult.value = (await api.testConnection({ ...chat.settings, profileId: editing.id, baseUrl: editing.baseUrl, provider: editing.provider, model: editing.model, thinking: editing.thinking, apiKey: profileKey.value })).message } catch (e) { testResult.value = String(e) } finally { testing.value = false } }
const total = computed(() => chat.usage.reduce((v, u) => v + u.estimatedCost, 0))
</script>
<template><div class="modal-backdrop" @click.self="emit('close')"><section class="settings-modal"><header><div><h2>工作区设置</h2><p>Profile、价格、用量和外观保存在本机。</p></div><button @click="emit('close')">×</button></header>
  <label>API Profile<select :value="selected" @change="choose(($event.target as HTMLSelectElement).value)"><option value="">新建 Profile</option><option v-for="p in chat.profiles" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
  <div class="setting-grid"><label>名称<input v-model.trim="editing.name" placeholder="工作 / 个人" /></label><label>Provider<select v-model="editing.provider"><option value="anthropic-compatible">Anthropic Compatible</option><option value="openai-compatible">OpenAI Compatible</option></select></label></div>
  <label>Base URL<input v-model.trim="editing.baseUrl" /></label><label>API Key<input v-model="profileKey" type="password" :placeholder="editing.hasKey ? '已安全保存；留空保持不变' : '输入 API Key'" autocomplete="off" /></label><p class="hint">API Key 保存在系统凭据管理器中。</p>
  <div class="setting-grid"><label>默认模型<input v-model.trim="editing.model" /></label><label>思考强度<select v-model="editing.thinking"><option value="off">Off</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label>输入价格（每百万 Token）<input v-model.number="editing.inputPrice" type="number" min="0" step="0.01" /></label><label>输出价格（每百万 Token）<input v-model.number="editing.outputPrice" type="number" min="0" step="0.01" /></label></div>
  <div class="test-row"><button class="primary" @click="saveProfile">保存并使用 Profile</button><button class="secondary" :disabled="testing" @click="test">{{ testing ? '测试中…' : '测试当前连接' }}</button><button v-if="selected" class="secondary" @click="removeProfile">删除</button><span>{{ testResult }}</span></div>
  <div v-if="selected"><strong>模型价格覆盖</strong><p class="hint">默认单价用于未单独定价的模型。单位为每百万 Token。</p><div class="setting-grid"><label>模型 ID<input v-model.trim="priceModel" placeholder="模型 ID" /></label><label>输入单价<input v-model.number="priceInput" type="number" min="0" step="0.01" /></label><label>输出单价<input v-model.number="priceOutput" type="number" min="0" step="0.01" /></label></div><button class="secondary" @click="savePrice">保存模型单价</button><p v-for="p in modelPrices.filter(x=>x.profileId===editing.id)" :key="p.model" class="hint">{{ p.model }} · 输入 ${{ p.inputPrice }} / 输出 ${{ p.outputPrice }}</p></div>
  <label>搜索 Provider<select v-model="form.searchProvider"><option value="claude">Claude 官方搜索</option><option value="searxng">SearXNG 实例</option></select></label><label v-if="form.searchProvider === 'searxng'">SearXNG Base URL<input v-model.trim="form.searchBaseUrl" placeholder="https://search.example.com" /></label>
  <label>主题<select v-model="form.theme"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label>全局 System Prompt<textarea v-model="form.systemPrompt" rows="3" /></label>
  <p class="hint">历史请求估算费用：${{ total.toFixed(4) }}。单价按请求时 Profile 设置计算。</p><p v-if="error" class="failure">{{ error }}</p><footer><button class="secondary" @click="emit('close')">取消</button><button class="primary" @click="save">保存外观与 Prompt</button></footer></section></div></template>
