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
      id: pk.credential_id,
      transports: pk.transports || undefined,
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
    const { registrationInfo } = verification;

    // Handle both v10 (credential object) and v9 (flat properties) API structures
    let credentialIdBase64, publicKeyBase64, counter;

    if (registrationInfo.credential) {
      // v10 API: credential info is under registrationInfo.credential
      credentialIdBase64 = registrationInfo.credential.id;
      publicKeyBase64 = Buffer.from(registrationInfo.credential.publicKey).toString('base64');
      counter = registrationInfo.credential.counter;
    } else if (registrationInfo.credentialID) {
      // v9 API fallback: flat properties on registrationInfo
      // credentialID may be Uint8Array or already a base64url string depending on version
      if (typeof registrationInfo.credentialID === 'string') {
        credentialIdBase64 = registrationInfo.credentialID;
      } else {
        credentialIdBase64 = Buffer.from(registrationInfo.credentialID).toString('base64url');
      }
      publicKeyBase64 = Buffer.from(registrationInfo.credentialPublicKey).toString('base64');
      counter = registrationInfo.counter;
    } else {
      console.error('Unknown registrationInfo structure:', Object.keys(registrationInfo));
      return { verified: false };
    }

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

// Generate authentication options for login (with username)
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
      id: pk.credential_id,
      transports: pk.transports || undefined,
    })),
    userVerification: 'preferred',
  });

  return { options, user };
}

// Generate authentication options for conditional UI (no username required)
async function generateConditionalAuthenticationOptions() {
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    // Empty allowCredentials allows any discoverable credential for this RP
  });

  return options;
}

// Verify authentication response
// user is optional - if not provided, will look up from credential
async function verifyAuthentication(response, expectedChallenge, user = null) {
  // Find the passkey being used
  const credentialIdBase64 = response.id;
  const passkey = passkeys.findByCredentialId(credentialIdBase64);

  if (!passkey) {
    return { verified: false, error: 'Passkey not found' };
  }

  // If no user provided (conditional UI flow), look up from passkey
  if (!user) {
    user = users.findById(passkey.user_id);
    if (!user) {
      return { verified: false, error: 'User not found' };
    }
  }

  // Decode the stored public key from base64
  const publicKey = Buffer.from(passkey.public_key, 'base64');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    authenticator: {
      credentialID: Buffer.from(passkey.credential_id, 'base64url'),
      credentialPublicKey: new Uint8Array(publicKey),
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
  generateConditionalAuthenticationOptions,
  verifyAuthentication,
  getRpID: () => rpID,
  getOrigin: () => origin,
};
