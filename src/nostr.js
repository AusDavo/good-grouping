const crypto = require('crypto');
const { verifyEvent } = require('nostr-tools/pure');

// Kind for NIP-07 authentication
const AUTH_EVENT_KIND = 22242;

// Challenge valid for 5 minutes
const CHALLENGE_VALIDITY_SECONDS = 5 * 60;

/**
 * Generate a random challenge for Nostr authentication
 * @returns {string} 32-byte hex string
 */
function generateChallenge() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Verify a NIP-07 authentication event
 * @param {object} event - The signed Nostr event
 * @param {string} expectedChallenge - The challenge that was sent to the client
 * @param {string|null} expectedPubkey - If provided, verify the pubkey matches
 * @returns {{verified: boolean, pubkey?: string, error?: string}}
 */
function verifyAuthEvent(event, expectedChallenge, expectedPubkey = null) {
  // Check event structure
  if (!event || typeof event !== 'object') {
    return { verified: false, error: 'Invalid event structure' };
  }

  // Verify event kind
  if (event.kind !== AUTH_EVENT_KIND) {
    return { verified: false, error: `Invalid event kind: expected ${AUTH_EVENT_KIND}, got ${event.kind}` };
  }

  // Verify challenge in tags
  const challengeTag = event.tags?.find(t => t[0] === 'challenge');
  if (!challengeTag || challengeTag[1] !== expectedChallenge) {
    return { verified: false, error: 'Challenge mismatch' };
  }

  // Verify timestamp is recent
  const now = Math.floor(Date.now() / 1000);
  const eventTime = event.created_at;
  if (Math.abs(now - eventTime) > CHALLENGE_VALIDITY_SECONDS) {
    return { verified: false, error: 'Event timestamp too old or too far in future' };
  }

  // Verify pubkey if expected
  if (expectedPubkey && event.pubkey !== expectedPubkey) {
    return { verified: false, error: 'Pubkey mismatch' };
  }

  // Verify signature
  const isValid = verifyEvent(event);
  if (!isValid) {
    return { verified: false, error: 'Invalid signature' };
  }

  return { verified: true, pubkey: event.pubkey };
}

/**
 * Convert hex pubkey to npub format (bech32)
 * @param {string} hexPubkey - 64-character hex pubkey
 * @returns {string} npub1... format
 */
function hexToNpub(hexPubkey) {
  const { npubEncode } = require('nostr-tools/nip19');
  return npubEncode(hexPubkey);
}

/**
 * Convert npub to hex pubkey
 * @param {string} npub - npub1... format
 * @returns {string|null} hex pubkey or null if invalid
 */
function npubToHex(npub) {
  try {
    const { decode } = require('nostr-tools/nip19');
    const result = decode(npub);
    if (result.type === 'npub') {
      return result.data;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = {
  generateChallenge,
  verifyAuthEvent,
  hexToNpub,
  npubToHex,
  AUTH_EVENT_KIND,
};
