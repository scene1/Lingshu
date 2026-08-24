import test from 'node:test'
import assert from 'node:assert/strict'
import { ApprovalCoordinator } from './approval-coordinator.js'

test('resolves an approval decision exactly once', async () => {
  const coordinator = new ApprovalCoordinator({ timeoutMs: 1000 })
  const pending = coordinator.request({ id: 'approval-1', tool: 'dangerous' })
  assert.equal(coordinator.get('approval-1').tool, 'dangerous')
  assert.equal(coordinator.resolve('approval-1', true), true)
  assert.equal(coordinator.resolve('approval-1', false), false)
  assert.deepEqual(await pending, { id: 'approval-1', approved: true, reason: '' })
})

test('denies approval when the request is aborted', async () => {
  const coordinator = new ApprovalCoordinator({ timeoutMs: 1000 })
  const controller = new AbortController()
  const pending = coordinator.request({ id: 'approval-2' }, { signal: controller.signal })
  controller.abort()
  assert.equal((await pending).approved, false)
  assert.equal(coordinator.get('approval-2'), null)
})
