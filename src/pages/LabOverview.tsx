import React from 'react'
import { Button, Card, Col, Row, Space, Tag, Typography } from 'antd'
import { ApiOutlined, BranchesOutlined, CloudOutlined, ExperimentOutlined, GithubOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Paragraph, Title, Text } = Typography

const labs = [
  {
    key: 'git-integrations',
    title: '代码仓库',
    route: '/git-integrations',
    icon: <GithubOutlined />,
    tag: '接入',
    desc: '连接 GitHub、GitLab、Gitee、自托管 Git，沉淀仓库入口和自动化触发配置。',
  },
  {
    key: 'channels',
    title: '集成渠道',
    route: '/channels',
    icon: <ApiOutlined />,
    tag: '实验',
    desc: '接入外部 IM 与消息入口，验证多渠道触达能力。',
  },
  {
    key: 'tool-registry',
    title: '工具注册表',
    route: '/tool-registry',
    icon: <CloudOutlined />,
    tag: '实验',
    desc: '统一管理 MCP、内置工具和插件工具。',
  },
  {
    key: 'automations',
    title: '自动化任务',
    route: '/automations',
    icon: <BranchesOutlined />,
    tag: '实验',
    desc: '创建定时任务和手动执行任务。',
  },
  {
    key: 'ai-compare',
    title: '方法参考',
    route: '/ai-compare',
    icon: <ExperimentOutlined />,
    tag: '参考',
    desc: '了解 ReAct、Plan-and-Execute、AutoGPT、MetaGPT 等 Agent 设计范式。',
  },
  {
    key: 'workflows',
    title: '自动化流程',
    route: '/workflows',
    icon: <BranchesOutlined />,
    tag: '实验',
    desc: '编排多步骤流程，沉淀可复用工作链路。',
  },
]

const LabOverview: React.FC = () => {
  const navigate = useNavigate()

  return (
    <div>
      <Space align="start" size={14} style={{ marginBottom: 20 }}>
        <div style={{
          display: 'grid',
          placeItems: 'center',
          width: 44,
          height: 44,
          borderRadius: 8,
          background: '#eef6ff',
          color: '#2563eb',
          fontSize: 22,
        }}>
          <ExperimentOutlined />
        </div>
        <div>
          <Title level={3} style={{ margin: 0 }}>实验室</Title>
          <Text type="secondary">集中管理仍在验证中的集成、工具和自动化能力。</Text>
        </div>
      </Space>

      <Row gutter={[16, 16]}>
        {labs.map(item => (
          <Col xs={24} md={12} xl={6} key={item.key}>
            <Card
              hoverable
              style={{ height: '100%', borderRadius: 8 }}
              bodyStyle={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              onClick={() => navigate(item.route)}
            >
              <Space align="center" style={{ marginBottom: 12 }}>
                <span style={{ color: '#2563eb', fontSize: 20 }}>{item.icon}</span>
                <Text strong>{item.title}</Text>
                <Tag color="blue">{item.tag}</Tag>
              </Space>
              <Paragraph type="secondary" style={{ flex: 1, marginBottom: 18 }}>
                {item.desc}
              </Paragraph>
              <Button type="primary" onClick={(event) => {
                event.stopPropagation()
                navigate(item.route)
              }}>
                打开
              </Button>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  )
}

export default LabOverview
