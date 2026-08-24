// ============================================================
// 灵枢 v3.0 — 后端自动化引擎
// Cron 调度 + 任务执行 + 日志记录
// 持久化到 ~/Lingshu/workspace/automations.json
// ============================================================

import fs from 'fs'
import path from 'path'
import os from 'os'
import cron from 'node-cron'

const WORKSPACE_DIR = path.join(os.homedir(), 'Lingshu', 'workspace')
const AUTOMATIONS_FILE = path.join(WORKSPACE_DIR, 'automations.json')

/** 最大保留日志条目数 */
const MAX_LOGS_PER_TASK = 50
const RETRY_BACKOFFS = new Set(['fixed', 'linear', 'exponential'])

function clampNumber(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, Math.floor(num)))
}

function normalizeRetryPolicy(config = {}) {
  const maxRetries = clampNumber(config.maxRetries ?? config.retry?.maxRetries, 0, 5, 0)
  const retryDelayMs = clampNumber(config.retryDelayMs ?? config.retry?.delayMs, 0, 300000, 0)
  const retryBackoff = RETRY_BACKOFFS.has(config.retryBackoff || config.retry?.backoff)
    ? (config.retryBackoff || config.retry?.backoff)
    : 'fixed'
  return { maxRetries, retryDelayMs, retryBackoff }
}

function getRetryDelayMs(policy, attemptIndex) {
  const base = policy.retryDelayMs || 0
  if (!base) return 0
  if (policy.retryBackoff === 'linear') return base * attemptIndex
  if (policy.retryBackoff === 'exponential') return base * Math.pow(2, attemptIndex - 1)
  return base
}

function sleep(ms) {
  if (!ms) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 自动化引擎
 *
 * 负责：
 * - 加载/持久化自动化任务配置
 * - 注册和管理 cron 定时任务
 * - 按时执行任务（chat 调用 AI / workflow 触发工作流）
 * - 记录执行日志
 */
class AutomationEngine {
  constructor() {
    /** @type {Map<string, {task: object, cronTask: import('node-cron').ScheduledTask}>} */
    this.scheduledTasks = new Map()
    /** @type {Map<string, Promise<object>>} */
    this.inFlightExecutions = new Map()
    /** @type {object[]} */
    this.automations = []
    /** 外部注入的执行器函数（由 server-v2.js 在 init 时注入） */
    this.executeChatFn = null
    this.executeWorkflowFn = null
    this.recordRunFn = null
    this.notifyFn = null
  }

  /**
   * 初始化引擎：创建数据目录、加载任务、注册 cron
   * @param {{ executeChat?: Function, executeWorkflow?: Function, recordRun?: Function, notify?: Function }} injectors
   */
  init(injectors = {}) {
    this.executeChatFn = injectors.executeChat || null
    this.executeWorkflowFn = injectors.executeWorkflow || null
    this.recordRunFn = injectors.recordRun || null
    this.notifyFn = injectors.notify || null

    // 确保目录存在
    if (!fs.existsSync(WORKSPACE_DIR)) {
      fs.mkdirSync(WORKSPACE_DIR, { recursive: true })
    }

    // 加载已保存的自动化任务
    this.automations = this.loadAutomations()

    // 注册所有启用的 cron 任务
    for (const automation of this.automations) {
      if (automation.enabled) {
        this.registerCron(automation)
      }
    }

    console.log(`[AutomationEngine] 已加载 ${this.automations.length} 个自动化任务，其中 ${this.scheduledTasks.size} 个已注册 cron`)
  }

  /** 从文件加载自动化任务 */
  loadAutomations() {
    try {
      if (fs.existsSync(AUTOMATIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(AUTOMATIONS_FILE, 'utf8'))
        if (Array.isArray(data)) return data
        if (Array.isArray(data.automations)) return data.automations
      }
    } catch (error) {
      console.error('[AutomationEngine] 加载自动化任务失败:', error.message)
    }
    return []
  }

  /** 持久化自动化任务到文件 */
  saveAutomations(automations) {
    try {
      const data = automations || this.automations
      fs.writeFileSync(AUTOMATIONS_FILE, JSON.stringify(data, null, 2))
    } catch (error) {
      console.error('[AutomationEngine] 保存自动化任务失败:', error.message)
    }
  }

  /**
   * 注册单个自动化任务的 cron
   * @param {object} automation
   */
  registerCron(automation) {
    // 先取消已有的
    this.unregisterCron(automation.id)

    // 验证 cron 表达式
    if (!cron.validate(automation.cronExpression)) {
      console.warn(`[AutomationEngine] 无效的 cron 表达式: ${automation.cronExpression} (任务: ${automation.name})`)
      return
    }

    const cronTask = cron.schedule(automation.cronExpression, async () => {
      console.log(`[AutomationEngine] 触发任务: ${automation.name} (${automation.id})`)
      try {
        await this.executeAutomation(automation.id)
      } catch (error) {
        console.error(`[AutomationEngine] 执行任务异常: ${automation.name}`, error.message)
      }
    })

    this.scheduledTasks.set(automation.id, { task: automation, cronTask })
  }

  /**
   * 取消单个自动化任务的 cron
   * @param {string} id
   */
  unregisterCron(id) {
    const entry = this.scheduledTasks.get(id)
    if (entry) {
      entry.cronTask.stop()
      this.scheduledTasks.delete(id)
    }
  }

  /**
   * 创建新的自动化任务
   * @param {object} config 任务配置
   * @returns {object} 创建的任务
   */
  createAutomation(config) {
    const automation = {
      id: config.id || `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: config.name || '未命名任务',
      description: config.description || '',
      cronExpression: config.cronExpression || '0 * * * *',
      actionType: config.actionType || 'chat',
      agentId: config.agentId || '',
      prompt: config.prompt || '',
      workflowId: config.workflowId || '',
      ...normalizeRetryPolicy(config),
      enabled: config.enabled !== false,
      lastRun: null,
      nextRun: this.getNextRun(config.cronExpression || '0 * * * *'),
      logs: [],
    }

    this.automations.push(automation)

    if (automation.enabled) {
      this.registerCron(automation)
    }

    this.saveAutomations()
    return automation
  }

  /**
   * 更新自动化任务
   * @param {string} id 任务 ID
   * @param {object} patch 更新字段
   * @returns {object|null} 更新后的任务
   */
  updateAutomation(id, patch) {
    const idx = this.automations.findIndex(a => a.id === id)
    if (idx === -1) return null

    const updated = { ...this.automations[idx], ...patch }

    // 如果 cron 表达式或启用状态变化，重新注册
    const cronChanged = patch.cronExpression && patch.cronExpression !== this.automations[idx].cronExpression
    const enabledChanged = typeof patch.enabled === 'boolean' && patch.enabled !== this.automations[idx].enabled

    if (cronChanged || enabledChanged) {
      this.unregisterCron(id)
      updated.nextRun = updated.enabled ? this.getNextRun(updated.cronExpression) : null
      if (updated.enabled) {
        this.registerCron(updated)
      }
    }

    this.automations[idx] = updated
    this.saveAutomations()
    return updated
  }

  /**
   * 删除自动化任务
   * @param {string} id 任务 ID
   */
  deleteAutomation(id) {
    this.unregisterCron(id)
    this.automations = this.automations.filter(a => a.id !== id)
    this.saveAutomations()
  }

  /**
   * 启用/禁用自动化任务
   * @param {string} id 任务 ID
   * @returns {object|null} 更新后的任务
   */
  toggleAutomation(id) {
    const automation = this.automations.find(a => a.id === id)
    if (!automation) return null

    return this.updateAutomation(id, { enabled: !automation.enabled })
  }

  /**
   * 获取所有自动化任务
   * @returns {object[]}
   */
  getAllAutomations() {
    // 更新 nextRun
    return this.automations.map(a => ({
      ...a,
      nextRun: a.enabled ? this.getNextRun(a.cronExpression) : null,
    }))
  }

  /**
   * 获取单个自动化任务
   * @param {string} id
   * @returns {object|null}
   */
  getAutomation(id) {
    return this.automations.find(a => a.id === id) || null
  }

  /**
   * 执行自动化任务
   * @param {string} id 任务 ID
   * @returns {Promise<object>} 执行日志条目
   */
  async executeAutomation(id) {
    const active = this.inFlightExecutions.get(id)
    if (active) return active

    const execution = this._executeAutomation(id)
    this.inFlightExecutions.set(id, execution)
    try {
      return await execution
    } finally {
      if (this.inFlightExecutions.get(id) === execution) {
        this.inFlightExecutions.delete(id)
      }
    }
  }

  async _executeAutomation(id) {
    const automation = this.getAutomation(id)
    if (!automation) {
      throw new Error(`自动化任务不存在: ${id}`)
    }

    const startTime = Date.now()
    const logEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      status: 'running',
      durationMs: 0,
      result: '',
      error: '',
      attempts: [],
    }

    try {
      const retryPolicy = normalizeRetryPolicy(automation)
      const maxAttempts = retryPolicy.maxRetries + 1
      let result = ''
      let lastError = null

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const attemptStartedAt = Date.now()
        const attemptLog = {
          attempt,
          status: 'running',
          startedAt: new Date(attemptStartedAt).toISOString(),
          finishedAt: '',
          durationMs: 0,
          result: '',
          error: '',
          nextRetryDelayMs: 0,
        }

        try {
          result = await this.executeAutomationAction(automation)
          attemptLog.status = 'success'
          attemptLog.result = String(result || '').slice(0, 1000)
          logEntry.attempts.push(attemptLog)
          lastError = null
          break
        } catch (error) {
          lastError = error
          attemptLog.status = 'error'
          attemptLog.error = error.message || String(error)
          if (attempt < maxAttempts) {
            attemptLog.nextRetryDelayMs = getRetryDelayMs(retryPolicy, attempt)
          }
          logEntry.attempts.push(attemptLog)
          if (attempt < maxAttempts && attemptLog.nextRetryDelayMs > 0) {
            await sleep(attemptLog.nextRetryDelayMs)
          }
        } finally {
          attemptLog.finishedAt = new Date().toISOString()
          attemptLog.durationMs = Date.now() - attemptStartedAt
        }
      }

      if (lastError) {
        throw lastError
      }

      logEntry.status = 'success'
      logEntry.result = result.slice(0, 2000)
    } catch (error) {
      logEntry.status = 'error'
      logEntry.error = error.message || String(error)
    }

    logEntry.durationMs = Date.now() - startTime

    if (this.recordRunFn) {
      try {
        this.recordRunFn({
          type: 'automation',
          targetId: automation.id,
          targetName: automation.name,
          status: logEntry.status === 'success' ? 'success' : 'error',
          startedAt: new Date(startTime).toISOString(),
          finishedAt: new Date(startTime + logEntry.durationMs).toISOString(),
          durationMs: logEntry.durationMs,
          input: {
            actionType: automation.actionType,
            agentId: automation.agentId,
            workflowId: automation.workflowId,
            prompt: automation.prompt,
            retry: normalizeRetryPolicy(automation),
          },
          output: logEntry.result,
          error: logEntry.error,
          steps: (logEntry.attempts.length > 0 ? logEntry.attempts : [logEntry]).map((attempt, index) => ({
            id: `${logEntry.id}-attempt-${index + 1}`,
            order: index,
            name: `${automation.actionType === 'workflow' ? '执行工作流' : '执行 AI 对话'} · 第 ${index + 1} 次`,
            type: automation.actionType,
            status: attempt.status === 'success' ? 'completed' : 'error',
            startedAt: attempt.startedAt || new Date(startTime).toISOString(),
            finishedAt: attempt.finishedAt || new Date(startTime + logEntry.durationMs).toISOString(),
            durationMs: attempt.durationMs ?? logEntry.durationMs,
            outputPreview: attempt.result || logEntry.result,
            error: attempt.error || '',
            nextRetryDelayMs: attempt.nextRetryDelayMs || 0,
          })),
        })
      } catch (error) {
        console.error('[AutomationEngine] 写入统一运行历史失败:', error.message)
      }
    }

    if (logEntry.status === 'error' && this.notifyFn) {
      try {
        this.notifyFn({
          title: `自动化失败：${automation.name}`,
          content: logEntry.error || '自动化任务执行失败',
          type: 'error',
          source: 'automation',
          targetId: automation.id,
          targetType: 'automation',
          route: '/automations',
          metadata: {
            actionType: automation.actionType,
            attempts: logEntry.attempts.length || 1,
            durationMs: logEntry.durationMs,
          },
        })
      } catch (error) {
        console.error('[AutomationEngine] 写入失败通知失败:', error.message)
      }
    }

    // 更新任务的 lastRun 和 logs
    const idx = this.automations.findIndex(a => a.id === id)
    if (idx !== -1) {
      this.automations[idx].lastRun = logEntry.timestamp
      this.automations[idx].logs = [
        logEntry,
        ...(this.automations[idx].logs || []),
      ].slice(0, MAX_LOGS_PER_TASK)
      this.automations[idx].nextRun = this.automations[idx].enabled
        ? this.getNextRun(this.automations[idx].cronExpression)
        : null
      this.saveAutomations()
    }

    return logEntry
  }

  async executeAutomationAction(automation) {
    if (automation.actionType === 'chat') {
      if (this.executeChatFn) {
        const chatResult = await this.executeChatFn({
          model: automation.agentId,
          prompt: automation.prompt,
        })
        return chatResult.text || chatResult.reply || '执行完成'
      }
      return '[跳过] 未注入 AI 执行器'
    }

    if (automation.actionType === 'workflow') {
      if (this.executeWorkflowFn) {
        const wfResult = await this.executeWorkflowFn(automation.workflowId)
        return wfResult.summary || '工作流执行完成'
      }
      return '[跳过] 未注入工作流执行器'
    }

    throw new Error(`未知的 actionType: ${automation.actionType}`)
  }

  /**
   * 获取任务的执行日志
   * @param {string} id 任务 ID
   * @returns {object[]}
   */
  getLogs(id) {
    const automation = this.getAutomation(id)
    return automation?.logs || []
  }

  /**
   * 计算 cron 表达式的下次执行时间
   * @param {string} cronExpression
   * @returns {string|null} ISO 时间字符串
   */
  getNextRun(cronExpression) {
    if (!cronExpression || !cron.validate(cronExpression)) {
      return null
    }
    try {
      // 使用 node-cron 的内部方法计算下次执行时间
      const nextDate = getCronNextDate(cronExpression)
      return nextDate ? nextDate.toISOString() : null
    } catch (_) {
      return null
    }
  }
}

/**
 * 计算 cron 表达式的下次执行时间
 * 简易实现：遍历未来时间找到第一个匹配的
 * @param {string} expression
 * @returns {Date|null}
 */
function getCronNextDate(expression) {
  if (!cron.validate(expression)) return null

  const parts = expression.split(' ')
  // node-cron 支持 5 或 6 字段表达式
  if (parts.length !== 5 && parts.length !== 6) return null

  // 从当前时间开始，逐分钟检查
  const now = new Date()
  const test = new Date(now)
  test.setSeconds(0, 0)
  test.setMinutes(test.getMinutes() + 1)

  // 最多检查 7 天 (7 * 24 * 60 = 10080 分钟)
  for (let i = 0; i < 10080; i++) {
    if (matchCron(expression, test)) {
      return test
    }
    test.setMinutes(test.getMinutes() + 1)
  }

  return null
}

/**
 * 简易 cron 匹配（支持 5 字段: minute hour day month weekday）
 * @param {string} expression
 * @param {Date} date
 * @returns {boolean}
 */
function matchCron(expression, date) {
  const parts = expression.trim().split(/\s+/)
  if (parts.length < 5) return false

  const [minute, hour, day, month, weekday] = parts

  const m = date.getMinutes()
  const h = date.getHours()
  const d = date.getDate()
  const mon = date.getMonth() + 1
  const w = date.getDay()

  return (
    matchField(minute, m, 0, 59) &&
    matchField(hour, h, 0, 23) &&
    matchField(day, d, 1, 31) &&
    matchField(month, mon, 1, 12) &&
    matchField(weekday, w === 0 ? 7 : w, 0, 7)
  )
}

/**
 * 匹配单个 cron 字段
 * 支持: * / , -
 */
function matchField(expr, value, min, max) {
  if (expr === '*') return true

  // 处理逗号分隔
  if (expr.includes(',')) {
    return expr.split(',').some(part => matchField(part, value, min, max))
  }

  // 处理步长 */
  if (expr.includes('/')) {
    const [range, stepStr] = expr.split('/')
    const step = parseInt(stepStr, 10)
    if (isNaN(step) || step <= 0) return false

    if (range === '*') {
      return (value - min) % step === 0
    }
    if (range.includes('-')) {
      const [start, end] = range.split('-').map(n => parseInt(n, 10))
      return value >= start && value <= end && (value - start) % step === 0
    }
    const start = parseInt(range, 10)
    return value >= start && (value - start) % step === 0
  }

  // 处理范围
  if (expr.includes('-')) {
    const [start, end] = expr.split('-').map(n => parseInt(n, 10))
    return value >= start && value <= end
  }

  // 精确匹配
  return parseInt(expr, 10) === value
}

/** 单例实例 */
const automationEngine = new AutomationEngine()

export { automationEngine, AutomationEngine }
