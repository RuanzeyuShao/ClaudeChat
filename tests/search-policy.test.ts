import { expect, it } from 'vitest'
import { hasBuiltinSearchRoute, validateSearch } from '../src/utils/searchPolicy'

it('maps the implemented Provider routes without claiming compatibility for all models',()=>{
 for(const provider of ['anthropic-compatible','openai','moonshot','zhipu'] as const)expect(hasBuiltinSearchRoute(provider)).toBe(true)
 for(const provider of ['openai-compatible','deepseek','grok'] as const){expect(hasBuiltinSearchRoute(provider)).toBe(false);expect(()=>validateSearch({provider,searchProvider:'claude',searchMode:'force',searchBaseUrl:''})).toThrow('SearXNG')}
})
it('allows every Provider to use an explicitly configured external search service',()=>{
 for(const provider of ['anthropic-compatible','openai','moonshot','zhipu','deepseek','grok','openai-compatible'] as const)expect(()=>validateSearch({provider,searchProvider:'searxng',searchMode:'force',searchBaseUrl:'https://search.invalid/subpath'})).not.toThrow()
})
it('rejects missing and malformed external addresses before saving or starting a request',()=>{
 for(const searchBaseUrl of ['','search.invalid','file:///etc/passwd'])expect(()=>validateSearch({provider:'deepseek',searchProvider:'searxng',searchMode:'auto',searchBaseUrl})).toThrow()
 expect(()=>validateSearch({provider:'grok',searchProvider:'claude',searchMode:'off',searchBaseUrl:''})).not.toThrow()
 expect(()=>validateSearch({provider:'grok',searchProvider:'claude',searchMode:'auto',webSearch:false,searchBaseUrl:''})).not.toThrow()
})
