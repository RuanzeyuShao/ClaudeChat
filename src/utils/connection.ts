import type { RequestIdentity, Settings } from '../types'
export const connectionFields=['provider','profileId','baseUrl','model','thinking','webSearch','searchMode','searchProvider','searchBaseUrl','searchModel','requestOptions'] as const
export function snapshotSettings(settings:Settings):Settings {return JSON.parse(JSON.stringify({...settings,apiKey:''})) as Settings}
export function identity(settings:Settings,profileName?:string):RequestIdentity {
  return {...Object.fromEntries(connectionFields.map(key=>[key,settings[key]])),profileName} as RequestIdentity
}
export function connectionChanged(a:Settings,b:Settings):boolean {return connectionFields.some(key=>JSON.stringify(a[key])!==JSON.stringify(b[key]))}
