import { buildContextWindow } from './context-manager.js'
import { randomUUID } from 'node:crypto'

const DEFAULT_LIMITS = {
  maxSteps: 6,
  maxToolResultChars: 12000,
  toolTimeoutMs: 60000,
}

function safeJson(value, maxChars = DEFAULT_LIMITS.maxToolResultChars) {
  let text
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch (_) {
    text = String(value)
  }
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n...[tool result truncated]`
}

function parseArguments(value) {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed }
  } catch (_) {
    return { raw: String(value) }
  }
}

function normalizeToolCalls(toolCalls = []) {
  if (!Array.isArray(toolCalls)) return []
  return toolCalls.map((item, index) => ({
    id: String(item?.id || `tool-${Date.now()}-${index}`),
    name: String(item?.name || item?.function?.name || ''),
    args: parseArguments(item?.args ?? item?.function?.arguments),
  })).filter(item => item.name)
}

function validateToolArguments(schema = {}, args = {}) {
  if (schema.type === 'object' && (!args || typeof args !== 'object' || Array.isArray(args))) {
    return ['工具参数必须是对象']
  }
  const required = Array.isArray(schema.required) ? schema.required : []
  return required
    .filter(name => args?.[name] === undefined || args?.[name] === null || args?.[name] === '')
    .map(name => `缺少必填参数：${name}`)
}

async function withTimeout(promise, timeoutMs, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}执行超时（${timeoutMs}ms）`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function compactConversationMessages(messages = [], options = {}) {
  const maxMessages = Math.max(8, Number(options.maxMessages || 26))
  const maxChars = Math.max(12000, Number(options.maxChars || 60000))
  const system = messages.filter(message => message.role === 'system')
  const conversation = messages.filter(message => message.role !== 'system')
  let recent = conversation.slice(-maxMessages)
  let totalChars = recent.reduce((sum, message) => sum + safeJson(message.content, maxChars).length, 0)
  while (recent.length > 4 && totalChars > maxChars) {
    recent = recent.slice(1)
    totalChars = recent.reduce((sum, message) => sum + safeJson(message.content, maxChars).length, 0)
  }

  const omitted = conversation.slice(0, Math.max(0, conversation.length - recent.length))
  const compacted = omitted.length > 0
    ? [{
        role: 'system',
        content: [
          '以下是更早对话的压缩记录，仅用于保持任务连续性；若与近期消息冲突，以近期消息为准：',
          ...omitted.slice(-12).map(message => `${message.role}: ${safeJson(message.content, 320)}`),
        ].join('\n'),
      }]
    : []
  return [...system, ...compacted, ...recent]
}

export function toProviderToolDefinitions(tools = []) {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: String(tool.description || tool.name).slice(0, 1000),
      parameters: tool.inputSchema || { type: 'object', properties: {}, additionalProperties: true },
    },
  }))
}

export async function runConversationTurn(options) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }
  const toolMap = new Map((options.tools || []).map(tool => [tool.name, tool]))
  const providerTools = toProviderToolDefinitions(options.tools || [])
  const contextWindow = buildContextWindow(options.messages || [], options.contextLimits)
  const messages = contextWindow.messages
  const transcript = []
  const evidence = { reasoning: '', toolCalls: [], iterations: 0, context: contextWindow.metrics }
  options.emit?.('step', {
    step: {
      id: 'context',
      label: '组装上下文',
      detail: `${contextWindow.metrics.estimatedInputTokens}/${contextWindow.metrics.budgetTokens} tokens${contextWindow.metrics.omittedMessages ? `，压缩 ${contextWindow.metrics.omittedMessages} 条旧消息` : ''}`,
      status: 'completed',
    },
  })

  for (let step = 0; step < limits.maxSteps; step += 1) {
    evidence.iterations = step + 1
    options.emit?.('step', {
      step: { id: `model-${step + 1}`, label: step === 0 ? '调用模型' : '模型继续推理', detail: `第 ${step + 1} 轮`, status: 'running' },
    })

    const result = await options.callModel({ messages, tools: providerTools })
    if (!result?.success) {
      throw new Error(result?.error || '模型调用失败')
    }

    const data = result.data || {}
    const reasoning = String(data.reasoning || '')
    if (reasoning) evidence.reasoning += reasoning
    const toolCalls = normalizeToolCalls(data.toolCalls)
    options.emit?.('step', {
      step: { id: `model-${step + 1}`, label: toolCalls.length > 0 ? '模型请求工具' : '模型完成回答', detail: toolCalls.length > 0 ? `${toolCalls.length} 个调用` : '', status: 'completed' },
    })

    if (toolCalls.length === 0) {
      const text = String(data.text || '')
      transcript.push({ role: 'assistant', content: text })
      return { text, messages, transcript, evidence }
    }

    const assistantToolMessage = {
      role: 'assistant',
      content: String(data.text || ''),
      tool_calls: toolCalls.map(call => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args || {}) },
      })),
    }
    messages.push(assistantToolMessage)
    transcript.push(assistantToolMessage)

    for (const call of toolCalls) {
      const tool = toolMap.get(call.name)
      const toolStartedAt = Date.now()
      const evidenceCall = { ...call, status: 'running', startedAt: new Date(toolStartedAt).toISOString() }
      evidence.toolCalls.push(evidenceCall)
      options.emit?.('tool_call', evidenceCall)

      let payload
      let failed = false
      try {
        if (!tool) throw new Error(`工具不存在或本轮未授权：${call.name}`)
        const validationErrors = validateToolArguments(tool.inputSchema, call.args)
        if (validationErrors.length > 0) throw new Error(validationErrors.join('；'))
        const authorization = typeof options.beforeToolExecute === 'function'
          ? await options.beforeToolExecute({ call, tool, step })
          : { allowed: true }
        if (authorization?.allowed === false) throw new Error(authorization.reason || '工具执行被策略阻止')
        const requiresApproval = authorization?.requiresApproval ?? tool.requiresApproval
        if (requiresApproval) {
          if (typeof options.requestApproval !== 'function') throw new Error('工具需要审批，但当前运行时不支持审批')
          const approval = {
            id: `approval-${randomUUID()}`,
            callId: call.id,
            name: call.name,
            label: tool.label || tool.name,
            args: call.args,
            reason: authorization?.approvalReason || tool.approvalReason || '该工具需要用户确认后执行',
          }
          evidenceCall.status = 'awaiting_approval'
          options.emit?.('approval_required', approval)
          const decision = await options.requestApproval(approval)
          options.emit?.('approval_resolved', { ...approval, approved: decision?.approved === true, reason: decision?.reason || '' })
          if (decision?.approved !== true) {
            failed = true
            payload = { success: false, denied: true, error: decision?.reason || '用户未批准工具执行' }
          }
        }
        if (!payload) {
          const output = await withTimeout(
            Promise.resolve(tool.execute(call.args, { callId: call.id, step })),
            Number(tool.timeoutMs || limits.toolTimeoutMs),
            tool.label || tool.name,
          )
          payload = { success: output?.success !== false, output }
          failed = output?.success === false
        }
      } catch (error) {
        failed = true
        payload = { success: false, error: error.message || String(error) }
      }

      const content = safeJson(payload, limits.maxToolResultChars)
      evidenceCall.result = payload
      evidenceCall.status = payload?.denied ? 'denied' : failed ? 'error' : 'completed'
      evidenceCall.finishedAt = new Date().toISOString()
      evidenceCall.durationMs = Date.now() - toolStartedAt
      const toolMessage = { role: 'tool', tool_call_id: call.id, name: call.name, content }
      messages.push(toolMessage)
      transcript.push(toolMessage)
      options.emit?.('tool_result', {
        id: call.id,
        name: call.name,
        result: payload,
        status: evidenceCall.status,
        startedAt: evidenceCall.startedAt,
        finishedAt: evidenceCall.finishedAt,
        durationMs: evidenceCall.durationMs,
      })
    }
  }

  messages.push({
    role: 'system',
    content: '已达到本轮工具循环上限。请停止调用工具，基于已有结果给出当前最佳答案，并明确仍缺少的信息。',
  })
  const finalResult = await options.callModel({ messages, tools: [] })
  if (!finalResult?.success) throw new Error(finalResult?.error || '最终总结失败')
  const text = String(finalResult.data?.text || '')
  transcript.push({ role: 'assistant', content: text })
  return { text, messages, transcript, evidence: { ...evidence, limitReached: true } }
}
