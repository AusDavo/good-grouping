const express = require('express');
const { games, users, notifications } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notifyGameCreated } = require('../pushService');

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

// Game types where highest score wins (draws possible if tied)
const SCORE_BASED_GAMES = ['Cricket'];

// Create new game
router.post('/', (req, res) => {
  try {
    const { playedAt, gameType, notes, players } = req.body;
    const normalizedGameType = gameType || 'Cricket';

    // Validate players
    if (!players || !Array.isArray(players) || players.length < 2) {
      const allUsers = users.findAll();
      return res.render('games/new', {
        title: 'Record New Game',
        allUsers,
        error: 'At least 2 players are required',
      });
    }

    // Parse player data
    let playerData = players.map((p, index) => ({
      userId: p.userId,
      score: p.score ? parseInt(p.score, 10) : null,
      position: index + 1,
      isWinner: p.isWinner === 'true' || p.isWinner === true,
      checkoutDarts: p.checkoutDarts ? parseInt(p.checkoutDarts, 10) : null,
    })).filter(p => p.userId);

    // For score-based games, auto-determine winner by highest score
    // Only one player can win - if scores are tied, it's a draw (no winner)
    if (SCORE_BASED_GAMES.includes(normalizedGameType)) {
      const allHaveScores = playerData.every(p => p.score !== null);
      if (allHaveScores) {
        const maxScore = Math.max(...playerData.map(p => p.score));
        const playersWithMaxScore = playerData.filter(p => p.score === maxScore);
        const isDraw = playersWithMaxScore.length > 1;
        playerData = playerData.map(p => ({
          ...p,
          isWinner: !isDraw && p.score === maxScore,
        }));
      }
    }

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
      normalizedGameType,
      req.user.id,
      notes || null,
      playerData
    );

    // Create notifications for other participants
    for (const player of playerData) {
      if (player.userId !== req.user.id) {
        notifications.create(
          player.userId,
          'game_created',
          gameId,
          `${req.user.name} recorded a ${normalizedGameType} game with you. Please confirm the results.`
        );
      }
    }

    // Send push notifications (async, don't await)
    const createdGame = games.findById(gameId);
    notifyGameCreated(createdGame, playerData, req.user.name).catch(err => {
      console.error('Push notification error:', err);
    });

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

// Confirm game results
router.post('/:id/confirm', (req, res) => {
  const game = games.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  // Check if user is a participant
  const isParticipant = game.players.some(p => p.user_id === req.user.id);

  if (!isParticipant) {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'You are not a participant in this game',
    });
  }

  // Confirm the game
  games.confirmForUser(req.params.id, req.user.id);

  res.redirect(`/games/${req.params.id}`);
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
