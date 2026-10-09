import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const md: MarkdownIt = new MarkdownIt({ html: false, linkify: true, breaks: true, highlight(code: string, language: string): string {
  const valid = language && hljs.getLanguage(language)
  const html: string = valid ? hljs.highlight(code, { language }).value : escapeHtml(code)
  return `<pre class="hljs"><code>${html}</code></pre>`
} })
// Use a single current KaTeX runtime; the former plugin bundled KaTeX 0.6.
md.inline.ruler.after('escape','math_inline',(state,silent)=>{
  const start=state.pos
  if(state.src[start]!=='$' || /\s|\$/.test(state.src[start+1] || ' '))return false
  let end=start+1
  for(;;){end=state.src.indexOf('$',end);if(end<0)return false;let slashes=0;for(let i=end-1;i>=0 && state.src[i]==='\\';i--)slashes++;if(slashes%2===0)break;end++}
  if(/\s/.test(state.src[end-1]) || /\d/.test(state.src[end+1] || ''))return false
  if(!silent){const token=state.push('math_inline','math',0);token.content=state.src.slice(start+1,end);token.markup='$'}
  state.pos=end+1;return true
})
md.block.ruler.before('fence','math_block',(state,startLine,endLine,silent)=>{
  const first=state.src.slice(state.bMarks[startLine]+state.tShift[startLine],state.eMarks[startLine]).trim()
  if(!first.startsWith('$$'))return false
  if(silent)return true
  let next=startLine+1,content=first.slice(2)
  if(content.endsWith('$$'))content=content.slice(0,-2)
  else{
    const lines=[content]
    for(;next<endLine;next++){
      const line=state.src.slice(state.bMarks[next]+state.tShift[next],state.eMarks[next])
      if(line.trimEnd().endsWith('$$')){lines.push(line.trimEnd().slice(0,-2));next++;break}
      lines.push(line)
    }
    content=lines.join('\n')
  }
  const token=state.push('math_block','math',0);token.block=true;token.content=content.trim();token.map=[startLine,next];token.markup='$$';state.line=next;return true
},{alt:['paragraph','reference','blockquote','list']})
md.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index], language = token.info.trim().split(/\s+/)[0] || 'text'
  const highlighted = hljs.getLanguage(language) ? hljs.highlight(token.content, { language }).value : escapeHtml(token.content)
  return `<div class="code-frame"><div class="code-heading"><span>${escapeHtml(language)}</span><div><button type="button" data-code-action="wrap" aria-label="代码自动换行" aria-pressed="false">换行</button><button type="button" data-code-action="copy" aria-label="复制代码">复制</button></div></div><pre class="hljs"><code>${highlighted}</code></pre></div>`
}

// Math markup uses the same renderer version as the bundled stylesheet.
const renderMath = (source: string, displayMode: boolean): string => {
  try { return katex.renderToString(source, { displayMode, throwOnError: false, trust:false, maxExpand:1000, output: 'htmlAndMathml' }) }
  catch { return escapeHtml(source) }
}
md.renderer.rules.math_inline = (tokens, index) => renderMath(tokens[index].content, false)
md.renderer.rules.math_block = (tokens, index) => `${renderMath(tokens[index].content, true)}\n`

export const renderMarkdown = (content: string) => md.render(content)
