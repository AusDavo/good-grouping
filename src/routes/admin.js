const express = require('express');
const { invitations } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All admin routes require admin role
router.use(requireAdmin);

// Invitations management page
router.get('/invites', (req, res) => {
  const activeInvites = invitations.findActive();
  const expiredInvites = invitations.findExpired();
  const usedInvites = invitations.findUsed();

  res.render('admin/invites', {
    title: 'Manage Invitations',
    activeInvites,
    expiredInvites,
    usedInvites,
    baseUrl: process.env.BASE_URL || `${req.protocol}://${req.get('host')}`,
  });
});

// Create new invitation
router.post('/invites', (req, res) => {
  try {
    const invite = invitations.create(req.user.id);
    res.redirect('/admin/invites');
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to create invitation',
    });
  }
});

// Revoke invitation
router.post('/invites/:id/revoke', (req, res) => {
  try {
    invitations.revoke(req.params.id);
    res.redirect('/admin/invites');
  } catch (error) {
    console.error('Revoke invite error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to revoke invitation',
    });
  }
});

module.exports = router;
