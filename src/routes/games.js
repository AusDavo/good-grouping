const express = require('express');
const { games, users } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All game routes require authentication
router.use(requireAuth);

// New game form
router.get('/new', (req, res) => {
  const allUsers = users.findAll();

  res.render('games/new', {
    title: 'Record New Game',
    allUsers,
    error: null,
  });
});

// Create new game
router.post('/', (req, res) => {
  try {
    const { playedAt, gameType, notes, players } = req.body;

    // Validate players
    if (!players || !Array.isArray(players) || players.length < 2) {
      const allUsers = users.findAll();
      return res.render('games/new', {
        title: 'Record New Game',
        allUsers,
        error: 'At least 2 players are required',
      });
    }

    // Parse and validate player data
    const playerData = players.map((p, index) => ({
      userId: p.userId,
      score: p.score ? parseInt(p.score, 10) : null,
      position: index + 1,
      isWinner: p.isWinner === 'true' || p.isWinner === true,
    })).filter(p => p.userId);

    if (playerData.length < 2) {
      const allUsers = users.findAll();
      return res.render('games/new', {
        title: 'Record New Game',
        allUsers,
        error: 'At least 2 players must be selected',
      });
    }

    // Create the game
    const gameId = games.create(
      playedAt || new Date().toISOString().split('T')[0],
      gameType || 'Cricket',
      req.user.id,
      notes || null,
      playerData
    );

    res.redirect(`/games/${gameId}`);
  } catch (error) {
    console.error('Create game error:', error);
    const allUsers = users.findAll();
    res.render('games/new', {
      title: 'Record New Game',
      allUsers,
      error: 'Failed to create game',
    });
  }
});

// View single game
router.get('/:id', (req, res) => {
  const game = games.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  res.render('games/show', {
    title: `Game - ${game.game_type}`,
    game,
  });
});

// Delete game (only creator or admin)
router.post('/:id/delete', (req, res) => {
  const game = games.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  if (game.created_by !== req.user.id && !req.user.is_admin) {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'You can only delete games you created',
    });
  }

  games.delete(req.params.id);
  res.redirect('/');
});

module.exports = router;
