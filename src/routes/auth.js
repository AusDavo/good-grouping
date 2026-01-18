const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { users, invitations, passkeys, countUserAuthMethods } = require('../db');

// Configure multer for avatar uploads (store in data directory for persistence)
const uploadDir = path.join(__dirname, '../../data/uploads/avatars');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.user.id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype);
    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});
const {
  generateRegistrationOptionsForUser,
  verifyAndStoreRegistration,
  generateConditionalAuthenticationOptions,
  verifyAuthentication,
} = require('../auth');
const { redirectIfAuthenticated, requireAuth } = require('../middleware/auth');
const { generateChallenge, verifyAuthEvent, hexToNpub } = require('../nostr');

const router = express.Router();

// Login page
router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('login', { title: 'Login', error: null });
});

// Generate authentication options for passkey login
router.get('/login/conditional-options', async (req, res) => {
  try {
    const options = await generateConditionalAuthenticationOptions();

    // Store challenge in session (no userId yet - will be determined from credential)
    req.session.authChallenge = options.challenge;
    req.session.authUserId = null; // Will be looked up from credential

    res.json(options);
  } catch (error) {
    console.error('Conditional options error:', error);
    res.status(500).json({ error: 'Failed to generate authentication options' });
  }
});

// Verify authentication
router.post('/login/verify', async (req, res) => {
  try {
    const { response } = req.body;
    const expectedChallenge = req.session.authChallenge;
    const userId = req.session.authUserId;

    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No authentication in progress' });
    }

    // For conditional UI flow, userId may be null - user will be looked up from credential
    let user = null;
    if (userId) {
      user = users.findById(userId);
      if (!user) {
        return res.status(400).json({ error: 'User not found' });
      }
    }

    const result = await verifyAuthentication(response, expectedChallenge, user);

    // Clear auth session data
    delete req.session.authChallenge;
    delete req.session.authUserId;

    if (result.verified) {
      req.session.userId = result.user.id;
      return res.json({ success: true, redirect: '/' });
    }

    res.status(400).json({ error: result.error || 'Authentication failed' });
  } catch (error) {
    console.error('Login verify error:', error);
    res.status(500).json({ error: 'Authentication verification failed' });
  }
});

// Generate Nostr login challenge
router.get('/login/nostr-challenge', (req, res) => {
  try {
    const challenge = generateChallenge();
    req.session.nostrChallenge = challenge;
    res.json({ challenge });
  } catch (error) {
    console.error('Nostr challenge error:', error);
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

// Verify Nostr login
router.post('/login/nostr-verify', (req, res) => {
  try {
    const { signedEvent } = req.body;
    const expectedChallenge = req.session.nostrChallenge;

    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No authentication in progress' });
    }

    const result = verifyAuthEvent(signedEvent, expectedChallenge);
    if (!result.verified) {
      return res.status(400).json({ error: result.error || 'Verification failed' });
    }

    // Look up user by pubkey
    const user = users.findByNostrPubkey(result.pubkey);
    if (!user) {
      return res.status(400).json({ error: 'No account linked to this Nostr identity' });
    }

    if (user.deleted_at) {
      return res.status(400).json({ error: 'Account has been deleted' });
    }

    // Clear challenge
    delete req.session.nostrChallenge;

    // Log the user in
    req.session.userId = user.id;
    res.json({ success: true, redirect: '/' });
  } catch (error) {
    console.error('Nostr login verify error:', error);
    res.status(500).json({ error: 'Authentication verification failed' });
  }
});

// Registration page (requires invite token)
router.get('/register', redirectIfAuthenticated, (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.render('error', {
      title: 'Invalid Link',
      message: 'Registration requires an invitation link.',
    });
  }

  const invitation = invitations.findByToken(token);

  // Check for system bootstrap token
  const isSystemToken = invitation && invitation.created_by === 'SYSTEM';
  const userCount = users.count();

  if (!invitations.isValid(invitation) && !(isSystemToken && userCount === 0)) {
    return res.render('error', {
      title: 'Invalid Invitation',
      message: 'This invitation link is invalid, expired, or has already been used.',
    });
  }

  res.render('register', {
    title: 'Create Account',
    token,
    isFirstUser: isSystemToken && userCount === 0,
    error: null,
  });
});

// Generate registration options
router.post('/register/options', async (req, res) => {
  try {
    const { token, username } = req.body;

    if (!token || !username) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Validate name (allow spaces and more characters for display names)
    const trimmedName = username.trim();
    if (trimmedName.length < 2 || trimmedName.length > 50) {
      return res.status(400).json({
        error: 'Name must be 2-50 characters',
      });
    }

    // Check if name already exists
    if (users.findByName(trimmedName)) {
      return res.status(400).json({ error: 'Name already taken' });
    }

    // Validate invitation
    const invitation = invitations.findByToken(token);
    const isSystemToken = invitation && invitation.created_by === 'SYSTEM';
    const userCount = users.count();

    if (!invitations.isValid(invitation) && !(isSystemToken && userCount === 0)) {
      return res.status(400).json({ error: 'Invalid or expired invitation' });
    }

    // Create temporary user object for registration
    const tempUser = {
      id: `temp_${Date.now()}`,
      name: trimmedName,
    };

    const options = await generateRegistrationOptionsForUser(tempUser);

    // Store registration data in session
    req.session.regChallenge = options.challenge;
    req.session.regToken = token;
    req.session.regName = trimmedName;

    res.json(options);
  } catch (error) {
    console.error('Registration options error:', error);
    res.status(500).json({ error: 'Failed to generate registration options' });
  }
});

// Verify registration
router.post('/register/verify', async (req, res) => {
  try {
    const { response } = req.body;
    const expectedChallenge = req.session.regChallenge;
    const token = req.session.regToken;
    const name = req.session.regName;

    if (!expectedChallenge || !token || !name) {
      return res.status(400).json({ error: 'No registration in progress' });
    }

    // Validate invitation again
    const invitation = invitations.findByToken(token);
    const isSystemToken = invitation && invitation.created_by === 'SYSTEM';
    const userCount = users.count();
    const isFirstUser = isSystemToken && userCount === 0;

    if (!invitations.isValid(invitation) && !isFirstUser) {
      return res.status(400).json({ error: 'Invalid or expired invitation' });
    }

    // Create the user (first user becomes admin)
    const user = users.create(name, isFirstUser);

    // Verify and store the passkey
    const result = await verifyAndStoreRegistration(user, response, expectedChallenge);

    if (!result.verified) {
      // If verification fails, we'd ideally roll back the user creation
      // For simplicity, we'll leave it (user can try again)
      return res.status(400).json({ error: 'Passkey registration failed' });
    }

    // Mark invitation as used
    invitations.markUsed(invitation.id, user.id);

    // Clear registration session data
    delete req.session.regChallenge;
    delete req.session.regToken;
    delete req.session.regName;

    // Log the user in
    req.session.userId = user.id;

    res.json({ success: true, redirect: '/' });
  } catch (error) {
    console.error('Registration verify error:', error);
    res.status(500).json({ error: 'Registration verification failed' });
  }
});

// Generate Nostr registration options
router.post('/register/nostr-options', (req, res) => {
  try {
    const { token, username } = req.body;

    if (!token || !username) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Validate name
    const trimmedName = username.trim();
    if (trimmedName.length < 2 || trimmedName.length > 50) {
      return res.status(400).json({ error: 'Name must be 2-50 characters' });
    }

    // Check if name already exists
    if (users.findByName(trimmedName)) {
      return res.status(400).json({ error: 'Name already taken' });
    }

    // Validate invitation
    const invitation = invitations.findByToken(token);
    const isSystemToken = invitation && invitation.created_by === 'SYSTEM';
    const userCount = users.count();

    if (!invitations.isValid(invitation) && !(isSystemToken && userCount === 0)) {
      return res.status(400).json({ error: 'Invalid or expired invitation' });
    }

    const challenge = generateChallenge();

    // Store registration data in session
    req.session.nostrRegChallenge = challenge;
    req.session.nostrRegToken = token;
    req.session.nostrRegName = trimmedName;

    res.json({ challenge });
  } catch (error) {
    console.error('Nostr registration options error:', error);
    res.status(500).json({ error: 'Failed to generate registration options' });
  }
});

// Verify Nostr registration
router.post('/register/nostr-verify', (req, res) => {
  try {
    const { signedEvent } = req.body;
    const expectedChallenge = req.session.nostrRegChallenge;
    const token = req.session.nostrRegToken;
    const name = req.session.nostrRegName;

    if (!expectedChallenge || !token || !name) {
      return res.status(400).json({ error: 'No registration in progress' });
    }

    // Validate invitation again
    const invitation = invitations.findByToken(token);
    const isSystemToken = invitation && invitation.created_by === 'SYSTEM';
    const userCount = users.count();
    const isFirstUser = isSystemToken && userCount === 0;

    if (!invitations.isValid(invitation) && !isFirstUser) {
      return res.status(400).json({ error: 'Invalid or expired invitation' });
    }

    // Verify the signed event
    const result = verifyAuthEvent(signedEvent, expectedChallenge);
    if (!result.verified) {
      return res.status(400).json({ error: result.error || 'Verification failed' });
    }

    // Check if pubkey is already linked to another account
    const existingUser = users.findByNostrPubkey(result.pubkey);
    if (existingUser) {
      return res.status(400).json({ error: 'This Nostr identity is already linked to another account' });
    }

    // Create the user (first user becomes admin)
    const user = users.create(name, isFirstUser);

    // Link the Nostr pubkey to the user
    users.linkNostrPubkey(user.id, result.pubkey);

    // Mark invitation as used
    invitations.markUsed(invitation.id, user.id);

    // Clear registration session data
    delete req.session.nostrRegChallenge;
    delete req.session.nostrRegToken;
    delete req.session.nostrRegName;

    // Log the user in
    req.session.userId = user.id;

    res.json({ success: true, redirect: '/' });
  } catch (error) {
    console.error('Nostr registration verify error:', error);
    res.status(500).json({ error: 'Registration verification failed' });
  }
});

// Profile page
router.get('/profile', requireAuth, (req, res) => {
  const nostrNpub = req.user.nostr_pubkey ? hexToNpub(req.user.nostr_pubkey) : null;
  res.render('profile', {
    title: 'Profile',
    error: null,
    success: null,
    nostrNpub,
  });
});

// Update profile
router.post('/profile', requireAuth, (req, res) => {
  const { name } = req.body;
  const trimmedName = name ? name.trim() : '';
  const nostrNpub = req.user.nostr_pubkey ? hexToNpub(req.user.nostr_pubkey) : null;

  // Validate name
  if (trimmedName.length < 2 || trimmedName.length > 50) {
    return res.render('profile', {
      title: 'Profile',
      error: 'Name must be 2-50 characters',
      success: null,
      nostrNpub,
    });
  }

  // Check if name is taken by another user
  const existingUser = users.findByName(trimmedName);
  if (existingUser && existingUser.id !== req.user.id) {
    return res.render('profile', {
      title: 'Profile',
      error: 'Name already taken',
      success: null,
      nostrNpub,
    });
  }

  // Update name
  users.updateName(req.user.id, trimmedName);

  // Update session user object
  req.user.name = trimmedName;
  res.locals.user.name = trimmedName;

  res.render('profile', {
    title: 'Profile',
    error: null,
    success: 'Name updated successfully',
    nostrNpub,
  });
});

// Upload avatar
router.post('/profile/avatar', requireAuth, (req, res) => {
  upload.single('avatar')(req, res, (err) => {
    const nostrNpub = req.user.nostr_pubkey ? hexToNpub(req.user.nostr_pubkey) : null;
    if (err) {
      const errorMsg = err.message === 'File too large'
        ? 'Image must be under 2MB'
        : err.message || 'Upload failed';
      return res.render('profile', {
        title: 'Profile',
        error: errorMsg,
        success: null,
        nostrNpub,
      });
    }

    if (!req.file) {
      return res.render('profile', {
        title: 'Profile',
        error: 'Please select an image',
        success: null,
        nostrNpub,
      });
    }

    // Update user's avatar URL
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    users.updateAvatar(req.user.id, avatarUrl);

    // Update session
    req.user.avatar_url = avatarUrl;
    res.locals.user.avatar_url = avatarUrl;

    res.render('profile', {
      title: 'Profile',
      error: null,
      success: 'Profile picture updated',
      nostrNpub,
    });
  });
});

// Remove avatar
router.post('/profile/avatar/remove', requireAuth, (req, res) => {
  const nostrNpub = req.user.nostr_pubkey ? hexToNpub(req.user.nostr_pubkey) : null;
  // Delete the file if it exists
  if (req.user.avatar_url) {
    const filePath = path.join(__dirname, '../../data', req.user.avatar_url);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // Clear avatar URL in database
  users.updateAvatar(req.user.id, null);

  // Update session
  req.user.avatar_url = null;
  res.locals.user.avatar_url = null;

  res.render('profile', {
    title: 'Profile',
    error: null,
    success: 'Profile picture removed',
    nostrNpub,
  });
});

// Generate challenge for linking Nostr identity
router.post('/profile/nostr/link', requireAuth, (req, res) => {
  try {
    // Check if user already has a linked Nostr identity
    if (req.user.nostr_pubkey) {
      return res.status(400).json({ error: 'Nostr identity already linked' });
    }

    const challenge = generateChallenge();
    req.session.nostrLinkChallenge = challenge;
    res.json({ challenge });
  } catch (error) {
    console.error('Nostr link challenge error:', error);
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

// Verify and link Nostr identity to account
router.post('/profile/nostr/verify', requireAuth, (req, res) => {
  try {
    const { signedEvent } = req.body;
    const expectedChallenge = req.session.nostrLinkChallenge;

    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No link in progress' });
    }

    // Verify the signed event
    const result = verifyAuthEvent(signedEvent, expectedChallenge);
    if (!result.verified) {
      return res.status(400).json({ error: result.error || 'Verification failed' });
    }

    // Check if pubkey is already linked to another account
    const existingUser = users.findByNostrPubkey(result.pubkey);
    if (existingUser && existingUser.id !== req.user.id) {
      return res.status(400).json({ error: 'This Nostr identity is already linked to another account' });
    }

    // Link the pubkey
    users.linkNostrPubkey(req.user.id, result.pubkey);

    // Update session
    req.user.nostr_pubkey = result.pubkey;

    // Clear challenge
    delete req.session.nostrLinkChallenge;

    const npub = hexToNpub(result.pubkey);
    res.json({ success: true, npub });
  } catch (error) {
    console.error('Nostr link verify error:', error);
    res.status(500).json({ error: 'Linking failed' });
  }
});

// Unlink Nostr identity from account
router.post('/profile/nostr/unlink', requireAuth, (req, res) => {
  try {
    if (!req.user.nostr_pubkey) {
      return res.status(400).json({ error: 'No Nostr identity linked' });
    }

    // Check auth method count before unlinking
    const authMethods = countUserAuthMethods(req.user.id);
    if (authMethods.total <= 1) {
      return res.status(400).json({ error: 'Cannot remove your only authentication method' });
    }

    // Unlink the pubkey
    users.unlinkNostrPubkey(req.user.id);

    // Update session
    req.user.nostr_pubkey = null;

    res.json({ success: true });
  } catch (error) {
    console.error('Nostr unlink error:', error);
    res.status(500).json({ error: 'Unlinking failed' });
  }
});

// List user's passkeys
router.get('/profile/passkeys', requireAuth, (req, res) => {
  try {
    const userPasskeys = passkeys.findByUserId(req.user.id);
    const authMethods = countUserAuthMethods(req.user.id);

    // Add deletion eligibility to each passkey
    const passkeysWithEligibility = userPasskeys.map(pk => ({
      id: pk.id,
      created_at: pk.created_at,
      canDelete: authMethods.total > 1,
    }));

    res.json({
      passkeys: passkeysWithEligibility,
      authMethods,
    });
  } catch (error) {
    console.error('List passkeys error:', error);
    res.status(500).json({ error: 'Failed to list passkeys' });
  }
});

// Generate WebAuthn options for adding a new passkey
router.post('/profile/passkeys/add', requireAuth, async (req, res) => {
  try {
    const options = await generateRegistrationOptionsForUser(req.user);

    // Store challenge in session
    req.session.addPasskeyChallenge = options.challenge;

    res.json(options);
  } catch (error) {
    console.error('Add passkey options error:', error);
    res.status(500).json({ error: 'Failed to generate registration options' });
  }
});

// Verify and store new passkey
router.post('/profile/passkeys/verify', requireAuth, async (req, res) => {
  try {
    const { response } = req.body;
    const expectedChallenge = req.session.addPasskeyChallenge;

    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No passkey registration in progress' });
    }

    const result = await verifyAndStoreRegistration(req.user, response, expectedChallenge);

    // Clear session
    delete req.session.addPasskeyChallenge;

    if (result.verified) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Passkey registration failed' });
    }
  } catch (error) {
    console.error('Verify passkey error:', error);
    res.status(500).json({ error: 'Failed to verify passkey' });
  }
});

// Delete a passkey
router.post('/profile/passkeys/:id/delete', requireAuth, (req, res) => {
  try {
    const passkeyId = req.params.id;

    // Verify passkey exists and belongs to user
    const passkey = passkeys.findById(passkeyId);
    if (!passkey) {
      return res.status(404).json({ error: 'Passkey not found' });
    }
    if (passkey.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this passkey' });
    }

    // Check auth method count before deletion
    const authMethods = countUserAuthMethods(req.user.id);
    if (authMethods.total <= 1) {
      return res.status(400).json({ error: 'Cannot delete your only authentication method' });
    }

    // Delete the passkey
    passkeys.deleteById(passkeyId);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete passkey error:', error);
    res.status(500).json({ error: 'Failed to delete passkey' });
  }
});

// Recovery page (requires valid recovery token)
router.get('/recover', redirectIfAuthenticated, (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.render('error', {
      title: 'Invalid Link',
      message: 'Recovery requires a valid recovery link.',
    });
  }

  const invitation = invitations.findByToken(token);

  if (!invitations.isValid(invitation) || !invitation.recovery_for_user_id) {
    return res.render('error', {
      title: 'Invalid Recovery Link',
      message: 'This recovery link is invalid, expired, or has already been used.',
    });
  }

  // Get the target user
  const targetUser = users.findById(invitation.recovery_for_user_id);
  if (!targetUser || targetUser.deleted_at) {
    return res.render('error', {
      title: 'Invalid Recovery Link',
      message: 'The account associated with this recovery link no longer exists.',
    });
  }

  // Check if user already has Nostr linked (can only add passkey then)
  const hasNostr = !!targetUser.nostr_pubkey;

  res.render('recover', {
    title: 'Account Recovery',
    token,
    targetUserName: targetUser.name,
    hasNostr,
    error: null,
  });
});

// Generate passkey registration options for recovery
router.post('/recover/passkey-options', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const invitation = invitations.findByToken(token);

    if (!invitations.isValid(invitation) || !invitation.recovery_for_user_id) {
      return res.status(400).json({ error: 'Invalid or expired recovery link' });
    }

    const targetUser = users.findById(invitation.recovery_for_user_id);
    if (!targetUser || targetUser.deleted_at) {
      return res.status(400).json({ error: 'Account no longer exists' });
    }

    const options = await generateRegistrationOptionsForUser(targetUser);

    // Store in session
    req.session.recoveryChallenge = options.challenge;
    req.session.recoveryToken = token;

    res.json(options);
  } catch (error) {
    console.error('Recovery passkey options error:', error);
    res.status(500).json({ error: 'Failed to generate registration options' });
  }
});

// Verify passkey registration for recovery and log in
router.post('/recover/passkey-verify', async (req, res) => {
  try {
    const { response } = req.body;
    const expectedChallenge = req.session.recoveryChallenge;
    const token = req.session.recoveryToken;

    if (!expectedChallenge || !token) {
      return res.status(400).json({ error: 'No recovery in progress' });
    }

    // Re-validate invitation
    const invitation = invitations.findByToken(token);
    if (!invitations.isValid(invitation) || !invitation.recovery_for_user_id) {
      return res.status(400).json({ error: 'Invalid or expired recovery link' });
    }

    const targetUser = users.findById(invitation.recovery_for_user_id);
    if (!targetUser || targetUser.deleted_at) {
      return res.status(400).json({ error: 'Account no longer exists' });
    }

    // Verify and store the passkey
    const result = await verifyAndStoreRegistration(targetUser, response, expectedChallenge);

    if (!result.verified) {
      return res.status(400).json({ error: 'Passkey registration failed' });
    }

    // Mark invitation as used
    invitations.markUsed(invitation.id, targetUser.id);

    // Clear session
    delete req.session.recoveryChallenge;
    delete req.session.recoveryToken;

    // Log the user in
    req.session.userId = targetUser.id;

    res.json({ success: true, redirect: '/' });
  } catch (error) {
    console.error('Recovery passkey verify error:', error);
    res.status(500).json({ error: 'Recovery verification failed' });
  }
});

// Generate Nostr challenge for recovery
router.post('/recover/nostr-options', (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const invitation = invitations.findByToken(token);

    if (!invitations.isValid(invitation) || !invitation.recovery_for_user_id) {
      return res.status(400).json({ error: 'Invalid or expired recovery link' });
    }

    const targetUser = users.findById(invitation.recovery_for_user_id);
    if (!targetUser || targetUser.deleted_at) {
      return res.status(400).json({ error: 'Account no longer exists' });
    }

    // Don't allow Nostr recovery if already linked
    if (targetUser.nostr_pubkey) {
      return res.status(400).json({ error: 'This account already has a Nostr identity linked. Please use passkey recovery.' });
    }

    const challenge = generateChallenge();

    // Store in session
    req.session.nostrRecoveryChallenge = challenge;
    req.session.nostrRecoveryToken = token;

    res.json({ challenge });
  } catch (error) {
    console.error('Recovery Nostr options error:', error);
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

// Verify Nostr for recovery and log in
router.post('/recover/nostr-verify', (req, res) => {
  try {
    const { signedEvent } = req.body;
    const expectedChallenge = req.session.nostrRecoveryChallenge;
    const token = req.session.nostrRecoveryToken;

    if (!expectedChallenge || !token) {
      return res.status(400).json({ error: 'No recovery in progress' });
    }

    // Re-validate invitation
    const invitation = invitations.findByToken(token);
    if (!invitations.isValid(invitation) || !invitation.recovery_for_user_id) {
      return res.status(400).json({ error: 'Invalid or expired recovery link' });
    }

    const targetUser = users.findById(invitation.recovery_for_user_id);
    if (!targetUser || targetUser.deleted_at) {
      return res.status(400).json({ error: 'Account no longer exists' });
    }

    // Don't allow if Nostr already linked
    if (targetUser.nostr_pubkey) {
      return res.status(400).json({ error: 'This account already has a Nostr identity linked' });
    }

    // Verify the signed event
    const result = verifyAuthEvent(signedEvent, expectedChallenge);
    if (!result.verified) {
      return res.status(400).json({ error: result.error || 'Verification failed' });
    }

    // Check if pubkey is already linked to another account
    const existingUser = users.findByNostrPubkey(result.pubkey);
    if (existingUser && existingUser.id !== targetUser.id) {
      return res.status(400).json({ error: 'This Nostr identity is already linked to another account' });
    }

    // Link the Nostr pubkey
    users.linkNostrPubkey(targetUser.id, result.pubkey);

    // Mark invitation as used
    invitations.markUsed(invitation.id, targetUser.id);

    // Clear session
    delete req.session.nostrRecoveryChallenge;
    delete req.session.nostrRecoveryToken;

    // Log the user in
    req.session.userId = targetUser.id;

    res.json({ success: true, redirect: '/' });
  } catch (error) {
    console.error('Recovery Nostr verify error:', error);
    res.status(500).json({ error: 'Recovery verification failed' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/login');
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/login');
  });
});

module.exports = router;
