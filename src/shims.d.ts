declare module 'markdown-it-katex' {
  import type MarkdownIt from 'markdown-it'
  const plugin: MarkdownIt.PluginWithOptions<{ throwOnError?: boolean; errorColor?: string }>
  export default plugin
}
