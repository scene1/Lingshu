import test from 'node:test'
import assert from 'node:assert/strict'
import { compactEvaluationReport } from './report-payload.js'

test('compacts evaluation output while preserving the head and failure evidence tail', () => {
  const output = `${'a'.repeat(1200)}tool_calls`
  const report = compactEvaluationReport({ results: [{ id: 'quality-1', prompt: 'prompt', output }] })
  assert.equal(report.results[0].outputTruncated, true)
  assert.ok(report.results[0].output.length < output.length)
  assert.match(report.results[0].output, /^a+/)
  assert.match(report.results[0].output, /tool_calls$/)
})
