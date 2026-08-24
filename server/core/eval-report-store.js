import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function clampScore(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(0, Math.min(1, number))
}

function summarizeResults(results = []) {
  const total = results.length
  const passed = results.filter(item => item.passed).length
  const numericScores = results.map(item => item.score).filter(value => value !== null)
  const semanticScores = results.map(item => item.humanScore ?? item.semanticScore).filter(value => value !== null && value !== undefined)
  const durations = results.map(item => item.durationMs).filter(Number.isFinite)
  return {
    total,
    passed,
    failed: Math.max(0, total - passed),
    passRate: total > 0 ? passed / total : 0,
    averageScore: numericScores.length ? numericScores.reduce((sum, item) => sum + item, 0) / numericScores.length : null,
    semanticScore: semanticScores.length ? semanticScores.reduce((sum, item) => sum + item, 0) / semanticScores.length : null,
    semanticSamples: semanticScores.length,
    averageDurationMs: durations.length ? Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length) : null,
  }
}

function summarizeCategories(results = []) {
  const categoryMap = new Map()
  for (const result of results) {
    if (!result.category) continue
    const current = categoryMap.get(result.category) || { category: result.category, results: [] }
    current.results.push(result)
    categoryMap.set(result.category, current)
  }
  return [...categoryMap.values()].map(item => ({ category: item.category, ...summarizeResults(item.results) }))
}

export class EvalReportStore {
  constructor(filePath) {
    this.filePath = filePath
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      return { reports: Array.isArray(data.reports) ? data.reports : [] }
    } catch (_) {
      return { reports: [] }
    }
  }

  add(input = {}) {
    const model = String(input.model || '').slice(0, 160)
    const results = Array.isArray(input.results) ? input.results.slice(0, 200).map(item => ({
      id: String(item.id || ''),
      category: String(item.category || ''),
      prompt: String(item.prompt || '').slice(0, 6000),
      rubric: String(item.rubric || '').slice(0, 3000),
      output: String(item.output || '').slice(0, 12000),
      passed: item.passed === true,
      score: clampScore(item.score),
      semanticScore: clampScore(item.semanticScore),
      humanScore: clampScore(item.humanScore),
      grader: String(item.grader || '').slice(0, 100),
      durationMs: Number.isFinite(Number(item.durationMs)) ? Number(item.durationMs) : undefined,
      failures: Array.isArray(item.failures) ? item.failures.map(String).slice(0, 8) : [],
    })) : []
    const computedSummary = summarizeResults(results)
    const report = {
      id: `eval_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      model,
      provider: String(input.provider || (model.includes('/') ? model.split('/')[0] : '')).slice(0, 80),
      baselineVersion: Number(input.baselineVersion || 1),
      source: String(input.source || 'conversation-baseline').slice(0, 100),
      policyId: String(input.policyId || '').slice(0, 160),
      summary: { ...computedSummary, ...(input.summary || {}), ...computedSummary },
      categories: summarizeCategories(results),
      results,
      reviewer: input.reviewer || null,
      createdAt: input.generatedAt || new Date().toISOString(),
    }
    const data = this.load()
    data.reports.unshift(report)
    data.reports = data.reports.slice(0, 200)
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify({ reports: data.reports, updatedAt: new Date().toISOString() }, null, 2))
    return report
  }

  summary(limit = 30) {
    const reports = this.load().reports.slice(0, Math.min(Math.max(Number(limit) || 30, 1), 200))
    const latestByModel = new Map()
    for (const report of reports) if (!latestByModel.has(report.model)) latestByModel.set(report.model, report)
    return {
      totalRuns: reports.length,
      latest: reports[0] || null,
      latestByModel: [...latestByModel.values()],
      trend: [...reports].reverse().map(report => ({
        id: report.id,
        model: report.model,
        passRate: report.summary?.passRate || 0,
        averageScore: report.summary?.averageScore ?? null,
        total: report.summary?.total || 0,
        averageDurationMs: report.summary?.averageDurationMs ?? null,
        createdAt: report.createdAt,
      })),
      reports,
    }
  }

  compare(limit = 30) {
    const reports = this.summary(limit).reports
    const latestByModel = new Map()
    for (const report of reports) if (!latestByModel.has(report.model)) latestByModel.set(report.model, report)
    const models = [...latestByModel.values()].map(report => ({
      reportId: report.id,
      model: report.model,
      provider: report.provider,
      total: report.summary?.total || 0,
      passRate: report.summary?.passRate || 0,
      averageScore: report.summary?.averageScore ?? null,
      averageDurationMs: report.summary?.averageDurationMs ?? null,
      createdAt: report.createdAt,
    })).sort((a, b) => b.passRate - a.passRate || Number(b.averageScore || 0) - Number(a.averageScore || 0))
    const leader = models[0] || null
    return {
      leader,
      models: models.map(item => ({
        ...item,
        passRateDelta: leader ? item.passRate - leader.passRate : 0,
        scoreDelta: leader && item.averageScore !== null && leader.averageScore !== null ? item.averageScore - leader.averageScore : null,
      })),
    }
  }

  get(id) {
    return this.load().reports.find(report => report.id === id) || null
  }

  updateReport(id, updater) {
    const data = this.load()
    const index = data.reports.findIndex(report => report.id === id)
    if (index < 0) return null
    const report = data.reports[index]
    const next = updater(report) || report
    next.summary = summarizeResults(next.results || [])
    next.categories = summarizeCategories(next.results || [])
    next.updatedAt = new Date().toISOString()
    data.reports[index] = next
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp-${process.pid}`
    fs.writeFileSync(tempPath, JSON.stringify({ reports: data.reports.slice(0, 200), updatedAt: next.updatedAt }, null, 2))
    fs.renameSync(tempPath, this.filePath)
    return next
  }

  applyModelReviews(id, reviews = [], reviewer = {}) {
    const reviewMap = new Map(reviews.map(item => [String(item.id || item.resultId || ''), item]))
    return this.updateReport(id, report => {
      report.results = (report.results || []).map(result => {
        const review = reviewMap.get(result.id)
        if (!review) return result
        return {
          ...result,
          semanticScore: clampScore(review.score),
          semanticVerdict: ['pass', 'fail', 'uncertain'].includes(review.verdict) ? review.verdict : undefined,
          semanticReasons: Array.isArray(review.reasons) ? review.reasons.map(String).slice(0, 6) : [],
        }
      })
      report.reviewer = {
        type: 'independent-model',
        model: String(reviewer.model || '').slice(0, 160),
        reviewedAt: new Date().toISOString(),
        reviewed: reviews.length,
      }
      return report
    })
  }

  applyHumanLabel(reportId, resultId, label = {}) {
    return this.updateReport(reportId, report => {
      report.results = (report.results || []).map(result => result.id === resultId
        ? { ...result, humanScore: clampScore(label.score), humanVerdict: label.verdict, humanComment: String(label.comment || '').slice(0, 1000) }
        : result)
      return report
    })
  }

  compareCategories(limit = 100) {
    const reports = this.summary(limit).reports
    const latestByModel = new Map()
    for (const report of reports) if (!latestByModel.has(report.model)) latestByModel.set(report.model, report)
    const categories = new Map()
    for (const report of latestByModel.values()) {
      for (const category of report.categories || []) {
        const values = categories.get(category.category) || []
        values.push({
          model: report.model,
          reportId: report.id,
          total: category.total,
          passRate: category.passRate,
          averageScore: category.averageScore,
          semanticScore: category.semanticScore,
          semanticSamples: category.semanticSamples,
        })
        categories.set(category.category, values)
      }
    }
    return [...categories.entries()].map(([category, values]) => {
      const leader = [...values].sort((a, b) => Number(b.semanticScore ?? b.averageScore ?? b.passRate) - Number(a.semanticScore ?? a.averageScore ?? a.passRate))[0] || null
      return { category, leader, values: values.map(item => ({ ...item, delta: leader ? Number(item.semanticScore ?? item.averageScore ?? item.passRate) - Number(leader.semanticScore ?? leader.averageScore ?? leader.passRate) : 0 })) }
    }).sort((a, b) => a.category.localeCompare(b.category))
  }
}
