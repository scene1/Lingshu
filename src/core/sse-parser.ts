// ============================================================
// 灵枢 v3.0 — SSE 流解析器
// 解析 Server-Sent Events 格式的流式响应
// 支持 event: + data: 多行格式，处理跨 chunk 的不完整 buffer
// ============================================================

import type { SSEEvent } from '../types'

/**
 * SSE 流解析器
 *
 * 负责将后端推送的 SSE 文本流解析为结构化的 SSEEvent 数组。
 * 后端格式约定：
 *   event: token
 *   data: {"content": "你好"}
 *   (空行分隔)
 *
 * 每次调用 feed(chunk) 时，将新数据追加到内部 buffer，
 * 然后尝试解析所有完整的事件（以空行分隔）。
 * 不完整的事件保留在 buffer 中等待下次 feed。
 */
export class SSEParser {
  private buffer: string = ''

  /**
   * 喂入新的文本 chunk，返回解析出的完整 SSE 事件数组
   * @param chunk 新的文本片段
   * @returns 解析出的 SSEEvent 数组（可能为空，表示数据不完整）
   */
  feed(chunk: string): SSEEvent[] {
    this.buffer += chunk
    const events: SSEEvent[] = []

    // SSE 事件以双换行（空行）分隔
    // 兼容 \r\n 和 \n
    const separator = '\n\n'
    let separatorIndex: number

    while ((separatorIndex = this.buffer.indexOf(separator)) !== -1) {
      const rawEvent = this.buffer.slice(0, separatorIndex)
      this.buffer = this.buffer.slice(separatorIndex + separator.length)

      // 也处理 \r\n\r\n 的情况
      const cleanedEvent = rawEvent.replace(/\r\n/g, '\n').trim()
      if (!cleanedEvent) continue

      const event = this.parseEventBlock(cleanedEvent)
      if (event) {
        events.push(event)
      }
    }

    return events
  }

  /**
   * 解析单个 SSE 事件块
   * @param block 不含分隔空行的事件文本
   * @returns 解析后的 SSEEvent，或 null（无效格式）
   */
  private parseEventBlock(block: string): SSEEvent | null {
    let eventType = 'message' // SSE 默认事件类型
    const dataLines: string[] = []

    const lines = block.split('\n')
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      } else if (line.startsWith(':')) {
        // SSE 注释行，忽略
        continue
      }
      // 忽略其他无法识别的行
    }

    if (dataLines.length === 0) return null

    const rawData = dataLines.join('\n')

    // 尝试 JSON 解析 data
    let parsedData: unknown
    try {
      parsedData = JSON.parse(rawData)
    } catch {
      // 非 JSON，保留原始字符串
      parsedData = rawData
    }

    return {
      type: eventType as SSEEvent['type'],
      data: parsedData,
    }
  }

  /**
   * 解析 buffer 中剩余的所有数据（用于流结束时）
   * @returns 剩余的 SSE 事件数组
   */
  parse(): SSEEvent[] {
    const remaining = this.buffer.trim()
    this.buffer = ''
    if (!remaining) return []

    const event = this.parseEventBlock(remaining)
    return event ? [event] : []
  }

  /**
   * 重置解析器状态
   */
  reset(): void {
    this.buffer = ''
  }
}
