import fs from 'node:fs/promises'
import { compactEvaluationReport } from './report-payload.js'

const endpoint = process.env.LINGSHU_EVAL_REPORT_ENDPOINT
  || 'http://127.0.0.1:3005/api/model-evaluations/baseline'
const reportPath = new URL(process.env.LINGSHU_EVAL_REPORT_FILE || './latest-report.json', import.meta.url)
const report = JSON.parse(await fs.readFile(reportPath, 'utf8'))
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(compactEvaluationReport(report)),
  signal: AbortSignal.timeout(15000),
})
const payload = await response.json().catch(() => ({}))
if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`)
console.log(JSON.stringify({ reportId: payload.report?.id, gate: payload.gate, queued: payload.queued }, null, 2))
