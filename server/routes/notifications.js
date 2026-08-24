import {
  appendNotification,
  clearNotifications,
  deleteNotification,
  markAllNotificationsRead,
  markNotificationRead,
  readNotifications,
} from '../core/notifications.js'

function registerNotificationsRoutes(app) {
  app.get('/api/notifications', (req, res) => {
    try {
      const type = String(req.query.type || 'all')
      const unreadOnly = req.query.unread === 'true'
      let notifications = readNotifications()
      if (type !== 'all') notifications = notifications.filter(item => item.type === type)
      if (unreadOnly) notifications = notifications.filter(item => !item.read)
      res.json({
        notifications,
        unreadCount: readNotifications().filter(item => !item.read).length,
      })
    } catch (error) {
      res.status(500).json({ error: '读取通知失败', message: error.message })
    }
  })

  app.post('/api/notifications', (req, res) => {
    try {
      const notification = appendNotification(req.body || {})
      res.json({ success: true, notification })
    } catch (error) {
      res.status(500).json({ error: '创建通知失败', message: error.message })
    }
  })

  app.post('/api/notifications/mark-all-read', (req, res) => {
    try {
      const notifications = markAllNotificationsRead()
      res.json({ success: true, notifications })
    } catch (error) {
      res.status(500).json({ error: '标记通知失败', message: error.message })
    }
  })

  app.post('/api/notifications/:id/read', (req, res) => {
    try {
      const notification = markNotificationRead(req.params.id)
      if (!notification) return res.status(404).json({ error: '通知不存在' })
      res.json({ success: true, notification })
    } catch (error) {
      res.status(500).json({ error: '标记通知失败', message: error.message })
    }
  })

  app.delete('/api/notifications/:id', (req, res) => {
    try {
      const deleted = deleteNotification(req.params.id)
      if (!deleted) return res.status(404).json({ error: '通知不存在' })
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: '删除通知失败', message: error.message })
    }
  })

  app.delete('/api/notifications', (req, res) => {
    try {
      clearNotifications()
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: '清空通知失败', message: error.message })
    }
  })
}

export { registerNotificationsRoutes }
