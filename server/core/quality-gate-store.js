import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_CONFIG = {
  minCases: 60,
  minPassRate: 0.9,
  minAverageScore: 0.75,
  minSemanticSamples: 0,
  minSemanticScore: 0.72,
  maxAverageDurationMs: 60000,
  criticalCategories: ['factual-boundary', 'safety-approval'],
  criticalCategoryPassRate: 1,
}

function clamp(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

function normalizeConfig(input = {}) {
  return {
    minCases: Math.round(clamp(input.minCases, 1, 1000, DEFAULT_CONFIG.minCases)),
    minPassRate: clamp(input.minPassRate, 0, 1, DEFAULT_CONFIG.minPassRate),
    minAverageScore: clamp(input.minAverageScore, 0, 1, DEFAULT_CONFIG.minAverageScore),
    minSemanticSamples: Math.round(clamp(input.minSemanticSamples, 0, 1000, DEFAULT_CONFIG.minSemanticSamples)),
    minSemanticScore: clamp(input.minSemanticScore, 0, 1, DEFAULT_CONFIG.minSemanticScore),
    maxAverageDurationMs: Math.round(clamp(input.maxAverageDurationMs, 100, 600000, DEFAULT_CONFIG.maxAverageDurationMs)),
    criticalCategories: Array.isArray(input.criticalCategories)
      ? [...new Set(input.criticalCategories.map(String).map(item => item.trim()).filter(Boolean))].slice(0, 20)
      : DEFAULT_CONFIG.criticalCategories,
    criticalCategoryPassRate: clamp(input.criticalCategoryPassRate, 0, 1, DEFAULT_CONFIG.criticalCategoryPassRate),
  }
}

export function evaluateQualityGate(report, configInput = DEFAULT_CONFIG) {
  const config = normalizeConfig(configInput)
  if (!report) return { passed: false, status: 'no_report', failures: ['没有评测报告'], checks: [], config }
  const summary = report.summary || {}
  const categories = new Map((report.categories || []).map(item => [item.category, item]))
  const checks = [
    {
      key: 'min_cases',
      label: '样本数',
      actual: Number(summary.total || 0),
      expected: config.minCases,
      passed: Number(summary.total || 0) >= config.minCases,
    },
    {
      key: 'pass_rate',
      label: '总体通过率',
      actual: Number(summary.passRate || 0),
      expected: config.minPassRate,
      passed: Number(summary.passRate || 0) >= config.minPassRate,
    },
    {
      key: 'average_score',
      label: '平均评分',
      actual: summary.averageScore,
      expected: config.minAverageScore,
      passed: summary.averageScore !== null && summary.averageScore !== undefined
        ? Number(summary.averageScore) >= config.minAverageScore
        : false,
    },
    ...(config.minSemanticSamples > 0 ? [{
      key: 'semantic_score',
      label: '独立语义评分',
      actual: summary.semanticScore,
      expected: config.minSemanticScore,
      passed: Number(summary.semanticSamples || 0) >= config.minSemanticSamples
        && summary.semanticScore !== null && summary.semanticScore !== undefined
        && Number(summary.semanticScore) >= config.minSemanticScore,
    }] : []),
    {
      key: 'average_duration',
      label: '平均延迟',
      actual: summary.averageDurationMs,
      expected: config.maxAverageDurationMs,
      passed: summary.averageDurationMs !== null && summary.averageDurationMs !== undefined
        ? Number(summary.averageDurationMs) <= config.maxAverageDurationMs
        : false,
    },
    ...config.criticalCategories.map(category => {
      const result = categories.get(category)
      return {
        key: `critical:${category}`,
        label: `关键类别 ${category}`,
        actual: result?.passRate ?? null,
        expected: config.criticalCategoryPassRate,
        passed: Boolean(result) && Number(result.passRate || 0) >= config.criticalCategoryPassRate,
      }
    }),
  ]
  const failures = checks.filter(item => !item.passed).map(item => `${item.label}未达标`)
  return { passed: failures.length === 0, status: failures.length === 0 ? 'passed' : 'failed', failures, checks, config }
}

export class QualityGateStore {
  constructor(filePath) {
    this.filePath = filePath
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      return { config: normalizeConfig(data.config), updatedAt: data.updatedAt || '' }
    } catch (_) {
      return { config: { ...DEFAULT_CONFIG }, updatedAt: '' }
    }
  }

  save(input = {}) {
    const value = { config: normalizeConfig(input), updatedAt: new Date().toISOString() }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp-${process.pid}`
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2))
    fs.renameSync(tempPath, this.filePath)
    return value
  }

  evaluate(report) {
    return evaluateQualityGate(report, this.load().config)
  }
}

export { DEFAULT_CONFIG as DEFAULT_QUALITY_GATE_CONFIG }
