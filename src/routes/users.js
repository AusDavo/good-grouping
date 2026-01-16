const express = require('express');
const { users, games } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All user routes require authentication
router.use(requireAuth);

// View public user profile
router.get('/:id', (req, res) => {
  const profileUser = users.findById(req.params.id);

  if (!profileUser) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'User not found',
    });
  }

  // Get user's games
  const userGames = games.findByUserId(profileUser.id, 20);

  // Calculate stats
  const totalGames = userGames.length;
  const wins = userGames.filter(g =>
    g.players.some(p => p.user_id === profileUser.id && p.is_winner)
  ).length;

  res.render('users/show', {
    title: profileUser.name,
    profileUser,
    games: userGames,
    stats: {
      totalGames,
      wins,
    },
  });
});

module.exports = router;
