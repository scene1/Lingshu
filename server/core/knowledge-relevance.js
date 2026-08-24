const GENERIC_QUERY_TOKENS = new Set([
  '一下', '什么', '怎么', '如何', '哪些', '区别', '对比', '比较', '内容', '资料', '文档', '知识库', '回答', '帮我', '请问', '的区', '和的', '跟的',
])

const CONVERSATION_ARCHIVE_PATTERN = /(?:^|\/)\u7075\u67a2\/Conversations\/AI\u5bf9\u8bdd(?:\/|$)|(?:^|\/)Conversations\/AI\u5bf9\u8bdd(?:\/|$)/i
const HISTORY_QUERY_PATTERN = /\u5386\u53f2(?:\u5bf9\u8bdd|\u4f1a\u8bdd)|\u4e4b\u524d(?:\u7684)?(?:\u5bf9\u8bdd|\u4f1a\u8bdd)|\u8fc7\u53bb(?:\u7684)?(?:\u5bf9\u8bdd|\u4f1a\u8bdd)|\u6211(?:\u4eec)?(?:\u4e4b\u524d|\u4e0a\u6b21)\u8bf4|\u4f1a\u8bdd\u8bb0\u5f55|\u804a\u5929\u8bb0\u5f55/i

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function tokenizeKnowledgeQuery(value) {
  const lower = normalize(value)
    .replace(/(?:的)?(?:区别|差异|不同)(?:是)?(?:什么)?/g, ' ')
    .replace(/(?:请|帮我|麻烦)?(?:查找|检索|搜索|说明|解释|介绍|回答|告诉我)(?:一下)?/g, ' ')
    .replace(/(?:是什么|怎么样|怎么做|如何)/g, ' ')
  const latin = lower.match(/[a-z0-9_#+.\-]{2,}/g) || []
  const cjkSegments = lower.match(/[\u4e00-\u9fff]{2,}/g) || []
  const cjk = []
  for (const segment of cjkSegments) {
    if (segment.length <= 6) cjk.push(segment)
    for (let index = 0; index < segment.length - 1; index += 1) cjk.push(segment.slice(index, index + 2))
  }
  return [...new Set([...latin, ...cjk])]
    .filter(token => token.length >= 2 && !GENERIC_QUERY_TOKENS.has(token))
    .slice(0, 24)
}

export function isConversationArchivePath(value) {
  return CONVERSATION_ARCHIVE_PATTERN.test(String(value || '').replace(/\\/g, '/'))
}

export function isHistoricalConversationQuery(value) {
  return HISTORY_QUERY_PATTERN.test(String(value || ''))
}

export function scoreKnowledgeCandidate(candidate, query) {
  const tokens = tokenizeKnowledgeQuery(query)
  if (tokens.length === 0) return 0

  const title = normalize(candidate?.title || candidate?.documentName)
  const path = normalize(candidate?.relativePath || candidate?.path || candidate?.chapter)
  const tags = normalize(Array.isArray(candidate?.tags) ? candidate.tags.join(' ') : candidate?.tags)
  const headings = normalize(Array.isArray(candidate?.headings) ? candidate.headings.join(' ') : candidate?.headings)
  const snippet = normalize(candidate?.snippet || candidate?.plain || candidate?.content)
  const fields = `${title} ${path} ${tags} ${headings} ${snippet}`
  const matched = tokens.filter(token => fields.includes(token))
  if (matched.length === 0) return 0

  const coverage = matched.length / tokens.length
  const titleCoverage = matched.filter(token => title.includes(token)).length / tokens.length
  const metadataCoverage = matched.filter(token => tags.includes(token) || headings.includes(token)).length / tokens.length
  const phrase = normalize(query).length >= 4 && fields.includes(normalize(query)) ? 1 : 0
  let relevance = coverage * 0.62 + titleCoverage * 0.23 + metadataCoverage * 0.1 + phrase * 0.05

  if (/\u4f1a\u8bddid|\u6d88\u606f\u6570|\u5f52\u6863\u8def\u5f84|\bmodel\s*:|\btime\s*:/i.test(snippet)) relevance *= 0.55
  return Math.max(0, Math.min(1, Number(relevance.toFixed(4))))
}

export function filterAndRankKnowledgeResults(results, query, options = {}) {
  const allowConversationArchives = isHistoricalConversationQuery(query)
  const minimumRelevance = Math.max(0.2, Math.min(0.9, Number(options.minimumRelevance || 0.34)))
  const limit = Math.max(1, Math.min(12, Number(options.limit || 5)))
  const seen = new Set()

  return (Array.isArray(results) ? results : [])
    .filter(item => allowConversationArchives || !isConversationArchivePath(item?.relativePath || item?.path || item?.chapter))
    .map(item => ({ ...item, relevance: scoreKnowledgeCandidate(item, query) }))
    .filter(item => item.relevance >= minimumRelevance)
    .sort((left, right) => right.relevance - left.relevance || Number(right.score || 0) - Number(left.score || 0))
    .filter(item => {
      const key = normalize(item.relativePath || item.path || `${item.title}:${item.snippet}`)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}
