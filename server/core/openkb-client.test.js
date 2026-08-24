import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configureOpenKBStorage, diagnoseOpenKB, getOpenKBConfig, getOpenKBObservability, queryOpenKB, resetOpenKBObservability, saveOpenKBConfig } from './openkb-client.js'

test('caches OpenKB answers and exposes source observability', async () => {
  const originalFetch = globalThis.fetch
  const originalEnabled = process.env.LINGSHU_OPENKB_ENABLED
  process.env.LINGSHU_OPENKB_ENABLED = '1'
  resetOpenKBObservability()
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return new Response(JSON.stringify({ answer: '结果', sources: [{ title: '文档 A', content: '依据' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const first = await queryOpenKB('P1 缓存测试')
    const second = await queryOpenKB('P1 缓存测试')
    assert.equal(first.sources[0].title, '文档 A')
    assert.equal(second.cacheHit, true)
    assert.equal(calls, 1)
    assert.equal(getOpenKBObservability().cacheHits, 1)
  } finally {
    globalThis.fetch = originalFetch
    if (originalEnabled === undefined) delete process.env.LINGSHU_OPENKB_ENABLED
    else process.env.LINGSHU_OPENKB_ENABLED = originalEnabled
    resetOpenKBObservability()
  }
})

test('persists local-only OpenKB settings and diagnoses the sidecar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-openkb-'))
  const originalFetch = globalThis.fetch
  const originalEnabled = process.env.LINGSHU_OPENKB_ENABLED
  delete process.env.LINGSHU_OPENKB_ENABLED
  await configureOpenKBStorage(path.join(dir, 'openkb.json'))
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).endsWith('/meta')
    ? { version: 'test' }
    : [{ name: 'lingshu' }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    const saved = saveOpenKBConfig({ enabled: true, baseUrl: 'http://127.0.0.1:7566', kb: 'lingshu', token: 'secret' })
    assert.equal(saved.authConfigured, true)
    assert.equal(getOpenKBConfig().token, undefined)
    const diagnosis = await diagnoseOpenKB()
    assert.equal(diagnosis.connected, true)
    assert.equal(diagnosis.diagnostics.knowledgeBaseFound, true)
    assert.throws(() => saveOpenKBConfig({ enabled: true, baseUrl: 'http://10.0.0.1:7566', kb: 'lingshu' }), /回环地址/)
  } finally {
    globalThis.fetch = originalFetch
    if (originalEnabled === undefined) delete process.env.LINGSHU_OPENKB_ENABLED
    else process.env.LINGSHU_OPENKB_ENABLED = originalEnabled
    await configureOpenKBStorage('')
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('falls back to stale OpenKB cache when upstream fails', async () => {
  const originalFetch = globalThis.fetch
  const originalEnabled = process.env.LINGSHU_OPENKB_ENABLED
  process.env.LINGSHU_OPENKB_ENABLED = '1'
  resetOpenKBObservability()
  let fail = false
  globalThis.fetch = async () => {
    if (fail) throw new Error('offline')
    return new Response(JSON.stringify({ answer: '缓存答案' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    await queryOpenKB('降级测试')
    fail = true
    const cached = await queryOpenKB('降级测试', { cacheBypass: true })
    assert.equal(cached.answer, '缓存答案')
  } finally {
    globalThis.fetch = originalFetch
    if (originalEnabled === undefined) delete process.env.LINGSHU_OPENKB_ENABLED
    else process.env.LINGSHU_OPENKB_ENABLED = originalEnabled
    resetOpenKBObservability()
  }
})
