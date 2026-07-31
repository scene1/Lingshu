import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Empty,
  Input,
  Layout,
  List,
  message,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tree,
  Typography
} from 'antd'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MarkdownLinkCandidate } from '../components/MarkdownCodeEditor'
import {
  AudioOutlined,
  CheckOutlined,
  DownloadOutlined,
  DiffOutlined,
  FileTextOutlined,
  FolderOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
  StopOutlined,
  UploadOutlined
} from '@ant-design/icons'

const { Sider, Content } = Layout
const { TextArea } = Input
const { Text } = Typography
const WIKI_LINK_SCHEME = 'lingshu-wiki:'

const MarkdownCodeEditor = React.lazy(() => import('../components/MarkdownCodeEditor'))

interface DocumentNode {
  title: string
  key: string
  path: string
  type: 'directory' | 'file'
  children?: DocumentNode[]
}

interface OpenDocument {
  path: string
  title: string
  content: string
  revision: string
  mtime: string
  size: number
}

interface DocumentVersion {
  id: string
  createdAt: string
  size: number
  revision: string
}

interface DocumentSearchResult {
  title: string
  path: string
  relativePath: string
  snippet: string
  mtime: string
  score: number
}

interface DocumentPropertyResult {
  title: string
  path: string
  relativePath?: string
  tags: string[]
  status: string
  created?: string
  updated?: string
  hasFrontMatter?: boolean
  mtime: string
}

interface DocumentPropertyFacet {
  tag?: string
  status?: string
  count: number
}

interface DocumentOutlineItem {
  id: string
  level: number
  text: string
  line: number
}

interface DocumentFrontMatter {
  tags: string[]
  status: string
  created: string
  updated: string
  extra: Record<string, string | string[]>
  hasFrontMatter: boolean
}

interface DocumentBacklink {
  title: string
  path: string
  relativePath?: string
  snippet: string
  reasons?: string[]
  mtime: string
}

interface DocumentGraphNode {
  id: string
  title: string
  path: string
  type: 'center' | 'outbound' | 'inbound' | 'bidirectional' | 'related'
}

interface DocumentGraphEdge {
  id: string
  source: string
  target: string
  type: 'outbound' | 'inbound'
}

interface DocumentGraph {
  center: string
  depth?: number
  nodes: DocumentGraphNode[]
  edges: DocumentGraphEdge[]
}

type DocumentGraphRelationFilter = 'all' | 'outbound' | 'inbound' | 'bidirectional' | 'related'
type DocumentAgentContextPolicy = 'document-only' | 'vault' | 'full-tools'

interface WorkbenchDocEntry {
  path: string
  title: string
  mtime?: string
  updatedAt?: string
  addedAt?: string
}

interface ExternalDocumentChange {
  type: 'changed' | 'deleted' | 'renamed'
  path: string
  revision?: string
  mtime?: string
  content?: string
  timestamp?: string
}

interface AiDiffCard {
  id: string
  action: string
  instruction: string
  model: string
  contextPolicy?: DocumentAgentContextPolicy
  scope: 'selection' | 'document'
  range: { start: number; end: number } | null
  beforeText: string
  proposal: string
  baseContent: string
  createdAt: string
  status: 'pending' | 'accepted' | 'rejected'
}

interface Meeting {
  id: string
  title: string
  status: string
  createdAt?: string
  updatedAt?: string
  audioPath?: string
  audioOriginalName?: string
  audioMimeType?: string
  transcriptPath?: string
  minutesPath?: string
  vaultRelativePath?: string
  hasAudio?: boolean
  hasTranscript?: boolean
  hasMinutes?: boolean
  transcriptLength?: number
  minutesLength?: number
  transcription?: { provider?: string; model?: string; error?: string }
}

interface TranscriptionSettings {
  enabled: boolean
  provider: 'browser' | 'openai-compatible'
  baseUrl: string
  apiKey: string
  model: string
  language: string
}

interface WorkbenchCommand {
  key: string
  title: string
  hint: string
  shortcut?: string
  disabled?: boolean
  run: () => void | Promise<void>
}

const apiJson = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || data.error || `请求失败 (${response.status})`)
  return data
}

const flattenFirstFile = (nodes: DocumentNode[]): string => {
  for (const node of nodes) {
    if (node.type === 'file') return node.path
    const child = flattenFirstFile(node.children || [])
    if (child) return child
  }
  return ''
}

const makeTreeData = (nodes: DocumentNode[]): any[] => nodes.map(node => ({
  title: node.title,
  key: node.path,
  icon: node.type === 'directory' ? <FolderOutlined /> : <FileTextOutlined />,
  isLeaf: node.type === 'file',
  selectable: node.type === 'file',
  children: node.children ? makeTreeData(node.children) : undefined
}))

const buildLineDiff = (before: string, after: string) => {
  const left = before.split('\n')
  const right = after.split('\n')
  const length = Math.max(left.length, right.length)
  return Array.from({ length }).map((_, index) => {
    const oldLine = left[index] ?? ''
    const newLine = right[index] ?? ''
    if (oldLine === newLine) return { type: 'same', line: newLine, number: index + 1 }
    if (oldLine && !newLine) return { type: 'removed', line: oldLine, number: index + 1 }
    if (!oldLine && newLine) return { type: 'added', line: newLine, number: index + 1 }
    return { type: 'changed', line: newLine, oldLine, number: index + 1 }
  })
}

const extractMarkdownOutline = (markdown: string): DocumentOutlineItem[] => markdown
  .split('\n')
  .map((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (!match) return null
    const text = match[2]
      .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim()
    if (!text) return null
    return {
      id: `${index + 1}-${text}`,
      level: match[1].length,
      text,
      line: index + 1
    }
  })
  .filter(Boolean) as DocumentOutlineItem[]

const stripYamlQuotes = (value: string) => String(value || '').trim().replace(/^['"]|['"]$/g, '')

const parseYamlValue = (value: string) => {
  const clean = String(value || '').trim()
  if (clean.startsWith('[') && clean.endsWith(']')) {
    return clean.slice(1, -1).split(',').map(item => stripYamlQuotes(item)).filter(Boolean)
  }
  return stripYamlQuotes(clean)
}

const parseDocumentFrontMatter = (markdown: string): { frontMatter: DocumentFrontMatter; body: string } => {
  const empty: DocumentFrontMatter = { tags: [], status: '', created: '', updated: '', extra: {}, hasFrontMatter: false }
  if (!String(markdown || '').startsWith('---\n')) return { frontMatter: empty, body: markdown }
  const lines = markdown.split('\n')
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (endIndex <= 0) return { frontMatter: empty, body: markdown }

  const frontMatter: DocumentFrontMatter = { ...empty, hasFrontMatter: true, extra: {} }
  const yamlLines = lines.slice(1, endIndex)
  for (let index = 0; index < yamlLines.length; index++) {
    const line = yamlLines[index]
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    const lowerKey = key.toLowerCase()
    let parsed = parseYamlValue(match[2])
    if (match[2].trim() === '') {
      const values: string[] = []
      let cursor = index + 1
      while (cursor < yamlLines.length) {
        const child = yamlLines[cursor].match(/^\s*-\s+(.+)$/)
        if (!child) break
        values.push(stripYamlQuotes(child[1]))
        cursor++
      }
      if (values.length > 0) {
        parsed = values
        index = cursor - 1
      }
    }
    if (lowerKey === 'tags') {
      frontMatter.tags = Array.isArray(parsed) ? parsed : String(parsed || '').split(/[,\s]+/).filter(Boolean)
    } else if (lowerKey === 'status') {
      frontMatter.status = Array.isArray(parsed) ? parsed.join(', ') : String(parsed || '')
    } else if (lowerKey === 'created') {
      frontMatter.created = Array.isArray(parsed) ? parsed[0] || '' : String(parsed || '')
    } else if (lowerKey === 'updated') {
      frontMatter.updated = Array.isArray(parsed) ? parsed[0] || '' : String(parsed || '')
    } else {
      frontMatter.extra[key] = parsed
    }
  }

  return { frontMatter, body: lines.slice(endIndex + 1).join('\n').replace(/^\n/, '') }
}

const serializeYamlScalar = (value: string) => {
  const clean = String(value || '').trim()
  if (!clean) return ''
  return /[:#[\]{}&,*>!|'"%@`\n]/.test(clean) ? JSON.stringify(clean) : clean
}

const serializeDocumentFrontMatter = (frontMatter: DocumentFrontMatter, body: string) => {
  const lines = ['---']
  if (frontMatter.tags.length > 0) {
    lines.push('tags:')
    frontMatter.tags.forEach(tag => lines.push(`  - ${serializeYamlScalar(tag)}`))
  }
  if (frontMatter.status.trim()) lines.push(`status: ${serializeYamlScalar(frontMatter.status)}`)
  if (frontMatter.created.trim()) lines.push(`created: ${serializeYamlScalar(frontMatter.created)}`)
  if (frontMatter.updated.trim()) lines.push(`updated: ${serializeYamlScalar(frontMatter.updated)}`)
  Object.entries(frontMatter.extra).forEach(([key, value]) => {
    if (['tags', 'status', 'created', 'updated'].includes(key.toLowerCase())) return
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      value.forEach(item => lines.push(`  - ${serializeYamlScalar(item)}`))
    } else if (String(value || '').trim()) {
      lines.push(`${key}: ${serializeYamlScalar(value)}`)
    }
  })
  lines.push('---', '')
  return `${lines.join('\n')}${String(body || '').replace(/^\n+/, '')}`
}

const normalizeWikiLinkKey = (value: string) => String(value || '')
  .split('#')[0]
  .replace(/\.md$/i, '')
  .trim()
  .toLowerCase()

const escapeMarkdownLinkLabel = (value: string) => String(value || '')
  .replace(/\\/g, '\\\\')
  .replace(/]/g, '\\]')
  .trim()

const buildWikiLinkIndex = (candidates: MarkdownLinkCandidate[]) => {
  const index = new Map<string, MarkdownLinkCandidate>()
  for (const candidate of candidates) {
    const aliases = [
      candidate.title,
      candidate.path,
      candidate.path.replace(/\.md$/i, ''),
      ...(candidate.aliases || [])
    ]
    for (const alias of aliases) {
      const key = normalizeWikiLinkKey(alias)
      if (key && !index.has(key)) index.set(key, candidate)
    }
  }
  return index
}

const transformWikiLinksToMarkdownLinks = (markdown: string, wikiLinkIndex: Map<string, MarkdownLinkCandidate>) => {
  const transformSegment = (segment: string) => segment.replace(/\[\[([^\]\n]+)]]/g, (_, rawLink: string) => {
    const [rawTarget, rawLabel] = String(rawLink).split('|')
    const target = rawTarget.trim()
    const label = escapeMarkdownLinkLabel(rawLabel || target)
    const candidate = wikiLinkIndex.get(normalizeWikiLinkKey(target))
    const href = `${WIKI_LINK_SCHEME}${encodeURIComponent(candidate?.path || target)}`
    return `[${label}](${href})`
  })

  let inFence = false
  return String(markdown || '').split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence) return line
    return line
      .split(/(`+[^`]*`+)/g)
      .map(segment => segment.startsWith('`') ? segment : transformSegment(segment))
      .join('')
  }).join('\n')
}

const buildGraphLayout = (graph: DocumentGraph | null) => {
  if (!graph?.nodes?.length) return []
  const center = graph.nodes.find(node => node.id === graph.center) || graph.nodes[0]
  const related = graph.nodes.filter(node => node.id !== center.id)
  const radius = related.length > 7 ? 175 : 145
  const centerNode = { ...center, x: 250, y: 190 }
  const relatedNodes = related.map((node, index) => {
    const angle = related.length <= 1 ? -Math.PI / 2 : (Math.PI * 2 * index / related.length) - Math.PI / 2
    return {
      ...node,
      x: 250 + Math.cos(angle) * radius,
      y: 190 + Math.sin(angle) * radius
    }
  })
  return [centerNode, ...relatedNodes]
}

const filterDocumentGraph = (
  graph: DocumentGraph | null,
  query: string,
  relationFilter: DocumentGraphRelationFilter
): DocumentGraph | null => {
  if (!graph) return null
  const cleanQuery = query.trim().toLowerCase()
  const nodeMatchesRelation = (node: DocumentGraphNode) => {
    if (node.id === graph.center) return true
    if (relationFilter === 'all') return true
    if (relationFilter === 'outbound') return node.type === 'outbound' || node.type === 'bidirectional'
    if (relationFilter === 'inbound') return node.type === 'inbound' || node.type === 'bidirectional'
    return node.type === relationFilter
  }
  const nodeMatchesQuery = (node: DocumentGraphNode) => {
    if (!cleanQuery) return true
    if (node.id === graph.center) return true
    return `${node.title} ${node.path}`.toLowerCase().includes(cleanQuery)
  }
  const nodes = graph.nodes.filter(node => nodeMatchesRelation(node) && nodeMatchesQuery(node))
  const visibleIds = new Set(nodes.map(node => node.id))
  const edges = graph.edges.filter(edge => {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return false
    if (relationFilter === 'outbound') return edge.type === 'outbound'
    if (relationFilter === 'inbound') return edge.type === 'inbound'
    return true
  })
  return { ...graph, nodes, edges }
}

const getRecorderMimeType = () => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find(type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) || ''
}

const formatMeetingTime = (value?: string) => {
  if (!value) return '未知时间'
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return value
  }
}

const DocumentWorkbench: React.FC = () => {
  const [status, setStatus] = useState<any>(null)
  const [tree, setTree] = useState<DocumentNode[]>([])
  const [loadingTree, setLoadingTree] = useState(false)
  const [selectedPath, setSelectedPath] = useState('')
  const [document, setDocument] = useState<OpenDocument | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<'html' | 'markdown' | ''>('')
  const [viewMode, setViewMode] = useState<'preview' | 'properties' | 'outline' | 'references' | 'graph' | 'diff' | 'history' | 'external'>('preview')
  const [newTitle, setNewTitle] = useState('')
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<DocumentSearchResult[]>([])
  const [searchingDocuments, setSearchingDocuments] = useState(false)
  const [propertyDocuments, setPropertyDocuments] = useState<DocumentPropertyResult[]>([])
  const [propertyTagFacets, setPropertyTagFacets] = useState<DocumentPropertyFacet[]>([])
  const [propertyStatusFacets, setPropertyStatusFacets] = useState<DocumentPropertyFacet[]>([])
  const [selectedPropertyTags, setSelectedPropertyTags] = useState<string[]>([])
  const [selectedPropertyStatus, setSelectedPropertyStatus] = useState('')
  const [propertyFilterText, setPropertyFilterText] = useState('')
  const [loadingPropertyDocuments, setLoadingPropertyDocuments] = useState(false)
  const [linkCandidates, setLinkCandidates] = useState<MarkdownLinkCandidate[]>([])
  const [backlinks, setBacklinks] = useState<DocumentBacklink[]>([])
  const [loadingBacklinks, setLoadingBacklinks] = useState(false)
  const [documentGraph, setDocumentGraph] = useState<DocumentGraph | null>(null)
  const [loadingGraph, setLoadingGraph] = useState(false)
  const [graphDepth, setGraphDepth] = useState<1 | 2>(1)
  const [graphFocusPath, setGraphFocusPath] = useState('')
  const [graphSearchText, setGraphSearchText] = useState('')
  const [graphRelationFilter, setGraphRelationFilter] = useState<DocumentGraphRelationFilter>('all')
  const [creatingWikiLinkTarget, setCreatingWikiLinkTarget] = useState('')
  const [recentDocs, setRecentDocs] = useState<WorkbenchDocEntry[]>([])
  const [favoriteDocs, setFavoriteDocs] = useState<WorkbenchDocEntry[]>([])
  const [updatingFavorite, setUpdatingFavorite] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<{ id: string; content: string; createdAt: string } | null>(null)
  const [restoringVersion, setRestoringVersion] = useState('')
  const [externalChange, setExternalChange] = useState<ExternalDocumentChange | null>(null)
  const [lastWatchEventId, setLastWatchEventId] = useState(0)
  const [comparingExternal, setComparingExternal] = useState(false)
  const [models, setModels] = useState<{ key: string; label: string }[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [aiAction, setAiAction] = useState('polish')
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiContextPolicy, setAiContextPolicy] = useState<DocumentAgentContextPolicy>('document-only')
  const [aiCards, setAiCards] = useState<AiDiffCard[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [editorSelection, setEditorSelection] = useState<{ start: number; end: number } | null>(null)

  const [meetingTitle, setMeetingTitle] = useState('')
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [recording, setRecording] = useState(false)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [minutes, setMinutes] = useState('')
  const [finalizing, setFinalizing] = useState(false)
  const [meetingHistory, setMeetingHistory] = useState<Meeting[]>([])
  const [loadingMeetings, setLoadingMeetings] = useState(false)
  const [retranscribingMeetingId, setRetranscribingMeetingId] = useState('')
  const [regeneratingMeetingId, setRegeneratingMeetingId] = useState('')
  const [transcriptionSettings, setTranscriptionSettings] = useState<TranscriptionSettings>({
    enabled: false,
    provider: 'browser',
    baseUrl: '',
    apiKey: '',
    model: 'whisper-1',
    language: 'zh'
  })
  const [savingTranscription, setSavingTranscription] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const recognitionRef = useRef<any>(null)
  const audioImportInputRef = useRef<HTMLInputElement | null>(null)

  const dirty = !!document && content !== savedContent
  const propertyFiltersActive = selectedPropertyTags.length > 0 || !!selectedPropertyStatus || !!propertyFilterText.trim()
  const parsedFrontMatter = useMemo(() => parseDocumentFrontMatter(content), [content])
  const frontMatter = parsedFrontMatter.frontMatter
  const outline = useMemo(() => extractMarkdownOutline(content), [content])
  const wikiLinkIndex = useMemo(() => buildWikiLinkIndex(linkCandidates), [linkCandidates])
  const previewContent = useMemo(() => transformWikiLinksToMarkdownLinks(content, wikiLinkIndex), [content, wikiLinkIndex])
  const filteredGraph = useMemo(() => filterDocumentGraph(documentGraph, graphSearchText, graphRelationFilter), [documentGraph, graphSearchText, graphRelationFilter])
  const graphNodes = useMemo(() => buildGraphLayout(filteredGraph), [filteredGraph])
  const diffRows = useMemo(() => buildLineDiff(savedContent, content), [savedContent, content])
  const versionDiffRows = useMemo(() => buildLineDiff(selectedVersion?.content || '', content), [selectedVersion, content])
  const externalDiffRows = useMemo(() => buildLineDiff(externalChange?.content || '', content), [externalChange, content])
  const isCurrentFavorite = !!document && favoriteDocs.some(item => item.path === document.path)

  const loadStatus = useCallback(async () => {
    const data = await apiJson('/api/documents/status')
    setStatus(data)
  }, [])

  const loadTree = useCallback(async () => {
    setLoadingTree(true)
    try {
      const data = await apiJson('/api/documents/tree')
      setTree(data.tree || [])
      if (!selectedPath) {
        const firstFile = flattenFirstFile(data.tree || [])
        if (firstFile) setSelectedPath(firstFile)
      }
    } catch (error: any) {
      message.warning(error.message)
    } finally {
      setLoadingTree(false)
    }
  }, [selectedPath])

  const loadWorkbenchState = useCallback(async () => {
    try {
      const data = await apiJson('/api/documents/workbench')
      setRecentDocs(Array.isArray(data.recent) ? data.recent : [])
      setFavoriteDocs(Array.isArray(data.favorites) ? data.favorites : [])
    } catch (_) {}
  }, [])

  const syncWorkbenchState = (data: any) => {
    setRecentDocs(Array.isArray(data.recent) ? data.recent : [])
    setFavoriteDocs(Array.isArray(data.favorites) ? data.favorites : [])
  }

  const rememberRecentDocument = useCallback(async (doc: OpenDocument) => {
    try {
      const data = await apiJson('/api/documents/recent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: doc.path, title: doc.title })
      })
      syncWorkbenchState(data)
    } catch (_) {}
  }, [])

  const loadDocument = useCallback(async (path: string) => {
    if (!path) return
    const data = await apiJson(`/api/documents/file?path=${encodeURIComponent(path)}`)
    setDocument(data)
    setContent(data.content || '')
    setSavedContent(data.content || '')
    setAiCards([])
    setSelectedVersion(null)
    setExternalChange(null)
    rememberRecentDocument(data)
  }, [rememberRecentDocument])

  const loadVersions = useCallback(async (path: string) => {
    if (!path) return
    setLoadingVersions(true)
    try {
      const data = await apiJson(`/api/documents/versions?path=${encodeURIComponent(path)}`)
      setVersions(Array.isArray(data.versions) ? data.versions : [])
    } catch (error: any) {
      message.warning(error.message)
      setVersions([])
    } finally {
      setLoadingVersions(false)
    }
  }, [])

  const searchDocuments = useCallback(async (query: string) => {
    const cleanQuery = query.trim()
    if (!cleanQuery) {
      setSearchResults([])
      setSearchingDocuments(false)
      return
    }
    setSearchingDocuments(true)
    try {
      const data = await apiJson(`/api/documents/search?q=${encodeURIComponent(cleanQuery)}&limit=16`)
      setSearchResults(Array.isArray(data.results) ? data.results : [])
    } catch (error: any) {
      message.warning(error.message)
      setSearchResults([])
    } finally {
      setSearchingDocuments(false)
    }
  }, [])

  const loadPropertyDocuments = useCallback(async (filters?: { tags?: string[]; status?: string; query?: string }) => {
    setLoadingPropertyDocuments(true)
    try {
      const tags = filters?.tags ?? selectedPropertyTags
      const status = filters?.status ?? selectedPropertyStatus
      const query = filters?.query ?? propertyFilterText
      const params = new URLSearchParams()
      if (tags.length > 0) params.set('tags', tags.join(','))
      if (status) params.set('status', status)
      if (query.trim()) params.set('q', query.trim())
      params.set('limit', '300')
      const data = await apiJson(`/api/documents/properties?${params.toString()}`)
      setPropertyDocuments(Array.isArray(data.documents) ? data.documents : [])
      setPropertyTagFacets(Array.isArray(data.facets?.tags) ? data.facets.tags : [])
      setPropertyStatusFacets(Array.isArray(data.facets?.statuses) ? data.facets.statuses : [])
    } catch (error: any) {
      message.warning(error.message)
      setPropertyDocuments([])
    } finally {
      setLoadingPropertyDocuments(false)
    }
  }, [selectedPropertyTags, selectedPropertyStatus, propertyFilterText])

  const loadBacklinks = useCallback(async (path: string) => {
    if (!path) return
    setLoadingBacklinks(true)
    try {
      const data = await apiJson(`/api/documents/backlinks?path=${encodeURIComponent(path)}&limit=30`)
      setBacklinks(Array.isArray(data.backlinks) ? data.backlinks : [])
    } catch (error: any) {
      message.warning(error.message)
      setBacklinks([])
    } finally {
      setLoadingBacklinks(false)
    }
  }, [])

  const loadDocumentGraph = useCallback(async (path: string, depth: 1 | 2 = graphDepth) => {
    if (!path) return
    setLoadingGraph(true)
    try {
      const data = await apiJson(`/api/documents/graph?path=${encodeURIComponent(path)}&limit=80&depth=${depth}`)
      setDocumentGraph({
        center: data.center || path,
        depth: data.depth || depth,
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
        edges: Array.isArray(data.edges) ? data.edges : []
      })
    } catch (error: any) {
      message.warning(error.message)
      setDocumentGraph(null)
    } finally {
      setLoadingGraph(false)
    }
  }, [graphDepth])

  const loadLinkCandidates = useCallback(async () => {
    try {
      const data = await apiJson('/api/documents/link-candidates?limit=800')
      setLinkCandidates(Array.isArray(data.candidates) ? data.candidates : [])
    } catch (_) {
      setLinkCandidates([])
    }
  }, [])

  const loadModels = useCallback(async () => {
    try {
      const data = await apiJson('/api/models')
      const modelList = Array.isArray(data.models) ? data.models : []
      setModels(modelList.map((item: any) => ({ key: item.key, label: item.label })))
      const firstReady = modelList.find((item: any) => item.hasApiKey) || modelList[0]
      if (firstReady?.key) setSelectedModel(firstReady.key)
    } catch (_) {}
  }, [])

  const loadTranscriptionSettings = useCallback(async () => {
    try {
      const data = await apiJson('/api/transcription/settings')
      setTranscriptionSettings({
        enabled: !!data.enabled,
        provider: data.provider === 'openai-compatible' ? 'openai-compatible' : 'browser',
        baseUrl: data.baseUrl || '',
        apiKey: data.apiKey || '',
        model: data.model || 'whisper-1',
        language: data.language || 'zh'
      })
    } catch (_) {}
  }, [])

  const loadMeetingHistory = useCallback(async () => {
    setLoadingMeetings(true)
    try {
      const data = await apiJson('/api/meetings')
      setMeetingHistory(Array.isArray(data.meetings) ? data.meetings : [])
    } catch (error: any) {
      message.warning(error.message || '读取历史会议失败')
    } finally {
      setLoadingMeetings(false)
    }
  }, [])

  useEffect(() => {
    loadStatus().then(loadTree).catch((error: any) => message.warning(error.message))
    loadModels()
    loadTranscriptionSettings()
    loadMeetingHistory()
    loadWorkbenchState()
    loadLinkCandidates()
  }, [loadStatus, loadTree, loadModels, loadTranscriptionSettings, loadMeetingHistory, loadWorkbenchState, loadLinkCandidates])

  useEffect(() => {
    if (selectedPath) {
      loadDocument(selectedPath).catch((error: any) => message.error(error.message))
      loadVersions(selectedPath)
      loadBacklinks(selectedPath)
      setGraphFocusPath(selectedPath)
      loadDocumentGraph(selectedPath, graphDepth)
    }
  }, [selectedPath, graphDepth, loadDocument, loadVersions, loadBacklinks, loadDocumentGraph])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      searchDocuments(searchText)
    }, 260)
    return () => window.clearTimeout(timer)
  }, [searchText, searchDocuments])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadPropertyDocuments()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [selectedPropertyTags, selectedPropertyStatus, propertyFilterText, loadPropertyDocuments])

  useEffect(() => {
    if (!document?.path) return
    let cancelled = false
    const markExternalChange = async (change: ExternalDocumentChange) => {
      if (cancelled) return
      if (change.type === 'deleted') {
        setExternalChange(change)
        return
      }
      setExternalChange(prev => ({
        ...prev,
        ...change,
        type: change.type || 'changed',
        path: document.path
      }))
    }
    const pollDocumentEvents = async () => {
      try {
        const data = await apiJson(`/api/documents/events?path=${encodeURIComponent(document.path)}&since=${lastWatchEventId}`)
        if (cancelled) return
        setLastWatchEventId(Number(data.lastEventId || lastWatchEventId))
        const events = Array.isArray(data.events) ? data.events : []
        const latest = events[events.length - 1]
        if (!latest) return
        if (latest.type === 'deleted') {
          await markExternalChange({ type: 'deleted', path: document.path, timestamp: latest.timestamp })
          return
        }
        if (latest.revision && latest.revision !== document.revision) {
          await markExternalChange({
            type: latest.type === 'renamed' ? 'renamed' : 'changed',
            path: document.path,
            revision: latest.revision,
            mtime: latest.mtime,
            timestamp: latest.timestamp
          })
        }
      } catch (_) {}

      try {
        const status = await apiJson(`/api/documents/file-status?path=${encodeURIComponent(document.path)}`)
        if (cancelled) return
        if (!status.exists) {
          await markExternalChange({ type: 'deleted', path: document.path })
        } else if (status.revision && status.revision !== document.revision) {
          await markExternalChange({
            type: 'changed',
            path: document.path,
            revision: status.revision,
            mtime: status.mtime
          })
        }
      } catch (_) {}
    }
    pollDocumentEvents()
    const timer = window.setInterval(pollDocumentEvents, 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [document?.path, document?.revision, lastWatchEventId])

  const saveDocument = async (force = false) => {
    if (!document) return
    setSaving(true)
    try {
      const data = await apiJson('/api/documents/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: document.path, content, baseRevision: document.revision, force })
      })
      setDocument(prev => prev ? { ...prev, revision: data.revision, mtime: data.mtime, size: data.size } : prev)
      setSavedContent(content)
      setExternalChange(null)
      await loadVersions(document.path)
      await loadPropertyDocuments()
      message.success('文档已保存')
    } catch (error: any) {
      message.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  const updateFrontMatter = (patch: Partial<Omit<DocumentFrontMatter, 'hasFrontMatter'>>) => {
    setContent(previous => {
      const parsed = parseDocumentFrontMatter(previous)
      const nextFrontMatter: DocumentFrontMatter = {
        ...parsed.frontMatter,
        ...patch,
        extra: patch.extra || parsed.frontMatter.extra,
        hasFrontMatter: true
      }
      return serializeDocumentFrontMatter(nextFrontMatter, parsed.body)
    })
  }

  const ensureFrontMatter = () => {
    const today = new Date().toISOString().slice(0, 10)
    updateFrontMatter({
      tags: frontMatter.tags,
      status: frontMatter.status || 'draft',
      created: frontMatter.created || today,
      updated: today,
      extra: frontMatter.extra
    })
    message.success('已补全基础文档属性')
  }

  const exportDocument = async (format: 'html' | 'markdown') => {
    if (!document) return
    setExportingFormat(format)
    try {
      const data = await apiJson('/api/documents/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: document.path, content, format })
      })
      if (data.url) {
        const url = `${data.url}`
        if (format === 'html') {
          window.open(url, '_blank', 'noopener,noreferrer')
        } else {
          const anchor = window.document.createElement('a')
          anchor.href = url
          anchor.download = data.fileName || `${document.title}.md`
          window.document.body.appendChild(anchor)
          anchor.click()
          window.document.body.removeChild(anchor)
        }
      }
      message.success(format === 'html' ? 'HTML 已导出' : 'Markdown 已导出')
    } catch (error: any) {
      message.error(error.message)
    } finally {
      setExportingFormat('')
    }
  }

  const loadExternalContentForDiff = async () => {
    if (!document || externalChange?.type === 'deleted') return
    setComparingExternal(true)
    try {
      const data = await apiJson(`/api/documents/file?path=${encodeURIComponent(document.path)}`)
      setExternalChange(prev => prev ? { ...prev, content: data.content || '', revision: data.revision, mtime: data.mtime } : prev)
      setViewMode('external')
    } catch (error: any) {
      message.error(error.message)
    } finally {
      setComparingExternal(false)
    }
  }

  const reloadExternalChange = async () => {
    if (!document) return
    await loadDocument(document.path)
    await loadVersions(document.path)
    message.success('已加载磁盘上的最新版本')
  }

  const loadVersionContent = async (versionId: string) => {
    if (!document) return
    try {
      const data = await apiJson(`/api/documents/versions/content?path=${encodeURIComponent(document.path)}&version=${encodeURIComponent(versionId)}`)
      setSelectedVersion({ id: data.version, content: data.content || '', createdAt: data.createdAt })
    } catch (error: any) {
      message.error(error.message)
    }
  }

  const restoreVersion = async (versionId: string) => {
    if (!document) return
    setRestoringVersion(versionId)
    try {
      const data = await apiJson('/api/documents/versions/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: document.path, version: versionId, baseRevision: document.revision })
      })
      await loadDocument(document.path)
      await loadVersions(document.path)
      setDocument(prev => prev ? { ...prev, revision: data.revision, mtime: data.mtime, size: data.size } : prev)
      message.success('已恢复到历史版本')
    } catch (error: any) {
      message.error(error.message)
    } finally {
      setRestoringVersion('')
    }
  }

  const createDocument = async () => {
    if (!newTitle.trim()) return
    try {
      const data = await apiJson('/api/documents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: selectedPath, title: newTitle })
      })
      setNewTitle('')
      await loadTree()
      await loadLinkCandidates()
      await loadPropertyDocuments()
      setSelectedPath(data.path)
      message.success('文档已创建')
    } catch (error: any) {
      message.error(error.message)
    }
  }

  const openSearchResult = (path: string) => {
    setSelectedPath(path)
    setSearchText('')
    setSearchResults([])
  }

  const openPropertyResult = (path: string) => {
    setSelectedPath(path)
    setSearchText('')
    setSearchResults([])
  }

  const clearPropertyFilters = () => {
    setSelectedPropertyTags([])
    setSelectedPropertyStatus('')
    setPropertyFilterText('')
  }

  const openWorkbenchEntry = (entry: WorkbenchDocEntry) => {
    setSelectedPath(entry.path)
    setSearchText('')
    setSearchResults([])
  }

  const expandGraphNode = (node: DocumentGraphNode) => {
    setGraphFocusPath(node.path)
    loadDocumentGraph(node.path, graphDepth)
  }

  const openWikiLinkTarget = useCallback(async (encodedTarget: string) => {
    const target = decodeURIComponent(encodedTarget || '')
    const cleanTarget = target.split('#')[0].trim()
    if (!cleanTarget) {
      message.warning('WikiLink 目标为空')
      return
    }
    const candidate = wikiLinkIndex.get(normalizeWikiLinkKey(target))
    if (candidate?.path) {
      setSelectedPath(candidate.path)
      setSearchText('')
      setSearchResults([])
      return
    }

    if (creatingWikiLinkTarget === cleanTarget) return
    setCreatingWikiLinkTarget(cleanTarget)
    try {
      const sourceTitle = document?.title || ''
      const backlink = sourceTitle ? `\n\n来源：[[${sourceTitle}]]\n` : '\n'
      const data = await apiJson('/api/documents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: document?.path || selectedPath,
          title: cleanTarget,
          content: `# ${cleanTarget}${backlink}`
        })
      })
      await loadTree()
      await loadLinkCandidates()
      await loadPropertyDocuments()
      setSelectedPath(data.path)
      setSearchText('')
      setSearchResults([])
      message.success(`已创建 WikiLink 文档：${cleanTarget}`)
    } catch (error: any) {
      message.error(error.message || `创建 WikiLink 文档失败：${cleanTarget}`)
    } finally {
      setCreatingWikiLinkTarget('')
    }
  }, [wikiLinkIndex, creatingWikiLinkTarget, document, selectedPath, loadTree, loadLinkCandidates, loadPropertyDocuments])

  const markdownComponents = useMemo<Components>(() => ({
    a: ({ href, children, node: _node, ...props }) => {
      if (href?.startsWith(WIKI_LINK_SCHEME)) {
        const encodedTarget = href.slice(WIKI_LINK_SCHEME.length)
        const target = decodeURIComponent(encodedTarget || '')
        const resolved = wikiLinkIndex.get(normalizeWikiLinkKey(target))
        const cleanTarget = target.split('#')[0].trim()
        const creating = !!cleanTarget && creatingWikiLinkTarget === cleanTarget
        return (
          <a
            {...props}
            href="#"
            className={`document-wiki-link${resolved ? '' : ' document-wiki-link-missing'}`}
            title={resolved?.path || (creating ? `正在创建：${target}` : `点击创建：${target}`)}
            onClick={event => {
              event.preventDefault()
              openWikiLinkTarget(encodedTarget)
            }}
          >
            {creating ? '创建中…' : children}
          </a>
        )
      }
      return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>
    }
  }), [openWikiLinkTarget, wikiLinkIndex, creatingWikiLinkTarget])

  const toggleFavoriteDocument = async () => {
    if (!document) return
    setUpdatingFavorite(true)
    try {
      const favorite = favoriteDocs.some(item => item.path === document.path)
      const data = favorite
        ? await apiJson(`/api/documents/favorites?path=${encodeURIComponent(document.path)}`, { method: 'DELETE' })
        : await apiJson('/api/documents/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: document.path, title: document.title })
        })
      syncWorkbenchState(data)
      message.success(favorite ? '已取消收藏' : '已收藏')
    } catch (error: any) {
      message.error(error.message)
    } finally {
      setUpdatingFavorite(false)
    }
  }

  const runDocumentAgent = async () => {
    if (!content.trim()) return
    const start = editorSelection?.start ?? 0
    const end = editorSelection?.end ?? 0
    const selection = start !== end ? content.slice(start, end) : ''
    setAiBusy(true)
    try {
      const data = await apiJson('/api/documents/agent/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'document-agent',
          documentPath: document?.path || '',
          baseRevision: document?.revision || '',
          documentContent: content,
          selection: selection ? { from: start, to: end, text: selection } : undefined,
          contextPolicy: aiContextPolicy,
          action: aiAction,
          instruction: aiInstruction,
          model: selectedModel
        })
      })
      const proposal = String(data.proposedContent || data.proposal || '').trim()
      if (!proposal) throw new Error('Agent 没有返回可应用的建议')
      const card: AiDiffCard = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        action: data.summary || aiAction,
        instruction: aiInstruction,
        model: data.model || selectedModel,
        contextPolicy: data.contextPolicy || aiContextPolicy,
        scope: selection ? 'selection' : 'document',
        range: selection ? { start, end } : null,
        beforeText: selection || content,
        proposal,
        baseContent: content,
        createdAt: new Date().toISOString(),
        status: 'pending'
      }
      setAiCards(prev => [card, ...prev].slice(0, 12))
      message.success(`Agent 已生成建议${data.model ? `：${data.model}` : ''}`)
    } catch (error: any) {
      message.error(error.message)
    } finally {
      setAiBusy(false)
    }
  }

  const applyAiCard = (card: AiDiffCard) => {
    if (card.status !== 'pending') return
    if (content !== card.baseContent) {
      message.warning('正文已变化，请重新生成这张建议卡，避免补丁套错位置')
      return
    }
    if (card.range) {
      setContent(prev => `${prev.slice(0, card.range!.start)}${card.proposal}${prev.slice(card.range!.end)}`)
    } else {
      setContent(card.proposal)
    }
    setAiCards(prev => prev.map(item => item.id === card.id ? { ...item, status: 'accepted' } : item))
    message.success('已应用 AI 建议')
  }

  const rejectAiCard = (cardId: string) => {
    setAiCards(prev => prev.map(item => item.id === cardId ? { ...item, status: 'rejected' } : item))
  }

  const removeAiCard = (cardId: string) => {
    setAiCards(prev => prev.filter(item => item.id !== cardId))
  }

  const startRecording = async () => {
    try {
      const created = await apiJson('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: meetingTitle || undefined })
      })
      setMeeting(created)
      setMinutes('')
      chunksRef.current = []
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = getRecorderMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        setUploadingAudio(true)
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          const form = new FormData()
          form.append('audio', blob, 'meeting.webm')
          form.append('mimeType', recorder.mimeType || 'audio/webm')
          form.append('transcript', transcript)
          const updated = await apiJson(`/api/meetings/${created.id}/audio`, { method: 'POST', body: form })
          setMeeting(updated)
          loadMeetingHistory()
          message.success('录音已保存')
        } catch (error: any) {
          message.error(error.message)
        } finally {
          setUploadingAudio(false)
        }
      }
      recorder.start(5000)
      recorderRef.current = recorder

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition()
        recognition.lang = 'zh-CN'
        recognition.continuous = true
        recognition.interimResults = false
        recognition.onresult = (event: any) => {
          const finalText = Array.from(event.results)
            .slice(event.resultIndex)
            .map((result: any) => result[0]?.transcript || '')
            .join('')
            .trim()
          if (finalText) setTranscript(prev => `${prev}${prev ? '\n' : ''}${finalText}`)
        }
        recognition.onerror = () => {}
        recognition.start()
        recognitionRef.current = recognition
      }

      setRecording(true)
    } catch (error: any) {
      message.error(error.message || '无法开始录音')
    }
  }

  const stopRecording = () => {
    setRecording(false)
    recognitionRef.current?.stop?.()
    recognitionRef.current = null
    recorderRef.current?.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }

  const importMeetingAudio = async (file?: File) => {
    if (!file || recording || uploadingAudio) return
    setUploadingAudio(true)
    try {
      const titleFromFile = file.name.replace(/\.[^.]+$/, '').trim()
      const created = await apiJson('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: meetingTitle || titleFromFile || undefined })
      })

      const form = new FormData()
      form.append('audio', file, file.name)
      form.append('mimeType', file.type || 'application/octet-stream')
      if (transcript.trim()) form.append('transcript', transcript)

      const updated = await apiJson(`/api/meetings/${created.id}/audio`, { method: 'POST', body: form })
      setMeeting(updated)
      setMinutes('')
      loadMeetingHistory()
      message.success(`已导入录音：${file.name}`)
    } catch (error: any) {
      message.error(error.message || '导入录音失败')
    } finally {
      setUploadingAudio(false)
      if (audioImportInputRef.current) audioImportInputRef.current.value = ''
    }
  }

  const finalizeMeeting = async (targetMeeting: Meeting | null = meeting, sourceTranscript = transcript) => {
    if (!targetMeeting) return
    setFinalizing(true)
    try {
      const data = await apiJson(`/api/meetings/${targetMeeting.id}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: sourceTranscript, model: selectedModel })
      })
      setMeeting(data)
      if (data.transcript) setTranscript(data.transcript)
      setMinutes(data.minutes || '')
      if (data.vaultRelativePath) setSelectedPath(data.vaultRelativePath)
      await loadTree()
      await loadMeetingHistory()
      message.success('会议纪要已生成')
    } catch (error: any) {
      message.error(error.message)
    } finally {
      setFinalizing(false)
    }
  }

  const openMeetingFromHistory = async (meetingId: string) => {
    try {
      const data = await apiJson(`/api/meetings/${meetingId}`)
      setMeeting(data)
      setMeetingTitle(data.title || '')
      setTranscript(data.transcript || '')
      setMinutes(data.minutes || '')
      if (data.vaultRelativePath) setSelectedPath(data.vaultRelativePath)
      message.success('已打开历史会议')
    } catch (error: any) {
      message.error(error.message || '打开历史会议失败')
    }
  }

  const retranscribeMeeting = async (item: Meeting) => {
    setRetranscribingMeetingId(item.id)
    try {
      const data = await apiJson(`/api/meetings/${item.id}/retranscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcription: transcriptionSettings })
      })
      setMeeting(data)
      setMeetingTitle(data.title || '')
      setTranscript(data.transcript || '')
      setMinutes(data.minutes || '')
      await loadMeetingHistory()
      if (data.transcription?.error) {
        message.warning(data.transcription.error)
      } else {
        message.success('重新转写完成')
      }
    } catch (error: any) {
      message.error(error.message || '重新转写失败')
    } finally {
      setRetranscribingMeetingId('')
    }
  }

  const regenerateMeetingMinutes = async (item: Meeting) => {
    setRegeneratingMeetingId(item.id)
    try {
      const detail = await apiJson(`/api/meetings/${item.id}`)
      await finalizeMeeting(detail, detail.transcript || '')
    } finally {
      setRegeneratingMeetingId('')
    }
  }

  const updateTranscriptionSetting = (key: keyof TranscriptionSettings, value: any) => {
    setTranscriptionSettings(prev => ({ ...prev, [key]: value }))
  }

  const saveTranscriptionSettings = async () => {
    setSavingTranscription(true)
    try {
      const data = await apiJson('/api/transcription/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transcriptionSettings)
      })
      setTranscriptionSettings({
        enabled: !!data.enabled,
        provider: data.provider === 'openai-compatible' ? 'openai-compatible' : 'browser',
        baseUrl: data.baseUrl || '',
        apiKey: data.apiKey || '',
        model: data.model || 'whisper-1',
        language: data.language || 'zh'
      })
      message.success('转写设置已保存')
    } catch (error: any) {
      message.error(error.message)
    } finally {
      setSavingTranscription(false)
    }
  }

  const commandActions: WorkbenchCommand[] = [
    {
      key: 'save',
      title: '保存当前文档',
      hint: dirty ? '写入 Vault 并生成版本快照' : '当前文档没有未保存改动',
      shortcut: '⌘S',
      disabled: !document || !dirty || saving,
      run: () => saveDocument()
    },
    {
      key: 'favorite',
      title: isCurrentFavorite ? '取消收藏当前文档' : '收藏当前文档',
      hint: '固定在左侧收藏区，适合长期项目文档',
      shortcut: '⇧⌘F',
      disabled: !document || updatingFavorite,
      run: () => toggleFavoriteDocument()
    },
    {
      key: 'new',
      title: '创建新文档',
      hint: newTitle.trim() ? `创建：${newTitle.trim()}` : '先在左侧输入新文档标题',
      disabled: !newTitle.trim(),
      run: () => createDocument()
    },
    {
      key: 'refresh',
      title: '刷新当前文档',
      hint: '重新读取磁盘内容和历史版本',
      disabled: !document,
      run: async () => {
        if (!document) return
        await loadDocument(document.path)
        await loadVersions(document.path)
      }
    },
    {
      key: 'preview',
      title: '切换到预览',
      hint: '查看 Markdown 渲染效果',
      disabled: !document,
      run: () => setViewMode('preview')
    },
    {
      key: 'properties',
      title: '查看文档属性',
      hint: frontMatter.hasFrontMatter ? `${frontMatter.tags.length} 个标签 · ${frontMatter.status || '无状态'}` : '补全 YAML Front Matter',
      disabled: !document,
      run: () => setViewMode('properties')
    },
    {
      key: 'ensure-properties',
      title: '补全基础文档属性',
      hint: '写入 tags/status/created/updated 字段',
      disabled: !document,
      run: () => {
        ensureFrontMatter()
        setViewMode('properties')
      }
    },
    {
      key: 'clear-property-filters',
      title: '清空属性筛选',
      hint: propertyFiltersActive ? '恢复显示收藏、最近和文件树' : '当前没有属性筛选条件',
      disabled: !propertyFiltersActive,
      run: clearPropertyFilters
    },
    {
      key: 'outline',
      title: '查看文档大纲',
      hint: outline.length > 0 ? `${outline.length} 个标题` : '当前文档没有标题',
      disabled: !document,
      run: () => setViewMode('outline')
    },
    {
      key: 'references',
      title: '查看引用与反链',
      hint: loadingBacklinks ? '正在扫描引用' : `${backlinks.length} 个反链`,
      disabled: !document,
      run: () => {
        if (document) loadBacklinks(document.path)
        setViewMode('references')
      }
    },
    {
      key: 'graph',
      title: '查看局部知识图谱',
      hint: loadingGraph ? '正在生成图谱' : `${graphDepth} 度 · ${documentGraph?.nodes.length || 0} 个节点 · ${documentGraph?.edges.length || 0} 条连接`,
      disabled: !document,
      run: () => {
        if (document) loadDocumentGraph(graphFocusPath || document.path, graphDepth)
        setViewMode('graph')
      }
    },
    {
      key: 'clear-graph-filter',
      title: '清空图谱过滤',
      hint: graphSearchText || graphRelationFilter !== 'all' ? '恢复显示全部图谱节点' : '当前没有图谱过滤条件',
      disabled: !document || (!graphSearchText && graphRelationFilter === 'all'),
      run: () => {
        setGraphSearchText('')
        setGraphRelationFilter('all')
        setViewMode('graph')
      }
    },
    {
      key: 'refresh-links',
      title: '刷新 WikiLink 候选索引',
      hint: `当前已加载 ${linkCandidates.length} 个 Markdown 文档`,
      run: () => loadLinkCandidates()
    },
    {
      key: 'diff',
      title: '切换到 Diff',
      hint: '对比当前编辑内容和上次保存版本',
      disabled: !document,
      run: () => setViewMode('diff')
    },
    {
      key: 'history',
      title: '查看版本历史',
      hint: '浏览快照并可恢复历史版本',
      disabled: !document,
      run: () => setViewMode('history')
    },
    {
      key: 'agent',
      title: '让灵枢 Agent 生成 Diff Card',
      hint: editorSelection && editorSelection.start !== editorSelection.end ? '基于选区生成建议' : '基于全文生成建议',
      disabled: !document || !content.trim() || aiBusy,
      run: () => runDocumentAgent()
    },
    {
      key: 'export-html',
      title: '导出 HTML',
      hint: '生成可预览的 HTML 文件',
      disabled: !document || !!exportingFormat,
      run: () => exportDocument('html')
    },
    {
      key: 'export-md',
      title: '导出 Markdown',
      hint: '下载当前 Markdown 内容',
      disabled: !document || !!exportingFormat,
      run: () => exportDocument('markdown')
    },
    {
      key: 'meeting',
      title: recording ? '结束会议录音' : '开始会议录音',
      hint: recording ? '保存录音并停止实时识别' : '创建会议记录并开始录音',
      run: () => (recording ? stopRecording() : startRecording())
    },
    {
      key: 'minutes',
      title: '生成会议纪要',
      hint: '根据逐字稿生成 Markdown 纪要并写入 Vault',
      disabled: !meeting || recording || uploadingAudio || finalizing,
      run: () => finalizeMeeting()
    }
  ]

  const filteredCommands = commandActions.filter(command => {
    const query = commandQuery.trim().toLowerCase()
    if (!query) return true
    return [command.title, command.hint, command.shortcut].some(value => String(value || '').toLowerCase().includes(query))
  })

  const runWorkbenchCommand = (command: WorkbenchCommand) => {
    if (command.disabled) return
    setCommandOpen(false)
    setCommandQuery('')
    Promise.resolve(command.run()).catch((error: any) => message.error(error.message || '命令执行失败'))
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const isMod = event.metaKey || event.ctrlKey
      if (isMod && key === 'k') {
        event.preventDefault()
        setCommandOpen(true)
        return
      }
      if (isMod && key === 's') {
        event.preventDefault()
        if (document && dirty && !saving) saveDocument()
        return
      }
      if (isMod && event.shiftKey && key === 'f') {
        event.preventDefault()
        if (document && !updatingFavorite) toggleFavoriteDocument()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [document, dirty, saving, updatingFavorite, isCurrentFavorite, content, savedContent])

  return (
    <div className="document-workbench">
      <Tabs
        items={[
          {
            key: 'documents',
            label: '文档',
            children: (
              <Layout className="document-workbench-layout">
                <Sider width={300} theme="light" className="document-workbench-sidebar">
                  <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
                    <Input value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="新文档标题" onPressEnter={createDocument} />
                    <Button icon={<PlusOutlined />} onClick={createDocument} />
                  </Space.Compact>
                  <Input
                    allowClear
                    prefix={<SearchOutlined />}
                    value={searchText}
                    onChange={event => setSearchText(event.target.value)}
                    placeholder="搜索标题、路径或正文"
                    className="document-search-input"
                  />
                  <div className="document-property-filters">
                    <Select
                      mode="multiple"
                      allowClear
                      size="small"
                      maxTagCount="responsive"
                      value={selectedPropertyTags}
                      placeholder="按 Tag 筛选"
                      options={propertyTagFacets.map(item => ({ value: item.tag, label: `${item.tag} (${item.count})` }))}
                      onChange={value => setSelectedPropertyTags(value)}
                    />
                    <Select
                      allowClear
                      size="small"
                      value={selectedPropertyStatus || undefined}
                      placeholder="按 Status 筛选"
                      options={propertyStatusFacets.map(item => ({ value: item.status, label: `${item.status} (${item.count})` }))}
                      onChange={value => setSelectedPropertyStatus(value || '')}
                    />
                    <Input
                      allowClear
                      size="small"
                      prefix={<SearchOutlined />}
                      value={propertyFilterText}
                      onChange={event => setPropertyFilterText(event.target.value)}
                      placeholder="属性内按标题/路径过滤"
                    />
                    {propertyFiltersActive && <Button size="small" onClick={clearPropertyFilters}>清空属性筛选</Button>}
                  </div>
                  {searchText.trim() && (
                    <div className="document-search-results">
                      <Spin spinning={searchingDocuments}>
                        {searchResults.length > 0 ? (
                          <List
                            size="small"
                            dataSource={searchResults}
                            renderItem={item => (
                              <List.Item className="document-search-result" onClick={() => openSearchResult(item.path || item.relativePath)}>
                                <div>
                                  <div className="document-search-title">{item.title}</div>
                                  <div className="document-search-path">{item.relativePath || item.path}</div>
                                  {item.snippet && <div className="document-search-snippet">{item.snippet}</div>}
                                </div>
                              </List.Item>
                            )}
                          />
                        ) : (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={searchingDocuments ? '搜索中' : '没有结果'} />
                        )}
                      </Spin>
                    </div>
                  )}
                  {!searchText.trim() && propertyFiltersActive && (
                    <div className="document-property-results">
                      <div className="document-quick-title">属性筛选 · {propertyDocuments.length} 篇</div>
                      <Spin spinning={loadingPropertyDocuments}>
                        {propertyDocuments.length > 0 ? (
                          <List
                            size="small"
                            dataSource={propertyDocuments}
                            renderItem={item => (
                              <List.Item className="document-search-result" onClick={() => openPropertyResult(item.path || item.relativePath || '')}>
                                <div>
                                  <Space size={6} wrap>
                                    <div className="document-search-title">{item.title}</div>
                                    {item.status && <Tag color="blue">{item.status}</Tag>}
                                    {(item.tags || []).slice(0, 4).map(tag => <Tag key={`${item.path}-${tag}`}>{tag}</Tag>)}
                                  </Space>
                                  <div className="document-search-path">{item.path || item.relativePath}</div>
                                  {(item.created || item.updated) && <div className="document-search-path">created {item.created || '-'} · updated {item.updated || '-'}</div>}
                                </div>
                              </List.Item>
                            )}
                          />
                        ) : (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loadingPropertyDocuments ? '筛选中' : '没有匹配文档'} />
                        )}
                      </Spin>
                    </div>
                  )}
                  {!searchText.trim() && !propertyFiltersActive && favoriteDocs.length > 0 && (
                    <div className="document-quick-section">
                      <div className="document-quick-title">收藏</div>
                      <List
                        size="small"
                        dataSource={favoriteDocs}
                        renderItem={item => (
                          <List.Item className="document-quick-item" onClick={() => openWorkbenchEntry(item)}>
                            <StarFilled className="document-quick-icon" />
                            <div>
                              <div className="document-search-title">{item.title}</div>
                              <div className="document-search-path">{item.path}</div>
                            </div>
                          </List.Item>
                        )}
                      />
                    </div>
                  )}
                  {!searchText.trim() && !propertyFiltersActive && recentDocs.length > 0 && (
                    <div className="document-quick-section">
                      <div className="document-quick-title">最近</div>
                      <List
                        size="small"
                        dataSource={recentDocs.slice(0, 8)}
                        renderItem={item => (
                          <List.Item className="document-quick-item" onClick={() => openWorkbenchEntry(item)}>
                            <FileTextOutlined className="document-quick-icon" />
                            <div>
                              <div className="document-search-title">{item.title}</div>
                              <div className="document-search-path">{item.path}</div>
                            </div>
                          </List.Item>
                        )}
                      />
                    </div>
                  )}
                  {status && !status.valid ? (
                    <Alert type="warning" showIcon message={status.reason || 'Vault 不可用'} />
                  ) : propertyFiltersActive && !searchText.trim() ? null : (
                    <Spin spinning={loadingTree}>
                      <Tree
                        showIcon
                        blockNode
                        treeData={makeTreeData(tree)}
                        selectedKeys={selectedPath ? [selectedPath] : []}
                        onSelect={keys => setSelectedPath(String(keys[0] || ''))}
                      />
                    </Spin>
                  )}
                </Sider>
                <Content className="document-editor-pane">
                  {document ? (
                    <>
                      <div className="document-toolbar">
                        <Space size={8}>
                          <Tag color={dirty ? 'gold' : 'green'}>{dirty ? '未保存' : '已保存'}</Tag>
                          <Tag color="blue">WikiLink {linkCandidates.length}</Tag>
                          <Text ellipsis className="document-path">{document.path}</Text>
                        </Space>
                        <Space size={8}>
                          <Button onClick={() => setCommandOpen(true)}>⌘K 命令</Button>
                          <Button
                            icon={isCurrentFavorite ? <StarFilled /> : <StarOutlined />}
                            loading={updatingFavorite}
                            onClick={toggleFavoriteDocument}
                          >
                            {isCurrentFavorite ? '已收藏' : '收藏'}
                          </Button>
                          <Button icon={<ReloadOutlined />} onClick={() => {
                            loadDocument(document.path)
                            loadVersions(document.path)
                          }}>刷新</Button>
                          <Button icon={<DownloadOutlined />} loading={exportingFormat === 'html'} onClick={() => exportDocument('html')}>HTML</Button>
                          <Button icon={<DownloadOutlined />} loading={exportingFormat === 'markdown'} onClick={() => exportDocument('markdown')}>MD</Button>
                          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => saveDocument()}>保存</Button>
                        </Space>
                      </div>
                      {externalChange && (
                        <Alert
                          className="document-external-alert"
                          type={externalChange.type === 'deleted' ? 'error' : 'warning'}
                          showIcon
                          message={externalChange.type === 'deleted' ? '磁盘上的文档已被删除' : '磁盘上的文档已被外部修改'}
                          description={externalChange.mtime ? `外部修改时间：${new Date(externalChange.mtime).toLocaleString('zh-CN')}` : undefined}
                          action={
                            <Space>
                              {externalChange.type !== 'deleted' && (
                                <Button size="small" loading={comparingExternal} onClick={loadExternalContentForDiff}>对比</Button>
                              )}
                              {externalChange.type !== 'deleted' && (
                                <Button size="small" type="primary" onClick={reloadExternalChange}>刷新</Button>
                              )}
                              <Button size="small" danger disabled={externalChange.type === 'deleted'} onClick={() => saveDocument(true)}>强制保存</Button>
                            </Space>
                          }
                        />
                      )}
                      <div className="document-main-grid">
                        <Suspense fallback={<div className="document-editor-loading"><Spin /></div>}>
                          <MarkdownCodeEditor
                            value={content}
                            onChange={setContent}
                            onSelectionChange={setEditorSelection}
                            linkCandidates={linkCandidates}
                          />
                        </Suspense>
                        <div className="document-side-pane">
                          <div className="document-side-toolbar">
                            <Segmented
                              value={viewMode}
                              onChange={value => setViewMode(value as 'preview' | 'properties' | 'outline' | 'references' | 'graph' | 'diff' | 'history' | 'external')}
                              options={[
                                { label: '预览', value: 'preview', icon: <FileTextOutlined /> },
                                { label: '属性', value: 'properties', icon: <FileTextOutlined /> },
                                { label: '大纲', value: 'outline', icon: <FileTextOutlined /> },
                                { label: '引用', value: 'references', icon: <DiffOutlined /> },
                                { label: '图谱', value: 'graph', icon: <DiffOutlined /> },
                                { label: 'Diff', value: 'diff', icon: <DiffOutlined /> },
                                { label: '历史', value: 'history', icon: <ReloadOutlined /> },
                                { label: '磁盘', value: 'external', icon: <DiffOutlined />, disabled: !externalChange?.content }
                              ]}
                            />
                          </div>
                          {viewMode === 'preview' ? (
                            <div className="document-preview markdown-content">
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{previewContent || ' '}</ReactMarkdown>
                            </div>
                          ) : viewMode === 'properties' ? (
                            <div className="document-properties">
                              <Space direction="vertical" size={14} style={{ width: '100%' }}>
                                {!frontMatter.hasFrontMatter && (
                                  <Alert
                                    type="info"
                                    showIcon
                                    message="当前文档还没有 YAML Front Matter"
                                    description="点击补全后，会在文档顶部写入 tags/status/created/updated 字段。"
                                    action={<Button size="small" type="primary" onClick={ensureFrontMatter}>补全</Button>}
                                  />
                                )}
                                <div className="document-property-field">
                                  <Text strong>Tags</Text>
                                  <Select
                                    mode="tags"
                                    value={frontMatter.tags}
                                    placeholder="输入标签后回车"
                                    style={{ width: '100%' }}
                                    onChange={value => updateFrontMatter({ tags: value })}
                                  />
                                </div>
                                <div className="document-property-field">
                                  <Text strong>Status</Text>
                                  <Select
                                    value={frontMatter.status || undefined}
                                    allowClear
                                    placeholder="选择或输入状态"
                                    style={{ width: '100%' }}
                                    onChange={value => updateFrontMatter({ status: value || '' })}
                                    options={[
                                      { value: 'draft', label: 'draft' },
                                      { value: 'active', label: 'active' },
                                      { value: 'review', label: 'review' },
                                      { value: 'done', label: 'done' },
                                      { value: 'archived', label: 'archived' }
                                    ]}
                                  />
                                </div>
                                <div className="document-property-grid">
                                  <div className="document-property-field">
                                    <Text strong>Created</Text>
                                    <Input
                                      value={frontMatter.created}
                                      placeholder="YYYY-MM-DD"
                                      onChange={event => updateFrontMatter({ created: event.target.value })}
                                    />
                                  </div>
                                  <div className="document-property-field">
                                    <Text strong>Updated</Text>
                                    <Input
                                      value={frontMatter.updated}
                                      placeholder="YYYY-MM-DD"
                                      onChange={event => updateFrontMatter({ updated: event.target.value })}
                                    />
                                  </div>
                                </div>
                                {Object.keys(frontMatter.extra).length > 0 && (
                                  <div className="document-property-extra">
                                    <Text strong>其他属性</Text>
                                    {Object.entries(frontMatter.extra).map(([key, value]) => (
                                      <div key={key} className="document-property-extra-row">
                                        <Text type="secondary">{key}</Text>
                                        <code>{Array.isArray(value) ? value.join(', ') : value}</code>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <Alert type="success" showIcon message="属性改动会同步到左侧 Markdown，点击保存后写入 Vault。" />
                              </Space>
                            </div>
                          ) : viewMode === 'outline' ? (
                            <div className="document-outline">
                              {outline.length > 0 ? (
                                <List
                                  size="small"
                                  dataSource={outline}
                                  renderItem={item => (
                                    <List.Item className="document-outline-item" style={{ paddingLeft: 10 + (item.level - 1) * 14 }}>
                                      <div>
                                        <div className="document-outline-title">{item.text}</div>
                                        <div className="document-outline-line">第 {item.line} 行 · H{item.level}</div>
                                      </div>
                                    </List.Item>
                                  )}
                                />
                              ) : (
                                <Empty description="当前文档没有标题大纲" />
                              )}
                            </div>
                          ) : viewMode === 'references' ? (
                            <div className="document-references">
                              <Spin spinning={loadingBacklinks}>
                                {backlinks.length > 0 ? (
                                  <List
                                    size="small"
                                    dataSource={backlinks}
                                    renderItem={item => (
                                      <List.Item className="document-reference-item" onClick={() => openWorkbenchEntry({ path: item.path || item.relativePath || '', title: item.title })}>
                                        <div>
                                          <Space size={6} wrap>
                                            <Text strong>{item.title}</Text>
                                            {(item.reasons || []).map(reason => <Tag key={`${item.path}-${reason}`}>{reason}</Tag>)}
                                          </Space>
                                          <div className="document-search-path">{item.path || item.relativePath}</div>
                                          {item.snippet && <pre className="document-reference-snippet">{item.snippet}</pre>}
                                        </div>
                                      </List.Item>
                                    )}
                                  />
                                ) : (
                                  <Empty description={loadingBacklinks ? '引用加载中' : '还没有发现反链'} />
                                )}
                              </Spin>
                            </div>
                          ) : viewMode === 'graph' ? (
                            <div className="document-graph">
                              <Spin spinning={loadingGraph}>
                                {documentGraph && filteredGraph && graphNodes.length > 0 ? (
                                  <>
                                    <div className="document-graph-summary">
                                      <Tag color="blue">{filteredGraph.nodes.length}/{documentGraph.nodes.length} 节点</Tag>
                                      <Tag color="purple">{filteredGraph.edges.length}/{documentGraph.edges.length} 连接</Tag>
                                      <Tag color="cyan">焦点：{documentGraph.center}</Tag>
                                      <Segmented
                                        size="small"
                                        value={graphDepth}
                                        options={[
                                          { label: '一度', value: 1 },
                                          { label: '二度', value: 2 }
                                        ]}
                                        onChange={value => {
                                          const nextDepth = Number(value) === 2 ? 2 : 1
                                          setGraphDepth(nextDepth)
                                          loadDocumentGraph(graphFocusPath || document?.path || '', nextDepth)
                                        }}
                                      />
                                      <Button size="small" onClick={() => loadDocumentGraph(graphFocusPath || document?.path || '', graphDepth)}>刷新图谱</Button>
                                    </div>
                                    <div className="document-graph-filters">
                                      <Input
                                        allowClear
                                        size="small"
                                        prefix={<SearchOutlined />}
                                        value={graphSearchText}
                                        onChange={event => setGraphSearchText(event.target.value)}
                                        placeholder="按标题或路径过滤节点"
                                      />
                                      <Segmented
                                        size="small"
                                        value={graphRelationFilter}
                                        options={[
                                          { label: '全部', value: 'all' },
                                          { label: '出链', value: 'outbound' },
                                          { label: '反链', value: 'inbound' },
                                          { label: '双向', value: 'bidirectional' },
                                          { label: '相关', value: 'related' }
                                        ]}
                                        onChange={value => setGraphRelationFilter(value as DocumentGraphRelationFilter)}
                                      />
                                    </div>
                                    <svg className="document-graph-canvas" viewBox="0 0 500 380" role="img" aria-label="文档局部知识图谱">
                                      {filteredGraph.edges.map(edge => {
                                        const source = graphNodes.find(node => node.id === edge.source)
                                        const target = graphNodes.find(node => node.id === edge.target)
                                        if (!source || !target) return null
                                        return (
                                          <line
                                            key={edge.id}
                                            x1={source.x}
                                            y1={source.y}
                                            x2={target.x}
                                            y2={target.y}
                                            className={`document-graph-edge document-graph-edge-${edge.type}`}
                                          />
                                        )
                                      })}
                                      {graphNodes.map(node => (
                                        <g key={node.id} className={`document-graph-node document-graph-node-${node.type}`} onClick={() => expandGraphNode(node)}>
                                          <circle cx={node.x} cy={node.y} r={node.type === 'center' ? 34 : 24} />
                                          <text x={node.x} y={node.y + 4}>{node.title.slice(0, 12)}</text>
                                        </g>
                                      ))}
                                    </svg>
                                    <List
                                      size="small"
                                      dataSource={filteredGraph.nodes.filter(node => node.id !== filteredGraph.center)}
                                      renderItem={node => (
                                        <List.Item
                                          className="document-graph-list-item"
                                          onClick={() => expandGraphNode(node)}
                                          actions={[
                                            <Button
                                              size="small"
                                              onClick={event => {
                                                event.stopPropagation()
                                                openWorkbenchEntry({ path: node.path, title: node.title })
                                              }}
                                            >
                                              打开
                                            </Button>
                                          ]}
                                        >
                                          <Space size={8} wrap>
                                            <Tag color={node.type === 'outbound' ? 'green' : node.type === 'inbound' ? 'gold' : node.type === 'bidirectional' ? 'purple' : 'default'}>
                                              {node.type === 'outbound' ? '出链' : node.type === 'inbound' ? '反链' : node.type === 'bidirectional' ? '双向' : '相关'}
                                            </Tag>
                                            <Text strong>{node.title}</Text>
                                            <Text type="secondary">{node.path}</Text>
                                          </Space>
                                        </List.Item>
                                      )}
                                    />
                                  </>
                                ) : (
                                  <Empty description={loadingGraph ? '图谱生成中' : '当前文档还没有可视化连接'} />
                                )}
                              </Spin>
                            </div>
                          ) : viewMode === 'diff' ? (
                            <div className="document-diff">
                              {diffRows.map(row => (
                                <div key={`${row.number}-${row.type}`} className={`document-diff-row document-diff-${row.type}`}>
                                  <span>{row.number}</span>
                                  <code>{row.type === 'changed' ? `${row.oldLine}  ->  ${row.line}` : row.line || ' '}</code>
                                </div>
                              ))}
                            </div>
                          ) : viewMode === 'history' ? (
                            <div className="document-history">
                              <Spin spinning={loadingVersions}>
                                {versions.length > 0 ? (
                                  <List
                                    size="small"
                                    dataSource={versions}
                                    renderItem={version => (
                                      <List.Item
                                        actions={[
                                          <Button size="small" onClick={() => loadVersionContent(version.id)}>查看</Button>,
                                          <Button size="small" loading={restoringVersion === version.id} onClick={() => restoreVersion(version.id)}>恢复</Button>
                                        ]}
                                      >
                                        <List.Item.Meta
                                          title={new Date(version.createdAt).toLocaleString('zh-CN')}
                                          description={`${Math.round(version.size / 1024 * 10) / 10} KB · ${version.revision.slice(0, 10)}`}
                                        />
                                      </List.Item>
                                    )}
                                  />
                                ) : (
                                  <Empty description="暂无历史版本" />
                                )}
                              </Spin>
                              {selectedVersion && (
                                <div className="document-version-preview">
                                  <Text strong>{new Date(selectedVersion.createdAt).toLocaleString('zh-CN')}</Text>
                                  <div className="document-diff document-version-diff">
                                    {versionDiffRows.map(row => (
                                      <div key={`${selectedVersion.id}-${row.number}-${row.type}`} className={`document-diff-row document-diff-${row.type}`}>
                                        <span>{row.number}</span>
                                        <code>{row.type === 'changed' ? `${row.oldLine}  ->  ${row.line}` : row.line || ' '}</code>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="document-diff">
                              {externalChange?.content ? externalDiffRows.map(row => (
                                <div key={`external-${row.number}-${row.type}`} className={`document-diff-row document-diff-${row.type}`}>
                                  <span>{row.number}</span>
                                  <code>{row.type === 'changed' ? `${row.oldLine}  ->  ${row.line}` : row.line || ' '}</code>
                                </div>
                              )) : (
                                <Empty description="尚未加载磁盘版本" />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="document-agent-panel">
                        <Space wrap>
                          <Select
                            value={selectedModel || undefined}
                            placeholder="模型"
                            style={{ width: 260 }}
                            options={models.map(model => ({ value: model.key, label: model.label }))}
                            onChange={setSelectedModel}
                          />
                          <Select
                            value={aiAction}
                            style={{ width: 160 }}
                            onChange={setAiAction}
                            options={[
                              { value: 'polish', label: '润色' },
                              { value: 'rewrite', label: '改写' },
                              { value: 'summarize', label: '摘要' },
                              { value: 'expand', label: '扩写' },
                              { value: 'translate', label: '翻译' },
                              { value: 'review', label: '审阅' },
                              { value: 'custom', label: '自定义' }
                            ]}
                          />
                          <Select
                            value={aiContextPolicy}
                            style={{ width: 190 }}
                            onChange={value => setAiContextPolicy(value as DocumentAgentContextPolicy)}
                            options={[
                              { value: 'document-only', label: '仅当前文档' },
                              { value: 'vault', label: '文档 + Vault' },
                              { value: 'full-tools', label: 'Vault + Skills' }
                            ]}
                          />
                          <Input
                            value={aiInstruction}
                            onChange={event => setAiInstruction(event.target.value)}
                            placeholder="补充要求"
                            style={{ width: 360 }}
                          />
                          <Button icon={<RobotOutlined />} loading={aiBusy} onClick={runDocumentAgent}>生成 Diff Card</Button>
                        </Space>
                        {aiCards.length > 0 && (
                          <div className="document-ai-cards">
                            {aiCards.map(card => {
                              const stale = content !== card.baseContent && card.status === 'pending'
                              const rows = buildLineDiff(card.beforeText, card.proposal).filter(row => row.type !== 'same')
                              return (
                                <div key={card.id} className={`document-ai-card document-ai-card-${card.status}`}>
                                  <div className="document-ai-card-header">
                                    <Space size={8} wrap>
                                      <Tag color={card.status === 'accepted' ? 'green' : card.status === 'rejected' ? 'default' : stale ? 'orange' : 'blue'}>
                                        {card.status === 'accepted' ? '已接受' : card.status === 'rejected' ? '已拒绝' : stale ? '已过期' : '待审阅'}
                                      </Tag>
                                      <Text strong>{card.action}</Text>
                                      <Text type="secondary">{card.scope === 'selection' ? '选区' : '全文'}</Text>
                                      {card.contextPolicy && <Text type="secondary">{card.contextPolicy}</Text>}
                                      {card.model && <Text type="secondary">{card.model}</Text>}
                                    </Space>
                                    <Space size={8}>
                                      <Button size="small" disabled={card.status !== 'pending'} onClick={() => rejectAiCard(card.id)}>拒绝</Button>
                                      <Button size="small" type="primary" icon={<CheckOutlined />} disabled={card.status !== 'pending' || stale} onClick={() => applyAiCard(card)}>接受</Button>
                                      <Button size="small" onClick={() => removeAiCard(card.id)}>移除</Button>
                                    </Space>
                                  </div>
                                  {card.instruction && <Text type="secondary" className="document-ai-card-instruction">{card.instruction}</Text>}
                                  {stale && <Alert type="warning" showIcon message="正文已变化，这张卡片不能直接应用" />}
                                  <div className="document-ai-card-diff">
                                    {rows.length > 0 ? rows.map(row => (
                                      <div key={`${card.id}-${row.number}-${row.type}`} className={`document-diff-row document-diff-${row.type}`}>
                                        <span>{row.number}</span>
                                        <code>{row.type === 'changed' ? `${row.oldLine}  ->  ${row.line}` : row.line || ' '}</code>
                                      </div>
                                    )) : (
                                      <Empty description="建议内容与原文一致" />
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <Empty description="未打开文档" />
                  )}
                </Content>
              </Layout>
            )
          },
          {
            key: 'meetings',
            label: '会议',
            children: (
              <div className="meeting-workspace">
                <div className="meeting-transcription-config">
                  <Space wrap align="center">
                    <Switch checked={transcriptionSettings.enabled} onChange={checked => updateTranscriptionSetting('enabled', checked)} />
                    <Select
                      value={transcriptionSettings.provider}
                      style={{ width: 190 }}
                      onChange={value => updateTranscriptionSetting('provider', value)}
                      options={[
                        { value: 'browser', label: '浏览器实时识别' },
                        { value: 'openai-compatible', label: 'OpenAI-compatible' }
                      ]}
                    />
                    {transcriptionSettings.provider === 'openai-compatible' && (
                      <>
                        <Input
                          value={transcriptionSettings.baseUrl}
                          onChange={event => updateTranscriptionSetting('baseUrl', event.target.value)}
                          placeholder="https://api.example.com/v1"
                          style={{ width: 260 }}
                        />
                        <Input.Password
                          value={transcriptionSettings.apiKey}
                          onChange={event => updateTranscriptionSetting('apiKey', event.target.value)}
                          placeholder="API Key"
                          style={{ width: 180 }}
                        />
                        <Input
                          value={transcriptionSettings.model}
                          onChange={event => updateTranscriptionSetting('model', event.target.value)}
                          placeholder="whisper-1"
                          style={{ width: 130 }}
                        />
                        <Input
                          value={transcriptionSettings.language}
                          onChange={event => updateTranscriptionSetting('language', event.target.value)}
                          placeholder="zh"
                          style={{ width: 90 }}
                        />
                      </>
                    )}
                    <Button loading={savingTranscription} onClick={saveTranscriptionSettings}>保存转写设置</Button>
                  </Space>
                </div>
                <div className="meeting-control">
                  <Space wrap>
                    <Input value={meetingTitle} onChange={event => setMeetingTitle(event.target.value)} placeholder="会议标题" style={{ width: 320 }} disabled={recording} />
                    <input
                      ref={audioImportInputRef}
                      type="file"
                      accept="audio/*,.mp3,.m4a,.wav,.webm,.mp4,.aac,.flac,.ogg"
                      style={{ display: 'none' }}
                      onChange={event => importMeetingAudio(event.target.files?.[0] || undefined)}
                    />
                    {recording ? (
                      <Button danger type="primary" icon={<StopOutlined />} onClick={stopRecording}>结束录音</Button>
                    ) : (
                      <Button type="primary" icon={<AudioOutlined />} onClick={startRecording}>开始录音</Button>
                    )}
                    <Button
                      icon={<UploadOutlined />}
                      loading={uploadingAudio}
                      disabled={recording}
                      onClick={() => audioImportInputRef.current?.click()}
                    >
                      导入录音
                    </Button>
                    <Button icon={<FileTextOutlined />} loading={finalizing} disabled={!meeting || recording || uploadingAudio} onClick={() => finalizeMeeting()}>生成纪要</Button>
                    {uploadingAudio && <Tag color="processing">保存录音中</Tag>}
                    {meeting?.vaultRelativePath && <Tag color="green">{meeting.vaultRelativePath}</Tag>}
                    {meeting?.transcription?.error && <Tag color="warning">{meeting.transcription.error}</Tag>}
                  </Space>
                </div>
                <div className="meeting-history">
                  <div className="meeting-history-header">
                    <Space>
                      <FileTextOutlined />
                      <Text strong>历史会议列表</Text>
                      <Tag>{meetingHistory.length}</Tag>
                    </Space>
                    <Button size="small" icon={<ReloadOutlined />} loading={loadingMeetings} onClick={loadMeetingHistory}>
                      刷新
                    </Button>
                  </div>
                  <Spin spinning={loadingMeetings}>
                    {meetingHistory.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史会议；导入录音或生成纪要后会出现在这里" />
                    ) : (
                      <List
                        size="small"
                        dataSource={meetingHistory}
                        renderItem={item => (
                          <List.Item
                            actions={[
                              <Button size="small" key="open" onClick={() => openMeetingFromHistory(item.id)}>打开</Button>,
                              <Button
                                size="small"
                                key="retranscribe"
                                disabled={!item.hasAudio}
                                loading={retranscribingMeetingId === item.id}
                                onClick={() => retranscribeMeeting(item)}
                              >
                                重新转写
                              </Button>,
                              <Button
                                size="small"
                                type="primary"
                                key="regenerate"
                                disabled={!item.hasTranscript && !item.hasAudio}
                                loading={regeneratingMeetingId === item.id || (finalizing && meeting?.id === item.id)}
                                onClick={() => regenerateMeetingMinutes(item)}
                              >
                                重新生成纪要
                              </Button>
                            ]}
                          >
                            <List.Item.Meta
                              title={
                                <Space wrap>
                                  <span>{item.title}</span>
                                  <Tag color={item.status === 'summarized' ? 'green' : item.status === 'transcribing' ? 'processing' : 'default'}>
                                    {item.status}
                                  </Tag>
                                  {meeting?.id === item.id && <Tag color="blue">当前打开</Tag>}
                                </Space>
                              }
                              description={
                                <Space wrap size={8}>
                                  <Text type="secondary">{formatMeetingTime(item.updatedAt || item.createdAt)}</Text>
                                  {item.audioOriginalName && <Text type="secondary">录音：{item.audioOriginalName}</Text>}
                                  {item.hasAudio && <Tag>录音</Tag>}
                                  {item.hasTranscript && <Tag color="blue">逐字稿 {item.transcriptLength || 0} 字</Tag>}
                                  {item.hasMinutes && <Tag color="green">纪要</Tag>}
                                  {item.vaultRelativePath && <Text type="secondary">{item.vaultRelativePath}</Text>}
                                </Space>
                              }
                            />
                          </List.Item>
                        )}
                      />
                    )}
                  </Spin>
                </div>
                <div className="meeting-grid">
                  <div className="meeting-panel">
                    <Text strong>逐字稿</Text>
                    <TextArea
                      value={transcript}
                      onChange={event => setTranscript(event.target.value)}
                      className="meeting-transcript"
                      placeholder="实时识别或手动粘贴逐字稿"
                    />
                  </div>
                  <div className="meeting-panel">
                    <Text strong>纪要</Text>
                    {minutes ? (
                      <div className="meeting-minutes markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{minutes}</ReactMarkdown>
                      </div>
                    ) : (
                      <List
                        size="small"
                        dataSource={[
                          meeting ? `会议：${meeting.title}` : '尚未创建会议',
                          recording ? '录音中' : '空闲',
                          transcript ? `已捕获 ${transcript.length} 字逐字稿` : '等待逐字稿'
                        ]}
                        renderItem={item => <List.Item>{item}</List.Item>}
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          }
        ]}
      />
      <Modal
        title="文档命令"
        open={commandOpen}
        footer={null}
        destroyOnClose
        onCancel={() => {
          setCommandOpen(false)
          setCommandQuery('')
        }}
      >
        <Input
          autoFocus
          allowClear
          prefix={<SearchOutlined />}
          value={commandQuery}
          onChange={event => setCommandQuery(event.target.value)}
          placeholder="搜索命令，例如：保存、收藏、导出、会议"
          className="document-command-search"
        />
        <List
          className="document-command-list"
          dataSource={filteredCommands}
          locale={{ emptyText: '没有匹配命令' }}
          renderItem={command => (
            <List.Item
              className={`document-command-item${command.disabled ? ' document-command-item-disabled' : ''}`}
              onClick={() => runWorkbenchCommand(command)}
            >
              <div>
                <div className="document-command-title">{command.title}</div>
                <div className="document-command-hint">{command.hint}</div>
              </div>
              {command.shortcut && <Tag>{command.shortcut}</Tag>}
            </List.Item>
          )}
        />
      </Modal>
    </div>
  )
}

export default DocumentWorkbench
