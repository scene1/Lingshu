import React, { useState, useEffect } from 'react'
import { 
  Card, 
  Row, 
  Col, 
  Tag, 
  Button, 
  Table, 
  Badge,
  Space,
  Modal,
  Form,
  Input,
  Select,
  message,
  Spin
} from 'antd'
import {
  CloudOutlined,
  DesktopOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CheckCircleOutlined
} from '@ant-design/icons'

const { Option } = Select

interface Instance {
  id: string
  name: string
  type: 'local' | 'stepfun-desktop' | 'remote' | 'cloud'
  status: 'connected' | 'disconnected' | 'error'
  host?: string
  port?: number
  configPath: string
  workspacePath: string
  description?: string
  lastConnected?: string
}

const InstanceManager: React.FC = () => {
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null)
  const [form] = Form.useForm()

  // 加载实例列表
  const loadInstances = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/instances')
      if (response.ok) {
        const data = await response.json()
        setInstances(data)
      }
    } catch (error) {
      message.error('加载实例失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInstances()
  }, [])

  // 测试连接
  const testConnection = async (id: string) => {
    try {
      const response = await fetch(`/api/instances/${id}/test`, { method: 'POST' })
      const data = await response.json()
      
      if (data.success) {
        message.success('连接成功')
        loadInstances()
      } else {
        message.error(data.message || '连接失败')
      }
    } catch (error) {
      message.error('测试连接失败')
    }
  }

  // 重启实例
  const restartInstance = async (id: string) => {
    try {
      const response = await fetch(`/api/instances/${id}/restart`, { method: 'POST' })
      const data = await response.json()
      
      if (data.success) {
        message.success('重启成功')
      } else {
        message.error(data.message || '重启失败')
      }
    } catch (error) {
      message.error('重启失败')
    }
  }

  // 删除实例
  const deleteInstance = async (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后无法恢复，是否继续？',
      onOk: async () => {
        try {
          await fetch(`/api/instances/${id}`, { method: 'DELETE' })
          message.success('删除成功')
          loadInstances()
        } catch (error) {
          message.error('删除失败')
        }
      }
    })
  }

  // 保存实例
  const handleSave = async (values: any) => {
    try {
      if (editingInstance) {
        // 更新
        await fetch(`/api/instances/${editingInstance.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        })
        message.success('更新成功')
      } else {
        // 创建
        await fetch('/api/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        })
        message.success('创建成功')
      }
      
      setModalVisible(false)
      form.resetFields()
      setEditingInstance(null)
      loadInstances()
    } catch (error) {
      message.error('保存失败')
    }
  }

  // 打开编辑弹窗
  const handleEdit = (instance: Instance) => {
    setEditingInstance(instance)
    form.setFieldsValue(instance)
    setModalVisible(true)
  }

  // 打开创建弹窗
  const handleCreate = () => {
    setEditingInstance(null)
    form.resetFields()
    setModalVisible(true)
  }

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Instance) => (
        <Space>
          {record.type === 'local' && <DesktopOutlined />}
          {record.type === 'stepfun-desktop' && <CloudOutlined />}
          {record.type === 'remote' && <CloudOutlined />}
          {record.type === 'cloud' && <CloudOutlined />}
          <span style={{ fontWeight: 500 }}>{text}</span>
        </Space>
      )
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const typeMap: Record<string, string> = {
          'local': '本地',
          'stepfun-desktop': '阶跃桌面端',
          'remote': '远程',
          'cloud': '云端'
        }
        return <Tag>{typeMap[type] || type}</Tag>
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        if (status === 'connected') {
          return <Badge status="success" text="已连接" />
        } else if (status === 'disconnected') {
          return <Badge status="default" text="未连接" />
        } else {
          return <Badge status="error" text="错误" />
        }
      }
    },
    {
      title: '配置路径',
      dataIndex: 'configPath',
      key: 'configPath',
      ellipsis: true
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Instance) => (
        <Space>
          <Button 
            type="text" 
            icon={<CheckCircleOutlined />} 
            onClick={() => testConnection(record.id)}
          >
            测试
          </Button>
          <Button 
            type="text" 
            icon={<ReloadOutlined />} 
            onClick={() => restartInstance(record.id)}
          >
            重启
          </Button>
          <Button 
            type="text" 
            icon={<EditOutlined />} 
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Button 
            type="text" 
            danger 
            icon={<DeleteOutlined />} 
            onClick={() => deleteInstance(record.id)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ]

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Space align="center">
          <CloudOutlined style={{ fontSize: 20, color: '#1890ff' }} />
          <span style={{ fontSize: 16, fontWeight: 600 }}>实例管理</span>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        {/* 统计卡片 */}
        <Col span={6}>
          <Card>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 'bold', color: '#1890ff' }}>
                {instances.length}
              </div>
              <div style={{ color: '#999' }}>总实例数</div>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 'bold', color: '#52c41a' }}>
                {instances.filter(i => i.status === 'connected').length}
              </div>
              <div style={{ color: '#999' }}>已连接</div>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 'bold', color: '#faad14' }}>
                {instances.filter(i => i.status === 'disconnected').length}
              </div>
              <div style={{ color: '#999' }}>未连接</div>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 'bold', color: '#f5222d' }}>
                {instances.filter(i => i.status === 'error').length}
              </div>
              <div style={{ color: '#999' }}>错误</div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 实例列表 */}
      <Card style={{ marginTop: 16 }} title="实例列表" extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          添加实例
        </Button>
      }>
        <Spin spinning={loading}>
          <Table 
            columns={columns} 
            dataSource={instances} 
            rowKey="id"
            pagination={false}
          />
        </Spin>
      </Card>

      {/* 创建/编辑弹窗 */}
      <Modal
        title={editingInstance ? '编辑实例' : '添加实例'}
        open={modalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setModalVisible(false)
          form.resetFields()
          setEditingInstance(null)
        }}
      >
        <Form form={form} onFinish={handleSave} layout="vertical">
          <Form.Item
            name="name"
            label="实例名称"
            rules={[{ required: true, message: '请输入实例名称' }]}
          >
            <Input placeholder="如：生产环境 OpenClaw" />
          </Form.Item>
          
          <Form.Item
            name="type"
            label="实例类型"
            rules={[{ required: true, message: '请选择实例类型' }]}
          >
            <Select placeholder="选择类型">
              <Option value="local">本地</Option>
              <Option value="stepfun-desktop">阶跃桌面端</Option>
              <Option value="remote">远程服务器</Option>
              <Option value="cloud">云端服务</Option>
            </Select>
          </Form.Item>
          
          <Form.Item
            name="configPath"
            label="配置路径"
            rules={[{ required: true, message: '请输入配置路径' }]}
            initialValue="~/.stepclaw/openclaw.json"
          >
            <Input placeholder="~/.stepclaw/openclaw.json" />
          </Form.Item>
          
          <Form.Item
            name="workspacePath"
            label="工作目录"
            rules={[{ required: true, message: '请输入工作目录' }]}
            initialValue="~/.stepclaw/workspace"
          >
            <Input placeholder="~/.stepclaw/workspace" />
          </Form.Item>
          
          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea placeholder="实例描述信息" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default InstanceManager
