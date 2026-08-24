import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolRateLimiter, normalizeToolGovernance, resolveToolPolicy } from './tool-governance.js'

test('never permanently allows high risk tools', () => {
  const governance = normalizeToolGovernance({ approvalPolicies: { highRisk: 'allow' } })
  assert.equal(governance.approvalPolicies.highRisk, 'always_ask')
  assert.equal(resolveToolPolicy(governance, { name: 'skill_shell', highRisk: true }).requiresApproval, true)
})

test('rate limits each tool session bucket independently', () => {
  const limiter = new ToolRateLimiter()
  const policy = { limit: 2, windowMs: 1000 }
  assert.equal(limiter.check('s1:tool', policy, 0).allowed, true)
  assert.equal(limiter.check('s1:tool', policy, 100).allowed, true)
  assert.equal(limiter.check('s1:tool', policy, 200).allowed, false)
  assert.equal(limiter.check('s2:tool', policy, 200).allowed, true)
  assert.equal(limiter.check('s1:tool', policy, 1200).allowed, true)
})
