// ============================================================
// 灵枢 v3.0 — 聊天头部组件
// Phase 2: 新增对比模式切换按钮
// ============================================================

import React from 'react'
import { Space, Select, Button, Tooltip, Typography, Switch } from 'antd'
import {
  SettingOutlined,
  ThunderboltOutlined,
  PlusOutlined,
  SwapOutlined,
} from '@ant-design/icons'

const { Text } = Typography

interface ChatHeaderProps {
  title: string
  selectedModel: string
  models: Array<{ value: string; label: string; desc: string }>
  onModelChange: (model: string) => void
  onNewSession: () => void
  onSettings?: () => void
  /** 对比模式状态 */
  compareMode?: boolean
  /** 切换对比模式 */
  onToggleCompare?: (enabled: boolean) => void
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  title,
  selectedModel,
  models,
  onModelChange,
  onNewSession,
  onSettings,
  compareMode = false,
  onToggleCompare,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-color, #f0f0f0)',
        background: 'var(--bg-header, #fff)',
      }}
    >
      <Space>
        <Text strong style={{ fontSize: 16 }}>
          {title}
        </Text>
      </Space>

      <Space>
        {/* 对比模式切换 */}
        {onToggleCompare && (
          <Tooltip title="开启后可选择多个模型并行对比回复">
            <Space size={4}>
              <SwapOutlined style={{ color: compareMode ? '#1677ff' : '#999' }} />
              <Switch
                size="small"
                checked={compareMode}
                onChange={onToggleCompare}
              />
              <Text style={{ fontSize: 12, color: compareMode ? '#1677ff' : '#999' }}>
                对比
              </Text>
            </Space>
          </Tooltip>
        )}

        <Select
          value={selectedModel}
          onChange={onModelChange}
          style={{ minWidth: 180 }}
          size="small"
          options={models.map(m => ({
            value: m.value,
            label: (
              <Space>
                <ThunderboltOutlined style={{ color: '#52c41a' }} />
                <span>{m.label}</span>
              </Space>
            ),
          }))}
        />

        <Tooltip title="新建对话">
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={onNewSession}
          />
        </Tooltip>

        {onSettings && (
          <Tooltip title="设置">
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={onSettings}
            />
          </Tooltip>
        )}
      </Space>
    </div>
  )
}
