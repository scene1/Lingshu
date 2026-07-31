import React, { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'

export interface MarkdownLinkCandidate {
  title: string
  path: string
  aliases?: string[]
}

interface MarkdownCodeEditorProps {
  value: string
  onChange: (value: string) => void
  onSelectionChange?: (selection: { start: number; end: number } | null) => void
  linkCandidates?: MarkdownLinkCandidate[]
}

const scoreLinkCandidate = (candidate: MarkdownLinkCandidate, query: string) => {
  if (!query) return 1
  const lowerQuery = query.toLowerCase()
  const title = candidate.title.toLowerCase()
  const path = candidate.path.toLowerCase()
  const aliases = (candidate.aliases || []).join(' ').toLowerCase()
  if (title === lowerQuery) return 100
  if (title.startsWith(lowerQuery)) return 80
  if (title.includes(lowerQuery)) return 60
  if (path.includes(lowerQuery)) return 40
  if (aliases.includes(lowerQuery)) return 30
  return 0
}

const makeWikiLinkCompletion = (linkCandidates: MarkdownLinkCandidate[]) => (context: CompletionContext) => {
  const lookBehind = context.state.sliceDoc(Math.max(0, context.pos - 160), context.pos)
  const openIndex = lookBehind.lastIndexOf('[[')
  if (openIndex < 0) return null
  const query = lookBehind.slice(openIndex + 2)
  if (query.includes(']]') || query.includes('\n')) return null

  const options: Completion[] = linkCandidates
    .map(candidate => ({ candidate, score: scoreLinkCandidate(candidate, query) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title, 'zh-Hans-CN'))
    .slice(0, 50)
    .map(({ candidate }) => ({
      label: candidate.title,
      detail: candidate.path,
      type: 'text',
      apply: `${candidate.title}]]`,
      boost: scoreLinkCandidate(candidate, query)
    }))

  if (!options.length && !context.explicit) return null
  return {
    from: context.pos - query.length,
    options,
    validFor: /^[^\]\n]*$/
  }
}

const MarkdownCodeEditor: React.FC<MarkdownCodeEditorProps> = ({ value, onChange, onSelectionChange, linkCandidates = [] }) => {
  const extensions = useMemo(() => [
    markdown(),
    autocompletion({
      override: [makeWikiLinkCompletion(linkCandidates)],
      activateOnTyping: true,
      defaultKeymap: true
    }),
    EditorView.lineWrapping
  ], [linkCandidates])

  return (
    <CodeMirror
      value={value}
      height="100%"
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
        autocompletion: false
      }}
      extensions={extensions}
      className="document-codemirror"
      onChange={onChange}
      onUpdate={update => {
        const selection = update.state.selection.main
        onSelectionChange?.(selection.from === selection.to ? null : { start: selection.from, end: selection.to })
      }}
    />
  )
}

export default MarkdownCodeEditor
