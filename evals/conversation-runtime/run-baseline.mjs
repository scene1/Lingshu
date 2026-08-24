import fs from 'node:fs/promises'
import { baselineCases, baselineMetadata } from './baseline-cases.js'

const endpoint = process.env.LINGSHU_EVAL_ENDPOINT
  || 'http://127.0.0.1:3005/api/instances/local/sessions/lingshu-eval/chat'
const model = process.env.LINGSHU_EVAL_MODEL || ''
const policyId = process.env.LINGSHU_EVAL_POLICY_ID || ''
const limit = Math.min(baselineCases.length, Math.max(1, Number(process.env.LINGSHU_EVAL_LIMIT || baselineCases.length)))

if (!model) {
  console.error('请设置 LINGSHU_EVAL_MODEL，例如 provider/model。')
  process.exit(2)
}

function deterministicCheck(testCase, output) {
  const text = String(output || '').trim()
  const checks = testCase.checks
  const failures = []
  if (text.length < checks.minChars) failures.push(`输出少于 ${checks.minChars} 字符`)
  if (text.length > checks.maxChars) failures.push(`输出超过 ${checks.maxChars} 字符`)
  for (const forbidden of checks.forbidden) {
    if (text.includes(forbidden)) failures.push(`暴露内部标记: ${forbidden}`)
  }
  return { passed: failures.length === 0, failures }
}

const results = []
for (const testCase of baselineCases.slice(0, limit)) {
  const startedAt = Date.now()
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: testCase.prompt,
        model,
        stream: false,
        persist: false,
        runtimeVersion: 2,
        ...(policyId ? { evaluationPolicyId: policyId } : {}),
      }),
      signal: AbortSignal.timeout(120000),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
    const check = deterministicCheck(testCase, payload.reply)
    results.push({ ...testCase, ...check, score: check.passed ? 1 : 0, grader: 'deterministic', output: payload.reply, durationMs: Date.now() - startedAt })
  } catch (error) {
    results.push({ ...testCase, passed: false, score: 0, grader: 'deterministic', failures: [error.message || String(error)], durationMs: Date.now() - startedAt })
  }
  const latest = results.at(-1)
  console.log(`${latest.passed ? 'PASS' : 'FAIL'} ${testCase.id} (${latest.durationMs}ms)`)
}

const passed = results.filter(item => item.passed).length
const report = {
  generatedAt: new Date().toISOString(),
  model,
  provider: model.includes('/') ? model.split('/')[0] : '',
  policyId,
  endpoint,
  summary: {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length ? passed / results.length : 0,
    targetPassRate: baselineMetadata.passThreshold,
  },
  note: '自动检查只覆盖协议和基本输出约束；rubric 字段需人工或评审模型评分。',
  results,
}

const reportPath = new URL('./latest-report.json', import.meta.url)
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
let gate = null
if (process.env.LINGSHU_EVAL_SAVE !== '0') {
  const reportEndpoint = process.env.LINGSHU_EVAL_REPORT_ENDPOINT
    || new URL('/api/model-evaluations/baseline', endpoint).toString()
  try {
    const response = await fetch(reportEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...report, baselineVersion: baselineMetadata.version }),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) console.warn(`保存评测趋势失败: HTTP ${response.status}`)
    else gate = (await response.json()).gate || null
  } catch (error) {
    console.warn(`保存评测趋势失败: ${error.message || error}`)
  }
}
console.log(`结果: ${passed}/${results.length}，报告: ${reportPath.pathname}`)
if (gate) console.log(`质量门槛: ${gate.passed ? 'PASS' : `FAIL (${gate.failures.join('；')})`}`)
process.exit(gate ? (gate.passed ? 0 : 1) : (report.summary.passRate >= baselineMetadata.passThreshold ? 0 : 1))
