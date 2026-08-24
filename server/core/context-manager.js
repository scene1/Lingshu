const DEFAULT_CONTEXT_LIMITS = {
  maxInputTokens: 32000,
  reserveOutputTokens: 4000,
  minRecentMessages: 6,
  maxSummaryMessages: 12,
}

function serializeContent(content) {
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content)
  } catch (_) {
    return String(content ?? '')
  }
}

export function estimateTokenCount(value) {
  const text = serializeContent(value)
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length
  const remaining = Math.max(0, text.length - cjk)
  return Math.max(1, cjk + Math.ceil(remaining / 4))
}

function estimateMessageTokens(message) {
  return 6
    + estimateTokenCount(message?.role || '')
    + estimateTokenCount(message?.content || '')
    + estimateTokenCount(message?.tool_calls || '')
    + estimateTokenCount(message?.name || '')
}

function trimTextToTokens(value, maxTokens) {
  const text = serializeContent(value)
  if (estimateTokenCount(text) <= maxTokens) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTokenCount(text.slice(0, middle)) <= maxTokens) low = middle
    else high = middle - 1
  }
  return `${text.slice(0, Math.max(0, low - 24))}\n...[context truncated]`
}

export function buildContextWindow(messages = [], options = {}) {
  const limits = { ...DEFAULT_CONTEXT_LIMITS, ...options }
  const budgetTokens = Math.max(1024, limits.maxInputTokens - limits.reserveOutputTokens)
  const systemMessages = messages.filter(message => message?.role === 'system')
  const conversation = messages.filter(message => message?.role !== 'system')
  const selectedSystem = []
  let usedTokens = 0

  for (const message of systemMessages) {
    const remaining = budgetTokens - usedTokens
    if (remaining <= 64) break
    const tokens = estimateMessageTokens(message)
    const selected = tokens <= remaining
      ? message
      : { ...message, content: trimTextToTokens(message.content, Math.max(32, remaining - 12)) }
    selectedSystem.push(selected)
    usedTokens += estimateMessageTokens(selected)
  }

  const selectedRecent = []
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index]
    const tokens = estimateMessageTokens(message)
    const mustKeep = selectedRecent.length < limits.minRecentMessages
    const summaryReserve = index > 0 && !mustKeep
      ? Math.min(512, Math.max(128, Math.floor(budgetTokens * 0.12)))
      : 0
    if (!mustKeep && usedTokens + tokens > budgetTokens - summaryReserve) break
    const remaining = budgetTokens - usedTokens - summaryReserve
    if (remaining <= 32) break
    const selected = tokens <= remaining
      ? message
      : { ...message, content: trimTextToTokens(message.content, Math.max(16, remaining - 12)) }
    selectedRecent.unshift(selected)
    usedTokens += estimateMessageTokens(selected)
  }

  const omittedCount = Math.max(0, conversation.length - selectedRecent.length)
  const summaryMessages = conversation.slice(
    Math.max(0, omittedCount - limits.maxSummaryMessages),
    omittedCount,
  )
  let summary = null
  if (summaryMessages.length > 0 && usedTokens < budgetTokens - 96) {
    const summaryBudget = Math.min(1024, budgetTokens - usedTokens - 12)
    summary = {
      role: 'system',
      content: trimTextToTokens([
        '以下是更早对话的压缩记录，仅用于保持任务连续性；若与近期消息冲突，以近期消息为准：',
        ...summaryMessages.map(message => `${message.role}: ${serializeContent(message.content)}`),
      ].join('\n'), summaryBudget),
    }
    usedTokens += estimateMessageTokens(summary)
  }

  const output = [...selectedSystem, ...(summary ? [summary] : []), ...selectedRecent]
  return {
    messages: output,
    metrics: {
      estimatedInputTokens: output.reduce((sum, message) => sum + estimateMessageTokens(message), 0),
      budgetTokens,
      omittedMessages: omittedCount,
      includedMessages: output.length,
      summaryCreated: Boolean(summary),
    },
  }
}

export { DEFAULT_CONTEXT_LIMITS }
