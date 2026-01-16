const express = require('express');
const { pushSubscriptions } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getVapidPublicKey } = require('../pushService');

const router = express.Router();
router.use(requireAuth);

// Get VAPID public key for client
router.get('/vapid-public-key', (req, res) => {
  const vapidPublicKey = getVapidPublicKey();
  if (!vapidPublicKey) {
    return res.status(503).json({ error: 'Push notifications not configured' });
  }
  res.json({ publicKey: vapidPublicKey });
});

// Subscribe to push notifications
router.post('/subscribe', (req, res) => {
  const { subscription } = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }

  try {
    const keys = subscription.keys || {};
    pushSubscriptions.create(
      req.user.id,
      subscription.endpoint,
      keys.p256dh || '',
      keys.auth || ''
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Push subscribe error:', error);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// Unsubscribe from push notifications
router.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;

  if (endpoint) {
    pushSubscriptions.deleteByEndpoint(endpoint);
  } else {
    pushSubscriptions.deleteByUserId(req.user.id);
  }

  res.json({ success: true });
});

// Check if user has push enabled
router.get('/status', (req, res) => {
  const subscriptions = pushSubscriptions.findByUserId(req.user.id);
  res.json({ enabled: subscriptions.length > 0 });
});

module.exports = router;
