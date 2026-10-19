import { useUiStore } from '../stores/ui'
export async function codeAction(event:MouseEvent) {
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-code-action]')
  if(!button)return
  const frame=button.closest<HTMLElement>('.code-frame')
  if(button.dataset.codeAction==='wrap'){
    frame?.classList.toggle('code-wrap')
    button.setAttribute('aria-pressed',String(frame?.classList.contains('code-wrap')))
  }else{
    try{await navigator.clipboard.writeText(frame?.querySelector('code')?.textContent || '');useUiStore().notify('代码已复制')}
    catch(error){useUiStore().failure(error)}
  }
}
