const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { passkeys, users } = require('./db');

// Configuration from environment
const rpName = process.env.RP_NAME || 'Dart Score Sharing';
const rpID = process.env.RP_ID || 'localhost';
const origin = process.env.ORIGIN || 'http://localhost:3000';

// Generate registration options for new passkey
async function generateRegistrationOptionsForUser(user) {
  const userPasskeys = passkeys.findByUserId(user.id);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(user.id),
    userName: user.name,
    userDisplayName: user.name,
    attestationType: 'none',
    excludeCredentials: userPasskeys.map(pk => ({
      id: Buffer.from(pk.credential_id, 'base64url'),
      transports: pk.transports,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  return options;
}

// Verify registration response and store passkey
async function verifyAndStoreRegistration(user, response, expectedChallenge) {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (verification.verified && verification.registrationInfo) {
    const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;

    // Store the credential - encode as base64 for storage
    const credentialIdBase64 = Buffer.from(credentialID).toString('base64url');
    const publicKeyBase64 = Buffer.from(credentialPublicKey).toString('base64');

    passkeys.create(
      user.id,
      credentialIdBase64,
      publicKeyBase64,
      counter,
      response.response.transports
    );

    return { verified: true };
  }

  return { verified: false };
}

// Generate authentication options for login
async function generateAuthenticationOptionsForUser(name) {
  const user = users.findByName(name);
  if (!user) {
    return { error: 'User not found' };
  }

  const userPasskeys = passkeys.findByUserId(user.id);
  if (userPasskeys.length === 0) {
    return { error: 'No passkeys registered for this user' };
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: userPasskeys.map(pk => ({
      id: Buffer.from(pk.credential_id, 'base64url'),
      transports: pk.transports,
    })),
    userVerification: 'preferred',
  });

  return { options, user };
}

// Verify authentication response
async function verifyAuthentication(response, expectedChallenge, user) {
  // Find the passkey being used
  const credentialIdBase64 = response.id;
  const passkey = passkeys.findByCredentialId(credentialIdBase64);

  if (!passkey) {
    return { verified: false, error: 'Passkey not found' };
  }

  // Decode the stored public key from base64
  const publicKey = Buffer.from(passkey.public_key, 'base64');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: Buffer.from(passkey.credential_id, 'base64url'),
      publicKey: new Uint8Array(publicKey),
      counter: passkey.counter,
      transports: passkey.transports,
    },
  });

  if (verification.verified) {
    // Update counter to prevent replay attacks
    passkeys.updateCounter(passkey.id, verification.authenticationInfo.newCounter);
    return { verified: true, user };
  }

  return { verified: false };
}

module.exports = {
  generateRegistrationOptionsForUser,
  verifyAndStoreRegistration,
  generateAuthenticationOptionsForUser,
  verifyAuthentication,
  getRpID: () => rpID,
  getOrigin: () => origin,
};
