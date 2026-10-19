import { api } from '../services/tauri'
type ImageData={dataUrl:string;resolvedUrl:string}
const entries=new Map<string,{promise:Promise<ImageData>;size:number}>()
const MAX_BYTES=32*1024*1024
export function forgetRemoteImage(url:string){entries.delete(url)}
export function remoteImage(url:string):Promise<ImageData>{
 const saved=entries.get(url);if(saved){entries.delete(url);entries.set(url,saved);return saved.promise}
 const promise=api.getRemoteImage(url).then(result=>{
  const entry=entries.get(url);if(entry?.promise===promise){entry.size=result.dataUrl.length;let total=[...entries.values()].reduce((sum,item)=>sum+item.size,0);for(const [key,item] of entries){if(total<=MAX_BYTES && entries.size<=24)break;entries.delete(key);total-=item.size}}
  return result
 })
 entries.set(url,{promise,size:0});while(entries.size>24)entries.delete(entries.keys().next().value!)
 return promise
}
