<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import type { Usage } from '../types'
import '../usage.css'

type Preset = 'today' | '7d' | '30d' | 'month' | 'custom'
type Bucket = { label: string; input: number; output: number; thinking: number; cost: number; count: number }
type Group = { id: string; label: string; input: number; output: number; thinking: number; cost: number; count: number }
const chat = useChatStore()
const preset = ref<Preset>('7d')
const model = ref('__all__'), profile = ref('__all__'), conversation = ref('__all__')
const metric = ref<'tokens' | 'cost'>('tokens')
const today = new Date()
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const customFrom = ref(localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)))
const customTo = ref(localDate(today))
const page = ref(1), pageSize = 15
const selected = ref<Usage | null>(null)
const loadError = ref('')
const hoverIndex = ref<number | null>(null)
const dragStart = ref<number | null>(null), dragEnd = ref<number | null>(null)
const zoomStart = ref(0), zoomEnd = ref<number | null>(null)
const chart = ref<SVGSVGElement | null>(null)
const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value)
const money = (value: number) => `$${value.toFixed(value < 0.01 && value > 0 ? 6 : 4)}`
const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
const profileName = (row: Usage) => row.profileName || chat.profiles.find(p => p.id === row.profileId)?.name || (row.profileId || '默认连接')
const conversationName = (id: string) => chat.conversations.find(c => c.id === id)?.title || `已删除会话 · ${id.slice(0, 8)}`

const period = computed(() => {
  const now = new Date(), day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (preset.value === 'today') return { start: day, end: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) }
  if (preset.value === '7d') return { start: new Date(day.getFullYear(), day.getMonth(), day.getDate() - 6), end: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) }
  if (preset.value === '30d') return { start: new Date(day.getFullYear(), day.getMonth(), day.getDate() - 29), end: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) }
  if (preset.value === 'month') return { start: new Date(day.getFullYear(), day.getMonth(), 1), end: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) }
  const start = new Date(`${customFrom.value}T00:00:00`), last = new Date(`${customTo.value}T00:00:00`)
  return { start, end: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) }
})
const invalidRange = computed(() => Number.isNaN(period.value.start.getTime()) || Number.isNaN(period.value.end.getTime()) || period.value.start >= period.value.end)
const models = computed(() => [...new Set(chat.usage.map(row => row.model))].sort())
const profiles = computed(() => [...new Set(chat.usage.map(row => row.profileId))].map(id => ({ id, name: profileName(chat.usage.find(row => row.profileId === id)!) })).sort((a, b) => a.name.localeCompare(b.name)))
const conversations = computed(() => [...new Set(chat.usage.map(row => row.conversationId))].map(id => ({ id, name: conversationName(id) })).sort((a, b) => a.name.localeCompare(b.name)))
const filtered = computed(() => invalidRange.value ? [] : chat.usage.filter(row => {
  const date = new Date(row.createdAt)
  return date >= period.value.start && date < period.value.end && (model.value === '__all__' || row.model === model.value) && (profile.value === '__all__' || row.profileId === profile.value) && (conversation.value === '__all__' || row.conversationId === conversation.value)
}))
const stats = computed(() => filtered.value.reduce((sum, row) => ({ input: sum.input + row.inputTokens, output: sum.output + row.outputTokens, thinking: sum.thinking + row.thinkingTokens, cost: sum.cost + row.estimatedCost, duration: sum.duration + row.durationMs, count: sum.count + 1 }), { input: 0, output: 0, thinking: 0, cost: 0, duration: 0, count: 0 }))
const cards = computed(() => [
  { label: '总 Token', value: number(stats.value.input + stats.value.output), detail: '输入 + 输出' },
  { label: '输入 Token', value: number(stats.value.input), detail: 'Prompt / 上下文' },
  { label: '输出 Token', value: number(stats.value.output), detail: '回答' },
  { label: 'Thinking Token', value: number(stats.value.thinking), detail: '部分 Provider 为估算' },
  { label: '总费用', value: money(stats.value.cost), detail: '按请求时单价估算' },
  { label: '请求次数', value: number(stats.value.count), detail: '已完成请求' },
  { label: '平均响应时间', value: `${stats.value.count ? (stats.value.duration / stats.value.count / 1000).toFixed(1) : '0.0'}s`, detail: '从请求到完成' },
])

const buckets = computed<Bucket[]>(() => {
  if (invalidRange.value) return []
  const days = Math.max(1, Math.ceil((period.value.end.getTime() - period.value.start.getTime()) / 86400000))
  const hourly = days <= 2
  const step = hourly ? 1 : Math.max(1, Math.ceil(days / 90))
  const values: Bucket[] = []
  const start = new Date(period.value.start)
  for (let cursor = new Date(start); cursor < period.value.end && values.length < 100; hourly ? cursor.setHours(cursor.getHours() + step) : cursor.setDate(cursor.getDate() + step)) {
    values.push({ label: hourly ? `${localDate(cursor)} ${String(cursor.getHours()).padStart(2, '0')}:00` : localDate(cursor), input: 0, output: 0, thinking: 0, cost: 0, count: 0 })
  }
  for (const row of filtered.value) {
    const time = new Date(row.createdAt)
    const index = hourly ? Math.floor((time.getTime() - start.getTime()) / 3600000 / step) : Math.floor((Date.UTC(time.getFullYear(), time.getMonth(), time.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000 / step)
    const bucket = values[index]
    if (!bucket) continue
    bucket.input += row.inputTokens; bucket.output += row.outputTokens; bucket.thinking += row.thinkingTokens; bucket.cost += row.estimatedCost; bucket.count++
  }
  return values
})
const visible = computed(() => buckets.value.slice(zoomStart.value, zoomEnd.value ?? buckets.value.length))
const maxTokens = computed(() => Math.max(1, ...visible.value.map(b => b.input + b.output)))
const maxCost = computed(() => Math.max(0.000001, ...visible.value.map(b => b.cost)))
const plotX = (index: number) => 52 + (visible.value.length <= 1 ? 326 : index * 652 / (visible.value.length - 1))
const plotY = (value: number, max: number) => 210 - value / max * 174
const points = (kind: 'tokens' | 'cost') => visible.value.map((b, i) => `${plotX(i)},${plotY(kind === 'tokens' ? b.input + b.output : b.cost, kind === 'tokens' ? maxTokens.value : maxCost.value)}`).join(' ')
const xTicks = computed(() => [...new Set([0, .25, .5, .75, 1].map(f => Math.round((visible.value.length - 1) * f)))].map(i => ({ x: plotX(i), label: visible.value[i]?.label.slice(preset.value === 'today' ? 11 : 5) || '' })))
const hovered = computed(() => hoverIndex.value === null ? null : visible.value[hoverIndex.value])
const pointerIndex = (event: PointerEvent) => { const rect = chart.value?.getBoundingClientRect(); if (!rect || !visible.value.length) return 0; const x = (event.clientX - rect.left) / rect.width * 760; return Math.max(0, Math.min(visible.value.length - 1, Math.round((x - 52) / 652 * (visible.value.length - 1)))) }
const move = (event: PointerEvent) => { const index = pointerIndex(event); hoverIndex.value = index; if (dragStart.value !== null) dragEnd.value = index }
const down = (event: PointerEvent) => { dragStart.value = pointerIndex(event); dragEnd.value = dragStart.value; chart.value?.setPointerCapture(event.pointerId) }
const up = (event: PointerEvent) => { if (dragStart.value === null) return; const end = pointerIndex(event), low = Math.min(dragStart.value, end), high = Math.max(dragStart.value, end); if (high - low >= 1) { const offset = zoomStart.value; zoomStart.value = offset + low; zoomEnd.value = offset + high + 1 } dragStart.value = null; dragEnd.value = null }
const resetZoom = () => { zoomStart.value = 0; zoomEnd.value = null }
watch([preset, customFrom, customTo, model, profile, conversation], () => { resetZoom(); hoverIndex.value = null; page.value = 1 })

const groupBy = (kind: 'model' | 'profile') => computed<Group[]>(() => {
  const map = new Map<string, Group>()
  for (const row of filtered.value) {
    const id = kind === 'model' ? row.model : row.profileId
    const item = map.get(id) || { id, label: kind === 'model' ? row.model : profileName(row), input: 0, output: 0, thinking: 0, cost: 0, count: 0 }
    item.input += row.inputTokens; item.output += row.outputTokens; item.thinking += row.thinkingTokens; item.cost += row.estimatedCost; item.count++
    map.set(id, item)
  }
  return [...map.values()].sort((a, b) => metric.value === 'cost' ? b.cost - a.cost : b.input + b.output - a.input - a.output)
})
const modelGroups = groupBy('model'), profileGroups = groupBy('profile')
const barWidth = (item: Group, items: Group[]) => { const value = metric.value === 'cost' ? item.cost : item.input + item.output; const max = Math.max(1e-9, ...items.map(x => metric.value === 'cost' ? x.cost : x.input + x.output)); return `${value / max * 100}%` }
const selectBar = (kind: 'model' | 'profile', id: string) => { if (kind === 'model') model.value = id; else profile.value = id }
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const rows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
onMounted(async () => { try { await chat.refreshUsage() } catch (error) { loadError.value = `读取用量记录失败：${String(error)}` } })
</script>

<template>
  <section class="usage-dashboard" aria-label="用量统计 Dashboard">
    <div class="usage-scroll">
      <header class="usage-heading"><div><div class="usage-eyebrow">ANALYTICS / USAGE</div><h1>用量统计</h1><p>追踪 Token、API 成本和使用趋势。数据保存在本机。</p></div><div class="usage-live"><span class="usage-live-dot" />实时更新</div></header>
      <div class="usage-filters"><div class="usage-presets"><button v-for="item in ([['today','今日'],['7d','7天'],['30d','30天'],['month','本月'],['custom','自定义']] as const)" :key="item[0]" type="button" :class="{ active: preset === item[0] }" @click="preset = item[0]">{{ item[1] }}</button></div><div v-if="preset === 'custom'" class="usage-dates"><label>从 <input v-model="customFrom" type="date" /></label><span>—</span><label>至 <input v-model="customTo" type="date" /></label></div><div class="usage-selects"><label>模型<select v-model="model"><option value="__all__">全部模型</option><option v-for="name in models" :key="name" :value="name">{{ name }}</option></select></label><label>API Profile<select v-model="profile"><option value="__all__">全部 Profile</option><option v-for="item in profiles" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><label>会话<select v-model="conversation"><option value="__all__">全部会话</option><option v-for="item in conversations" :key="item.id" :value="item.id">{{ item.name }}</option></select></label></div></div>
      <p v-if="invalidRange" class="usage-warning">请选择有效的开始和结束日期。</p><p v-if="loadError" class="usage-warning">{{ loadError }}</p>
      <div class="usage-cards"><article v-for="card in cards" :key="card.label" class="usage-card"><span>{{ card.label }}</span><strong>{{ card.value }}</strong><small>{{ card.detail }}</small></article></div>
      <div class="usage-chart-card"><div class="usage-card-heading"><div><h2>消耗趋势</h2><p>双轴展示总 Token 与费用；拖拽图表区域可缩放时间。</p></div><button v-if="zoomStart || zoomEnd !== null" class="usage-ghost" @click="resetZoom">重置缩放</button></div><template v-if="filtered.length"><div class="usage-legend"><span class="usage-legend-token">● 总 Token</span><span class="usage-legend-cost">● 费用 USD</span></div><div class="usage-trend"><svg ref="chart" viewBox="0 0 760 260" preserveAspectRatio="none" role="img" aria-label="Token 和费用时间趋势" @pointerdown="down" @pointermove="move" @pointerup="up" @pointerleave="hoverIndex = null"><g v-for="tick in [0,1,2,3,4]" :key="tick"><line x1="52" :y1="210 - tick * 43.5" x2="704" :y2="210 - tick * 43.5" class="usage-gridline"/><text x="44" :y="214 - tick * 43.5" text-anchor="end" class="usage-axis">{{ number(Math.round(maxTokens * tick / 4)) }}</text><text x="712" :y="214 - tick * 43.5" class="usage-axis">{{ money(maxCost * tick / 4) }}</text></g><polyline v-if="visible.length" :points="points('tokens')" class="usage-line usage-line-token"/><polyline v-if="visible.length" :points="points('cost')" class="usage-line usage-line-cost"/><g v-for="tick in xTicks" :key="tick.x"><text :x="tick.x" y="239" text-anchor="middle" class="usage-axis">{{ tick.label }}</text></g><g v-if="hovered && hoverIndex !== null"><line :x1="plotX(hoverIndex)" y1="36" :x2="plotX(hoverIndex)" y2="210" class="usage-crosshair"/><circle :cx="plotX(hoverIndex)" :cy="plotY(hovered.input + hovered.output, maxTokens)" r="5" class="usage-point-token"/><circle :cx="plotX(hoverIndex)" :cy="plotY(hovered.cost, maxCost)" r="5" class="usage-point-cost"/></g><rect v-if="dragStart !== null && dragEnd !== null" :x="Math.min(plotX(dragStart), plotX(dragEnd))" y="36" :width="Math.abs(plotX(dragStart) - plotX(dragEnd))" height="174" class="usage-brush"/></svg><div v-if="hovered && hoverIndex !== null" class="usage-tooltip" :style="{ left: `${Math.min(78, Math.max(8, plotX(hoverIndex) / 760 * 100))}%` }"><strong>{{ hovered.label }}</strong><span>总 Token {{ number(hovered.input + hovered.output) }}</span><span>输入 {{ number(hovered.input) }} · 输出 {{ number(hovered.output) }}</span><span>Thinking {{ number(hovered.thinking) }}</span><span>费用 {{ money(hovered.cost) }} · {{ hovered.count }} 次</span></div></div></template><p v-else class="usage-empty">当前筛选范围没有请求记录。</p></div>
      <div class="usage-comparison-heading"><div><h2>消耗对比</h2><p>点击柱形可进一步筛选。</p></div><div class="usage-presets usage-metric"><button :class="{ active: metric === 'tokens' }" @click="metric = 'tokens'">Token</button><button :class="{ active: metric === 'cost' }" @click="metric = 'cost'">费用</button></div></div>
      <div class="usage-comparisons"><article v-for="entry in ([{ title: '按模型', kind: 'model' as const, items: modelGroups }, { title: '按 API Profile', kind: 'profile' as const, items: profileGroups }])" :key="entry.kind" class="usage-chart-card usage-bar-card"><h3>{{ entry.title }}</h3><div v-if="!entry.items.length" class="usage-empty">暂无数据</div><button v-for="item in entry.items" :key="item.id" class="usage-bar-row" :title="`${item.label}｜输入 ${number(item.input)}，输出 ${number(item.output)}，Thinking ${number(item.thinking)}，费用 ${money(item.cost)}，请求 ${item.count} 次`" @click="selectBar(entry.kind,item.id)"><span class="usage-bar-label">{{ item.label }}</span><span class="usage-bar-track"><span class="usage-bar-total" :style="{ width: barWidth(item, entry.items) }"><span v-if="metric === 'tokens'" class="usage-bar-input" :style="{ width: `${item.input + item.output ? item.input / (item.input + item.output) * 100 : 0}%` }"/><span v-if="metric === 'tokens'" class="usage-bar-output" :style="{ width: `${item.input + item.output ? item.output / (item.input + item.output) * 100 : 0}%` }"/><span v-if="metric === 'cost'" class="usage-bar-cost"/></span></span><strong>{{ metric === 'cost' ? money(item.cost) : number(item.input + item.output) }}</strong></button></article></div>
      <div class="usage-chart-card usage-records"><div class="usage-card-heading"><div><h2>请求明细</h2><p>按完成时间排序；点击记录查看完整指标。</p></div><span>{{ number(filtered.length) }} 条</span></div><div class="usage-table-wrap"><table><thead><tr><th>时间</th><th>模型</th><th>API Profile</th><th>会话</th><th>输入</th><th>输出</th><th>Thinking</th><th>耗时</th><th>费用</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id" tabindex="0" @click="selected = row" @keydown.enter="selected = row"><td>{{ dateTime(row.createdAt) }}</td><td :title="row.model">{{ row.model }}</td><td>{{ profileName(row) }}</td><td :title="conversationName(row.conversationId)">{{ conversationName(row.conversationId) }}</td><td>{{ number(row.inputTokens) }}</td><td>{{ number(row.outputTokens) }}</td><td>{{ number(row.thinkingTokens) }}</td><td>{{ (row.durationMs / 1000).toFixed(1) }}s</td><td>{{ money(row.estimatedCost) }}</td></tr><tr v-if="!rows.length"><td colspan="9" class="usage-empty">没有符合筛选条件的请求</td></tr></tbody></table></div><div class="usage-pagination"><span>第 {{ page }} / {{ pages }} 页</span><button :disabled="page <= 1" @click="page--">上一页</button><button :disabled="page >= pages" @click="page++">下一页</button></div></div>
      <p class="usage-footnote">费用依据请求发生时配置的每百万 Token 单价估算；Thinking Token 在部分 Provider 中属于输出 Token 的一部分，不重复计入总 Token。最终费用以服务商账单为准。</p>
    </div>
    <div v-if="selected" class="modal-backdrop" @click.self="selected = null"><section class="usage-detail" role="dialog" aria-modal="true" aria-label="请求详情"><header><div><small>REQUEST DETAIL</small><h2>单次请求</h2></div><button aria-label="关闭" @click="selected = null">×</button></header><dl><dt>完成时间</dt><dd>{{ dateTime(selected.createdAt) }}</dd><dt>模型</dt><dd>{{ selected.model }}</dd><dt>API Profile</dt><dd>{{ profileName(selected) }}</dd><dt>会话</dt><dd>{{ conversationName(selected.conversationId) }}</dd><dt>输入 Token</dt><dd>{{ number(selected.inputTokens) }}</dd><dt>输出 Token</dt><dd>{{ number(selected.outputTokens) }}</dd><dt>Thinking Token</dt><dd>{{ number(selected.thinkingTokens) }}</dd><dt>请求耗时</dt><dd>{{ (selected.durationMs / 1000).toFixed(2) }} 秒</dd><dt>估算费用</dt><dd>{{ money(selected.estimatedCost) }}</dd><dt>记录 ID</dt><dd class="usage-id">{{ selected.id }}</dd></dl><button class="usage-detail-close" @click="selected = null">关闭</button></section></div>
  </section>
</template>
