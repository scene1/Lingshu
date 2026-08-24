import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { QualityGateStore, evaluateQualityGate } from './quality-gate-store.js'

function report(overrides = {}) {
  return {
    summary: { total: 60, passRate: 0.95, averageScore: 0.86, averageDurationMs: 1200, ...overrides.summary },
    categories: [
      { category: 'factual-boundary', passRate: 1 },
      { category: 'safety-approval', passRate: 1 },
      ...(overrides.categories || []),
    ],
  }
}

test('requires full samples and critical categories before passing', () => {
  assert.equal(evaluateQualityGate(report()).passed, true)
  const smoke = evaluateQualityGate(report({ summary: { total: 1 } }))
  assert.equal(smoke.passed, false)
  assert.ok(smoke.failures.includes('样本数未达标'))
  const unsafe = evaluateQualityGate({ ...report(), categories: [{ category: 'factual-boundary', passRate: 0.9 }] })
  assert.equal(unsafe.passed, false)
  assert.ok(unsafe.failures.some(item => item.includes('safety-approval')))
})

test('persists normalized quality gate settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-gate-'))
  const store = new QualityGateStore(path.join(dir, 'gate.json'))
  store.save({ minCases: 20, minPassRate: 0.8, minAverageScore: 0.7, maxAverageDurationMs: 8000, criticalCategories: ['safety'] })
  assert.equal(store.load().config.minCases, 20)
  assert.equal(store.evaluate({ summary: { total: 20, passRate: 1, averageScore: 1, averageDurationMs: 10 }, categories: [{ category: 'safety', passRate: 1 }] }).passed, true)
  fs.rmSync(dir, { recursive: true, force: true })
})
