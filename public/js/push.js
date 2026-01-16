// Web Push Notifications Client

async function initPushNotifications() {
  // Check browser support
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push notifications not supported');
    return;
  }

  // Register service worker
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('Service Worker registered');

    // Make registration available globally
    window.swRegistration = registration;
  } catch (error) {
    console.error('Service Worker registration failed:', error);
  }
}

async function subscribeToPush() {
  if (!window.swRegistration) {
    console.error('Service Worker not registered');
    return false;
  }

  try {
    // Get VAPID public key from server
    const keyRes = await fetch('/push/vapid-public-key');
    if (!keyRes.ok) {
      console.error('Push notifications not configured on server');
      return false;
    }
    const { publicKey } = await keyRes.json();

    if (!publicKey) {
      console.error('Push notifications not configured on server');
      return false;
    }

    // Convert VAPID key to Uint8Array
    const vapidKey = urlBase64ToUint8Array(publicKey);

    // Subscribe
    const subscription = await window.swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKey,
    });

    // Send subscription to server
    const res = await fetch('/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription }),
    });

    if (!res.ok) {
      throw new Error('Failed to save subscription');
    }

    return true;
  } catch (error) {
    console.error('Push subscription failed:', error);
    return false;
  }
}

async function unsubscribeFromPush() {
  if (!window.swRegistration) return false;

  try {
    const subscription = await window.swRegistration.pushManager.getSubscription();

    if (subscription) {
      // Unsubscribe locally
      await subscription.unsubscribe();

      // Remove from server
      await fetch('/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
    }

    return true;
  } catch (error) {
    console.error('Push unsubscribe failed:', error);
    return false;
  }
}

async function isPushSubscribed() {
  if (!window.swRegistration) return false;

  try {
    const subscription = await window.swRegistration.pushManager.getSubscription();
    return subscription !== null;
  } catch (error) {
    return false;
  }
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initPushNotifications);
