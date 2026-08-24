import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ConversationMemoryStore, buildConversationMemoryContext, extractMemoryCandidates } from './conversation-memory.js'

test('extracts explicit memory types but skips secrets', () => {
  const items = extractMemoryCandidates('我偏好简洁回答。我们决定保留现有前端。我的 API Key 是 sk-1234567890abcdef。')
  assert.deepEqual(items.map(item => item.type), ['preference', 'decision'])
  assert.equal(items.every(item => item.confirmedByUser), true)
})

test('stores, deduplicates, retrieves and archives conversation memories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-memory-'))
  const store = new ConversationMemoryStore(path.join(dir, 'memory.json'))
  const first = store.ingest('项目叫灵枢。以后请用简洁回答。', { sessionId: 's1', messageId: 'm1' })
  assert.equal(first.added.length, 2)
  const second = store.ingest('项目叫灵枢。', { sessionId: 's2', messageId: 'm2' })
  assert.equal(second.updated.length, 1)
  const matches = store.query('灵枢项目需要怎么回复')
  assert.ok(matches.some(item => item.type === 'fact'))
  assert.ok(matches.some(item => item.type === 'preference'))
  assert.match(buildConversationMemoryContext(matches), /跨会话长期记忆/)
  assert.ok(store.update(matches[0].id, { status: 'archived' }))
  assert.equal(store.query('灵枢项目').some(item => item.id === matches[0].id), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('keeps ambiguous conflicts pending and resolves them without silent overwrite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-memory-conflict-'))
  const store = new ConversationMemoryStore(path.join(dir, 'memory.json'))
  const original = store.ingest('当前后端端口是 3005。').added[0]
  const candidate = store.ingest('当前后端端口是 3006。').added[0]
  assert.equal(candidate.status, 'candidate')
  assert.deepEqual(candidate.conflictWith, [original.id])
  assert.equal(store.query('后端端口').some(item => item.id === original.id), true)
  const accepted = store.resolveConflict(candidate.id, 'accept_new')
  assert.equal(accepted.status, 'active')
  assert.equal(store.list({ status: 'superseded' })[0].id, original.id)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('supports explicit correction, user correction and expiration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-memory-correction-'))
  const store = new ConversationMemoryStore(path.join(dir, 'memory.json'))
  const original = store.ingest('当前后端端口是 3005。').added[0]
  const corrected = store.ingest('当前后端端口改为 3007。').added[0]
  assert.equal(corrected.status, 'active')
  assert.deepEqual(corrected.supersedes, [original.id])
  const manual = store.correct(corrected.id, '当前后端端口是 3008。')
  assert.equal(manual.status, 'active')
  store.update(manual.id, { expiresAt: '2020-01-01T00:00:00.000Z' })
  assert.equal(store.list({ status: 'expired' })[0].id, manual.id)
  assert.equal(store.query('后端端口').length, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})
