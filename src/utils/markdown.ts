import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import katex from 'markdown-it-katex'
import 'katex/dist/katex.min.css'

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const md: MarkdownIt = new MarkdownIt({ html: false, linkify: true, breaks: true, highlight(code: string, language: string): string {
  const valid = language && hljs.getLanguage(language)
  const html: string = valid ? hljs.highlight(code, { language }).value : escapeHtml(code)
  return `<pre class="hljs"><code>${html}</code></pre>`
} })
md.use(katex, { throwOnError: false, errorColor: '#cc0000' })

export const renderMarkdown = (content: string) => md.render(content)
