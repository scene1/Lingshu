import fs from 'fs'
import path from 'path'
import os from 'os'
import { redactSensitiveValue, sanitizePublicError } from './security.js'

const WORKSPACE_DIR = path.join(os.homedir(), 'Lingshu', 'workspace')
const RUN_HISTORY_FILE = path.join(WORKSPACE_DIR, 'run-history.jsonl')
const MAX_RUN_HISTORY = 500

function ensureWorkspaceDir() {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true })
  }
}

function normalizeRunRecord(input = {}) {
  const now = new Date().toISOString()
  const startedAt = input.startedAt || input.timestamp || now
  const finishedAt = input.finishedAt || now
  const durationMs = typeof input.durationMs === 'number'
    ? input.durationMs
    : Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())

  return {
    id: input.id || `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: input.type || 'unknown',
    targetId: input.targetId || '',
    targetName: input.targetName || '',
    status: input.status || 'success',
    startedAt,
    finishedAt,
    durationMs,
    input: redactSensitiveValue(input.input ?? null),
    output: redactSensitiveValue(input.output ?? null),
    error: sanitizePublicError(input.error || '', ''),
    steps: redactSensitiveValue(Array.isArray(input.steps) ? input.steps : []),
  }
}

function readRunHistory(limit = 100) {
  try {
    if (!fs.existsSync(RUN_HISTORY_FILE)) return []
    const lines = fs.readFileSync(RUN_HISTORY_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
    return lines
      .slice(-Math.max(1, limit))
      .map(line => {
        try { return JSON.parse(line) } catch { return null }
      })
      .filter(Boolean)
      .reverse()
  } catch (error) {
    console.error('[RunHistory] 读取失败:', error.message)
    return []
  }
}

function appendRunRecord(input) {
  ensureWorkspaceDir()
  const record = normalizeRunRecord(input)
  fs.appendFileSync(RUN_HISTORY_FILE, `${JSON.stringify(record)}\n`, 'utf8')

  try {
    const lines = fs.readFileSync(RUN_HISTORY_FILE, 'utf8').split('\n').filter(Boolean)
    if (lines.length > MAX_RUN_HISTORY) {
      fs.writeFileSync(RUN_HISTORY_FILE, `${lines.slice(-MAX_RUN_HISTORY).join('\n')}\n`, 'utf8')
    }
  } catch (error) {
    console.error('[RunHistory] 裁剪失败:', error.message)
  }

  return record
}

export { appendRunRecord, readRunHistory }
