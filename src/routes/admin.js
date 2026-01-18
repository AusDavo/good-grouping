const express = require('express');
const { invitations, users } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All admin routes require admin role
router.use(requireAdmin);

// Invitations management page
router.get('/invites', (req, res) => {
  const activeInvites = invitations.findActive();
  const activeRecoveryInvites = invitations.findActiveRecovery();
  const expiredInvites = invitations.findExpired();
  const usedInvites = invitations.findUsed();
  const allUsers = users.findAllActive();

  res.render('admin/invites', {
    title: 'Manage Invitations',
    activeInvites,
    activeRecoveryInvites,
    expiredInvites,
    usedInvites,
    allUsers,
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

// Create recovery invitation for a specific user
router.post('/invites/recovery', (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).render('error', {
        title: 'Error',
        message: 'User ID is required',
      });
    }

    // Validate user exists and is not deleted
    const targetUser = users.findById(userId);
    if (!targetUser) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'User not found',
      });
    }

    if (targetUser.deleted_at) {
      return res.status(400).render('error', {
        title: 'Error',
        message: 'Cannot create recovery invitation for a deleted user',
      });
    }

    // Check if there's already an active recovery invitation for this user
    const existingRecovery = invitations.findRecoveryByUserId(userId);
    if (existingRecovery) {
      return res.status(400).render('error', {
        title: 'Error',
        message: 'An active recovery invitation already exists for this user',
      });
    }

    // Create recovery invitation (expires in 7 days)
    invitations.createRecovery(req.user.id, userId, 7);
    res.redirect('/admin/invites');
  } catch (error) {
    console.error('Create recovery invite error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to create recovery invitation',
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

// User management page
router.get('/users', (req, res) => {
  const allUsers = users.findAllActive();
  const adminCount = users.countAdmins();

  res.render('admin/users', {
    title: 'Manage Users',
    allUsers,
    adminCount,
  });
});

// Promote user to admin
router.post('/users/:id/promote', (req, res) => {
  try {
    const targetUser = users.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'User not found',
      });
    }

    if (targetUser.deleted_at) {
      return res.status(400).render('error', {
        title: 'Error',
        message: 'Cannot promote a deleted user',
      });
    }

    users.setAdmin(req.params.id, true);
    res.redirect('/admin/users');
  } catch (error) {
    console.error('Promote user error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to promote user',
    });
  }
});

// Demote user from admin (self-demotion only, blocked if last admin)
router.post('/users/:id/demote', (req, res) => {
  try {
    // Can only demote yourself
    if (req.params.id !== req.user.id) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You can only demote yourself',
      });
    }

    const adminCount = users.countAdmins();
    if (adminCount <= 1) {
      return res.status(400).render('error', {
        title: 'Error',
        message: 'Cannot demote the last admin',
      });
    }

    users.setAdmin(req.params.id, false);
    res.redirect('/');
  } catch (error) {
    console.error('Demote user error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to demote user',
    });
  }
});

// Remove user (soft delete)
router.post('/users/:id/remove', (req, res) => {
  try {
    const targetUser = users.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'User not found',
      });
    }

    // Cannot remove yourself
    if (req.params.id === req.user.id) {
      return res.status(400).render('error', {
        title: 'Error',
        message: 'Cannot remove yourself',
      });
    }

    // If target is admin, check admin count
    if (targetUser.is_admin) {
      const adminCount = users.countAdmins();
      if (adminCount <= 1) {
        return res.status(400).render('error', {
          title: 'Error',
          message: 'Cannot remove the last admin',
        });
      }
    }

    users.softDelete(req.params.id);
    res.redirect('/admin/users');
  } catch (error) {
    console.error('Remove user error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to remove user',
    });
  }
});

module.exports = router;
