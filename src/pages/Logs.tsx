import React, { useState, useEffect, useCallback } from 'react'
import { Card, Input, Select, Button, List, Tag, Space, DatePicker, message, Empty, Spin } from 'antd'
import { SearchOutlined, DownloadOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker
const { Option } = Select

interface LogEntry {
  id: string
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: string
  message: string
}

const Logs: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({
    level: 'all',
    source: 'all',
    search: ''
  })

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/logs')
      if (response.ok) {
        const data = await response.json()
        if (Array.isArray(data)) {
          setLogs(data)
        } else {
          setLogs([])
        }
      } else {
        setLogs([])
      }
    } catch (error) {
      console.error('加载日志失败:', error)
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  const getLevelTag = (level: string) => {
    const colors: Record<string, string> = {
      debug: 'default',
      info: 'processing',
      warn: 'warning',
      error: 'error'
    }
    return <Tag color={colors[level] || 'default'}>{level.toUpperCase()}</Tag>
  }

  const filteredLogs = logs.filter(log => {
    if (filter.level !== 'all' && log.level !== filter.level) return false
    if (filter.source !== 'all' && !log.source.includes(filter.source)) return false
    if (filter.search && !log.message.toLowerCase().includes(filter.search.toLowerCase())) return false
    return true
  })

  const handleExport = () => {
    const content = filteredLogs.map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`).join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lingshu-logs-${dayjs().format('YYYYMMDD-HHmmss')}.txt`
    a.click()
    URL.revokeObjectURL(url)
    message.success('日志导出成功')
  }

  const handleClear = () => {
    fetch('/api/logs', { method: 'DELETE' }).catch(() => {})
    setLogs([])
    message.success('日志已清空')
  }

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>日志查看</h2>

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            placeholder="搜索日志..."
            prefix={<SearchOutlined />}
            value={filter.search}
            onChange={e => setFilter({ ...filter, search: e.target.value })}
            style={{ width: 250 }}
          />
          <Select
            placeholder="日志级别"
            value={filter.level}
            onChange={value => setFilter({ ...filter, level: value })}
            style={{ width: 120 }}
          >
            <Option value="all">全部</Option>
            <Option value="debug">Debug</Option>
            <Option value="info">Info</Option>
            <Option value="warn">Warning</Option>
            <Option value="error">Error</Option>
          </Select>
          <Select
            placeholder="来源"
            value={filter.source}
            onChange={value => setFilter({ ...filter, source: value })}
            style={{ width: 150 }}
          >
            <Option value="all">全部</Option>
            <Option value="system">系统</Option>
            <Option value="skill">Skills</Option>
            <Option value="channel">渠道</Option>
          </Select>
          <RangePicker />
          <Button icon={<ReloadOutlined />} onClick={loadLogs}>刷新</Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport}>导出</Button>
          <Button danger icon={<DeleteOutlined />} onClick={handleClear}>清空</Button>
        </Space>
      </Card>

      <Card>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spin tip="加载日志..." />
          </div>
        ) : filteredLogs.length === 0 ? (
          <Empty description="暂无日志数据" />
        ) : (
          <List
            dataSource={filteredLogs}
            renderItem={item => (
              <List.Item>
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ color: '#999', marginRight: 16, fontSize: 12 }}>
                      {item.timestamp}
                    </span>
                    {getLevelTag(item.level)}
                    <Tag style={{ marginLeft: 8 }}>{item.source}</Tag>
                  </div>
                  <div>{item.message}</div>
                </div>
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  )
}

export default Logs
