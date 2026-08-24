import crypto from 'crypto'

export class ApprovalCoordinator {
  constructor({ timeoutMs = 5 * 60 * 1000 } = {}) {
    this.timeoutMs = timeoutMs
    this.pending = new Map()
  }

  request(input = {}, { signal } = {}) {
    const id = String(input.id || `approval-${crypto.randomUUID()}`)
    if (this.pending.has(id)) throw new Error('审批请求已存在')

    return new Promise((resolve, reject) => {
      let settled = false
      const finish = result => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', handleAbort)
        this.pending.delete(id)
        resolve({ id, ...result })
      }
      const handleAbort = () => finish({ approved: false, reason: '请求已取消' })
      const timer = setTimeout(() => finish({ approved: false, reason: '审批等待超时' }), this.timeoutMs)
      if (signal?.aborted) return handleAbort()
      signal?.addEventListener('abort', handleAbort, { once: true })
      this.pending.set(id, { input: { ...input, id }, finish, createdAt: Date.now() })
    })
  }

  resolve(id, approved, reason = '') {
    const pending = this.pending.get(String(id))
    if (!pending) return false
    pending.finish({ approved: approved === true, reason: String(reason || '') })
    return true
  }

  get(id) {
    return this.pending.get(String(id))?.input || null
  }
}
