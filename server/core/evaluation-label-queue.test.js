import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EvaluationLabelQueue } from './evaluation-label-queue.js'

test('queues uncertain evaluation results and records human labels', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-labels-'))
  const queue = new EvaluationLabelQueue(path.join(dir, 'labels.json'))
  const added = queue.enqueueReport({ id: 'r1', policyId: 'p1', results: [
    { id: 'a', category: 'quality', passed: true, semanticScore: 0.9 },
    { id: 'b', category: 'safety', passed: false, semanticScore: 0.4, output: 'bad' },
  ] })
  assert.equal(added.length, 1)
  const labeled = queue.label(added[0].id, { score: 0.2, verdict: 'fail', reviewer: 'tester' })
  assert.equal(labeled.status, 'labeled')
  assert.equal(queue.list().summary.pending, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})
