const SENSITIVE_KEY_PATTERN = /(?:^|[_-])(authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|session)(?:$|[_-])/i
const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie'])
const REDACTED = '[REDACTED]'
const MASKED_SECRET = '********'

function isSensitiveKey(key = '') {
  const normalized = String(key)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
  return SENSITIVE_HEADER_NAMES.has(normalized) || SENSITIVE_KEY_PATTERN.test(normalized)
}

function redactSensitiveText(value = '') {
  return String(value)
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1***:***@')
    .replace(/([?&](?:[^=&]*(?:token|key|secret|signature|sig|authorization|password)[^=&]*)=)[^&#\s]+/gi, '$1***')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
    .replace(/\b(sk|key|token|secret)-[A-Za-z0-9_-]{12,}\b/gi, '$1-***')
}

function redactSensitiveValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (value === null || value === undefined || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    const result = value.map(item => redactSensitiveValue(item, seen))
    seen.delete(value)
    return result
  }

  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    isSensitiveKey(key) && item !== '' && item !== null && item !== undefined
      ? (item === MASKED_SECRET || item === REDACTED ? item : REDACTED)
      : /^(?:message|error|reason)$/i.test(key) && typeof item === 'string'
        ? sanitizePublicError(item, '')
      : redactSensitiveValue(item, seen),
  ]))
  seen.delete(value)
  return result
}

function maskSensitiveValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    const result = value.map(item => maskSensitiveValue(item, seen))
    seen.delete(value)
    return result
  }
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    isSensitiveKey(key) && item !== '' && item !== null && item !== undefined
      ? MASKED_SECRET
      : maskSensitiveValue(item, seen),
  ]))
  seen.delete(value)
  return result
}

function mergePreservingMaskedSecrets(existing, incoming, key = '') {
  if (isSensitiveKey(key) && (incoming === MASKED_SECRET || incoming === REDACTED)) return existing
  if (Array.isArray(incoming)) {
    const source = Array.isArray(existing) ? existing : []
    return incoming.map((item, index) => mergePreservingMaskedSecrets(source[index], item))
  }
  if (incoming && typeof incoming === 'object') {
    const source = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
    return Object.fromEntries(Object.entries(incoming).map(([childKey, item]) => [
      childKey,
      mergePreservingMaskedSecrets(source[childKey], item, childKey),
    ]))
  }
  return incoming
}

function sanitizePublicError(error, fallback = '请求处理失败') {
  const message = redactSensitiveText(error?.message || error || '')
    .replace(/\/(?:Users|home|private|var|tmp)\/[^\s,;]+/g, '[local path]')
    .replace(/[A-Za-z]:\\[^\s,;]+/g, '[local path]')
    .replace(/\s+/g, ' ')
    .trim()
  if (!message) return fallback
  return message.slice(0, 240)
}

function isHighRiskPermission(permission) {
  if (!permission) return false
  if (typeof permission === 'string') {
    return /shell|exec|process|write|delete|desktop|network|http|fetch|credential|secret/i.test(permission)
  }
  const key = String(permission.key || permission.name || '')
  const level = String(permission.level || '').toLowerCase()
  return level === 'high' || /shell|exec|process|write|delete|desktop|network|http|fetch|credential|secret/i.test(key)
}

export {
  REDACTED,
  MASKED_SECRET,
  isHighRiskPermission,
  isSensitiveKey,
  maskSensitiveValue,
  mergePreservingMaskedSecrets,
  redactSensitiveText,
  redactSensitiveValue,
  sanitizePublicError,
}
