import React, { useState, useEffect } from 'react'
import { Card, Table, Button, Tag, Space, Modal, Input, message, Popconfirm, Upload, Typography } from 'antd'
import { UploadOutlined, InboxOutlined, SaveOutlined } from '@ant-design/icons'
import {
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons'

const { Dragger } = Upload
const { Text } = Typography

interface Skill {
  id: string
  name: string
  version: string
  description: string
  status: 'active' | 'inactive' | 'error'
  category: string
  installedAt: string
}

const Skills: React.FC = () => {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(false)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [installInput, setInstallInput] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [extraDirsText, setExtraDirsText] = useState('')
  const [savingDirs, setSavingDirs] = useState(false)

  // 从 API 获取 skills
  const fetchSkills = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/skills')
      const data = await response.json()
      setSkills(data)
    } catch (error) {
      message.error('获取 skills 失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const fetchSkillConfig = async () => {
    try {
      const response = await fetch('/api/config')
      if (!response.ok) return
      const config = await response.json()
      const extraDirs = Array.isArray(config?.skills?.load?.extraDirs)
        ? config.skills.load.extraDirs
        : []
      setExtraDirsText(extraDirs.join('\n'))
    } catch (error) {
      console.error('获取 Skills 配置失败:', error)
    }
  }

  // 组件加载时获取数据
  useEffect(() => {
    fetchSkills()
    fetchSkillConfig()
  }, [])

  const handleSaveExtraDirs = async () => {
    setSavingDirs(true)
    try {
      const response = await fetch('/api/config')
      if (!response.ok) throw new Error('读取配置失败')
      const config = await response.json()
      const extraDirs = extraDirsText
        .split('\n')
        .map(dir => dir.trim())
        .filter(Boolean)

      if (!config.skills) config.skills = {}
      if (!config.skills.load) config.skills.load = {}
      config.skills.load.extraDirs = extraDirs

      const saveResponse = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      if (!saveResponse.ok) throw new Error('保存配置失败')
      message.success('Skills 目录配置已保存')
      fetchSkills()
    } catch (error) {
      message.error('保存 Skills 目录配置失败')
      console.error(error)
    } finally {
      setSavingDirs(false)
    }
  }

  const handleInstall = async () => {
    const formData = new FormData()
    formData.append('input', installInput)
    if (uploadFile) formData.append('file', uploadFile)

    try {
      const res = await fetch('/api/skills/install', { method: 'POST', body: formData })
      if (res.ok) {
        message.success('Skill 安装成功')
        setIsModalOpen(false)
        setInstallInput('')
        setUploadFile(null)
        fetchSkills()
      } else {
        const err = await res.json()
        message.error(err.error || '安装失败')
      }
    } catch {
      message.error('安装请求失败')
    }
  }

  const handleUninstall = async (id: string) => {
    try {
      const response = await fetch(`/api/skills/${id}`, { method: 'DELETE' })
      if (response.ok) {
        message.success('Skill 已卸载')
        fetchSkills() // 刷新列表
      } else {
        message.error('卸载失败')
      }
    } catch (error) {
      message.error('卸载失败')
      console.error(error)
    }
  }

  const handleReload = async (id: string) => {
    try {
      // 调用重启 API
      const response = await fetch(`/api/skills/${id}/reload`, { method: 'POST' })
      if (response.ok) {
        message.success(`Skill ${id} 已重新加载`)
        fetchSkills() // 刷新列表
      } else {
        message.error('重载失败')
      }
    } catch (error) {
      message.error('重载失败')
      console.error(error)
    }
  }

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'active':
        return <Tag color="success"><CheckCircleOutlined /> 运行中</Tag>
      case 'inactive':
        return <Tag color="default">已停用</Tag>
      case 'error':
        return <Tag color="error"><ExclamationCircleOutlined /> 错误</Tag>
      default:
        return <Tag>未知</Tag>
    }
  }

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Skill) => (
        <div>
          <strong>{text}</strong>
          <div style={{ color: '#999', fontSize: 12 }}>{record.description}</div>
        </div>
      )
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 100
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (text: string) => <Tag>{text}</Tag>
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string) => getStatusTag(status)
    },
    {
      title: '安装时间',
      dataIndex: 'installedAt',
      key: 'installedAt',
      width: 120
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: Skill) => (
        <Space>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => handleReload(record.id)}
          >
            重载
          </Button>
          <Popconfirm
            title="确认卸载"
            description={`确定要卸载 ${record.name} 吗？`}
            onConfirm={() => handleUninstall(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              卸载
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  const filteredSkills = skills.filter(s =>
    s.name.toLowerCase().includes(searchText.toLowerCase()) ||
    s.description.includes(searchText)
  )

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>Skills 管理</h2>

      <Card
        title="Skills 加载目录"
        style={{ marginBottom: 16 }}
        extra={
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveExtraDirs} loading={savingDirs}>
            保存目录
          </Button>
        }
      >
        <Text strong style={{ display: 'block', marginBottom: 8 }}>额外 Skills 目录</Text>
        <Input.TextArea
          value={extraDirsText}
          onChange={e => setExtraDirsText(e.target.value)}
          placeholder={"每行一个目录路径，例如：\n/Users/xxx/.stepfun/skills\n/Applications/某应用.app/Contents/Resources/skills"}
          rows={4}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />
        <Text type="secondary" style={{ fontSize: 12, marginTop: 6, display: 'block' }}>
          保存到 openclaw.json 的 skills.load.extraDirs。调整后刷新列表即可查看已加载的 Skills。
        </Text>
      </Card>
      
      <Card
        extra={
          <Space>
            <Input
              placeholder="搜索 skills..."
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ width: 200 }}
            />
            <Button icon={<ReloadOutlined />} onClick={fetchSkills} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>
              安装 Skill
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={filteredSkills}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title="安装 Skill"
        open={isModalOpen}
        onOk={handleInstall}
        onCancel={() => { setIsModalOpen(false); setInstallInput(''); setUploadFile(null) }}
        okText="安装"
        cancelText="取消"
      >
        <p>输入 skill 名称或 GitHub 地址：</p>
        <Input
          placeholder="例如: weather 或 github:user/repo"
          value={installInput}
          onChange={e => setInstallInput(e.target.value)}
          style={{ marginBottom: 16 }}
        />
        <Dragger
          accept=".zip,.tar.gz,.tgz"
          maxCount={1}
          fileList={uploadFile ? [{ uid: '-1', name: uploadFile.name, status: 'done' } as any] : []}
          beforeUpload={(file) => {
            setUploadFile(file)
            return false
          }}
          onRemove={() => setUploadFile(null)}
          style={{ marginBottom: 16 }}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽 .zip / .tar.gz 文件到此区域</p>
          <p className="ant-upload-hint">支持离线 Skill 包上传</p>
        </Dragger>
        <Button
          icon={<UploadOutlined />}
          onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.webkitdirectory = true
            input.onchange = (e: any) => {
              const files = e.target?.files
              if (files?.length) setInstallInput(files[0].webkitRelativePath.split('/')[0])
            }
            input.click()
          }}
        >
          选择本地文件夹
        </Button>
        <div style={{ marginTop: 16, color: '#999' }}>
          支持从以下源安装：
          <ul>
            <li>内置 skills（直接输入名称）</li>
            <li>GitHub 仓库（user/repo 格式）</li>
            <li>本地路径（/path/to/skill）</li>
          </ul>
        </div>
      </Modal>
    </div>
  )
}

export default Skills
