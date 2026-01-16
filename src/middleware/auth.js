const { users, notifications } = require('../db');

// Middleware to load user from session
function loadUser(req, res, next) {
  if (req.session && req.session.userId) {
    const user = users.findById(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.user = user;
      // Add unread notification count for navbar
      res.locals.unreadNotificationCount = notifications.countUnread(user.id);
    } else {
      // User no longer exists, clear session
      delete req.session.userId;
    }
  }
  next();
}

// Middleware to require authentication
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect('/login');
  }
  next();
}

// Middleware to require admin role
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.redirect('/login');
  }
  if (!req.user.is_admin) {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'You do not have permission to access this page.',
    });
  }
  next();
}

// Middleware to redirect if already logged in
function redirectIfAuthenticated(req, res, next) {
  if (req.user) {
    return res.redirect('/');
  }
  next();
}

module.exports = {
  loadUser,
  requireAuth,
  requireAdmin,
  redirectIfAuthenticated,
};
