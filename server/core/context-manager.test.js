import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContextWindow, estimateTokenCount } from './context-manager.js'

test('estimates CJK and latin token usage conservatively', () => {
  assert.ok(estimateTokenCount('这是中文测试') >= 6)
  assert.ok(estimateTokenCount('abcdefghijklmnop') >= 4)
})

test('keeps system and recent messages within the input budget', () => {
  const messages = [
    { role: 'system', content: 'system rules' },
    ...Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index} ${'内容'.repeat(120)}`,
    })),
  ]
  const result = buildContextWindow(messages, {
    maxInputTokens: 2200,
    reserveOutputTokens: 400,
    minRecentMessages: 4,
  })
  assert.equal(result.messages[0].role, 'system')
  assert.equal(result.messages.at(-1).content.includes('message-29'), true)
  assert.ok(result.metrics.estimatedInputTokens <= result.metrics.budgetTokens)
  assert.ok(result.metrics.omittedMessages > 0)
  assert.equal(result.metrics.summaryCreated, true)
})
