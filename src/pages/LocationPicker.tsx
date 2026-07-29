import React, { useState } from 'react'
import { Card, Input, Button, Space, Tag, message, Modal, Tabs, Form, Row, Col } from 'antd'
import { 
  EnvironmentOutlined, 
  SearchOutlined, 
  PlusOutlined,
  DeleteOutlined,
  StarOutlined,
  StarFilled,
  CopyOutlined,
  CompassOutlined
} from '@ant-design/icons'

interface Location {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  tags: string[]
  isFavorite: boolean
  createdAt: string
}

const LocationPicker: React.FC = () => {
  const [locations, setLocations] = useState<Location[]>([
    {
      id: '1',
      name: '公司',
      address: '北京市朝阳区望京SOHO T3',
      lat: 39.9999,
      lng: 116.4810,
      tags: ['工作', '常用'],
      isFavorite: true,
      createdAt: '2024-01-15'
    },
    {
      id: '2',
      name: '家',
      address: '北京市海淀区中关村',
      lat: 39.9833,
      lng: 116.3161,
      tags: ['居住', '常用'],
      isFavorite: true,
      createdAt: '2024-01-10'
    },
    {
      id: '3',
      name: '客户A公司',
      address: '上海市浦东新区陆家嘴',
      lat: 31.2304,
      lng: 121.4737,
      tags: ['客户', '出差'],
      isFavorite: false,
      createdAt: '2024-03-20'
    }
  ])

  const [searchText, setSearchText] = useState('')
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newLocation, setNewLocation] = useState({
    name: '',
    address: '',
    lat: '',
    lng: ''
  })

  const handleAddLocation = () => {
    if (!newLocation.name || !newLocation.address) {
      message.error('请填写名称和地址')
      return
    }
    
    const location: Location = {
      id: Date.now().toString(),
      name: newLocation.name,
      address: newLocation.address,
      lat: parseFloat(newLocation.lat) || 0,
      lng: parseFloat(newLocation.lng) || 0,
      tags: [],
      isFavorite: false,
      createdAt: new Date().toISOString().split('T')[0]
    }
    
    setLocations([...locations, location])
    setNewLocation({ name: '', address: '', lat: '', lng: '' })
    setIsModalOpen(false)
    message.success('位置已添加')
  }

  const handleDeleteLocation = (id: string) => {
    setLocations(locations.filter(l => l.id !== id))
    message.success('位置已删除')
  }

  const handleToggleFavorite = (id: string) => {
    setLocations(locations.map(l => 
      l.id === id ? { ...l, isFavorite: !l.isFavorite } : l
    ))
  }

  const handleCopyCoordinates = (lat: number, lng: number) => {
    navigator.clipboard.writeText(`${lat}, ${lng}`)
    message.success('坐标已复制')
  }

  const filteredLocations = locations.filter(l =>
    l.name.toLowerCase().includes(searchText.toLowerCase()) ||
    l.address.toLowerCase().includes(searchText.toLowerCase())
  )

  const favoriteLocations = locations.filter(l => l.isFavorite)

  const getTagColor = (tag: string) => {
    const colors: Record<string, string> = {
      '工作': 'blue',
      '居住': 'green',
      '客户': 'orange',
      '出差': 'purple',
      '常用': 'red'
    }
    return colors[tag] || 'default'
  }

  const LocationCard = ({ location }: { location: Location }) => (
    <Card
      size="small"
      style={{ marginBottom: 12, cursor: 'pointer' }}
      onClick={() => setCurrentLocation(location)}
      className={currentLocation?.id === location.id ? 'location-selected' : ''}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <EnvironmentOutlined style={{ marginRight: 8, color: '#1890ff' }} />
            <strong>{location.name}</strong>
            <Button
              type="text"
              size="small"
              icon={location.isFavorite ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                handleToggleFavorite(location.id)
              }}
              style={{ marginLeft: 8 }}
            />
          </div>
          <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
            {location.address}
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {location.tags.map(tag => (
              <Tag key={tag} color={getTagColor(tag)}>{tag}</Tag>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag>{location.lat.toFixed(4)}, {location.lng.toFixed(4)}</Tag>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                handleCopyCoordinates(location.lat, location.lng)
              }}
            />
          </div>
        </div>
        <Button
          type="text"
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={(e) => {
            e.stopPropagation()
            handleDeleteLocation(location.id)
          }}
        />
      </div>
    </Card>
  )

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>
        <CompassOutlined /> 位置管理
      </h2>

      <Row gutter={16}>
        <Col span={8}>
          <Card
            title="位置列表"
            extra={
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setIsModalOpen(true)}
              >
                添加
              </Button>
            }
          >
            <Input
              placeholder="搜索位置..."
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ marginBottom: 16 }}
            />

            <Tabs defaultActiveKey="all">
              <Tabs.TabPane tab={`全部 (${locations.length})`} key="all">
                <div style={{ maxHeight: 400, overflow: 'auto' }}>
                  {filteredLocations.map(location => (
                    <LocationCard key={location.id} location={location} />
                  ))}
                </div>
              </Tabs.TabPane>
              <Tabs.TabPane tab={`收藏 (${favoriteLocations.length})`} key="favorite">
                <div style={{ maxHeight: 400, overflow: 'auto' }}>
                  {favoriteLocations.map(location => (
                    <LocationCard key={location.id} location={location} />
                  ))}
                </div>
              </Tabs.TabPane>
            </Tabs>
          </Card>
        </Col>

        <Col span={16}>
          <Card title="地图预览" style={{ height: '100%' }}>
            {currentLocation ? (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <h3>{currentLocation.name}</h3>
                  <p style={{ color: '#666' }}>{currentLocation.address}</p>
                </div>
                
                {/* 模拟地图显示 */}
                <div
                  style={{
                    width: '100%',
                    height: 400,
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      textAlign: 'center',
                      color: 'white'
                    }}
                  >
                    <EnvironmentOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                    <div>纬度: {currentLocation.lat.toFixed(6)}</div>
                    <div>经度: {currentLocation.lng.toFixed(6)}</div>
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <Space>
                    <Tag color="blue">纬度: {currentLocation.lat}</Tag>
                    <Tag color="green">经度: {currentLocation.lng}</Tag>
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => handleCopyCoordinates(currentLocation.lat, currentLocation.lng)}
                    >
                      复制坐标
                    </Button>
                  </Space>
                </div>
              </div>
            ) : (
              <div
                style={{
                  height: 400,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#999'
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <CompassOutlined style={{ fontSize: 64, marginBottom: 16 }} />
                  <p>点击左侧位置查看详情</p>
                </div>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title="添加位置"
        open={isModalOpen}
        onOk={handleAddLocation}
        onCancel={() => setIsModalOpen(false)}
        okText="添加"
        cancelText="取消"
      >
        <Form layout="vertical">
          <Form.Item label="名称" required>
            <Input
              placeholder="例如: 公司、家、客户地址"
              value={newLocation.name}
              onChange={e => setNewLocation({ ...newLocation, name: e.target.value })}
            />
          </Form.Item>
          <Form.Item label="地址" required>
            <Input.TextArea
              placeholder="详细地址"
              value={newLocation.address}
              onChange={e => setNewLocation({ ...newLocation, address: e.target.value })}
              rows={2}
            />
          </Form.Item>
          <Form.Item label="纬度">
            <Input
              placeholder="39.9999"
              value={newLocation.lat}
              onChange={e => setNewLocation({ ...newLocation, lat: e.target.value })}
            />
          </Form.Item>
          <Form.Item label="经度">
            <Input
              placeholder="116.4810"
              value={newLocation.lng}
              onChange={e => setNewLocation({ ...newLocation, lng: e.target.value })}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default LocationPicker
