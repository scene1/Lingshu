import {
  appendProjectUpdate,
  normalizeProject,
  normalizeProjectConfigItem,
  sanitizeProjectConfigItemForResponse,
  normalizeProjectLink,
  normalizeWorkItem,
  readProjectsState,
  summarizeProject,
  writeProjectsState,
} from '../core/projects.js'
import { sanitizePublicError } from '../core/security.js'

const WORK_ITEM_STATUS_LABELS = {
  inbox: '收集箱',
  todo: '待处理',
  doing: '进行中',
  blocked: '阻塞',
  review: '评审',
  done: '完成',
}

const PRIORITY_LABELS = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
}

function formatWorkItem(item) {
  const priority = PRIORITY_LABELS[item.priority] || item.priority || '-'
  const status = WORK_ITEM_STATUS_LABELS[item.status] || item.status || '-'
  const assignee = item.assignee ? `，负责人：${item.assignee}` : ''
  const dueDate = item.dueDate ? `，截止：${item.dueDate}` : ''
  return `- ${item.title}（${status}，${priority}${assignee}${dueDate}）`
}

function buildProjectStats(project, workItems) {
  const total = workItems.length
  const done = workItems.filter(item => item.status === 'done').length
  const blocked = workItems.filter(item => item.status === 'blocked').length
  const doing = workItems.filter(item => item.status === 'doing').length
  const review = workItems.filter(item => item.status === 'review').length
  const todo = workItems.filter(item => ['inbox', 'todo'].includes(item.status)).length
  const progress = total > 0 ? Math.round((done / total) * 100) : Number(project.progress || 0)
  return { total, done, blocked, doing, review, todo, progress }
}

function buildProjectSummary(project, workItems, updates) {
  const stats = buildProjectStats(project, workItems)
  const blockedItems = workItems.filter(item => item.status === 'blocked')
  const activeItems = workItems.filter(item => ['doing', 'review'].includes(item.status)).slice(0, 6)
  const nextItems = workItems
    .filter(item => ['inbox', 'todo'].includes(item.status))
    .sort((a, b) => {
      const priorityScore = { urgent: 0, high: 1, medium: 2, low: 3 }
      return (priorityScore[a.priority] ?? 9) - (priorityScore[b.priority] ?? 9)
    })
    .slice(0, 6)
  const recentUpdates = updates.slice(0, 5)

  return [
    `## ${project.name} 项目摘要`,
    '',
    `当前进度约 ${stats.progress}%。任务共 ${stats.total} 项，已完成 ${stats.done} 项，进行中 ${stats.doing} 项，评审中 ${stats.review} 项，待处理 ${stats.todo} 项，阻塞 ${stats.blocked} 项。`,
    project.description ? `项目目标：${project.description}` : '',
    '',
    '### 当前重点',
    activeItems.length > 0 ? activeItems.map(formatWorkItem).join('\n') : '- 暂无进行中或评审中的任务。',
    '',
    '### 下一步建议',
    nextItems.length > 0 ? nextItems.map(formatWorkItem).join('\n') : '- 当前没有待处理任务，可以补充下一批目标或检查已完成项。',
    '',
    '### 主要阻塞',
    blockedItems.length > 0 ? blockedItems.map(formatWorkItem).join('\n') : '- 暂无阻塞任务。',
    '',
    '### 最近动态',
    recentUpdates.length > 0
      ? recentUpdates.map(item => `- ${item.title}${item.content ? `：${item.content}` : ''}`).join('\n')
      : '- 暂无项目动态。',
  ].filter(Boolean).join('\n')
}

function buildProjectRiskScan(project, workItems) {
  const risks = []
  const today = new Date().toISOString().slice(0, 10)
  const blockedItems = workItems.filter(item => item.status === 'blocked')
  const overdueItems = workItems.filter(item => item.dueDate && item.dueDate < today && item.status !== 'done')
  const urgentOpenItems = workItems.filter(item => ['urgent', 'high'].includes(item.priority) && item.status !== 'done')
  const noOwnerItems = workItems.filter(item => !item.assignee && item.status !== 'done')

  if (blockedItems.length > 0) {
    risks.push({
      title: `阻塞任务 ${blockedItems.length} 项`,
      suggestion: '优先明确阻塞原因、负责人和解除条件。',
      items: blockedItems.slice(0, 6),
    })
  }
  if (overdueItems.length > 0) {
    risks.push({
      title: `已逾期任务 ${overdueItems.length} 项`,
      suggestion: '建议重新确认截止时间，或拆分成更小的可执行任务。',
      items: overdueItems.slice(0, 6),
    })
  }
  if (urgentOpenItems.length > 0) {
    risks.push({
      title: `高优先级未完成任务 ${urgentOpenItems.length} 项`,
      suggestion: '建议集中处理高优先级事项，避免并行过多。',
      items: urgentOpenItems.slice(0, 6),
    })
  }
  if (noOwnerItems.length > 0) {
    risks.push({
      title: `未指定负责人任务 ${noOwnerItems.length} 项`,
      suggestion: '建议为关键任务补充负责人，减少推进真空。',
      items: noOwnerItems.slice(0, 6),
    })
  }
  if ((project.linkedRepositories || []).length === 0) {
    risks.push({
      title: '未关联 Git 仓库',
      suggestion: '如果这是研发项目，建议关联代码仓库，方便后续同步 Issue/PR。',
      items: [],
    })
  }
  if ((project.linkedDocuments || []).length + (project.linkedMeetings || []).length + (project.linkedSessions || []).length === 0) {
    risks.push({
      title: '项目资料为空',
      suggestion: '建议关联核心文档、会议纪要或 AI 会话，形成项目上下文。',
      items: [],
    })
  }

  if (risks.length === 0) {
    return [
      `## ${project.name} 风险扫描`,
      '',
      '当前没有发现明显风险。建议继续保持任务状态更新，并定期关联会议纪要、文档和 Git 变更。',
    ].join('\n')
  }

  return [
    `## ${project.name} 风险扫描`,
    '',
    `发现 ${risks.length} 类需要关注的风险：`,
    '',
    ...risks.map((risk, index) => [
      `### ${index + 1}. ${risk.title}`,
      risk.suggestion,
      risk.items.length > 0 ? risk.items.map(formatWorkItem).join('\n') : '',
    ].filter(Boolean).join('\n')),
  ].join('\n\n')
}

function cleanTaskTitle(line) {
  return String(line || '')
    .replace(/^\s*[-*•\d.、\[\]【】]+/, '')
    .replace(/^(TODO|todo|待办|任务|行动项|Action|Action Item|需|需要|请|安排|跟进|修复|优化|确认)[:：\s-]*/i, '')
    .trim()
}

function inferPriority(line) {
  if (/紧急|urgent|P0|高优|高优先级|严重|critical/i.test(line)) return 'urgent'
  if (/高|重要|P1|尽快|本周/i.test(line)) return 'high'
  if (/低|P3|有空|后续/i.test(line)) return 'low'
  return 'medium'
}

function inferType(line) {
  if (/风险|risk|隐患|阻塞|blocked?/i.test(line)) return 'risk'
  if (/bug|缺陷|错误|报错|失败|修复|fix/i.test(line)) return 'bug'
  if (/功能|需求|feature|新增|支持/i.test(line)) return 'feature'
  if (/调研|研究|research|确认|评估/i.test(line)) return 'research'
  if (/决策|决定|decision/i.test(line)) return 'decision'
  return 'task'
}

function inferStatus(line) {
  if (/阻塞|blocked?|卡住/i.test(line)) return 'blocked'
  if (/进行中|doing|处理中/i.test(line)) return 'doing'
  if (/评审|review|待验收/i.test(line)) return 'review'
  return 'todo'
}

function extractAssignee(line) {
  const match = String(line || '').match(/(?:负责人|owner|assignee|@)\s*[:：]?\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)/i)
  return match?.[1] || ''
}

function extractDueDate(line) {
  const source = String(line || '')
  const dateMatch = source.match(/(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})/)
  if (dateMatch) return dateMatch[1].replace(/[/.]/g, '-')
  if (/今天|今日/.test(source)) return new Date().toISOString().slice(0, 10)
  if (/明天|明日/.test(source)) {
    const date = new Date()
    date.setDate(date.getDate() + 1)
    return date.toISOString().slice(0, 10)
  }
  return ''
}

function extractProjectTasksFromText(text, source = {}) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const actionablePattern = /(TODO|todo|待办|任务|行动项|Action|需要|需|请|安排|跟进|修复|优化|确认|实现|完成|处理|负责人|截止|阻塞|风险|bug|缺陷|新增|支持|评估)/
  const candidates = []
  const seen = new Set()

  for (const line of lines) {
    if (!actionablePattern.test(line) && !/^\s*[-*•\d.、]+\s+/.test(line)) continue
    const title = cleanTaskTitle(line)
    if (!title || title.length < 2) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      type: inferType(line),
      title: title.slice(0, 120),
      description: line,
      status: inferStatus(line),
      priority: inferPriority(line),
      assignee: extractAssignee(line),
      dueDate: extractDueDate(line),
      labels: source.type ? [source.type] : [],
      source: {
        type: source.type || 'manual',
        title: source.title || '文本提取',
        excerpt: line,
      },
    })
  }

  return candidates.slice(0, 30)
}

function registerProjectsRoutes(app) {
  app.get('/api/projects', (req, res) => {
    try {
      const state = readProjectsState()
      const status = req.query.status ? String(req.query.status) : ''
      const projects = state.projects
        .map(project => summarizeProject(project, state.workItems))
        .filter(project => !status || project.status === status)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      res.json({ projects })
    } catch (error) {
      res.status(500).json({ error: '读取项目失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/projects', (req, res) => {
    try {
      const state = readProjectsState()
      const project = normalizeProject(req.body)
      state.projects.unshift(project)
      appendProjectUpdate(state, {
        projectId: project.id,
        type: 'project_created',
        title: `创建项目：${project.name}`,
      })
      writeProjectsState(state)
      res.json(summarizeProject(project, state.workItems))
    } catch (error) {
      res.status(500).json({ error: '创建项目失败', message: sanitizePublicError(error) })
    }
  })

  app.get('/api/projects/:projectId', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const workItems = state.workItems
        .filter(item => item.projectId === project.id)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      const updates = state.updates
        .filter(item => item.projectId === project.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 80)
      res.json({ project: summarizeProject(project, state.workItems), workItems, updates })
    } catch (error) {
      res.status(500).json({ error: '读取项目详情失败', message: sanitizePublicError(error) })
    }
  })

  app.patch('/api/projects/:projectId', (req, res) => {
    try {
      const state = readProjectsState()
      const index = state.projects.findIndex(item => item.id === req.params.projectId)
      if (index < 0) return res.status(404).json({ error: '项目不存在' })
      const previous = state.projects[index]
      const project = normalizeProject({
        ...previous,
        ...req.body,
        id: previous.id,
        createdAt: previous.createdAt,
        updatedAt: new Date().toISOString(),
      })
      state.projects[index] = project
      appendProjectUpdate(state, {
        projectId: project.id,
        type: 'project_updated',
        title: `更新项目：${project.name}`,
      })
      writeProjectsState(state)
      res.json(summarizeProject(project, state.workItems))
    } catch (error) {
      res.status(500).json({ error: '更新项目失败', message: sanitizePublicError(error) })
    }
  })

  app.delete('/api/projects/:projectId', (req, res) => {
    try {
      const state = readProjectsState()
      state.projects = state.projects.filter(item => item.id !== req.params.projectId)
      state.workItems = state.workItems.filter(item => item.projectId !== req.params.projectId)
      state.updates = state.updates.filter(item => item.projectId !== req.params.projectId)
      writeProjectsState(state)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: '删除项目失败', message: sanitizePublicError(error) })
    }
  })

  app.get('/api/projects/:projectId/work-items', (req, res) => {
    try {
      const state = readProjectsState()
      const workItems = state.workItems.filter(item => item.projectId === req.params.projectId)
      res.json({ workItems })
    } catch (error) {
      res.status(500).json({ error: '读取任务失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/projects/:projectId/work-items', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const workItem = normalizeWorkItem(req.body, project.id)
      state.workItems.unshift(workItem)
      project.updatedAt = new Date().toISOString()
      appendProjectUpdate(state, {
        projectId: project.id,
        type: 'work_item_created',
        title: `新增任务：${workItem.title}`,
        targetId: workItem.id,
      })
      writeProjectsState(state)
      res.json(workItem)
    } catch (error) {
      res.status(500).json({ error: '创建任务失败', message: sanitizePublicError(error) })
    }
  })

  app.patch('/api/projects/:projectId/work-items/:itemId', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const index = state.workItems.findIndex(item => item.id === req.params.itemId && item.projectId === project.id)
      if (index < 0) return res.status(404).json({ error: '任务不存在' })
      const previous = state.workItems[index]
      const workItem = normalizeWorkItem({
        ...previous,
        ...req.body,
        id: previous.id,
        projectId: project.id,
        createdAt: previous.createdAt,
        updatedAt: new Date().toISOString(),
      }, project.id)
      state.workItems[index] = workItem
      project.updatedAt = new Date().toISOString()
      appendProjectUpdate(state, {
        projectId: project.id,
        type: 'work_item_updated',
        title: `更新任务：${workItem.title}`,
        content: previous.status !== workItem.status ? `${previous.status} -> ${workItem.status}` : '',
        targetId: workItem.id,
      })
      writeProjectsState(state)
      res.json(workItem)
    } catch (error) {
      res.status(500).json({ error: '更新任务失败', message: sanitizePublicError(error) })
    }
  })

  app.delete('/api/projects/:projectId/work-items/:itemId', (req, res) => {
    try {
      const state = readProjectsState()
      state.workItems = state.workItems.filter(item => !(item.projectId === req.params.projectId && item.id === req.params.itemId))
      appendProjectUpdate(state, {
        projectId: req.params.projectId,
        type: 'work_item_deleted',
        title: '删除任务',
        targetId: req.params.itemId,
      })
      writeProjectsState(state)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: '删除任务失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/projects/:projectId/repositories', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const repo = String(req.body.repository || req.body.repo || '').trim()
      if (!repo) return res.status(400).json({ error: '仓库不能为空' })
      project.linkedRepositories = [...new Set([...(project.linkedRepositories || []), repo])]
      project.updatedAt = new Date().toISOString()
      appendProjectUpdate(state, {
        projectId: project.id,
        type: 'repository_linked',
        title: `关联仓库：${repo}`,
      })
      writeProjectsState(state)
      res.json(summarizeProject(project, state.workItems))
    } catch (error) {
      res.status(500).json({ error: '关联仓库失败', message: sanitizePublicError(error) })
    }
  })

  app.delete('/api/projects/:projectId/repositories', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const repo = String(req.query.repository || '').trim()
      project.linkedRepositories = (project.linkedRepositories || []).filter(item => item !== repo)
      project.updatedAt = new Date().toISOString()
      writeProjectsState(state)
      res.json(summarizeProject(project, state.workItems))
    } catch (error) {
      res.status(500).json({ error: '移除仓库失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/projects/:projectId/links', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const link = normalizeProjectLink(req.body)
      if (link.type === 'meeting') project.linkedMeetings.push(link)
      else if (link.type === 'chat') project.linkedSessions.push(link)
      else project.linkedDocuments.push(link)
      project.updatedAt = new Date().toISOString()
      appendProjectUpdate(state, {
        projectId: project.id,
        type: 'resource_linked',
        title: `关联资料：${link.title}`,
        targetId: link.id,
      })
      writeProjectsState(state)
      res.json({ project: summarizeProject(project, state.workItems), link })
    } catch (error) {
      res.status(500).json({ error: '关联资料失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/projects/:projectId/config-items', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const inputItems = Array.isArray(req.body.items) ? req.body.items : [req.body]
      const configItems = inputItems
        .map(item => normalizeProjectConfigItem(item))
        .filter(item => item.title || item.host || item.username || item.value)
      if (configItems.length === 0) return res.status(400).json({ error: '项目配置不能为空' })
      project.configItems.unshift(...configItems)
      project.updatedAt = new Date().toISOString()
      appendProjectUpdate(state, {
        projectId: project.id,
        type: 'config_item_created',
        title: configItems.length > 1 ? `批量新增项目配置：${configItems.length} 条` : `新增项目配置：${configItems[0].title}`,
        targetId: configItems[0].id,
      })
      writeProjectsState(state)
      res.json({
        project: summarizeProject(project, state.workItems),
        configItem: sanitizeProjectConfigItemForResponse(configItems[0]),
        configItems: configItems.map(sanitizeProjectConfigItemForResponse),
      })
    } catch (error) {
      res.status(500).json({ error: '保存项目配置失败', message: sanitizePublicError(error) })
    }
  })

  app.patch('/api/projects/:projectId/config-items/:configId', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const index = project.configItems.findIndex(item => item.id === req.params.configId)
      if (index < 0) return res.status(404).json({ error: '项目配置不存在' })
      const previous = project.configItems[index]
      const incoming = req.body && typeof req.body === 'object' ? { ...req.body } : {}
      if (previous.sensitive) {
        if (incoming.clearValue === true) incoming.value = ''
        else if (!String(incoming.value || '').trim()) delete incoming.value
        if (incoming.clearNotes === true) incoming.notes = ''
        else if (!String(incoming.notes || '').trim()) delete incoming.notes
      }
      delete incoming.clearValue
      delete incoming.clearNotes
      const configItem = normalizeProjectConfigItem({
        ...previous,
        ...incoming,
        id: previous.id,
        createdAt: previous.createdAt,
        updatedAt: new Date().toISOString(),
      })
      project.configItems[index] = configItem
      project.updatedAt = new Date().toISOString()
      appendProjectUpdate(state, {
        projectId: project.id,
        type: 'config_item_updated',
        title: `更新项目配置：${configItem.title}`,
        targetId: configItem.id,
      })
      writeProjectsState(state)
      res.json({ project: summarizeProject(project, state.workItems), configItem: sanitizeProjectConfigItemForResponse(configItem) })
    } catch (error) {
      res.status(500).json({ error: '更新项目配置失败', message: sanitizePublicError(error) })
    }
  })

  app.delete('/api/projects/:projectId/config-items/:configId', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const previousLength = project.configItems.length
      project.configItems = project.configItems.filter(item => item.id !== req.params.configId)
      if (project.configItems.length === previousLength) return res.status(404).json({ error: '项目配置不存在' })
      project.updatedAt = new Date().toISOString()
      appendProjectUpdate(state, {
        projectId: project.id,
        type: 'config_item_deleted',
        title: '删除项目配置',
        targetId: req.params.configId,
      })
      writeProjectsState(state)
      res.json({ project: summarizeProject(project, state.workItems) })
    } catch (error) {
      res.status(500).json({ error: '删除项目配置失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/projects/:projectId/ai/summary', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const workItems = state.workItems.filter(item => item.projectId === project.id)
      const updates = state.updates
        .filter(item => item.projectId === project.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      const content = buildProjectSummary(project, workItems, updates)
      const update = appendProjectUpdate(state, {
        projectId: project.id,
        type: 'project_summary',
        title: '生成项目摘要',
        content,
      })
      project.updatedAt = new Date().toISOString()
      writeProjectsState(state)
      res.json({ content, update, project: summarizeProject(project, state.workItems) })
    } catch (error) {
      res.status(500).json({ error: '生成项目摘要失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/projects/:projectId/ai/risk-scan', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const workItems = state.workItems.filter(item => item.projectId === project.id)
      const content = buildProjectRiskScan(project, workItems)
      const update = appendProjectUpdate(state, {
        projectId: project.id,
        type: 'project_risk_scan',
        title: '执行风险扫描',
        content,
      })
      project.updatedAt = new Date().toISOString()
      writeProjectsState(state)
      res.json({ content, update, project: summarizeProject(project, state.workItems) })
    } catch (error) {
      res.status(500).json({ error: '项目风险扫描失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/projects/:projectId/ai/extract-tasks', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const text = String(req.body.text || '')
      const source = req.body.source || { type: 'manual', title: '文本提取' }
      if (!text.trim()) return res.status(400).json({ error: '请输入会议纪要、对话记录或需求文本' })
      const tasks = extractProjectTasksFromText(text, source)
      res.json({ tasks, count: tasks.length })
    } catch (error) {
      res.status(500).json({ error: '提取项目任务失败', message: sanitizePublicError(error) })
    }
  })

  app.post('/api/projects/:projectId/ai/import-tasks', (req, res) => {
    try {
      const state = readProjectsState()
      const project = state.projects.find(item => item.id === req.params.projectId)
      if (!project) return res.status(404).json({ error: '项目不存在' })
      const inputTasks = Array.isArray(req.body.tasks) ? req.body.tasks : []
      const workItems = inputTasks
        .map(item => normalizeWorkItem(item, project.id))
        .filter(item => item.title)
      if (workItems.length === 0) return res.status(400).json({ error: '没有可导入的任务' })
      state.workItems.unshift(...workItems)
      project.updatedAt = new Date().toISOString()
      appendProjectUpdate(state, {
        projectId: project.id,
        type: 'tasks_imported',
        title: `导入项目任务：${workItems.length} 项`,
        content: workItems.slice(0, 10).map(item => `- ${item.title}`).join('\n'),
      })
      writeProjectsState(state)
      res.json({ workItems, project: summarizeProject(project, state.workItems) })
    } catch (error) {
      res.status(500).json({ error: '导入项目任务失败', message: sanitizePublicError(error) })
    }
  })
}

export { registerProjectsRoutes }
