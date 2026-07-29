import React, { useState } from 'react'
import { Table, Card, Row, Col, Statistic, Tag, Typography, Space, Tabs } from 'antd'
import { Radar, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts'
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'

const { Title, Text } = Typography

// AI Framework data
const frameworks = [
  {
    key: 'react',
    name: 'ReAct',
    developer: 'Yao et al. (Google)',
    year: 2022,
    paradigm: '推理+行动',
    memory: '短期',
    planning: '迭代式',
    autonomy: '中等',
    tools: 'API/搜索',
    reasoning: '交替推理与行动',
    bestFor: '问答、推理任务',
    pros: ['推理过程透明', '实现简单', '可解释性强'],
    cons: ['迭代效率低', '长链推理易出错', '内存有限'],
    performance: 78,
    usability: 85,
    scalability: 60,
    flexibility: 90,
    robustness: 70,
    ecosystem: 75
  },
  {
    key: 'plan-execute',
    name: 'Plan-and-Execute',
    developer: 'LangChain',
    year: 2023,
    paradigm: '规划再执行',
    memory: '长期+短期',
    planning: '全局规划',
    autonomy: '高',
    tools: '全功能',
    reasoning: '先规划后执行',
    bestFor: '复杂任务、多步操作',
    pros: ['全局规划', '可分解复杂任务', '支持多步'],
    cons: ['规划偏差影响大', '调试复杂', '启动慢'],
    performance: 82,
    usability: 70,
    scalability: 85,
    flexibility: 88,
    robustness: 75,
    ecosystem: 80
  },
  {
    key: 'autogpt',
    name: 'AutoGPT',
    developer: 'Significant Gravitas',
    year: 2023,
    paradigm: '自主循环',
    memory: '长期+向量',
    planning: '动态规划',
    autonomy: '极高',
    tools: '全功能+插件',
    reasoning: '目标驱动自主循环',
    bestFor: '自动化任务、创意项目',
    pros: ['高度自治', '社区活跃', '插件丰富'],
    cons: ['成本高', '不可预测', '容易跑偏'],
    performance: 72,
    usability: 60,
    scalability: 75,
    flexibility: 85,
    robustness: 55,
    ecosystem: 90
  },
  {
    key: 'babyagi',
    name: 'BabyAGI',
    developer: 'Yohei Nakajima',
    year: 2023,
    paradigm: '任务驱动',
    memory: '向量数据库',
    planning: '递归式',
    autonomy: '高',
    tools: '基础',
    reasoning: '任务创建-优先级-执行',
    bestFor: '任务管理、自动化流程',
    pros: ['轻量级', '专注任务管理', '易扩展'],
    cons: ['功能单一', '工具集成弱', '社区较小'],
    performance: 68,
    usability: 75,
    scalability: 55,
    flexibility: 80,
    robustness: 60,
    ecosystem: 65
  },
  {
    key: 'metagpt',
    name: 'MetaGPT',
    developer: 'DeepWisdom',
    year: 2023,
    paradigm: '多Agent协作',
    memory: '共享',
    planning: '角色驱动',
    autonomy: '高',
    tools: '全功能',
    reasoning: '角色扮演+标准化流程',
    bestFor: '软件项目、复杂协作',
    pros: ['多角色协作', '标准化输出', '适合软件工程'],
    cons: ['配置复杂', '资源消耗大', '学习曲线陡'],
    performance: 85,
    usability: 65,
    scalability: 90,
    flexibility: 82,
    robustness: 80,
    ecosystem: 78
  }
]

// Comparison dimensions
const comparisonDimensions = [
  { title: '框架', dataIndex: 'name', key: 'name', width: 100 },
  { title: '开发者', dataIndex: 'developer', key: 'developer', width: 150 },
  { title: '年份', dataIndex: 'year', key: 'year', width: 80 },
  { title: '推理范式', dataIndex: 'paradigm', key: 'paradigm', width: 120 },
  { title: '记忆机制', dataIndex: 'memory', key: 'memory', width: 100 },
  { title: '规划方式', dataIndex: 'planning', key: 'planning', width: 100 },
  { title: '自主级别', dataIndex: 'autonomy', key: 'autonomy', width: 100 },
  { title: '工具集成', dataIndex: 'tools', key: 'tools', width: 120 },
  { title: '最佳场景', dataIndex: 'bestFor', key: 'bestFor', width: 180 },
]

// Radar chart data
const radarData = frameworks.map(f => ({
  framework: f.name,
  性能: f.performance,
  易用性: f.usability,
  可扩展性: f.scalability,
  灵活性: f.flexibility,
  鲁棒性: f.robustness,
  生态: f.ecosystem
}))

// Bar chart data
const barData = frameworks.map(f => ({
  name: f.name,
  总体评分: Math.round((f.performance + f.usability + f.scalability + f.flexibility + f.robustness + f.ecosystem) / 6)
}))

const AIFrameworkCompare: React.FC = () => {
  const [selectedFrameworks, setSelectedFrameworks] = useState<string[]>(frameworks.map(f => f.key))

  const filteredFrameworks = frameworks.filter(f => selectedFrameworks.includes(f.key))

  const handleFrameworkToggle = (key: string) => {
    setSelectedFrameworks(prev => 
      prev.includes(key) 
        ? prev.filter(k => k !== key)
        : [...prev, key]
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <Title level={2}>🤖 AI Agent 框架横评</Title>
      <Text type="secondary">
        对比 ReAct、Plan-and-Execute、AutoGPT、BabyAGI、MetaGPT 五大框架的核心特性
      </Text>

      {/* Quick Stats */}
      <Row gutter={16} style={{ marginTop: 24, marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="框架总数" value={frameworks.length} suffix="个" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="最高评分" value={85} suffix="分" />
            <Text type="secondary">MetaGPT</Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="最易使用" value={85} suffix="分" />
            <Text type="secondary">ReAct</Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="最强自主" value="AutoGPT" />
            <Text type="secondary">自主循环</Text>
          </Card>
        </Col>
      </Row>

      {/* Framework Selection */}
      <Card style={{ marginBottom: 24 }}>
        <Space>
          <Text strong>显示框架：</Text>
          {frameworks.map(f => (
            <Tag.CheckableTag
              key={f.key}
              checked={selectedFrameworks.includes(f.key)}
              onChange={() => handleFrameworkToggle(f.key)}
            >
              {f.name}
            </Tag.CheckableTag>
          ))}
        </Space>
      </Card>

      {/* Tabs: Table / Radar / Bar / Pros & Cons */}
      <Card>
        <Tabs
          defaultActiveKey="table"
          items={[
            {
              key: 'table',
              label: '📊 对比表格',
              children: (
                <Table
                  columns={comparisonDimensions}
                  dataSource={filteredFrameworks}
                  pagination={false}
                  scroll={{ x: 1200 }}
                  size="small"
                />
              )
            },
            {
              key: 'radar',
              label: '🎯 六维雷达图',
              children: (
                <ResponsiveContainer width="100%" height={450}>
                  <RadarChart data={radarData.filter(d => selectedFrameworks.includes(frameworks.find(f => f.name === d.framework)?.key || ''))}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="framework" />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} />
                    <Radar name="性能" dataKey="性能" stroke="#1890ff" fill="#1890ff" fillOpacity={0.2} />
                    <Radar name="易用性" dataKey="易用性" stroke="#52c41a" fill="#52c41a" fillOpacity={0.2} />
                    <Radar name="可扩展性" dataKey="可扩展性" stroke="#faad14" fill="#faad14" fillOpacity={0.2} />
                    <Radar name="灵活性" dataKey="灵活性" stroke="#f5222d" fill="#f5222d" fillOpacity={0.2} />
                    <Radar name="鲁棒性" dataKey="鲁棒性" stroke="#722ed1" fill="#722ed1" fillOpacity={0.2} />
                    <Radar name="生态" dataKey="生态" stroke="#13c2c2" fill="#13c2c2" fillOpacity={0.2} />
                    <Legend />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              )
            },
            {
              key: 'bar',
              label: '📈 总体评分',
              children: (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={barData.filter(d => selectedFrameworks.includes(frameworks.find(f => f.name === d.name)?.key || ''))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="总体评分" fill="#1890ff" name="总体评分" />
                  </BarChart>
                </ResponsiveContainer>
              )
            },
            {
              key: 'procons',
              label: '✅ 优缺点',
              children: (
                <Row gutter={[16, 16]}>
                  {filteredFrameworks.map(f => (
                    <Col span={12} key={f.key}>
                      <Card title={<span><strong>{f.name}</strong> — {f.paradigm}</span>} size="small">
                        <Text strong>优点：</Text>
                        <ul>
                          {f.pros.map((p, i) => <li key={i}><CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />{p}</li>)}
                        </ul>
                        <Text strong>缺点：</Text>
                        <ul>
                          {f.cons.map((c, i) => <li key={i}><CloseCircleOutlined style={{ color: '#f5222d', marginRight: 8 }} />{c}</li>)}
                        </ul>
                      </Card>
                    </Col>
                  ))}
                </Row>
              )
            }
          ]}
        />
      </Card>

      {/* Recommendation */}
      <Card style={{ marginTop: 24 }} title="💡 选型建议">
        <Row gutter={16}>
          <Col span={8}>
            <Card size="small" type="inner" title="快速原型 / 教学">
              <Text>→ <strong>ReAct</strong>：最简单，推理透明，适合入门和快速验证</Text>
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" type="inner" title="复杂任务 / 企业级">
              <Text>→ <strong>MetaGPT</strong>：多角色协作，标准化输出，适合软件项目</Text>
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" type="inner" title="自动化工单 / 探索">
              <Text>→ <strong>AutoGPT</strong>：最高自主性，适合探索性自动化任务</Text>
            </Card>
          </Col>
        </Row>
      </Card>
    </div>
  )
}

export default AIFrameworkCompare
