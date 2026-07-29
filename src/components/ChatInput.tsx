import React, { useState, useRef } from 'react'
import { Input, Button, Space, Dropdown, Tag, Popover, List, Avatar } from 'antd'
import {
  SendOutlined,
  NumberOutlined,
  SettingOutlined,
  AppstoreOutlined,
  PaperClipOutlined,
  UpOutlined,
  DownOutlined,
  RobotOutlined,
  CodeOutlined,
  FileTextOutlined,
  CloudOutlined,
  SearchOutlined
} from '@ant-design/icons'

interface Skill {
  id: string
  name: string
  icon: React.ReactNode
  description: string
}

interface ChatInputProps {
  onSend?: (message: string, skill?: string) => void
  placeholder?: string
}

const ChatInput: React.FC<ChatInputProps> = ({ 
  onSend, 
  placeholder = "输入 / 使用技能..." 
}) => {
  const [inputValue, setInputValue] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>({
    id: 'default',
    name: 'StepClaw',
    icon: <RobotOutlined />,
    description: '默认助手'
  })
  const [showSkillMenu, setShowSkillMenu] = useState(false)
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const inputRef = useRef<any>(null)

  const skills: Skill[] = [
    { id: 'default', name: 'StepClaw', icon: <RobotOutlined />, description: '默认助手' },
    { id: 'code', name: 'Code', icon: <CodeOutlined />, description: '代码编写' },
    { id: 'weather', name: 'Weather', icon: <CloudOutlined />, description: '天气查询' },
    { id: 'search', name: 'Search', icon: <SearchOutlined />, description: '网络搜索' },
    { id: 'docx', name: 'DOCX', icon: <FileTextOutlined />, description: 'Word文档' },
    { id: 'xlsx', name: 'XLSX', icon: <FileTextOutlined />, description: 'Excel表格' },
    { id: 'pdf', name: 'PDF', icon: <FileTextOutlined />, description: 'PDF处理' },
  ]

  const mentions = [
    { id: '1', name: '文件', type: 'file' },
    { id: '2', name: '图片', type: 'image' },
    { id: '3', name: '链接', type: 'link' },
  ]

  const handleSend = () => {
    if (!inputValue.trim()) return
    onSend?.(inputValue, selectedSkill?.id)
    setInputValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const position = e.target.selectionStart || 0
    setInputValue(value)
    setCursorPosition(position)

    // 检测 / 触发技能菜单
    if (value === '/') {
      setShowSkillMenu(true)
    } else if (!value.startsWith('/')) {
      setShowSkillMenu(false)
    }

    // 检测 # 触发话题标签
    if (value.slice(position - 1, position) === '#') {
      setShowMentionMenu(true)
    }
  }

  const selectSkill = (skill: Skill) => {
    setSelectedSkill(skill)
    setShowSkillMenu(false)
    setInputValue('')
    inputRef.current?.focus()
  }

  const insertMention = (mention: typeof mentions[0]) => {
    const before = inputValue.slice(0, cursorPosition)
    const after = inputValue.slice(cursorPosition)
    const newValue = before + mention.name + ' ' + after
    setInputValue(newValue)
    setShowMentionMenu(false)
    inputRef.current?.focus()
  }

  const skillMenuContent = (
    <div style={{ width: 280, padding: 8 }}>
      <div style={{ fontSize: 12, color: '#999', marginBottom: 8, padding: '0 8px' }}>
        选择技能
      </div>
      <List
        size="small"
        dataSource={skills}
        renderItem={skill => (
          <List.Item
            style={{ 
              cursor: 'pointer', 
              borderRadius: 6,
              backgroundColor: selectedSkill?.id === skill.id ? '#f0f7ff' : 'transparent'
            }}
            onClick={() => selectSkill(skill)}
          >
            <Space>
              <Avatar size="small" style={{ backgroundColor: '#1890ff' }}>
                {skill.icon}
              </Avatar>
              <div>
                <div style={{ fontWeight: 'bold' }}>{skill.name}</div>
                <div style={{ fontSize: 12, color: '#999' }}>{skill.description}</div>
              </div>
            </Space>
          </List.Item>
        )}
      />
    </div>
  )

  return (
    <div
      style={{
        backgroundColor: '#1f1f1f',
        borderRadius: 16,
        padding: '12px 16px',
        border: '1px solid #333',
      }}
    >
      {/* 输入框 */}
      <Input.TextArea
        ref={inputRef}
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoSize={{ minRows: 1, maxRows: 6 }}
        style={{
          backgroundColor: 'transparent',
          border: 'none',
          color: '#fff',
          fontSize: 14,
          resize: 'none',
          padding: 0,
          marginBottom: 12,
        }}
        variant="borderless"
      />

      {/* 底部工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space size={8}>
          {/* 技能选择 */}
          <Dropdown
            overlay={skillMenuContent}
            visible={showSkillMenu}
            onVisibleChange={setShowSkillMenu}
            placement="topLeft"
          >
            <Button
              type="text"
              style={{
                color: '#fff',
                backgroundColor: '#333',
                borderRadius: 20,
                padding: '4px 12px',
                height: 32,
              }}
            >
              <Space>
                <Avatar size="small" style={{ backgroundColor: '#ff4d4f' }}>
                  {selectedSkill?.icon}
                </Avatar>
                <span>{selectedSkill?.name}</span>
                {showSkillMenu ? <UpOutlined /> : <DownOutlined />}
              </Space>
            </Button>
          </Dropdown>

          {/* 话题标签 */}
          <Popover
            content={
              <div style={{ width: 200 }}>
                <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
                  插入话题
                </div>
                {mentions.map(item => (
                  <Tag
                    key={item.id}
                    style={{ cursor: 'pointer', margin: '0 4px 4px 0' }}
                    onClick={() => insertMention(item)}
                  >
                    #{item.name}
                  </Tag>
                ))}
              </div>
            }
            trigger="click"
            visible={showMentionMenu}
            onVisibleChange={setShowMentionMenu}
          >
            <Button
              type="text"
              icon={<NumberOutlined />}
              style={{
                color: '#999',
                width: 36,
                height: 36,
                borderRadius: 8,
              }}
            />
          </Popover>

          {/* 设置 */}
          <Button
            type="text"
            icon={<SettingOutlined />}
            style={{
              color: '#999',
              width: 36,
              height: 36,
              borderRadius: 8,
            }}
          />

          {/* 更多选项 */}
          <Button
            type="text"
            icon={<AppstoreOutlined />}
            style={{
              color: '#999',
              width: 36,
              height: 36,
              borderRadius: 8,
            }}
          />
        </Space>

        <Space size={8}>
          {/* 附件 */}
          <Button
            type="text"
            icon={<PaperClipOutlined />}
            style={{
              color: '#999',
              width: 36,
              height: 36,
              borderRadius: 8,
            }}
          />

          {/* 发送按钮 */}
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            disabled={!inputValue.trim()}
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: inputValue.trim() ? '#1890ff' : '#333',
              border: 'none',
            }}
          />
        </Space>
      </div>
    </div>
  )
}

export default ChatInput
