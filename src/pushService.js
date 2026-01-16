const webPush = require('web-push');
const fs = require('fs');
const path = require('path');
const { pushSubscriptions } = require('./db');

const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const vapidKeysPath = path.join(__dirname, '../data/vapid-keys.json');

let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
let pushConfigured = false;

// Auto-generate VAPID keys if not provided
if (!vapidPublicKey || !vapidPrivateKey) {
  // Try to load from file first
  if (fs.existsSync(vapidKeysPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(vapidKeysPath, 'utf8'));
      vapidPublicKey = saved.publicKey;
      vapidPrivateKey = saved.privateKey;
      console.log('Loaded VAPID keys from', vapidKeysPath);
    } catch (e) {
      console.error('Failed to load VAPID keys:', e.message);
    }
  }

  // Generate new keys if still not available
  if (!vapidPublicKey || !vapidPrivateKey) {
    const keys = webPush.generateVAPIDKeys();
    vapidPublicKey = keys.publicKey;
    vapidPrivateKey = keys.privateKey;

    // Save to file for persistence across restarts
    try {
      fs.writeFileSync(vapidKeysPath, JSON.stringify({
        publicKey: vapidPublicKey,
        privateKey: vapidPrivateKey,
      }, null, 2));
      console.log('Generated and saved new VAPID keys to', vapidKeysPath);
    } catch (e) {
      console.error('Failed to save VAPID keys:', e.message);
    }
  }
}

if (vapidPublicKey && vapidPrivateKey) {
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  pushConfigured = true;
}

async function sendPushToUser(userId, payload) {
  if (!pushConfigured) return;

  const subscriptions = pushSubscriptions.findByUserId(userId);

  for (const sub of subscriptions) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    };

    try {
      await webPush.sendNotification(
        pushSubscription,
        JSON.stringify(payload)
      );
    } catch (error) {
      console.error('Push send error:', error.message);
      // If subscription is invalid, remove it
      if (error.statusCode === 410 || error.statusCode === 404) {
        pushSubscriptions.deleteByEndpoint(sub.endpoint);
      }
    }
  }
}

async function notifyGameCreated(game, players, creatorName) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  for (const player of players) {
    // Don't notify the creator
    if (player.userId === game.created_by) continue;

    const payload = {
      title: 'New Game Recorded',
      body: `${creatorName} added you to a ${game.game_type} game. Tap to confirm.`,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      data: {
        url: `${baseUrl}/games/${game.id}`,
        gameId: game.id,
      },
    };

    await sendPushToUser(player.userId, payload);
  }
}

module.exports = {
  sendPushToUser,
  notifyGameCreated,
  isPushConfigured: () => pushConfigured,
  getVapidPublicKey: () => vapidPublicKey,
};
