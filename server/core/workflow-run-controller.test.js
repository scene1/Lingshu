import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkflowRunController } from './workflow-run-controller.js'

const workflow = { id: 'wf-test', name: '测试工作流' }

test('controls pause, resume, skip and cancel without exposing internals', async () => {
  const controller = new WorkflowRunController()
  const created = controller.create(workflow)
  controller.start(created.id)
  controller.pause(created.id)
  let resumed = false
  const waiting = controller.waitIfPaused(created.id).then(() => { resumed = true })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(resumed, false)
  controller.skip(created.id, 'node-2')
  assert.equal(controller.shouldSkip(created.id, 'node-2'), true)
  controller.resume(created.id)
  await waiting
  assert.equal(resumed, true)
  const canceled = controller.cancel(created.id)
  assert.equal(canceled.status, 'canceled')
  assert.equal('controller' in canceled, false)
  assert.throws(() => controller.resume(created.id), /已经结束/)
})

test('records node results and terminal outcome', () => {
  const controller = new WorkflowRunController()
  const created = controller.create(workflow)
  controller.start(created.id)
  controller.nodeStarted(created.id, { id: 'node-1' })
  controller.nodeCompleted(created.id, { nodeId: 'node-1', status: 'completed' })
  const completed = controller.complete(created.id, { success: true, results: [{ nodeId: 'node-1', status: 'completed' }] })
  assert.equal(completed.status, 'completed')
  assert.equal(completed.results.length, 1)
  assert.equal(controller.list({ workflowId: 'wf-test' }).length, 1)
})

test('finds only active runs for a workflow', () => {
  const controller = new WorkflowRunController()
  const created = controller.create(workflow)
  assert.equal(controller.activeForWorkflow(workflow.id)?.id, created.id)
  controller.start(created.id)
  controller.complete(created.id, { success: true, results: [] })
  assert.equal(controller.activeForWorkflow(workflow.id), null)
})
