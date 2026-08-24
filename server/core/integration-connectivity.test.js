import test from 'node:test'
import assert from 'node:assert/strict'
import { assertIntegrationApiUrlAllowed, buildRemoteInstanceUrl, normalizeHttpUrl, testChannelConnection, testRemoteInstanceConnection } from './integration-connectivity.js'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

test('rejects unsafe remote URL forms', () => {
  assert.throws(() => normalizeHttpUrl('file:///etc/passwd'), /HTTP/)
  assert.throws(() => normalizeHttpUrl('https://user:password@example.com'), /账号或密码/)
  assert.equal(buildRemoteInstanceUrl({ host: 'runtime.example.com', port: 8443 }), 'https://runtime.example.com:8443')
})

test('pins integration API hosts before sending access tokens', () => {
  assert.equal(assertIntegrationApiUrlAllowed('https://github.com', 'https://api.github.com', 'github'), 'https://api.github.com')
  assert.equal(assertIntegrationApiUrlAllowed('https://git.example.com', 'https://git.example.com/api/v3', 'github'), 'https://git.example.com/api/v3')
  assert.throws(() => assertIntegrationApiUrlAllowed('https://github.com', 'https://attacker.example/api', 'github'), /同一主机/)
})

test('authenticates Feishu without exposing credentials in result', async () => {
  let receivedBody = ''
  const result = await testChannelConnection({ id: 'feishu', appId: 'cli-demo', appSecret: 'secret-value' }, async (_url, options) => {
    receivedBody = options.body
    return jsonResponse({ code: 0, tenant_access_token: 'access-secret' })
  })
  assert.equal(result.success, true)
  assert.match(receivedBody, /secret-value/)
  assert.equal(JSON.stringify(result).includes('secret-value'), false)
  assert.equal(JSON.stringify(result).includes('access-secret'), false)
})

test('checks a remote runtime with bearer authentication', async () => {
  let authorization = ''
  const result = await testRemoteInstanceConnection({ baseUrl: 'https://runtime.example.com', apiToken: 'remote-secret' }, async (_url, options) => {
    authorization = options.headers.Authorization
    return jsonResponse({ status: 'ok', version: '2.1.0' })
  })
  assert.equal(authorization, 'Bearer remote-secret')
  assert.equal(result.success, true)
  assert.equal(result.runtime.version, '2.1.0')
  assert.equal(JSON.stringify(result).includes('remote-secret'), false)
})
