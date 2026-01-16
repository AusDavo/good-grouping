const express = require('express');
const { notifications } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Get all notifications (full page)
router.get('/', (req, res) => {
  const userNotifications = notifications.findByUserId(req.user.id, 50);
  const unreadCount = notifications.countUnread(req.user.id);

  res.render('notifications/index', {
    title: 'Notifications',
    notifications: userNotifications,
    unreadCount,
  });
});

// API: Get unread count (for navbar badge)
router.get('/api/unread-count', (req, res) => {
  const count = notifications.countUnread(req.user.id);
  res.json({ count });
});

// API: Get recent notifications (for dropdown)
router.get('/api/recent', (req, res) => {
  const recent = notifications.findByUserId(req.user.id, 10);
  const unreadCount = notifications.countUnread(req.user.id);
  res.json({ notifications: recent, unreadCount });
});

// Mark single notification as read
router.post('/:id/read', (req, res) => {
  const notification = notifications.findById(req.params.id);

  if (!notification || notification.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  notifications.markAsRead(req.params.id);

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true });
  }

  res.redirect('/notifications');
});

// Mark all as read
router.post('/mark-all-read', (req, res) => {
  notifications.markAllAsRead(req.user.id);

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true });
  }

  res.redirect('/notifications');
});

module.exports = router;
