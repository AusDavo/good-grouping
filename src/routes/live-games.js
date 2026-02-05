const express = require('express');
const { liveGames, liveGameSeries, users, games, notifications, crowns } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All live game routes require authentication
router.use(requireAuth);

// List active live games
router.get('/', (req, res) => {
  const activeGames = liveGames.findActive();

  res.render('live-games/index', {
    title: 'Live Games',
    activeGames,
  });
});

// New live game form
router.get('/new', (req, res) => {
  const allUsers = users.findAllActive();

  res.render('live-games/new', {
    title: 'Start Live Game',
    allUsers,
    error: null,
  });
});

// Create new live game
router.post('/', (req, res) => {
  try {
    const { gameType, startingScore, playerIds, seriesLength } = req.body;

    // Validate players
    const playerList = Array.isArray(playerIds) ? playerIds : [playerIds].filter(Boolean);

    if (playerList.length < 2) {
      const allUsers = users.findAllActive();
      return res.render('live-games/new', {
        title: 'Start Live Game',
        allUsers,
        error: 'At least 2 players are required',
      });
    }

    // Validate game type
    const validGameTypes = ['Cricket', '301', '501', 'Around the World'];
    if (!validGameTypes.includes(gameType)) {
      const allUsers = users.findAllActive();
      return res.render('live-games/new', {
        title: 'Start Live Game',
        allUsers,
        error: 'Invalid game type',
      });
    }

    // Parse starting score for 01 games
    let score = null;
    if (gameType === '301') score = 301;
    if (gameType === '501') score = 501;
    if (startingScore) score = parseInt(startingScore, 10);

    // Handle series creation
    let seriesId = null;
    const parsedSeriesLength = parseInt(seriesLength, 10) || 1;
    if (parsedSeriesLength > 1) {
      seriesId = liveGameSeries.create(parsedSeriesLength, gameType, req.user.id, playerList);
    }

    // Create the live game
    const gameId = liveGames.create(gameType, score, req.user.id, playerList, seriesId);

    res.redirect(`/live-games/${gameId}/lobby`);
  } catch (error) {
    console.error('Create live game error:', error);
    const allUsers = users.findAllActive();
    res.render('live-games/new', {
      title: 'Start Live Game',
      allUsers,
      error: 'Failed to create game',
    });
  }
});

// Lobby / waiting room
router.get('/:id/lobby', (req, res) => {
  const game = liveGames.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  // If game already started, redirect to play
  if (game.status === 'playing') {
    return res.redirect(`/live-games/${req.params.id}/play`);
  }

  // If game finished, redirect to summary
  if (game.status === 'finished') {
    return res.redirect(`/live-games/${req.params.id}`);
  }

  const isCreator = game.created_by === req.user.id;
  const isPlayer = game.players.some(p => p.user_id === req.user.id);

  res.render('live-games/lobby', {
    title: `Lobby - ${game.game_type}`,
    game,
    isCreator,
    isPlayer,
  });
});

// Reorder players (creator only, waiting status only)
router.post('/:id/reorder', (req, res) => {
  const game = liveGames.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  if (game.created_by !== req.user.id) {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'Only the game creator can reorder players',
    });
  }

  if (game.status !== 'waiting') {
    return res.status(400).render('error', {
      title: 'Error',
      message: 'Can only reorder players before the game starts',
    });
  }

  const { playerIdA, playerIdB } = req.body;
  if (playerIdA && playerIdB) {
    liveGames.swapPlayerOrder(playerIdA, playerIdB);
  }

  res.redirect(`/live-games/${req.params.id}/lobby`);
});

// Start the game (creator only)
router.post('/:id/start', (req, res) => {
  const game = liveGames.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  if (game.created_by !== req.user.id) {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'Only the game creator can start the game',
    });
  }

  if (game.status !== 'waiting') {
    return res.redirect(`/live-games/${req.params.id}/play`);
  }

  liveGames.start(req.params.id);

  res.redirect(`/live-games/${req.params.id}/play`);
});

// Main scoring UI
router.get('/:id/play', (req, res) => {
  const game = liveGames.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  // If game waiting, redirect to lobby
  if (game.status === 'waiting') {
    return res.redirect(`/live-games/${req.params.id}/lobby`);
  }

  // If game finished, redirect to summary
  if (game.status === 'finished') {
    return res.redirect(`/live-games/${req.params.id}`);
  }

  const isPlayer = game.players.some(p => p.user_id === req.user.id);
  const currentPlayer = game.players[game.current_player_index];

  res.render('live-games/play', {
    title: `${game.game_type} - Live`,
    game,
    isPlayer,
    currentPlayer,
    wsUrl: process.env.WS_URL || '',
  });
});

// API: Get current game state
router.get('/:id/state', (req, res) => {
  const game = liveGames.findById(req.params.id);

  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  res.json({
    id: game.id,
    game_type: game.game_type,
    status: game.status,
    starting_score: game.starting_score,
    current_player_index: game.current_player_index,
    current_dart: game.current_dart,
    current_turn: game.current_turn,
    players: game.players.map(p => ({
      id: p.id,
      user_id: p.user_id,
      name: p.name,
      player_order: p.player_order,
      marks_15: p.marks_15,
      marks_16: p.marks_16,
      marks_17: p.marks_17,
      marks_18: p.marks_18,
      marks_19: p.marks_19,
      marks_20: p.marks_20,
      marks_bull: p.marks_bull,
      cricket_points: p.cricket_points,
      remaining_score: p.remaining_score,
      current_target: p.current_target,
    })),
    throws: game.throws,
    winner_player_id: game.winner_player_id,
    series_id: game.series_id || null,
  });
});

// Game summary / finished view
router.get('/:id', (req, res) => {
  const game = liveGames.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  // Find winner if game is finished
  let winner = null;
  if (game.winner_player_id) {
    winner = game.players.find(p => p.id === game.winner_player_id);
  }

  const isPlayer = game.players.some(p => p.user_id === req.user.id);

  // Load series data if applicable
  let series = null;
  let seriesDecided = false;
  let seriesWinner = null;
  if (game.series_id) {
    series = liveGameSeries.findById(game.series_id);
    if (series) {
      seriesWinner = liveGameSeries.checkSeriesDecided(series);
      seriesDecided = !!seriesWinner;
    }
  }

  res.render('live-games/show', {
    title: `${game.game_type} - Summary`,
    game,
    winner,
    isPlayer,
    series,
    seriesDecided,
    seriesWinner,
  });
});

// Finalize game - convert to regular game for crown tracking
router.post('/:id/finalize', (req, res) => {
  const game = liveGames.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  if (game.status !== 'finished') {
    return res.status(400).render('error', {
      title: 'Error',
      message: 'Game must be finished before finalizing',
    });
  }

  // Check if user is a participant
  const isPlayer = game.players.some(p => p.user_id === req.user.id);
  if (!isPlayer) {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'Only participants can finalize the game',
    });
  }

  try {
    // Build player data for the regular game
    const winner = game.players.find(p => p.id === game.winner_player_id);
    const playerData = game.players.map((p, index) => ({
      userId: p.user_id,
      score: p.cricket_points || p.remaining_score || null,
      position: index + 1,
      isWinner: p.id === game.winner_player_id,
    }));

    // Create regular game record
    const playedAt = game.started_at ? game.started_at.split('T')[0] : new Date().toISOString().split('T')[0];
    const regularGameId = games.create(
      playedAt,
      game.game_type,
      req.user.id,
      `Live game finalized`,
      playerData
    );

    // Crown awarding: only if this is NOT part of a series, or if the series is decided
    let shouldAwardCrown = true;
    let crownWinnerUserId = winner ? winner.user_id : null;

    if (game.series_id) {
      // Part of a series - only award crown when series is decided
      const series = liveGameSeries.findById(game.series_id);
      if (series) {
        const seriesWinner = liveGameSeries.checkSeriesDecided(series);
        if (seriesWinner) {
          // Series is decided - award crown to series winner
          crownWinnerUserId = seriesWinner.user_id;
        } else {
          // Series still in progress - don't award crown yet
          shouldAwardCrown = false;
        }
      }
    }

    // Process crown transfer if appropriate
    if (shouldAwardCrown && crownWinnerUserId) {
      const playerIds = playerData.map(p => p.userId);
      const crownResult = crowns.processGameResult(game.game_type, crownWinnerUserId, regularGameId, playerIds);

      if (crownResult.awarded) {
        const winnerUser = users.findById(crownWinnerUserId);
        if (crownResult.previousHolder) {
          notifications.create(
            crownWinnerUserId,
            'crown_won',
            regularGameId,
            `You claimed the ${game.game_type} crown from ${crownResult.previousHolder.name}!`
          );
          notifications.create(
            crownResult.previousHolder.id,
            'crown_lost',
            regularGameId,
            `${winnerUser.name} has taken your ${game.game_type} crown!`
          );
        } else {
          notifications.create(
            crownWinnerUserId,
            'crown_won',
            regularGameId,
            `You are the first to claim the ${game.game_type} crown!`
          );
        }
      }
    }

    // Delete the live game
    liveGames.delete(req.params.id);

    res.redirect(`/games/${regularGameId}`);
  } catch (error) {
    console.error('Finalize game error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to finalize game',
    });
  }
});

// Create next game in series
router.post('/:id/next-in-series', (req, res) => {
  const game = liveGames.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  if (!game.series_id) {
    return res.status(400).render('error', {
      title: 'Error',
      message: 'This game is not part of a series',
    });
  }

  const series = liveGameSeries.findById(game.series_id);
  if (!series) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Series not found',
    });
  }

  // Check series is not already decided
  const seriesWinner = liveGameSeries.checkSeriesDecided(series);
  if (seriesWinner) {
    return res.status(400).render('error', {
      title: 'Error',
      message: 'Series is already decided',
    });
  }

  // Parse starting score for 01 games
  let score = null;
  if (game.game_type === '301') score = 301;
  if (game.game_type === '501') score = 501;
  if (game.starting_score) score = game.starting_score;

  // Mugs away: loser of previous game goes first
  const winnerPlayer = game.winner_player_id
    ? game.players.find(p => p.id === game.winner_player_id)
    : null;
  const winnerUserId = winnerPlayer ? winnerPlayer.user_id : null;
  const seriesUserIds = series.players.map(p => p.user_id);

  let playerUserIds;
  if (winnerUserId) {
    // Put non-winners first, winner last
    const losers = seriesUserIds.filter(id => id !== winnerUserId);
    playerUserIds = [...losers, winnerUserId];
  } else {
    playerUserIds = seriesUserIds;
  }

  // Create next game in series
  const nextGameId = liveGames.create(game.game_type, score, req.user.id, playerUserIds, game.series_id);

  res.redirect(`/live-games/${nextGameId}/lobby`);
});

// Extend series (+2 games)
router.post('/:id/extend-series', (req, res) => {
  const game = liveGames.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  if (!game.series_id) {
    return res.status(400).render('error', {
      title: 'Error',
      message: 'This game is not part of a series',
    });
  }

  const series = liveGameSeries.findById(game.series_id);
  if (!series) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Series not found',
    });
  }

  // Extend by 2 games and reactivate
  liveGameSeries.extendSeries(game.series_id, 2);

  // Parse starting score for 01 games
  let score = null;
  if (game.game_type === '301') score = 301;
  if (game.game_type === '501') score = 501;
  if (game.starting_score) score = game.starting_score;

  // Mugs away: loser of previous game goes first
  const winnerPlayer = game.winner_player_id
    ? game.players.find(p => p.id === game.winner_player_id)
    : null;
  const winnerUserId = winnerPlayer ? winnerPlayer.user_id : null;
  const seriesUserIds = series.players.map(p => p.user_id);

  let playerUserIds;
  if (winnerUserId) {
    const losers = seriesUserIds.filter(id => id !== winnerUserId);
    playerUserIds = [...losers, winnerUserId];
  } else {
    playerUserIds = seriesUserIds;
  }

  // Create next game in extended series
  const nextGameId = liveGames.create(game.game_type, score, req.user.id, playerUserIds, game.series_id);

  res.redirect(`/live-games/${nextGameId}/lobby`);
});

// Abandon/delete game
router.post('/:id/abandon', (req, res) => {
  const game = liveGames.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  // Only creator or admin can abandon
  if (game.created_by !== req.user.id && !req.user.is_admin) {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'Only the game creator can abandon the game',
    });
  }

  liveGames.delete(req.params.id);

  res.redirect('/live-games');
});

module.exports = router;
