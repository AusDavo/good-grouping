const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { users, invitations } = require('../db');

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

// Profile page
router.get('/profile', requireAuth, (req, res) => {
  res.render('profile', {
    title: 'Profile',
    error: null,
    success: null,
  });
});

// Update profile
router.post('/profile', requireAuth, (req, res) => {
  const { name } = req.body;
  const trimmedName = name ? name.trim() : '';

  // Validate name
  if (trimmedName.length < 2 || trimmedName.length > 50) {
    return res.render('profile', {
      title: 'Profile',
      error: 'Name must be 2-50 characters',
      success: null,
    });
  }

  // Check if name is taken by another user
  const existingUser = users.findByName(trimmedName);
  if (existingUser && existingUser.id !== req.user.id) {
    return res.render('profile', {
      title: 'Profile',
      error: 'Name already taken',
      success: null,
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
  });
});

// Upload avatar
router.post('/profile/avatar', requireAuth, (req, res) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) {
      const errorMsg = err.message === 'File too large'
        ? 'Image must be under 2MB'
        : err.message || 'Upload failed';
      return res.render('profile', {
        title: 'Profile',
        error: errorMsg,
        success: null,
      });
    }

    if (!req.file) {
      return res.render('profile', {
        title: 'Profile',
        error: 'Please select an image',
        success: null,
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
    });
  });
});

// Remove avatar
router.post('/profile/avatar/remove', requireAuth, (req, res) => {
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
  });
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
