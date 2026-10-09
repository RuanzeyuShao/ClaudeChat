export function usageOriginLabel(origin?: {input:string;output:string;thinking:string}) {
  if(!origin)return '历史记录 · 来源未标记'
  return origin.input==='provider' && origin.output==='provider'?'Provider 实际 Usage':origin.input==='provider' || origin.output==='provider'?'Provider 部分 Usage':'Provider 未返回 Usage'
}
export function thinkingOriginLabel(origin?: {thinking:string}) {
  return origin?.thinking==='provider'?'Provider 返回':origin?.thinking==='estimated'?'客户端估算':'未标记 / 未返回'
}
