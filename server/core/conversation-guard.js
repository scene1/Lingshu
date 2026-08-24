import crypto from 'crypto'

const DEFAULT_TTL_MS = 10 * 60 * 1000

function normalizeChatRequestBody(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const rawMessage = typeof source.message === 'string' ? source.message : ''
  return {
    ...source,
    message: rawMessage,
    valid: rawMessage.trim().length > 0,
    requestId: String(source.requestId || '').trim().slice(0, 160),
    evaluationPolicyId: source.persist === false ? String(source.evaluationPolicyId || '').trim().slice(0, 160) : '',
  }
}

class ChatRequestCoordinator {
  constructor({ ttlMs = DEFAULT_TTL_MS } = {}) {
    this.ttlMs = ttlMs
    this.activeSessions = new Map()
    this.completedRequests = new Map()
  }

  cleanup(now = Date.now()) {
    for (const [key, expiresAt] of this.completedRequests.entries()) {
      if (expiresAt <= now) this.completedRequests.delete(key)
    }
  }

  begin(sessionKey, requestId = '') {
    this.cleanup()
    const normalizedSessionKey = String(sessionKey)
    const normalizedRequestId = String(requestId || '').trim()
    const idempotencyKey = normalizedRequestId ? `${normalizedSessionKey}:${normalizedRequestId}` : ''

    if (idempotencyKey && this.completedRequests.has(idempotencyKey)) {
      return { ok: false, code: 'DUPLICATE_REQUEST' }
    }
    const active = this.activeSessions.get(normalizedSessionKey)
    if (active) {
      return {
        ok: false,
        code: active.requestId && active.requestId === normalizedRequestId ? 'DUPLICATE_REQUEST' : 'SESSION_BUSY',
      }
    }

    const token = crypto.randomUUID()
    this.activeSessions.set(normalizedSessionKey, { token, requestId: normalizedRequestId })
    let released = false
    return {
      ok: true,
      release: ({ completed = false } = {}) => {
        if (released) return
        released = true
        const current = this.activeSessions.get(normalizedSessionKey)
        if (current?.token === token) this.activeSessions.delete(normalizedSessionKey)
        if (completed && idempotencyKey) {
          this.completedRequests.set(idempotencyKey, Date.now() + this.ttlMs)
        }
      },
    }
  }
}

export { ChatRequestCoordinator, normalizeChatRequestBody }
