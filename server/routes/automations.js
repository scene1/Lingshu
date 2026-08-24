import { automationEngine } from '../core/automation-engine.js'
import { sanitizePublicError } from '../core/security.js'

function registerAutomationsRoutes(app) {
  app.get('/api/automations', (req, res) => {
    try {
      const automations = automationEngine.getAllAutomations()
      res.json(automations)
    } catch (error) {
      res.status(500).json({ error: '获取自动化任务失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/automations', (req, res) => {
    try {
      const automation = automationEngine.createAutomation(req.body)
      res.json(automation)
    } catch (error) {
      res.status(500).json({ error: '创建自动化任务失败', message: sanitizePublicError(error) })
    }
  })

  app.put('/api/automations/:id', (req, res) => {
    try {
      const updated = automationEngine.updateAutomation(req.params.id, req.body)
      if (updated) {
        res.json(updated)
      } else {
        res.status(404).json({ error: '自动化任务不存在', id: req.params.id })
      }
    } catch (error) {
      res.status(500).json({ error: '更新自动化任务失败', message: sanitizePublicError(error) })
    }
  })

  app.delete('/api/automations/:id', (req, res) => {
    try {
      automationEngine.deleteAutomation(req.params.id)
      res.json({ success: true, id: req.params.id })
    } catch (error) {
      res.status(500).json({ error: '删除自动化任务失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/automations/:id/toggle', (req, res) => {
    try {
      const updated = automationEngine.toggleAutomation(req.params.id)
      if (updated) {
        res.json(updated)
      } else {
        res.status(404).json({ error: '自动化任务不存在', id: req.params.id })
      }
    } catch (error) {
      res.status(500).json({ error: '切换自动化任务状态失败', message: sanitizePublicError(error) })
    }
  })

  app.get('/api/automations/:id/logs', (req, res) => {
    try {
      const logs = automationEngine.getLogs(req.params.id)
      res.json(logs)
    } catch (error) {
      res.status(500).json({ error: '获取执行日志失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/automations/:id/execute', async (req, res) => {
    try {
      const log = await automationEngine.executeAutomation(req.params.id)
      res.json(log)
    } catch (error) {
      res.status(500).json({ error: '执行自动化任务失败', message: sanitizePublicError(error) })
    }
  })
}

export { registerAutomationsRoutes }
