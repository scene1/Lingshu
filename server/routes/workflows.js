import { appendRunRecord, readRunHistory } from '../core/run-history.js'
import { assertValidWorkflow } from '../core/workflow-guard.js'
import { sanitizePublicError } from '../core/security.js'

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
    const workflows = loadWorkflows()
    const filtered = workflows.filter(w => w.id !== req.params.id)
    saveWorkflows(filtered)
    res.json({ success: true })
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
