// ============================================================
// 灵枢 Phase 2 — 任务分配器
// 串行/并行/条件三种分发模式
// ============================================================

import React from 'react'
import { Radio, Card, Space, Tag, Typography } from 'antd'
import {
  ArrowRightOutlined, BranchesOutlined, SplitCellsOutlined
} from '@ant-design/icons'
import type { TaskDistributionMode } from '../../types'

const { Text } = Typography

export interface TaskDistributorProps {
  /** 当前分发模式 */
  mode: TaskDistributionMode
  /** 模式变更回调 */
  onChange: (mode: TaskDistributionMode) => void
  /** 参与者数量 */
  participantCount?: number
}

const MODE_CONFIG: Record<TaskDistributionMode, {
  label: string
  icon: React.ReactNode
  color: string
  description: string
}> = {
  sequential: {
    label: '串行',
    icon: <ArrowRightOutlined />,
    color: '#1890ff',
    description: '按角色顺序依次调用，前一个完成后才启动下一个',
  },
  parallel: {
    label: '并行',
    icon: <SplitCellsOutlined />,
    color: '#52c41a',
    description: '同时调用所有执行者，结果汇总后一起返回',
  },
  conditional: {
    label: '条件',
    icon: <BranchesOutlined />,
    color: '#fa8c16',
    description: '根据消息内容关键词路由到匹配角色的 Agent',
  },
}

export const TaskDistributor: React.FC<TaskDistributorProps> = ({
  mode,
  onChange,
  participantCount = 0,
}) => {
  return (
    <Card size="small" title="任务分发模式" style={{ marginBottom: 12 }}>
      <Radio.Group
        value={mode}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%' }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {(Object.keys(MODE_CONFIG) as TaskDistributionMode[]).map(m => {
            const config = MODE_CONFIG[m]
            return (
              <Radio key={m} value={m} style={{ width: '100%' }}>
                <Space>
                  <Tag color={config.color}>{config.icon} {config.label}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>{config.description}</Text>
                </Space>
              </Radio>
            )
          })}
        </Space>
      </Radio.Group>

      {/* 分发流程可视化 */}
      {participantCount > 0 && (
        <div style={{ marginTop: 12, padding: 8, background: '#fafafa', borderRadius: 6 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {mode === 'sequential' && `将按顺序依次调用 ${participantCount} 个 Agent`}
            {mode === 'parallel' && `将同时调用 ${participantCount} 个 Agent（Promise.all）`}
            {mode === 'conditional' && `将根据消息内容路由到匹配角色的 Agent（共 ${participantCount} 个候选）`}
          </Text>
        </div>
      )}
    </Card>
  )
}

export default TaskDistributor
