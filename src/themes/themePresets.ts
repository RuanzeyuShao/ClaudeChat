export const colorThemeIds=['emerald','ocean','violet','coral','sakura','forest','amber','graphite'] as const
export type ColorThemeId=typeof colorThemeIds[number]
export type ColorTokens=Record<string,string>
export interface ThemePreset {id:ColorThemeId;name:string;accent:string;soft:string;light:ColorTokens;dark:ColorTokens}
export const defaultColorTheme:ColorThemeId='emerald'
const rgb=(hex:string)=>[0,2,4].map(start=>parseInt(hex.slice(start+1,start+3),16))
export function mixColor(base:string,tint:string,amount:number){const a=rgb(base),b=rgb(tint);return '#'+a.map((value,index)=>Math.round(value+(b[index]-value)*amount).toString(16).padStart(2,'0')).join('')}
export function contrastRatio(first:string,second:string){
 const luminance=(hex:string)=>rgb(hex).map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0)
 const a=luminance(first),b=luminance(second);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)
}
function ink(color:string,surfaces:string[],towards:string){for(let step=0;step<=25;step++){const value=mixColor(color,towards,step/25);if(surfaces.every(surface=>contrastRatio(value,surface)>=4.5))return value}return towards}
function onAccent(accent:string){const dark='#14201b';if(contrastRatio(accent,dark)>=4.5)return dark;return contrastRatio(accent,'#ffffff')>=4.5?'#ffffff':'#000000'}
interface DarkPalette {accent:string;bg:string;panel:string;sidebar:string;soft:string;bubble:string;code:string;line:string;strong:string;text:string;muted:string;secondary:string}
function preset(id:ColorThemeId,name:string,accent:string,soft:string,secondary:string,dark:DarkPalette):ThemePreset {
 const classic=id==='emerald',bg=classic?'#faf9f6':mixColor('#ffffff',soft,.25),panel=classic?'#ffffff':mixColor('#ffffff',soft,.04)
 const light:ColorTokens={bg,panel,sidebar:classic?'#f0f0eb':mixColor('#ffffff',soft,.65),text:'#2b3331',muted:'#626e67',line:mixColor('#ffffff',accent,.17),'line-strong':mixColor('#ffffff',accent,.32),soft,accent,'accent-soft':soft,'accent-ink':ink(accent,[bg,panel,soft],'#16221c'),'on-accent':onAccent(accent),'user-bubble':soft,'code-bg':mixColor(soft,'#ffffff',.35),'chart-secondary':ink(secondary,[bg,panel],'#19242c'),'tooltip-bg':dark.panel,'tooltip-text':dark.text,'tooltip-muted':dark.muted,'tooltip-line':dark.line}
 const night:ColorTokens={bg:dark.bg,panel:dark.panel,sidebar:dark.sidebar,text:dark.text,muted:dark.muted,line:dark.line,'line-strong':dark.strong,soft:dark.soft,accent:dark.accent,'accent-soft':dark.soft,'accent-ink':ink(dark.accent,[dark.bg,dark.panel,dark.soft],'#ffffff'),'on-accent':onAccent(dark.accent),'user-bubble':dark.bubble,'code-bg':dark.code,'chart-secondary':ink(dark.secondary,[dark.bg,dark.panel],'#ffffff'),'tooltip-bg':dark.panel,'tooltip-text':dark.text,'tooltip-muted':dark.muted,'tooltip-line':dark.line}
 return {id,name,accent,soft,light,dark:night}
}
// Dark surfaces are independently tuned. They are not inverted light colors.
export const themePresets:ThemePreset[]=[
 preset('emerald','经典翡翠','#277B69','#EAF2ED','#497fa6',{accent:'#86BBA5',bg:'#1e2221',panel:'#272c2a',sidebar:'#242927',soft:'#303b33',bubble:'#303e35',code:'#232925',line:'#37433c',strong:'#53675b',text:'#e3e8e1',muted:'#abb9b0',secondary:'#9bc4e5'}),
 preset('ocean','海洋蓝','#3869C5','#E9F0FD','#7d65ad',{accent:'#92B7FF',bg:'#1c2330',panel:'#263142',sidebar:'#212b3a',soft:'#263a57',bubble:'#2b405f',code:'#1e2938',line:'#3a4b63',strong:'#536d8e',text:'#e5edfa',muted:'#aab9cf',secondary:'#c3a6ee'}),
 preset('violet','紫罗兰','#7959B5','#F0EBFC','#317f8d',{accent:'#BFA3EA',bg:'#24202d',panel:'#30283c',sidebar:'#2b2436',soft:'#3b2e52',bubble:'#433259',code:'#282132',line:'#4c3f5d',strong:'#6d5a82',text:'#f0e9f9',muted:'#beb1cd',secondary:'#86c6ce'}),
 preset('coral','珊瑚橙','#BD7046','#FCEEE6','#497ea6',{accent:'#E9A680',bg:'#2b221e',panel:'#372b25',sidebar:'#302620',soft:'#4b3429',bubble:'#513a2e',code:'#2f251f',line:'#594338',strong:'#7c5d4b',text:'#f7eae0',muted:'#cbb5a6',secondary:'#9cc8e9'}),
 preset('sakura','樱花粉','#B95F82','#FBEAF1','#5c7c9c',{accent:'#E5A1BD',bg:'#2c2127',panel:'#382a32',sidebar:'#31252c',soft:'#492d3a',bubble:'#503140',code:'#30242b',line:'#59414e',strong:'#7a5668',text:'#f8e7ef',muted:'#ccafbd',secondary:'#9bbfe6'}),
 preset('forest','森林绿','#4E7950','#EAF3E8','#8a7448',{accent:'#A2C99A',bg:'#21281f',panel:'#2b3428',sidebar:'#252e23',soft:'#30422d',bubble:'#374c31',code:'#242d21',line:'#43523d',strong:'#607756',text:'#eaf2e5',muted:'#b3c2ac',secondary:'#d0bb88'}),
 preset('amber','琥珀金','#96701E','#FBF2D9','#557da1',{accent:'#DDBE73',bg:'#28251c',panel:'#343023',sidebar:'#2e291f',soft:'#473b24',bubble:'#4e4228',code:'#2c281c',line:'#554b34',strong:'#776949',text:'#f6efdc',muted:'#c8bda3',secondary:'#9ebfe6'}),
 preset('graphite','石墨灰','#566672','#E9EEF1','#8c6f95',{accent:'#B0C0CD',bg:'#21272c',panel:'#2b343b',sidebar:'#252e34',soft:'#34414b',bubble:'#3b4954',code:'#242d33',line:'#45535f',strong:'#627583',text:'#e9eff4',muted:'#b5c1ca',secondary:'#d0b5dd'})
]
export function normalizeColorTheme(value:unknown):ColorThemeId{return colorThemeIds.includes(value as ColorThemeId)?value as ColorThemeId:defaultColorTheme}
export function getThemePreset(value:unknown){return themePresets.find(preset=>preset.id===normalizeColorTheme(value))!}
