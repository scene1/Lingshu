const DSML_BLOCK_RE = /<\s*\/?\s*\|\s*\|\s*DSML\s*\|\s*\|\s*\/?\s*tool_calls\b[^>]*>[\s\S]*?<\s*\/?\s*\|\s*\|\s*DSML\s*\|\s*\|\s*\/?\s*tool_calls\s*>/gi
const DSML_INVOKE_BLOCK_RE = /<\s*\/?\s*\|\s*\|\s*DSML\s*\|\s*\|\s*\/?\s*invoke\b[^>]*>[\s\S]*?<\s*\/?\s*\|\s*\|\s*DSML\s*\|\s*\|\s*\/?\s*invoke\s*>/gi
const VISIBLE_TOOL_BLOCK_RE = /<\s*工具调用\s*>[\s\S]*?<\s*\/\s*工具调用\s*>/g
const INTERNAL_CODE_FENCE_RE = /```[\s\S]*?(?:DSML|tool_calls|本地灵枢运行时|exec_command|invoke\s+name=)[\s\S]*?```/gi
const DSML_TAG_RE = /<\s*\/?\s*\|\s*\|\s*DSML\s*\|\s*\|\s*\/?\s*(?:tool_calls|invoke|parameter)\b[^>]*>/i
const DSML_BLOCK_OPEN_RE = /<\s*\|\s*\|\s*DSML\s*\|\s*\|\s*(?:tool_calls|invoke)\b[^>]*>/i
const DSML_BLOCK_CLOSE_RE = /<\s*\/\s*\|\s*\|\s*DSML\s*\|\s*\|\s*(?:tool_calls|invoke)\b[^>]*>|<\s*\|\s*\|\s*DSML\s*\|\s*\|\s*\/\s*(?:tool_calls|invoke)\b[^>]*>/i

function decodeInternalControlEntities(text: string) {
  if (!/DSML|tool_calls|工具调用|本地灵枢运行时|exec_command/.test(text)) return text
  return text
    .replace(/&amp;lt;/gi, '<')
    .replace(/&amp;gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#124;|&vert;/gi, '|')
}

export function sanitizeAssistantContent(content: string) {
  let text = decodeInternalControlEntities(String(content || ''))
  if (!/DSML|tool_calls|工具调用|本地灵枢运行时|exec_command/.test(text)) return text
  text = text
    .replace(INTERNAL_CODE_FENCE_RE, '')
    .replace(DSML_BLOCK_RE, '')
    .replace(DSML_INVOKE_BLOCK_RE, '')
    .replace(VISIBLE_TOOL_BLOCK_RE, '')

  const lines = text.split('\n')
  const cleaned: string[] = []
  let removed = false
  let insideDsmlBlock = false
  let insideVisibleToolBlock = false

  for (const line of lines) {
    if (insideVisibleToolBlock) {
      removed = true
      if (/<\s*\/\s*工具调用\s*>/.test(line)) insideVisibleToolBlock = false
      continue
    }
    if (/\[本地灵枢运行时\]|exec_command/.test(line)) {
      removed = true
      continue
    }
    if (/<\s*工具调用\s*>/.test(line)) {
      removed = true
      if (!/<\s*\/\s*工具调用\s*>/.test(line)) insideVisibleToolBlock = true
      continue
    }

    if (insideDsmlBlock) {
      removed = true
      if (DSML_BLOCK_CLOSE_RE.test(line)) insideDsmlBlock = false
      continue
    }
    if (DSML_TAG_RE.test(line)) {
      removed = true
      if (DSML_BLOCK_OPEN_RE.test(line) && !DSML_BLOCK_CLOSE_RE.test(line)) insideDsmlBlock = true
      continue
    }

    cleaned.push(line)
  }

  return (removed ? cleaned.join('\n') : text)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
