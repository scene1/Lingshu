import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EvalReportStore } from './eval-report-store.js'

test('stores baseline reports and builds model trends', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-eval-'))
  const store = new EvalReportStore(path.join(dir, 'reports.json'))
  const first = store.add({ model: 'deepseek/test', results: [
    { id: 'a', category: 'quality', prompt: 'p', output: 'o', passed: true, score: 0.9, durationMs: 100 },
    { id: 'b', category: 'quality', passed: false, score: 0.4, durationMs: 300 },
  ] })
  store.add({ model: 'deepseek/test', results: [{ id: 'a', category: 'quality', passed: true, score: 1 }] })
  const summary = store.summary()
  assert.equal(summary.totalRuns, 2)
  assert.equal(summary.latest.summary.passRate, 1)
  assert.equal(summary.trend.length, 2)
  assert.equal(store.compare().models.length, 1)
  assert.equal(summary.reports[1].summary.averageDurationMs, 200)
  const reviewed = store.applyModelReviews(first.id, [{ id: 'a', score: 0.8, verdict: 'pass' }], { model: 'judge/model' })
  assert.equal(reviewed.summary.semanticSamples, 1)
  assert.equal(reviewed.reviewer.model, 'judge/model')
  store.applyHumanLabel(first.id, 'b', { score: 0.2, verdict: 'fail' })
  assert.equal(store.get(first.id).summary.semanticSamples, 2)
  assert.equal(store.compareCategories().length, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})
