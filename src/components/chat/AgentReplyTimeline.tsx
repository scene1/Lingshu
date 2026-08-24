// ============================================================
// 灵枢 Phase 2 — Agent 回复时序可视化 (P2)
// 时间线展示每个 Agent 的回复时间、内容摘要、依赖关系
// ============================================================

import React from 'react'
import { Timeline, Card, Tag, Space, Typography, Empty } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons'
import type { AgentRunStep } from '../../types'

const { Text, Paragraph } = Typography

export interface AgentReplyTimelineProps {
  /** Agent 回复列表 */
  replies: AgentRunStep[]
}

const ROLE_COLORS: Record<string, string> = {
  coordinator: '#722ed1',
  executor: '#1890ff',
  reviewer: '#52c41a',
  researcher: '#fa8c16',
}

export const AgentReplyTimeline: React.FC<AgentReplyTimelineProps> = ({ replies }) => {
  if (!replies || replies.length === 0) {
    return <Empty description="暂无 Agent 回复" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }

  const getIcon = (status?: string) => {
    if (status === 'running') return <LoadingOutlined style={{ color: '#1890ff' }} />
    if (status === 'pending') return <ClockCircleOutlined style={{ color: '#8c8c8c' }} />
    if (status === 'error') return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
    return <CheckCircleOutlined style={{ color: '#52c41a' }} />
  }

  const getStatusColor = (status?: string) => {
    if (status === 'completed') return 'success'
    if (status === 'error') return 'error'
    if (status === 'running') return 'processing'
    return 'default'
  }

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp)
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`
    } catch {
      return '--:--:--'
    }
  }

  return (
    <Card size="small" title="Agent Team 执行轨迹" style={{ marginTop: 12, marginBottom: 12 }}>
      <Timeline
        items={replies.map((reply, index) => ({
          key: reply.id || index,
          dot: getIcon(reply.status),
          children: (
            <div>
              <Space>
                <Tag color={ROLE_COLORS[reply.role || ''] || '#1890ff'}>
                  {reply.agentId}
                </Tag>
                {reply.role && (
                  <Text type="secondary" style={{ fontSize: 12 }}>{reply.role}</Text>
                )}
                {reply.model && (
                  <Text type="secondary" style={{ fontSize: 12 }}>{reply.model}</Text>
                )}
                <Tag color={getStatusColor(reply.status)} style={{ marginInlineEnd: 0 }}>
                  {reply.status === 'completed' ? '完成' : reply.status === 'error' ? '失败' : reply.status === 'running' ? '运行中' : '等待'}
                </Tag>
                {typeof reply.durationMs === 'number' && (
                  <Text type="secondary" style={{ fontSize: 12 }}>{reply.durationMs}ms</Text>
                )}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {formatTime(reply.finishedAt || reply.startedAt)}
                </Text>
              </Space>
              <Paragraph
                ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                style={{ marginTop: 4, marginBottom: 0, fontSize: 13 }}
              >
                {reply.error || reply.outputPreview || '等待输出'}
              </Paragraph>
            </div>
          ),
        }))}
      />
    </Card>
  )
}

export default AgentReplyTimeline
