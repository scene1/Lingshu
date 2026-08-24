// ============================================================
// 灵枢 Phase 2 — Agent Team 角色选择器
// 选择角色（coordinator/executor/reviewer/researcher）+ 分配 Agent + 模型
// ============================================================

import React from 'react'
import { Select, Tag, Space, Tooltip, Card, Row, Col, Avatar } from 'antd'
import {
  SearchOutlined,
  CrownOutlined, ToolOutlined, CheckCircleOutlined
} from '@ant-design/icons'
import type { AgentRole, TeamRoleConfig } from '../../types'

// 角色配置
const ROLE_CONFIG: Record<AgentRole, {
  label: string
  icon: React.ReactNode
  color: string
  systemPromptTemplate: string
  description: string
}> = {
  coordinator: {
    label: '项目经理',
    icon: <CrownOutlined />,
    color: '#722ed1',
    systemPromptTemplate: '你是一个项目经理（Coordinator），负责协调团队成员、分配任务、把控进度。请分析用户需求，制定执行计划，并协调其他角色完成任务。',
    description: '负责协调团队成员、分配任务、把控进度',
  },
  executor: {
    label: '执行者',
    icon: <ToolOutlined />,
    color: '#1890ff',
    systemPromptTemplate: '你是一个执行者（Executor），负责按照计划完成具体任务。请根据项目经理的分配，高效执行任务并输出结果。',
    description: '负责按照计划完成具体任务',
  },
  reviewer: {
    label: '审查者',
    icon: <CheckCircleOutlined />,
    color: '#52c41a',
    systemPromptTemplate: '你是一个审查者（Reviewer），负责检查和验证执行结果。请仔细审查输出内容，发现问题并提出改进建议。',
    description: '负责检查和验证执行结果',
  },
  researcher: {
    label: '研究员',
    icon: <SearchOutlined />,
    color: '#fa8c16',
    systemPromptTemplate: '你是一个研究员（Researcher），负责收集信息、分析数据、提供背景知识。请深入研究相关主题，为团队提供有价值的洞察。',
    description: '负责收集信息、分析数据、提供背景知识',
  },
}

export interface TeamRoleSelectorProps {
  /** 已配置的角色列表 */
  roles: TeamRoleConfig[]
  /** 可用 Agent 列表 */
  agents: Array<{ id: string; name: string; model: string }>
  /** 可用模型列表 */
  models: Array<{ value: string; label: string }>
  /** 角色变更回调 */
  onChange: (roles: TeamRoleConfig[]) => void
}

export const TeamRoleSelector: React.FC<TeamRoleSelectorProps> = ({
  roles,
  agents,
  models,
  onChange,
}) => {
  /** 更新某个角色的配置 */
  const updateRole = (index: number, patch: Partial<TeamRoleConfig>) => {
    const updated = [...roles]
    updated[index] = { ...updated[index], ...patch }
    onChange(updated)
  }

  /** 添加角色 */
  const addRole = (role: AgentRole) => {
    const config = ROLE_CONFIG[role]
    const newRole: TeamRoleConfig = {
      agentId: agents[0]?.id || '',
      model: agents[0]?.model || models[0]?.value || '',
      role,
      systemPrompt: config.systemPromptTemplate,
      avatarColor: config.color,
    }
    onChange([...roles, newRole])
  }

  /** 移除角色 */
  const removeRole = (index: number) => {
    onChange(roles.filter((_, i) => i !== index))
  }

  return (
    <div className="team-role-selector">
      <Row gutter={[12, 12]}>
        {roles.map((roleConfig, index) => {
          const config = ROLE_CONFIG[roleConfig.role]
          return (
            <Col key={index} span={24}>
              <Card
                size="small"
                style={{ borderColor: config.color + '40' }}
                title={
                  <Space>
                    <Avatar size="small" style={{ backgroundColor: config.color }}>
                      {config.icon}
                    </Avatar>
                    <span>{config.label}</span>
                    <Tag color={config.color}>{roleConfig.role}</Tag>
                  </Space>
                }
                extra={
                  <a
                    onClick={() => removeRole(index)}
                    style={{ color: '#ff4d4f', fontSize: 12, cursor: 'pointer' }}
                  >
                    移除
                  </a>
                }
              >
                <Row gutter={[8, 8]}>
                  <Col span={12}>
                    <label style={{ fontSize: 12, color: '#666' }}>分配 Agent</label>
                    <Select
                      style={{ width: '100%', marginTop: 4 }}
                      value={roleConfig.agentId}
                      onChange={(val) => updateRole(index, { agentId: val })}
                      options={agents.map(a => ({
                        value: a.id,
                        label: `${a.name} (${a.model})`,
                      }))}
                      placeholder="选择 Agent"
                    />
                  </Col>
                  <Col span={12}>
                    <label style={{ fontSize: 12, color: '#666' }}>使用模型</label>
                    <Select
                      style={{ width: '100%', marginTop: 4 }}
                      value={roleConfig.model}
                      onChange={(val) => updateRole(index, { model: val })}
                      options={models}
                      placeholder="选择模型"
                    />
                  </Col>
                  <Col span={24}>
                    <Tooltip title={config.description}>
                      <span style={{ fontSize: 12, color: '#999' }}>{config.description}</span>
                    </Tooltip>
                  </Col>
                </Row>
              </Card>
            </Col>
          )
        })}
      </Row>

      {/* 添加角色按钮 */}
      <Row gutter={[8, 8]} style={{ marginTop: 12 }}>
        {(Object.keys(ROLE_CONFIG) as AgentRole[]).map(role => {
          const config = ROLE_CONFIG[role]
          const exists = roles.some(r => r.role === role)
          return (
            <Col key={role} span={6}>
              <Card
                hoverable
                size="small"
                onClick={() => !exists && addRole(role)}
                style={{
                  opacity: exists ? 0.4 : 1,
                  cursor: exists ? 'not-allowed' : 'pointer',
                  textAlign: 'center',
                }}
              >
                <Avatar size="small" style={{ backgroundColor: config.color }}>
                  {config.icon}
                </Avatar>
                <div style={{ fontSize: 12, marginTop: 4 }}>{config.label}</div>
              </Card>
            </Col>
          )
        })}
      </Row>
    </div>
  )
}

export default TeamRoleSelector
