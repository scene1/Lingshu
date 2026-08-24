function compactText(value, maxChars) {
  const text = String(value || '')
  if (text.length <= maxChars) return text
  const tailChars = Math.max(120, Math.floor(maxChars * 0.3))
  const headChars = maxChars - tailChars
  return `${text.slice(0, headChars)}\n...[truncated for trend storage]...\n${text.slice(-tailChars)}`
}

export function compactEvaluationReport(report = {}) {
  return {
    ...report,
    results: Array.isArray(report.results) ? report.results.map(item => ({
      ...item,
      prompt: compactText(item.prompt, 1200),
      rubric: compactText(item.rubric, 1000),
      output: compactText(item.output, 600),
      outputTruncated: String(item.output || '').length > 600,
    })) : [],
  }
}
