import { appendRunRecord, readRunHistory } from '../core/run-history.js'
import { assertValidWorkflow } from '../core/workflow-guard.js'
import { sanitizePublicError } from '../core/security.js'
import { WorkflowRunController } from '../core/workflow-run-controller.js'

const workflowRuns = new WorkflowRunController()

function buildWorkflowRunRecord(workflow, result) {
  return {
    type: 'workflow',
    targetId: workflow.id,
    targetName: workflow.name || workflow.id,
    status: result.success ? 'success' : 'error',
    startedAt: new Date(Date.now() - (result.duration || 0)).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: result.duration || 0,
    input: { mode: workflow.mode, nodeCount: workflow.nodes?.length || 0 },
    output: result.results || [],
    error: result.error || '',
    steps: (result.results || []).map((item, index) => ({
      id: `${workflow.id}-${item.nodeId || index}`,
      order: index,
      name: item.nodeName || item.nodeId,
      type: item.type,
      status: item.status || 'completed',
      input: item.input || {},
      outputPreview: String(item.output || '').slice(0, 360),
      startedAt: item.startedAt || item.timestamp || new Date().toISOString(),
      finishedAt: item.finishedAt || item.timestamp || new Date().toISOString(),
      durationMs: item.durationMs || 0,
    })),
  }
}

function registerWorkflowsRoutes(app, deps) {
  const { loadWorkflows, saveWorkflows, executeWorkflow } = deps

  const updateWorkflowStatus = (workflowId, status) => {
    const workflows = loadWorkflows()
    const target = workflows.find(item => item.id === workflowId)
    if (target) {
      target.status = status
      target.lastRunAt = new Date().toISOString()
      saveWorkflows(workflows)
    }
  }

  const startManagedRun = (workflow, options = {}) => {
    const created = workflowRuns.create(workflow, options)
    const internal = workflowRuns.internal(created.id)
    updateWorkflowStatus(workflow.id, 'running')

    queueMicrotask(async () => {
      try {
        workflowRuns.start(created.id)
        const result = await executeWorkflow(workflow, {
          signal: internal.controller.signal,
          startNodeId: options.startNodeId,
          onlyNodeId: options.onlyNodeId,
          initialResults: options.initialResults,
          waitIfPaused: () => workflowRuns.waitIfPaused(created.id),
          shouldSkip: nodeId => workflowRuns.shouldSkip(created.id, nodeId),
          onNodeStart: node => workflowRuns.nodeStarted(created.id, node),
          onNodeComplete: nodeResult => workflowRuns.nodeCompleted(created.id, nodeResult),
        })
        const completed = workflowRuns.complete(created.id, result)
        updateWorkflowStatus(workflow.id, completed.status === 'completed' ? 'completed' : completed.status === 'canceled' ? 'draft' : 'failed')
        appendRunRecord(buildWorkflowRunRecord(workflow, result))
      } catch (error) {
        const failed = workflowRuns.fail(created.id, error)
        updateWorkflowStatus(workflow.id, failed.status === 'canceled' ? 'draft' : 'failed')
        appendRunRecord({
          type: 'workflow',
          targetId: workflow.id,
          targetName: workflow.name || workflow.id,
          status: failed.status === 'canceled' ? 'canceled' : 'error',
          error: sanitizePublicError(error),
          steps: failed.results,
        })
      }
    })

    return created
  }

  app.get('/api/workflows', (req, res) => {
    res.json(loadWorkflows())
  })

  app.post('/api/workflows', (req, res) => {
    try {
      const workflows = loadWorkflows()
      const newWorkflow = { ...(req.body || {}), updatedAt: new Date().toISOString().split('T')[0] }
      assertValidWorkflow(newWorkflow)
      workflows.unshift(newWorkflow)
      saveWorkflows(workflows)
      res.json(newWorkflow)
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: '工作流校验失败', message: sanitizePublicError(error) })
    }
  })

  app.put('/api/workflows/:id', (req, res) => {
    const workflows = loadWorkflows()
    const id = req.params.id
    const idx = workflows.findIndex(w => w.id === id)
    if (idx >= 0) {
      try {
        const updated = { ...workflows[idx], ...(req.body || {}), updatedAt: new Date().toISOString().split('T')[0] }
        assertValidWorkflow(updated)
        workflows[idx] = updated
        saveWorkflows(workflows)
        res.json(workflows[idx])
      } catch (error) {
        res.status(error.statusCode || 400).json({ error: '工作流校验失败', message: sanitizePublicError(error) })
      }
    } else {
      res.status(404).json({ error: '未找到工作流' })
    }
  })

  app.delete('/api/workflows/:id', (req, res) => {
    const activeRun = workflowRuns.activeForWorkflow(req.params.id)
    if (activeRun) return res.status(409).json({ error: '工作流正在运行，请先取消运行', run: activeRun })
    const workflows = loadWorkflows()
    const filtered = workflows.filter(w => w.id !== req.params.id)
    saveWorkflows(filtered)
    res.json({ success: true })
  })

  app.get('/api/workflow-runs', (req, res) => {
    res.json({ runs: workflowRuns.list({ workflowId: String(req.query.workflowId || ''), limit: req.query.limit }) })
  })

  app.get('/api/workflow-runs/:runId', (req, res) => {
    const run = workflowRuns.get(req.params.runId)
    if (!run) return res.status(404).json({ error: '运行记录不存在' })
    res.json({ run })
  })

  app.post('/api/workflows/:id/runs', (req, res) => {
    try {
      const workflow = loadWorkflows().find(item => item.id === req.params.id)
      if (!workflow) return res.status(404).json({ error: '未找到工作流' })
      const activeRun = workflowRuns.activeForWorkflow(workflow.id)
      if (activeRun) return res.status(409).json({ error: '工作流已有运行中的任务', run: activeRun })
      const startNodeId = String(req.body?.startNodeId || '')
      if (startNodeId && !workflow.nodes.some(node => node.id === startNodeId)) return res.status(400).json({ error: '断点节点不存在' })
      const run = startManagedRun(workflow, { startNodeId })
      res.status(202).json({ success: true, run })
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: '启动工作流失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/workflow-runs/:runId/actions', (req, res) => {
    try {
      const action = String(req.body?.action || '')
      let run
      if (action === 'pause') run = workflowRuns.pause(req.params.runId)
      else if (action === 'resume') run = workflowRuns.resume(req.params.runId)
      else if (action === 'cancel') run = workflowRuns.cancel(req.params.runId)
      else if (action === 'skip') run = workflowRuns.skip(req.params.runId, req.body?.nodeId)
      else return res.status(400).json({ error: '不支持的运行操作' })
      res.json({ success: true, run })
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: '运行操作失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/workflow-runs/:runId/nodes/:nodeId/retry', (req, res) => {
    try {
      const previous = workflowRuns.get(req.params.runId)
      if (!previous) return res.status(404).json({ error: '运行记录不存在' })
      if (!['completed', 'failed', 'canceled'].includes(previous.status)) return res.status(409).json({ error: '请等待当前运行结束后再重试节点' })
      const workflow = loadWorkflows().find(item => item.id === previous.workflowId)
      if (!workflow) return res.status(404).json({ error: '工作流不存在' })
      const activeRun = workflowRuns.activeForWorkflow(workflow.id)
      if (activeRun) return res.status(409).json({ error: '工作流已有运行中的任务', run: activeRun })
      const node = workflow.nodes.find(item => item.id === req.params.nodeId)
      if (!node) return res.status(404).json({ error: '节点不存在' })
      const initialResults = previous.results.filter(item => item.nodeId !== node.id)
      const run = startManagedRun(workflow, {
        parentRunId: previous.id,
        retryNodeId: node.id,
        onlyNodeId: node.id,
        initialResults,
      })
      res.status(202).json({ success: true, run })
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: '节点重试失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/workflows/:id/run', async (req, res) => {
    const workflows = loadWorkflows()
    const wf = workflows.find(w => w.id === req.params.id)
    if (!wf) return res.status(404).json({ error: '未找到工作流' })

    wf.status = 'running'
    wf.lastRunAt = new Date().toISOString().split('T')[0]
    saveWorkflows(workflows)

    try {
      const result = await executeWorkflow(wf)
      const updated = loadWorkflows()
      const target = updated.find(w => w.id === wf.id)
      if (target) {
        target.status = result.success ? 'completed' : 'failed'
        target.lastRunAt = new Date().toISOString().split('T')[0]
        saveWorkflows(updated)
      }
      const record = appendRunRecord(buildWorkflowRunRecord(wf, result))
      res.json({
        success: result.success,
        message: result.success ? '工作流执行完成' : '工作流执行失败',
        workflowId: wf.id,
        result,
        runRecord: record,
      })
    } catch (error) {
      const updated = loadWorkflows()
      const target = updated.find(w => w.id === wf.id)
      if (target) {
        target.status = 'failed'
        saveWorkflows(updated)
      }
      const result = {
        success: false,
        error: sanitizePublicError(error) || '工作流执行异常',
        results: [],
        duration: 0,
      }
      const record = appendRunRecord({
        type: 'workflow',
        targetId: wf.id,
        targetName: wf.name || wf.id,
        status: 'error',
        input: { mode: wf.mode, nodeCount: wf.nodes?.length || 0 },
        error: result.error,
      })
      res.status(500).json({ success: false, message: result.error, workflowId: wf.id, result, runRecord: record })
    }
  })

  app.get('/api/run-history', (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200)
      const type = req.query.type ? String(req.query.type) : ''
      const records = readRunHistory(limit * 2)
        .filter(record => !type || record.type === type)
        .slice(0, limit)
      res.json({ records })
    } catch (error) {
      res.status(500).json({ error: '获取运行历史失败', message: sanitizePublicError(error) })
    }
  })
}

export { registerWorkflowsRoutes }
