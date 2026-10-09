import { vi } from 'vitest'
Object.defineProperty(window,'matchMedia',{value:vi.fn().mockImplementation(query=>({matches:false,media:query,addEventListener:vi.fn(),removeEventListener:vi.fn()})),writable:true})
Object.defineProperty(navigator,'clipboard',{value:{writeText:vi.fn().mockResolvedValue(undefined)},configurable:true})
Element.prototype.scrollTo=vi.fn()
Element.prototype.scrollIntoView=vi.fn()
globalThis.ResizeObserver=class {observe(){}unobserve(){}disconnect(){}} as unknown as typeof ResizeObserver
