function clamp01(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0
}

export function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]) || 0
    const b = Number(right[index]) || 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

export function knowledgeCandidateText(item = {}) {
  return [
    item.title || item.documentName,
    item.relativePath || item.path || item.chapter,
    Array.isArray(item.tags) ? item.tags.join(' ') : item.tags,
    Array.isArray(item.headings) ? item.headings.join(' ') : item.headings,
    item.snippet || item.plain || item.content,
  ].filter(Boolean).join('\n').slice(0, 6000)
}

export async function hybridSemanticRank(results, query, options = {}) {
  const candidates = (Array.isArray(results) ? results : []).slice(0, Math.max(1, Number(options.candidateLimit || 80)))
  if (candidates.length === 0) return { results: [], diagnostics: { embedding: 'skipped', reranker: 'skipped' } }

  let embeddingStatus = 'disabled'
  let rerankerStatus = 'disabled'
  let ranked = candidates.map(item => ({ ...item, lexicalRelevance: clamp01(item.relevance ?? item.lexicalRelevance ?? 0) }))

  if (typeof options.embedTexts === 'function') {
    try {
      const vectors = await options.embedTexts([String(query || ''), ...ranked.map(knowledgeCandidateText)])
      const queryVector = vectors?.[0]
      if (!Array.isArray(queryVector)) throw new Error('embedding 响应缺少查询向量')
      ranked = ranked.map((item, index) => {
        const cosine = cosineSimilarity(queryVector, vectors[index + 1])
        const embeddingRelevance = clamp01((cosine + 1) / 2)
        const relevance = clamp01(item.lexicalRelevance * 0.38 + embeddingRelevance * 0.62)
        return { ...item, embeddingRelevance, relevance }
      })
      embeddingStatus = 'ok'
    } catch (error) {
      embeddingStatus = `degraded:${String(error?.message || error).slice(0, 120)}`
    }
  }

  ranked.sort((a, b) => Number(b.relevance || 0) - Number(a.relevance || 0) || Number(b.score || 0) - Number(a.score || 0))
  const rerankPool = ranked.slice(0, Math.max(1, Number(options.rerankLimit || 16)))
  if (typeof options.crossEncode === 'function' && rerankPool.length > 1) {
    try {
      const scores = await options.crossEncode(String(query || ''), rerankPool.map(knowledgeCandidateText))
      rerankPool.forEach((item, index) => {
        item.crossEncoderRelevance = clamp01(scores?.[index])
        item.relevance = clamp01(Number(item.relevance || 0) * 0.35 + item.crossEncoderRelevance * 0.65)
      })
      rerankerStatus = 'ok'
    } catch (error) {
      rerankerStatus = `degraded:${String(error?.message || error).slice(0, 120)}`
    }
  }

  ranked.sort((a, b) => Number(b.relevance || 0) - Number(a.relevance || 0) || Number(b.score || 0) - Number(a.score || 0))
  const minimumRelevance = clamp01(options.minimumRelevance ?? 0.34)
  const limit = Math.max(1, Number(options.limit || 5))
  return {
    results: ranked.filter(item => Number(item.relevance || 0) >= minimumRelevance).slice(0, limit),
    diagnostics: { embedding: embeddingStatus, reranker: rerankerStatus, candidates: candidates.length },
  }
}
