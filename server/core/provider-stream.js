function parseJson(value, fallback = {}) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch (_) {
    return fallback
  }
}

function appendToolDelta(toolMap, key, delta = {}) {
  const current = toolMap.get(key) || { id: '', name: '', argumentsText: '', input: undefined }
  if (delta.id) current.id = delta.id
  if (delta.name) current.name += delta.name
  if (delta.argumentsText) current.argumentsText += delta.argumentsText
  if (delta.input !== undefined) current.input = delta.input
  toolMap.set(key, current)
}

export function createProviderStreamCollector(provider = 'openai') {
  const toolMap = new Map()
  let text = ''
  let reasoning = ''

  const push = payload => {
    if (provider === 'anthropic') {
      if (payload.type === 'content_block_start' && payload.content_block?.type === 'tool_use') {
        appendToolDelta(toolMap, payload.index, {
          id: payload.content_block.id,
          name: payload.content_block.name,
          input: payload.content_block.input,
        })
      }
      if (payload.type === 'content_block_delta') {
        if (payload.delta?.type === 'text_delta') text += payload.delta.text || ''
        if (payload.delta?.type === 'thinking_delta') reasoning += payload.delta.thinking || ''
        if (payload.delta?.type === 'input_json_delta') {
          appendToolDelta(toolMap, payload.index, { argumentsText: payload.delta.partial_json || '' })
        }
      }
      return
    }

    const delta = payload.choices?.[0]?.delta || {}
    if (delta.content) text += delta.content
    reasoning += delta.reasoning_content || delta.reasoning || ''
    for (const call of delta.tool_calls || []) {
      appendToolDelta(toolMap, call.index ?? call.id ?? toolMap.size, {
        id: call.id,
        name: call.function?.name,
        argumentsText: call.function?.arguments,
      })
    }
  }

  const result = () => ({
    text,
    reasoning,
    toolCalls: [...toolMap.values()].map((tool, index) => ({
      id: tool.id || `tool-${index + 1}`,
      name: tool.name,
      args: tool.argumentsText ? parseJson(tool.argumentsText, { raw: tool.argumentsText }) : (tool.input || {}),
    })).filter(tool => tool.name),
  })

  return { push, result }
}

export async function collectProviderSSE(body, provider = 'openai') {
  if (!body?.getReader) throw new Error('Provider 流不可读取')
  const collector = createProviderStreamCollector(provider)
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let parsedEvents = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) {
      const clean = line.trim()
      if (!clean.startsWith('data:')) continue
      const data = clean.slice(5).trim()
      if (!data || data === '[DONE]') continue
      const payload = parseJson(data, null)
      if (payload) {
        parsedEvents += 1
        collector.push(payload)
      }
    }
  }
  const tail = buffer.trim()
  if (tail.startsWith('data:')) {
    const payload = parseJson(tail.slice(5).trim(), null)
    if (payload) {
      parsedEvents += 1
      collector.push(payload)
    }
  }
  if (parsedEvents === 0) throw new Error('Provider 返回了空的流式响应')
  return collector.result()
}
