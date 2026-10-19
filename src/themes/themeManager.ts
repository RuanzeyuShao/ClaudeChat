import type { ThemeMode } from '../types'
import { getThemePreset,normalizeColorTheme,type ColorThemeId } from './themePresets'
export interface Appearance {theme:ThemeMode;colorTheme:ColorThemeId}
const cacheKey='claudechat.appearance'
export function normalizeAppearance(value?:{theme?:unknown;colorTheme?:unknown}|null):Appearance {
 return {theme:['light','dark','system'].includes(value?.theme as string)?value!.theme as ThemeMode:'system',colorTheme:normalizeColorTheme(value?.colorTheme)}
}
let current:Appearance=normalizeAppearance(),media:MediaQueryList|undefined
const systemChanged=()=>{if(current.theme==='system')themeManager.apply(current)}
export const themeManager={
 cached():Appearance{try{return normalizeAppearance(JSON.parse(localStorage.getItem(cacheKey) || 'null'))}catch{return normalizeAppearance()}},
 cache(value:Appearance){try{localStorage.setItem(cacheKey,JSON.stringify(value))}catch{/* SQLite remains authoritative if the optional startup cache is full. */}},
 apply(value:{theme?:unknown;colorTheme?:unknown}){
  current=normalizeAppearance(value)
  const dark=current.theme==='dark' || (current.theme==='system' && (media || window.matchMedia('(prefers-color-scheme: dark)')).matches),resolved=dark?'dark':'light'
  const root=document.documentElement;root.dataset.theme=resolved;root.dataset.colorTheme=current.colorTheme;root.dataset.appearanceMode=current.theme;root.style.colorScheme=resolved
  for(const [key,color] of Object.entries(getThemePreset(current.colorTheme)[resolved]))root.style.setProperty(`--${key}`,color)
 },
 start(){if(media)return;media=window.matchMedia('(prefers-color-scheme: dark)');media.addEventListener('change',systemChanged);this.apply(current)},
 stop(){media?.removeEventListener('change',systemChanged);media=undefined}
}
