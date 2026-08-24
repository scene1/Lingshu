import crypto from 'crypto'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled'])

class WorkflowRunController {
  constructor({ maxRuns = 200 } = {}) {
    this.maxRuns = maxRuns
    this.runs = new Map()
  }

  create(workflow, options = {}) {
    const id = `wfr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const run = {
      id,
      workflowId: workflow.id,
      workflowName: workflow.name || workflow.id,
      status: 'queued',
      currentNodeId: '',
      results: Array.isArray(options.initialResults) ? [...options.initialResults] : [],
      error: '',
      startedAt: new Date().toISOString(),
      finishedAt: '',
      updatedAt: new Date().toISOString(),
      parentRunId: String(options.parentRunId || ''),
      retryNodeId: String(options.retryNodeId || ''),
      startNodeId: String(options.startNodeId || ''),
      skippedNodeIds: new Set(),
      controller: new AbortController(),
      pauseWaiters: [],
    }
    this.runs.set(id, run)
    this.prune()
    return this.public(run)
  }

  prune() {
    if (this.runs.size <= this.maxRuns) return
    const removable = [...this.runs.values()].filter(run => TERMINAL_STATUSES.has(run.status))
    for (const run of removable.slice(0, Math.max(0, this.runs.size - this.maxRuns))) this.runs.delete(run.id)
  }

  internal(id) {
    return this.runs.get(id) || null
  }

  get(id) {
    const run = this.internal(id)
    return run ? this.public(run) : null
  }

  list({ workflowId = '', limit = 50 } = {}) {
    return [...this.runs.values()]
      .filter(run => !workflowId || run.workflowId === workflowId)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .slice(0, Math.min(Math.max(Number(limit) || 50, 1), 200))
      .map(run => this.public(run))
  }

  activeForWorkflow(workflowId) {
    const run = [...this.runs.values()].find(item => (
      item.workflowId === workflowId && !TERMINAL_STATUSES.has(item.status)
    ))
    return run ? this.public(run) : null
  }

  start(id) {
    const run = this.require(id)
    if (run.status === 'queued') this.update(run, { status: 'running' })
    return this.public(run)
  }

  nodeStarted(id, node) {
    const run = this.require(id)
    this.update(run, { status: run.status === 'paused' ? 'paused' : 'running', currentNodeId: node.id })
  }

  nodeCompleted(id, result) {
    const run = this.require(id)
    const index = run.results.findIndex(item => item.nodeId === result.nodeId)
    if (index >= 0) run.results[index] = result
    else run.results.push(result)
    this.update(run, { currentNodeId: '' })
  }

  pause(id) {
    const run = this.requireActive(id)
    if (run.status === 'running' || run.status === 'queued') this.update(run, { status: 'paused' })
    return this.public(run)
  }

  resume(id) {
    const run = this.requireActive(id)
    if (run.status === 'paused') {
      this.update(run, { status: 'running' })
      const waiters = run.pauseWaiters.splice(0)
      waiters.forEach(resolve => resolve())
    }
    return this.public(run)
  }

  cancel(id) {
    const run = this.requireActive(id)
    run.controller.abort(new Error('工作流已取消'))
    const waiters = run.pauseWaiters.splice(0)
    waiters.forEach(resolve => resolve())
    this.update(run, { status: 'canceled', error: '用户取消运行', currentNodeId: '', finishedAt: new Date().toISOString() })
    return this.public(run)
  }

  skip(id, nodeId) {
    const run = this.requireActive(id)
    const normalized = String(nodeId || '').trim()
    if (!normalized) throw Object.assign(new Error('nodeId 不能为空'), { statusCode: 400 })
    run.skippedNodeIds.add(normalized)
    this.update(run, {})
    return this.public(run)
  }

  shouldSkip(id, nodeId) {
    return this.require(id).skippedNodeIds.has(nodeId)
  }

  async waitIfPaused(id) {
    const run = this.require(id)
    if (run.controller.signal.aborted) throw new DOMException('工作流已取消', 'AbortError')
    if (run.status !== 'paused') return
    await new Promise(resolve => run.pauseWaiters.push(resolve))
    if (run.controller.signal.aborted) throw new DOMException('工作流已取消', 'AbortError')
  }

  complete(id, result) {
    const run = this.require(id)
    if (run.status === 'canceled') return this.public(run)
    this.update(run, {
      status: result.success ? 'completed' : 'failed',
      results: Array.isArray(result.results) ? result.results : run.results,
      error: result.error || '',
      currentNodeId: '',
      finishedAt: new Date().toISOString(),
    })
    return this.public(run)
  }

  fail(id, error) {
    const run = this.require(id)
    if (run.status === 'canceled') return this.public(run)
    this.update(run, { status: 'failed', error: String(error?.message || error || '运行失败'), currentNodeId: '', finishedAt: new Date().toISOString() })
    return this.public(run)
  }

  require(id) {
    const run = this.internal(id)
    if (!run) throw Object.assign(new Error('运行记录不存在'), { statusCode: 404 })
    return run
  }

  requireActive(id) {
    const run = this.require(id)
    if (TERMINAL_STATUSES.has(run.status)) throw Object.assign(new Error('运行已经结束'), { statusCode: 409 })
    return run
  }

  update(run, patch) {
    Object.assign(run, patch, { updatedAt: new Date().toISOString() })
  }

  public(run) {
    return {
      id: run.id,
      workflowId: run.workflowId,
      workflowName: run.workflowName,
      status: run.status,
      currentNodeId: run.currentNodeId,
      results: run.results.map(item => ({ ...item })),
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      updatedAt: run.updatedAt,
      parentRunId: run.parentRunId,
      retryNodeId: run.retryNodeId,
      startNodeId: run.startNodeId,
      skippedNodeIds: [...run.skippedNodeIds],
    }
  }
}

export { TERMINAL_STATUSES, WorkflowRunController }
