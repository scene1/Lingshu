import test from 'node:test'
import assert from 'node:assert/strict'
import { baselineCases, baselineMetadata } from './baseline-cases.js'

test('conversation quality baseline contains 60 valid, unique cases', () => {
  assert.equal(baselineCases.length, baselineMetadata.expectedCaseCount)
  assert.equal(new Set(baselineCases.map(item => item.id)).size, baselineCases.length)
  assert.ok(new Set(baselineCases.map(item => item.category)).size >= 8)
  for (const item of baselineCases) {
    assert.ok(item.id && item.category && item.prompt && item.rubric)
    assert.ok(item.checks.minChars >= 1)
    assert.ok(item.checks.maxChars > item.checks.minChars)
  }
})

test('critical factual and approval suites have enough coverage', () => {
  for (const category of baselineMetadata.criticalCategories) {
    assert.ok(baselineCases.filter(item => item.category === category).length >= 6)
  }
})
