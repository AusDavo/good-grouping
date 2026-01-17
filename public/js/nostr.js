// NIP-07 Browser Extension Integration

/**
 * Check if a Nostr extension is available (nos2x, Alby, etc.)
 * @returns {boolean}
 */
function hasNostrExtension() {
  return typeof window.nostr !== 'undefined';
}

/**
 * Get the user's public key from the extension
 * @returns {Promise<string>} hex pubkey
 */
async function getNostrPubkey() {
  if (!hasNostrExtension()) {
    throw new Error('No Nostr extension found');
  }
  return await window.nostr.getPublicKey();
}

/**
 * Sign an authentication event (NIP-07 kind 22242)
 * @param {string} challenge - The challenge from the server
 * @param {string} content - Optional content for the event
 * @returns {Promise<object>} Signed event object
 */
async function signAuthEvent(challenge, content = 'Login to Good Grouping') {
  if (!hasNostrExtension()) {
    throw new Error('No Nostr extension found');
  }

  const event = {
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['challenge', challenge]],
    content: content,
  };

  return await window.nostr.signEvent(event);
}

/**
 * Perform Nostr login
 * @param {function} onSuccess - Called on successful login with redirect URL
 * @param {function} onError - Called on error with error message
 */
async function nostrLogin(onSuccess, onError) {
  try {
    // Get challenge from server
    const challengeRes = await fetch('/login/nostr-challenge');
    if (!challengeRes.ok) {
      const data = await challengeRes.json();
      throw new Error(data.error || 'Failed to get challenge');
    }
    const { challenge } = await challengeRes.json();

    // Sign the challenge
    const signedEvent = await signAuthEvent(challenge);

    // Verify with server
    const verifyRes = await fetch('/login/nostr-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedEvent }),
    });

    const result = await verifyRes.json();
    if (!verifyRes.ok) {
      throw new Error(result.error || 'Login failed');
    }

    onSuccess(result.redirect);
  } catch (error) {
    onError(error.message || 'Login failed');
  }
}

/**
 * Perform Nostr registration
 * @param {string} token - Invitation token
 * @param {string} username - Display name
 * @param {function} onSuccess - Called on successful registration with redirect URL
 * @param {function} onError - Called on error with error message
 */
async function nostrRegister(token, username, onSuccess, onError) {
  try {
    // Get challenge from server
    const optionsRes = await fetch('/register/nostr-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, username }),
    });

    if (!optionsRes.ok) {
      const data = await optionsRes.json();
      throw new Error(data.error || 'Failed to get registration options');
    }
    const { challenge } = await optionsRes.json();

    // Sign the challenge
    const signedEvent = await signAuthEvent(challenge, 'Register at Good Grouping');

    // Verify with server
    const verifyRes = await fetch('/register/nostr-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedEvent }),
    });

    const result = await verifyRes.json();
    if (!verifyRes.ok) {
      throw new Error(result.error || 'Registration failed');
    }

    onSuccess(result.redirect);
  } catch (error) {
    onError(error.message || 'Registration failed');
  }
}

/**
 * Link Nostr identity to current account
 * @param {function} onSuccess - Called on successful link with npub
 * @param {function} onError - Called on error with error message
 */
async function nostrLink(onSuccess, onError) {
  try {
    // Get challenge from server
    const challengeRes = await fetch('/profile/nostr/link', {
      method: 'POST',
    });

    if (!challengeRes.ok) {
      const data = await challengeRes.json();
      throw new Error(data.error || 'Failed to get challenge');
    }
    const { challenge } = await challengeRes.json();

    // Sign the challenge
    const signedEvent = await signAuthEvent(challenge, 'Link Nostr to Good Grouping');

    // Verify with server
    const verifyRes = await fetch('/profile/nostr/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedEvent }),
    });

    const result = await verifyRes.json();
    if (!verifyRes.ok) {
      throw new Error(result.error || 'Linking failed');
    }

    onSuccess(result.npub);
  } catch (error) {
    onError(error.message || 'Linking failed');
  }
}

/**
 * Unlink Nostr identity from current account
 * @param {function} onSuccess - Called on successful unlink
 * @param {function} onError - Called on error with error message
 */
async function nostrUnlink(onSuccess, onError) {
  try {
    const res = await fetch('/profile/nostr/unlink', {
      method: 'POST',
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || 'Unlinking failed');
    }

    onSuccess();
  } catch (error) {
    onError(error.message || 'Unlinking failed');
  }
}
