import type { ArtifactFormat, ChatArtifactPreview } from '../types'

const formatLabels: Record<ArtifactFormat, string> = {
  docx: '生成 DOCX',
  pptx: '生成 PPTX',
  xlsx: '生成 XLSX',
  csv: '生成 CSV',
  md: '导出 MD',
  html: '导出 HTML',
}

export function artifactFormatLabel(format: ArtifactFormat) {
  return formatLabels[format] || `导出 ${format.toUpperCase()}`
}

export function compactArtifactTitle(content: string, fallback = '生成的内容') {
  const source = String(content || '')
  return (
    source.match(/^#\s+(.+)$/m)?.[1]
    || source.match(/<title>([^<]+)<\/title>/i)?.[1]
    || source.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').replace(/[*`|]/g, '').trim().slice(0, 52)
    || fallback
  )
}

function requestedArtifactKind(request: string) {
  const text = String(request || '')
  if (/PPTX?|幻灯片|演示文稿|演示稿|slide deck/i.test(text)) return 'presentation'
  if (/表格|数据表|清单|台账|Excel|xlsx|csv/i.test(text)) return 'spreadsheet'
  if (/HTML|网页|页面|站点|静态页/i.test(text)) return 'html'
  if (/Markdown|\.md|md\b/i.test(text)) return 'markdown'
  if (/Word|docx|文档|报告|手册|方案|需求说明|白皮书/i.test(text)) return 'document'
  return ''
}

export function detectChatArtifact(content: string, requestedFormats?: ArtifactFormat[], requestText = ''): ChatArtifactPreview | null {
  const source = String(content || '').trim()
  const requestedKind = requestedArtifactKind(requestText)
  if (!source) return null

  const hasMarkdownTable = /\n\s*\|[^|\n]+\|[^|\n]+\|\s*\n\s*\|[\s:|-]+\|[\s:|-]+\|/m.test(`\n${source}`)
  const hasHtml = /```html[\s\S]*?```/i.test(source) || /<!doctype\s+html|<html[\s>]|<table[\s>]|<section[\s>]/i.test(source)
  const hasPresentation = /(marp:\s*true|^---\s*$[\s\S]*?^---\s*$|PPTX?|幻灯片|演示文稿|演示稿|slide deck)/im.test(source)
  const hasDocument = /(优化后的文档|文档产物|操作手册|方案文档|需求文档|说明文档|报告|白皮书|目录|主要优化点)/.test(source)
  const hasMarkdownStructure = /^#{1,3}\s+.+/m.test(source) || /\n\s*[-*]\s+.+/.test(source) || /\n\s*\d+[.)、]\s+.+/.test(source)

  if (requestedKind === 'presentation' || hasPresentation) {
    return {
      kind: 'presentation',
      label: '幻灯片产物',
      title: compactArtifactTitle(source, '生成的幻灯片'),
      formats: requestedFormats?.length ? requestedFormats : ['pptx', 'md'],
      primaryFormat: requestedFormats?.[0] || 'pptx',
    }
  }

  if (requestedKind === 'spreadsheet' || hasMarkdownTable || /(^|\n)(表格|数据表|清单|台账|Excel|xlsx|csv)[：:]/i.test(source)) {
    return {
      kind: 'spreadsheet',
      label: '表格产物',
      title: compactArtifactTitle(source, '生成的表格'),
      formats: requestedFormats?.length ? requestedFormats : ['xlsx', 'csv', 'md'],
      primaryFormat: requestedFormats?.[0] || 'xlsx',
    }
  }

  if (requestedKind === 'html' || hasHtml) {
    return {
      kind: 'html',
      label: 'HTML 产物',
      title: compactArtifactTitle(source, '生成的 HTML'),
      formats: requestedFormats?.length ? requestedFormats : ['html', 'md'],
      primaryFormat: requestedFormats?.[0] || 'html',
    }
  }

  if (requestedKind === 'markdown') {
    return {
      kind: 'markdown',
      label: 'Markdown 产物',
      title: compactArtifactTitle(source, '生成的 Markdown'),
      formats: requestedFormats?.length ? requestedFormats : ['md', 'html', 'docx'],
      primaryFormat: requestedFormats?.[0] || 'md',
    }
  }

  if (requestedKind === 'document' || hasDocument || (hasMarkdownStructure && source.length > 260)) {
    return {
      kind: 'document',
      label: hasDocument ? '文档产物' : 'Markdown 产物',
      title: compactArtifactTitle(source, hasDocument ? '优化后的文档' : '生成的 Markdown'),
      formats: requestedFormats?.length ? requestedFormats : (hasDocument ? ['docx', 'md', 'html'] : ['md', 'html', 'docx']),
      primaryFormat: requestedFormats?.[0] || (hasDocument ? 'docx' : 'md'),
    }
  }

  return null
}
