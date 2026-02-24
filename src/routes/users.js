const express = require('express');
const { users, games, crowns } = require('../db');
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

  // Get user's crowns
  const userCrowns = crowns.findByUserId(profileUser.id);

  // Calculate win rate by game type
  const gameTypeStats = {};
  userGames.forEach(g => {
    if (!gameTypeStats[g.game_type]) {
      gameTypeStats[g.game_type] = { played: 0, wins: 0 };
    }
    gameTypeStats[g.game_type].played++;
    if (g.players.some(p => p.user_id === profileUser.id && p.is_winner)) {
      gameTypeStats[g.game_type].wins++;
    }
  });

  // Calculate streaks
  let currentStreak = 0;
  let bestStreak = 0;
  let streakType = null;
  for (const game of userGames) {
    const playerResult = game.players.find(p => p.user_id === profileUser.id);
    if (playerResult && playerResult.is_winner) {
      currentStreak++;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
      if (streakType === null) streakType = 'W';
    } else {
      if (streakType === null) streakType = 'L';
      currentStreak = 0;
    }
  }

  // Find head-to-head records
  const h2hRecords = {};
  userGames.forEach(g => {
    g.players.forEach(p => {
      if (p.user_id !== profileUser.id) {
        if (!h2hRecords[p.user_id]) {
          h2hRecords[p.user_id] = { name: p.name, wins: 0, losses: 0, played: 0, avatar_url: p.avatar_url };
        }
        h2hRecords[p.user_id].played++;
        const userIsWinner = g.players.some(pp => pp.user_id === profileUser.id && pp.is_winner);
        if (userIsWinner) {
          h2hRecords[p.user_id].wins++;
        } else if (p.is_winner) {
          h2hRecords[p.user_id].losses++;
        }
      }
    });
  });

  res.render('users/show', {
    title: profileUser.name,
    profileUser,
    games: userGames,
    userCrowns,
    stats: {
      totalGames,
      wins,
      gameTypeStats,
      bestStreak,
      currentStreak: streakType === 'W' ? currentStreak : 0,
    },
    h2hRecords,
  });
});

module.exports = router;
