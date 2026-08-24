import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function normalizeItem(item = {}) {
  return {
    id: String(item.id || ''),
    reportId: String(item.reportId || ''),
    resultId: String(item.resultId || ''),
    policyId: String(item.policyId || ''),
    category: String(item.category || 'uncategorized').slice(0, 100),
    prompt: String(item.prompt || '').slice(0, 6000),
    output: String(item.output || '').slice(0, 12000),
    rubric: String(item.rubric || '').slice(0, 3000),
    status: item.status === 'labeled' ? 'labeled' : 'pending',
    priority: ['high', 'normal', 'low'].includes(item.priority) ? item.priority : 'normal',
    modelScore: item.modelScore !== null && item.modelScore !== undefined && Number.isFinite(Number(item.modelScore))
      ? Math.max(0, Math.min(1, Number(item.modelScore)))
      : null,
    label: item.label && typeof item.label === 'object' ? item.label : null,
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
  }
}

export class EvaluationLabelQueue {
  constructor(filePath) {
    this.filePath = filePath
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      return { items: Array.isArray(data.items) ? data.items.map(normalizeItem) : [] }
    } catch (_) {
      return { items: [] }
    }
  }

  save(data) {
    const next = { items: data.items.map(normalizeItem).slice(0, 3000), updatedAt: new Date().toISOString() }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp-${process.pid}`
    fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), { mode: 0o600 })
    fs.renameSync(tempPath, this.filePath)
    return next
  }

  enqueueReport(report, options = {}) {
    if (!report?.id) return []
    const data = this.load()
    const existing = new Set(data.items.map(item => `${item.reportId}:${item.resultId}`))
    const added = []
    for (const result of Array.isArray(report.results) ? report.results : []) {
      const key = `${report.id}:${result.id}`
      if (existing.has(key)) continue
      const uncertain = result.semanticScore === null || result.semanticScore === undefined
        || Number(result.semanticScore) < Number(options.scoreThreshold ?? 0.75)
        || result.passed === false
      if (options.all !== true && !uncertain) continue
      const item = normalizeItem({
        id: `label_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        reportId: report.id,
        resultId: result.id,
        policyId: report.policyId,
        category: result.category,
        prompt: result.prompt,
        output: result.output,
        rubric: result.rubric,
        modelScore: result.semanticScore,
        priority: result.passed === false || (result.semanticScore !== null && result.semanticScore !== undefined && Number(result.semanticScore) < 0.5) ? 'high' : 'normal',
      })
      data.items.unshift(item)
      added.push(item)
    }
    this.save(data)
    return added
  }

  list(options = {}) {
    const status = String(options.status || '')
    const category = String(options.category || '')
    const limit = Math.max(1, Math.min(500, Number(options.limit || 100)))
    const items = this.load().items.filter(item => (!status || item.status === status) && (!category || item.category === category)).slice(0, limit)
    const all = this.load().items
    return {
      items,
      summary: {
        total: all.length,
        pending: all.filter(item => item.status === 'pending').length,
        labeled: all.filter(item => item.status === 'labeled').length,
        byCategory: all.reduce((acc, item) => ({ ...acc, [item.category]: (acc[item.category] || 0) + 1 }), {}),
      },
    }
  }

  label(id, input = {}) {
    const data = this.load()
    const item = data.items.find(entry => entry.id === id)
    if (!item) return null
    const score = Math.max(0, Math.min(1, Number(input.score)))
    if (!Number.isFinite(score)) throw new Error('人工评分必须是 0 到 1')
    item.status = 'labeled'
    item.label = {
      score,
      verdict: ['pass', 'fail', 'uncertain'].includes(input.verdict) ? input.verdict : score >= 0.7 ? 'pass' : 'fail',
      tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 12) : [],
      comment: String(input.comment || '').slice(0, 1000),
      reviewer: String(input.reviewer || 'local-human').slice(0, 120),
      labeledAt: new Date().toISOString(),
    }
    item.updatedAt = item.label.labeledAt
    this.save(data)
    return item
  }
}
