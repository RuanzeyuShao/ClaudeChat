import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import mathPlugin from 'markdown-it-katex'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const md: MarkdownIt = new MarkdownIt({ html: false, linkify: true, breaks: true, highlight(code: string, language: string): string {
  const valid = language && hljs.getLanguage(language)
  const html: string = valid ? hljs.highlight(code, { language }).value : escapeHtml(code)
  return `<pre class="hljs"><code>${html}</code></pre>`
} })
md.use(mathPlugin, { throwOnError: false, errorColor: '#cc0000' })

// markdown-it-katex parses math delimiters but bundles KaTeX 0.6. Its output
// cannot be styled correctly by the current KaTeX stylesheet, so render the
// parsed tokens with the same KaTeX version that supplies the CSS above.
const renderMath = (source: string, displayMode: boolean): string => {
  try { return katex.renderToString(source, { displayMode, throwOnError: false, output: 'htmlAndMathml' }) }
  catch { return escapeHtml(source) }
}
md.renderer.rules.math_inline = (tokens, index) => renderMath(tokens[index].content, false)
md.renderer.rules.math_block = (tokens, index) => `${renderMath(tokens[index].content, true)}\n`

export const renderMarkdown = (content: string) => md.render(content)
