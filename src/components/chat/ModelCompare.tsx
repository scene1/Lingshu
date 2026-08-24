// ============================================================
// 灵枢 v3.0 — 多模型对比模式组件
// 选择 2-3 个模型并行调用，分列展示结果
// ============================================================

import React, { useState, useCallback } from 'react'
import { Card, Button, Row, Col, Spin, Tag, Typography, Space, Empty, message } from 'antd'
import { ThunderboltOutlined, CheckOutlined, CloseOutlined, SwapOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const { Text } = Typography

interface ModelOption {
  key: string
  label: string
  provider?: string
}

interface CompareResult {
  model: string
  modelLabel: string
  content: string
  loading: boolean
  error?: string
}

interface ModelCompareProps {
  /** 可选模型列表 */
  models: ModelOption[]
  /** 当前会话 ID */
  sessionId: string
  /** 用户输入的消息内容 */
  content: string
  /** 采用某条回复时的回调 */
  onAdopt: (model: string, content: string) => void
  /** 关闭对比模式 */
  onClose: () => void
}

/**
 * 多模型对比模式组件
 *
 * 功能：
 * 1. 选择 2-3 个模型
 * 2. 使用 Promise.all 并行调用 /api/instances/local/sessions/:sid/chat
 * 3. 结果分列展示
 * 4. 点击「采用此回复」保留选中消息，移除其他
 */
export const ModelCompare: React.FC<ModelCompareProps> = ({
  models,
  sessionId,
  content,
  onAdopt,
  onClose,
}) => {
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [results, setResults] = useState<CompareResult[]>([])
  const [isComparing, setIsComparing] = useState(false)

  const handleModelToggle = (modelKey: string) => {
    setSelectedModels(prev => {
      if (prev.includes(modelKey)) {
        return prev.filter(k => k !== modelKey)
      }
      if (prev.length >= 3) {
        message.warning('最多选择 3 个模型进行对比')
        return prev
      }
      return [...prev, modelKey]
    })
  }

  const handleCompare = useCallback(async () => {
    if (selectedModels.length < 2) {
      message.warning('请至少选择 2 个模型进行对比')
      return
    }
    if (!content.trim()) {
      message.warning('请输入消息内容')
      return
    }

    setIsComparing(true)
    const initialResults: CompareResult[] = selectedModels.map(key => ({
      model: key,
      modelLabel: models.find(m => m.key === key)?.label || key,
      content: '',
      loading: true,
    }))
    setResults(initialResults)

    // 并行调用所有模型
    const promises = selectedModels.map(async (modelKey) => {
      try {
        const response = await fetch(`/api/instances/local/sessions/${sessionId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify({
	            message: content,
	            model: modelKey,
	            stream: false,
	            persist: false,
	          }),
        })

        if (!response.ok) {
          throw new Error(`请求失败: ${response.status}`)
        }

        const data = await response.json()
        return {
          model: modelKey,
          modelLabel: models.find(m => m.key === modelKey)?.label || modelKey,
          content: data.reply || '（无回复）',
          loading: false,
        } as CompareResult
      } catch (error) {
        return {
          model: modelKey,
          modelLabel: models.find(m => m.key === modelKey)?.label || modelKey,
          content: '',
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        } as CompareResult
      }
    })

    const finalResults = await Promise.all(promises)
    setResults(finalResults)
    setIsComparing(false)
  }, [selectedModels, content, sessionId, models])

  const handleAdopt = (model: string, resultContent: string) => {
    onAdopt(model, resultContent)
    onClose()
  }

  return (
    <Card
      size="small"
      title={
        <Space>
          <SwapOutlined />
          <span>多模型对比</span>
        </Space>
      }
      extra={
        <Button type="text" icon={<CloseOutlined />} onClick={onClose} size="small" />
      }
      style={{ marginBottom: 12 }}
    >
      {/* 模型选择器 */}
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ marginRight: 8 }}>选择模型（2-3个）：</Text>
        <Space wrap>
          {models.slice(0, 8).map(m => (
            <Tag.CheckableTag
              key={m.key}
              checked={selectedModels.includes(m.key)}
              onChange={() => handleModelToggle(m.key)}
            >
              {m.label}
            </Tag.CheckableTag>
          ))}
        </Space>
      </div>

      {/* 消息预览 */}
      {content && (
        <div style={{
          padding: '8px 12px',
          background: '#f5f5f5',
          borderRadius: 6,
          marginBottom: 12,
          fontSize: 13,
        }}>
          <Text type="secondary">消息内容：</Text>
          <Text>{content.slice(0, 100)}{content.length > 100 ? '...' : ''}</Text>
        </div>
      )}

      {/* 对比按钮 */}
      <Button
        type="primary"
        icon={<ThunderboltOutlined />}
        onClick={handleCompare}
        loading={isComparing}
        disabled={selectedModels.length < 2 || !content.trim()}
        style={{ marginBottom: results.length > 0 ? 12 : 0 }}
      >
        开始对比 ({selectedModels.length} 个模型)
      </Button>

      {/* 结果展示 */}
      {results.length > 0 && (
        <Row gutter={[8, 8]}>
          {results.map(result => (
            <Col key={result.model} span={24 / results.length}>
              <Card
                size="small"
                title={
                  <Space size={4}>
                    <Tag color="blue" style={{ fontSize: 11 }}>{result.modelLabel}</Tag>
                  </Space>
                }
                extra={
                  !result.loading && !result.error && (
                    <Button
                      type="primary"
                      size="small"
                      icon={<CheckOutlined />}
                      onClick={() => handleAdopt(result.model, result.content)}
                    >
                      采用
                    </Button>
                  )
                }
                style={{ minHeight: 200 }}
              >
                {result.loading ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <Spin tip="生成中..." />
                  </div>
                ) : result.error ? (
                  <Text type="danger">❌ {result.error}</Text>
                ) : (
                  <div className="markdown-content" style={{ fontSize: 13, lineHeight: 1.6, maxHeight: 400, overflow: 'auto' }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {result.content}
                    </ReactMarkdown>
                  </div>
                )}
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {results.length === 0 && !isComparing && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="选择模型后点击「开始对比」"
          style={{ margin: '12px 0' }}
        />
      )}
    </Card>
  )
}

export default ModelCompare
