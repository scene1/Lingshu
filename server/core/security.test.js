import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatRequestCoordinator, normalizeChatRequestBody } from './conversation-guard.js'
import { isHighRiskPermission, maskSensitiveValue, mergePreservingMaskedSecrets, redactSensitiveValue, sanitizePublicError } from './security.js'
import { assertOpenAPIServerOverrideAllowed } from './tool-registry.js'
import { AutomationEngine } from './automation-engine.js'
import { decryptProjectSecret, encryptProjectSecret, summarizeProject } from './projects.js'
import { validateWorkflowDefinition } from './workflow-guard.js'

test('detects object-based high risk permissions', () => {
  assert.equal(isHighRiskPermission({ key: 'network', level: 'high' }), true)
  assert.equal(isHighRiskPermission({ key: 'read', level: 'medium' }), false)
})

test('redacts nested secrets, headers, URLs and bearer tokens', () => {
  const value = redactSensitiveValue({
    headers: { Authorization: 'Bearer abc.def.ghi', 'Set-Cookie': 'sid=secret' },
    nested: {
      apiKey: 'sk-secret-value',
      appSecret: 'app-secret-value',
      reportAuthToken: 'report-token-value',
      maxTokens: 4000,
      url: 'https://user:pass@example.com/a?sig=secret',
    },
  })
  assert.equal(value.headers.Authorization, '[REDACTED]')
  assert.equal(value.headers['Set-Cookie'], '[REDACTED]')
  assert.equal(value.nested.apiKey, '[REDACTED]')
  assert.equal(value.nested.appSecret, '[REDACTED]')
  assert.equal(value.nested.reportAuthToken, '[REDACTED]')
  assert.equal(value.nested.maxTokens, 4000)
  assert.equal(value.nested.url.includes('user:pass'), false)
  assert.equal(value.nested.url.includes('sig=secret'), false)
  assert.equal(sanitizePublicError(new Error('Bearer abcdefghijklmnop')), 'Bearer ***')
})

test('preserves an intentionally empty public status message', () => {
  assert.equal(redactSensitiveValue({ message: '' }).message, '')
  assert.equal(redactSensitiveValue({ reason: '' }).reason, '')
})

test('preserves repeated references while still blocking true cycles', () => {
  const shared = { value: 'safe' }
  const repeated = redactSensitiveValue({ first: shared, second: shared })
  assert.deepEqual(repeated, { first: { value: 'safe' }, second: { value: 'safe' } })
  const cyclic = { value: 'safe' }
  cyclic.self = cyclic
  assert.equal(redactSensitiveValue(cyclic).self, '[Circular]')
})

test('masks configuration secrets and preserves them on round trip', () => {
  const existing = { providers: { demo: { apiKey: 'real-secret', baseUrl: 'https://example.com' } } }
  const masked = maskSensitiveValue(existing)
  assert.equal(masked.providers.demo.apiKey, '********')
  const merged = mergePreservingMaskedSecrets(existing, {
    ...masked,
    providers: { demo: { ...masked.providers.demo, baseUrl: 'https://new.example.com' } },
  })
  assert.equal(merged.providers.demo.apiKey, 'real-secret')
  assert.equal(merged.providers.demo.baseUrl, 'https://new.example.com')
})

test('keeps OpenAPI execution pinned to the imported server', () => {
  assert.equal(
    assertOpenAPIServerOverrideAllowed('https://api.example.com', 'https://api.example.com'),
    'https://api.example.com',
  )
  assert.throws(
    () => assertOpenAPIServerOverrideAllowed('https://api.example.com', 'http://127.0.0.1:3005'),
    /不允许覆盖/,
  )
})

test('does not expose sensitive project configuration values', () => {
  const project = summarizeProject({
    id: 'project-1',
    progress: 0,
    linkedRepositories: [],
    linkedDocuments: [],
    linkedMeetings: [],
    linkedSessions: [],
    configItems: [
      { id: 'secret', sensitive: true, value: 'password', notes: 'private note' },
      { id: 'public', sensitive: false, value: 'visible', notes: 'public note' },
    ],
  }, [])
  assert.equal(project.configItems[0].value, '')
  assert.equal(project.configItems[0].notes, '')
  assert.equal(project.configItems[0].hasValue, true)
  assert.equal(project.configItems[1].value, 'visible')
})

test('encrypts sensitive project configuration at rest', () => {
  const key = Buffer.alloc(32, 7)
  const encrypted = encryptProjectSecret('project-password', key)
  assert.match(encrypted, /^enc:v1:/)
  assert.equal(encrypted.includes('project-password'), false)
  assert.equal(decryptProjectSecret(encrypted, key), 'project-password')
})

test('coalesces overlapping automation executions', async () => {
  const engine = new AutomationEngine()
  let executions = 0
  engine.automations = [{
    id: 'automation-1',
    actionType: 'chat',
    prompt: 'hello',
    logs: [],
    retry: { maxRetries: 0 },
  }]
  engine.executeChatFn = async () => {
    executions += 1
    await new Promise(resolve => setTimeout(resolve, 20))
    return 'done'
  }
  engine.saveAutomations = () => {}

  const [first, second] = await Promise.all([
    engine.executeAutomation('automation-1'),
    engine.executeAutomation('automation-1'),
  ])
  assert.equal(executions, 1)
  assert.equal(first.id, second.id)
})

test('rejects blank chat input and coordinates duplicate requests', () => {
  assert.equal(normalizeChatRequestBody({ message: '   ' }).valid, false)
  assert.equal(normalizeChatRequestBody({ message: ' hello ' }).valid, true)
  assert.equal(normalizeChatRequestBody({ message: 'eval', persist: false, evaluationPolicyId: 'policy-v2' }).evaluationPolicyId, 'policy-v2')
  assert.equal(normalizeChatRequestBody({ message: 'chat', persist: true, evaluationPolicyId: 'policy-v2' }).evaluationPolicyId, '')

  const coordinator = new ChatRequestCoordinator({ ttlMs: 1000 })
  const first = coordinator.begin('local:session', 'request-1')
  assert.equal(first.ok, true)
  assert.equal(coordinator.begin('local:session', 'request-1').code, 'DUPLICATE_REQUEST')
  assert.equal(coordinator.begin('local:session', 'request-2').code, 'SESSION_BUSY')
  first.release({ completed: true })
  assert.equal(coordinator.begin('local:session', 'request-1').code, 'DUPLICATE_REQUEST')
  const next = coordinator.begin('local:session', 'request-2')
  assert.equal(next.ok, true)
  next.release()
})

test('rejects cyclic workflows and accepts a valid DAG', () => {
  const cyclic = validateWorkflowDefinition({
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }],
  })
  assert.equal(cyclic.valid, false)
  assert.match(cyclic.errors.join(' '), /循环依赖/)

  const dag = validateWorkflowDefinition({
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [{ source: 'a', target: 'b' }],
  })
  assert.equal(dag.valid, true)
})
