import test from 'node:test'
import assert from 'node:assert/strict'
import { compactConversationMessages, runConversationTurn } from './conversation-runtime.js'

test('executes a tool and feeds the result back before final answer', async () => {
  const calls = []
  const events = []
  const result = await runConversationTurn({
    messages: [{ role: 'user', content: '查一下项目状态' }],
    tools: [{
      name: 'project_status',
      description: '读取项目状态',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      execute: async ({ id }) => ({ success: true, id, status: 'ready' }),
    }],
    callModel: async ({ messages }) => {
      calls.push(messages)
      if (calls.length === 1) {
        return { success: true, data: { text: '', toolCalls: [{ id: 'call-1', name: 'project_status', args: { id: 'p1' } }] } }
      }
      assert.equal(messages.at(-1).role, 'tool')
      assert.match(messages.at(-1).content, /ready/)
      return { success: true, data: { text: '项目已经就绪。' } }
    },
    emit: (event, data) => events.push({ event, data }),
  })

  assert.equal(result.text, '项目已经就绪。')
  assert.equal(result.evidence.iterations, 2)
  assert.equal(result.evidence.toolCalls[0].status, 'completed')
  assert.ok(result.evidence.toolCalls[0].startedAt)
  assert.ok(result.evidence.toolCalls[0].finishedAt)
  assert.equal(typeof result.evidence.toolCalls[0].durationMs, 'number')
  assert.deepEqual(result.transcript.map(message => message.role), ['assistant', 'tool', 'assistant'])
  const toolResultEvent = events.find(item => item.event === 'tool_result')
  assert.equal(typeof toolResultEvent?.data?.durationMs, 'number')
  assert.ok(toolResultEvent?.data?.startedAt)
  assert.ok(toolResultEvent?.data?.finishedAt)
})

test('returns a structured tool error without executing invalid arguments', async () => {
  let executed = false
  let modelCalls = 0
  const result = await runConversationTurn({
    messages: [{ role: 'user', content: '执行查询' }],
    tools: [{
      name: 'lookup',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: async () => { executed = true },
    }],
    callModel: async ({ messages }) => {
      modelCalls += 1
      if (modelCalls === 1) return { success: true, data: { toolCalls: [{ id: 'bad-1', name: 'lookup', args: {} }] } }
      assert.match(messages.at(-1).content, /缺少必填参数/)
      return { success: true, data: { text: '缺少查询条件。' } }
    },
  })

  assert.equal(executed, false)
  assert.equal(result.evidence.toolCalls[0].status, 'error')
  assert.equal(result.text, '缺少查询条件。')
})

test('forces a final answer after reaching the loop limit', async () => {
  const toolSets = []
  const result = await runConversationTurn({
    messages: [{ role: 'user', content: '循环测试' }],
    limits: { maxSteps: 2 },
    tools: [{ name: 'again', inputSchema: { type: 'object', properties: {} }, execute: async () => ({ ok: true }) }],
    callModel: async ({ tools }) => {
      toolSets.push(tools)
      if (tools.length === 0) return { success: true, data: { text: '已停止继续调用。' } }
      return { success: true, data: { toolCalls: [{ name: 'again', args: {} }] } }
    },
  })

  assert.equal(result.evidence.limitReached, true)
  assert.equal(result.text, '已停止继续调用。')
  assert.equal(toolSets.at(-1).length, 0)
})

test('compacts old conversation while keeping recent turns', () => {
  const messages = [
    { role: 'system', content: 'system' },
    ...Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `message-${index}` })),
  ]
  const compacted = compactConversationMessages(messages, { maxMessages: 8, maxChars: 12000 })
  assert.equal(compacted[0].content, 'system')
  assert.match(compacted[1].content, /压缩记录/)
  assert.equal(compacted.at(-1).content, 'message-19')
})

test('waits for approval before executing a protected tool', async () => {
  let executed = false
  let modelCalls = 0
  const events = []
  const result = await runConversationTurn({
    messages: [{ role: 'user', content: '执行高风险操作' }],
    tools: [{
      name: 'protected_action',
      requiresApproval: true,
      approvalReason: '将修改本地状态',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => { executed = true; return { success: true } },
    }],
    requestApproval: async approval => ({ id: approval.id, approved: true }),
    callModel: async () => {
      modelCalls += 1
      if (modelCalls === 1) return { success: true, data: { toolCalls: [{ id: 'protected-1', name: 'protected_action', args: {} }] } }
      return { success: true, data: { text: '操作已获批准并完成。' } }
    },
    emit: (event, data) => events.push({ event, data }),
  })
  assert.equal(executed, true)
  assert.equal(result.text, '操作已获批准并完成。')
  assert.ok(events.some(item => item.event === 'approval_required'))
  assert.ok(events.some(item => item.event === 'approval_resolved'))
})

test('blocks a tool before approval when governance denies it', async () => {
  let executed = false
  const responses = [
    { success: true, data: { toolCalls: [{ id: 'call-denied', name: 'network_write', args: {} }] } },
    { success: true, data: { text: '工具被策略阻止。' } },
  ]
  const result = await runConversationTurn({
    messages: [{ role: 'user', content: '执行写入' }],
    tools: [{ name: 'network_write', inputSchema: { type: 'object' }, requiresApproval: true, execute: async () => { executed = true } }],
    callModel: async () => responses.shift(),
    beforeToolExecute: async () => ({ allowed: false, reason: '策略拒绝' }),
    requestApproval: async () => ({ approved: true }),
  })
  assert.equal(executed, false)
  assert.equal(result.evidence.toolCalls[0].status, 'error')
  assert.match(JSON.stringify(result.transcript), /策略拒绝/)
})
