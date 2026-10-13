import { api } from '../services/tauri'
import { useUiStore } from '../stores/ui'
export function webUrl(value:string):string|undefined {
 try{const url=new URL(value);if(['http:','https:'].includes(url.protocol) && !url.username && !url.password)return url.href}catch{}
}
export async function openWebLink(value:string){
 const url=webUrl(value);if(!url){useUiStore().notify('仅支持 HTTP 或 HTTPS 网页链接。','info');return}
 try{
  if(api.isTauri){await api.openLinkPreview(url);useUiStore().notify('网页已在独立窗口打开，点击顶部“返回聊天”可回来。','info')}
  else{window.open(url,'_blank','noopener,noreferrer')}
 }catch(e){useUiStore().failure(e)}
}
export function contentLink(event:MouseEvent):boolean {
 const anchor=(event.target as Element)?.closest<HTMLAnchorElement>('a[href]');if(!anchor)return false
 const value=anchor.getAttribute('href') || '';if(value.startsWith('#'))return false
 event.preventDefault();event.stopPropagation();void openWebLink(value);return true
}
