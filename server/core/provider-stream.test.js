import test from 'node:test'
import assert from 'node:assert/strict'
import { collectProviderSSE, createProviderStreamCollector } from './provider-stream.js'

test('aggregates fragmented OpenAI-compatible tool arguments', () => {
  const collector = createProviderStreamCollector('openai')
  collector.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'project_', arguments: '{"id":' } }] } }] })
  collector.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'status', arguments: '"p1"}' } }] } }] })
  const result = collector.result()
  assert.equal(result.toolCalls[0].name, 'project_status')
  assert.deepEqual(result.toolCalls[0].args, { id: 'p1' })
})

test('aggregates fragmented Anthropic input_json_delta payloads', () => {
  const collector = createProviderStreamCollector('anthropic')
  collector.push({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} } })
  collector.push({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"灵' } })
  collector.push({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '枢"}' } })
  const result = collector.result()
  assert.deepEqual(result.toolCalls[0].args, { query: '灵枢' })
})

test('collects DeepSeek-compatible SSE split across byte chunks', async () => {
  const source = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"deepseek-1","function":{"name":"knowledge_","arguments":"{\\"query\\":\\"P0"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"search","arguments":" 基线\\"}"}}]}}]}\n\n',
    'data: [DONE]\n\n',
  ].join('')
  const bytes = new TextEncoder().encode(source)
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 37))
      controller.enqueue(bytes.slice(37, 119))
      controller.enqueue(bytes.slice(119))
      controller.close()
    },
  })
  const result = await collectProviderSSE(body, 'openai')
  assert.equal(result.toolCalls[0].name, 'knowledge_search')
  assert.deepEqual(result.toolCalls[0].args, { query: 'P0 基线' })
})

test('rejects an empty provider stream', async () => {
  const body = new ReadableStream({ start(controller) { controller.close() } })
  await assert.rejects(() => collectProviderSSE(body, 'anthropic'), /空的流式响应/)
})
