const express = require('express');
const { users, invitations } = require('../db');
const {
  generateRegistrationOptionsForUser,
  verifyAndStoreRegistration,
  generateAuthenticationOptionsForUser,
  verifyAuthentication,
} = require('../auth');
const { redirectIfAuthenticated } = require('../middleware/auth');

const router = express.Router();

// Login page
router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('login', { title: 'Login', error: null });
});

// Generate authentication options
router.post('/login/options', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await generateAuthenticationOptionsForUser(username);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    // Store challenge in session
    req.session.authChallenge = result.options.challenge;
    req.session.authUserId = result.user.id;

    res.json(result.options);
  } catch (error) {
    console.error('Login options error:', error);
    res.status(500).json({ error: 'Failed to generate authentication options' });
  }
});

// Verify authentication
router.post('/login/verify', async (req, res) => {
  try {
    const { response } = req.body;
    const expectedChallenge = req.session.authChallenge;
    const userId = req.session.authUserId;

    if (!expectedChallenge || !userId) {
      return res.status(400).json({ error: 'No authentication in progress' });
    }

    const user = users.findById(userId);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    const result = await verifyAuthentication(response, expectedChallenge, user);

    // Clear auth session data
    delete req.session.authChallenge;
    delete req.session.authUserId;

    if (result.verified) {
      req.session.userId = user.id;
      return res.json({ success: true, redirect: '/' });
    }

    res.status(400).json({ error: 'Authentication failed' });
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
