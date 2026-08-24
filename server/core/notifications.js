import fs from 'fs'
import path from 'path'
import os from 'os'

const WORKSPACE_DIR = path.join(os.homedir(), 'Lingshu', 'workspace')
const NOTIFICATIONS_FILE = path.join(WORKSPACE_DIR, 'notifications.json')
const MAX_NOTIFICATIONS = 300

function ensureWorkspaceDir() {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true })
  }
}

function readNotifications() {
  try {
    if (!fs.existsSync(NOTIFICATIONS_FILE)) return []
    const data = JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf8'))
    return Array.isArray(data) ? data : (Array.isArray(data.notifications) ? data.notifications : [])
  } catch (error) {
    console.error('[Notifications] 读取失败:', error.message)
    return []
  }
}

function writeNotifications(items) {
  ensureWorkspaceDir()
  fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(items.slice(0, MAX_NOTIFICATIONS), null, 2))
}

function appendNotification(input = {}) {
  const notification = {
    id: input.id || `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title || '灵枢通知',
    content: input.content || '',
    type: ['success', 'info', 'warning', 'error'].includes(input.type) ? input.type : 'info',
    source: input.source || '',
    targetId: input.targetId || '',
    targetType: input.targetType || '',
    route: input.route || '',
    read: false,
    timestamp: input.timestamp || new Date().toISOString(),
    metadata: input.metadata || {},
  }
  const next = [notification, ...readNotifications()]
  writeNotifications(next)
  return notification
}

function markNotificationRead(id) {
  const items = readNotifications()
  const next = items.map(item => item.id === id ? { ...item, read: true } : item)
  writeNotifications(next)
  return next.find(item => item.id === id) || null
}

function markAllNotificationsRead() {
  const next = readNotifications().map(item => ({ ...item, read: true }))
  writeNotifications(next)
  return next
}

function deleteNotification(id) {
  const items = readNotifications()
  const next = items.filter(item => item.id !== id)
  writeNotifications(next)
  return items.length !== next.length
}

function clearNotifications() {
  writeNotifications([])
}

export {
  appendNotification,
  clearNotifications,
  deleteNotification,
  markAllNotificationsRead,
  markNotificationRead,
  readNotifications,
}
