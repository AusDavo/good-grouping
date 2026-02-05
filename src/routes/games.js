const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { games, users, notifications, crowns, gameDeletions, gameComments, gamePhotos } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notifyGameCreated, notifyGameComment } = require('../pushService');

const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../data/uploads/game-photos');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer configuration for photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit
  },
});

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

    // Process crown transfer if there's a single winner
    const winner = playerData.find(p => p.isWinner);
    if (winner) {
      const playerIds = playerData.map(p => p.userId);
      const crownResult = crowns.processGameResult(normalizedGameType, winner.userId, gameId, playerIds);
      if (crownResult.awarded) {
        const winnerUser = users.findById(winner.userId);
        if (crownResult.previousHolder) {
          // Crown was taken from previous holder
          notifications.create(
            winner.userId,
            'crown_won',
            gameId,
            `You claimed the ${normalizedGameType} crown from ${crownResult.previousHolder.name}!`
          );
          notifications.create(
            crownResult.previousHolder.id,
            'crown_lost',
            gameId,
            `${winnerUser.name} has taken your ${normalizedGameType} crown!`
          );
        } else {
          // First ever crown holder
          notifications.create(
            winner.userId,
            'crown_won',
            gameId,
            `You are the first to claim the ${normalizedGameType} crown!`
          );
        }
      }
    }

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

  // Get deletion approvals if there's a pending deletion request
  let deletionApprovals = [];
  if (game.deletion_requested_by) {
    deletionApprovals = gameDeletions.findApprovals(game.id);
  }

  // Get comments for this game
  const comments = gameComments.findByGameId(game.id);

  // Get photos for this game
  const photos = gamePhotos.findByGameId(game.id);
  const photoCount = photos.length;
  const maxPhotos = 10;

  res.render('games/show', {
    title: `Game - ${game.game_type}`,
    game,
    deletionApprovals,
    comments,
    photos,
    photoCount,
    maxPhotos,
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

// Delete game (multi-approval flow for participants)
router.post('/:id/delete', (req, res) => {
  const game = games.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  // Check if user is a participant or admin
  const isParticipant = game.players.some(p => p.user_id === req.user.id);
  if (!isParticipant && !req.user.is_admin) {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'Only participants can request game deletion',
    });
  }

  // Admins can always delete immediately
  if (req.user.is_admin) {
    // Notify participants about deletion
    for (const player of game.players) {
      if (player.user_id !== req.user.id) {
        notifications.create(
          player.user_id,
          'game_deleted',
          null,
          `${req.user.name} (admin) deleted the ${game.game_type} game from ${new Date(game.played_at).toLocaleDateString()}.`
        );
      }
    }
    games.delete(req.params.id);
    return res.redirect('/');
  }

  // Count confirmations
  const confirmedCount = game.players.filter(p => p.confirmed_at).length;

  // If only 1 confirmation, single participant can delete
  if (confirmedCount <= 1) {
    // Notify participants about deletion
    for (const player of game.players) {
      if (player.user_id !== req.user.id) {
        notifications.create(
          player.user_id,
          'game_deleted',
          null,
          `${req.user.name} deleted the ${game.game_type} game from ${new Date(game.played_at).toLocaleDateString()}.`
        );
      }
    }
    games.delete(req.params.id);
    return res.redirect('/');
  }

  // Multi-confirmed game: request deletion and add first approval
  gameDeletions.requestDeletion(game.id, req.user.id);
  gameDeletions.addApproval(game.id, req.user.id);

  // Notify other participants about deletion request
  for (const player of game.players) {
    if (player.user_id !== req.user.id) {
      notifications.create(
        player.user_id,
        'deletion_requested',
        game.id,
        `${req.user.name} has requested to delete the ${game.game_type} game from ${new Date(game.played_at).toLocaleDateString()}. Your approval is needed.`
      );
    }
  }

  res.redirect(`/games/${req.params.id}`);
});

// Approve pending deletion
router.post('/:id/approve-deletion', (req, res) => {
  const game = games.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  if (!game.deletion_requested_by) {
    return res.status(400).render('error', {
      title: 'Error',
      message: 'No deletion request pending for this game',
    });
  }

  // Check if user is a participant
  const isParticipant = game.players.some(p => p.user_id === req.user.id);
  if (!isParticipant) {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'Only participants can approve game deletion',
    });
  }

  // Add approval
  gameDeletions.addApproval(game.id, req.user.id);

  // Check if we have 2 approvals
  const approvalCount = gameDeletions.countApprovals(game.id);
  if (approvalCount >= 2) {
    // Notify participants about deletion
    for (const player of game.players) {
      notifications.create(
        player.user_id,
        'game_deleted',
        null,
        `The ${game.game_type} game from ${new Date(game.played_at).toLocaleDateString()} has been deleted with multiple approvals.`
      );
    }
    games.delete(req.params.id);
    return res.redirect('/');
  }

  res.redirect(`/games/${req.params.id}`);
});

// Cancel deletion request (only requester can cancel)
router.post('/:id/cancel-deletion', (req, res) => {
  const game = games.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  if (!game.deletion_requested_by) {
    return res.status(400).render('error', {
      title: 'Error',
      message: 'No deletion request pending for this game',
    });
  }

  // Only the requester can cancel
  if (game.deletion_requested_by !== req.user.id) {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'Only the requester can cancel the deletion request',
    });
  }

  gameDeletions.cancelDeletion(game.id);
  res.redirect(`/games/${req.params.id}`);
});

// Add comment to game
router.post('/:id/comments', (req, res) => {
  const game = games.findById(req.params.id);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  const { content } = req.body;

  // Validate content
  if (!content || content.trim().length === 0) {
    return res.redirect(`/games/${req.params.id}`);
  }

  // Limit to 500 characters
  const trimmedContent = content.trim().slice(0, 500);

  // Create the comment
  gameComments.create(game.id, req.user.id, trimmedContent);

  // Notify other game participants
  for (const player of game.players) {
    if (player.user_id !== req.user.id) {
      notifications.create(
        player.user_id,
        'game_comment',
        game.id,
        `${req.user.name} commented on the ${game.game_type} game from ${new Date(game.played_at).toLocaleDateString()}.`
      );
    }
  }

  // Send push notifications (async, don't await)
  notifyGameComment(game, req.user).catch(err => {
    console.error('Push notification error:', err);
  });

  res.redirect(`/games/${req.params.id}`);
});

// Delete comment
router.post('/:gameId/comments/:commentId/delete', (req, res) => {
  const game = games.findById(req.params.gameId);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  const comment = gameComments.findById(req.params.commentId);

  if (!comment) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Comment not found',
    });
  }

  // Only comment author or admin can delete
  if (comment.user_id !== req.user.id && !req.user.is_admin) {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'You can only delete your own comments',
    });
  }

  gameComments.delete(comment.id);

  res.redirect(`/games/${req.params.gameId}`);
});

// Upload photo to game
router.post('/:id/photos', upload.single('photo'), (req, res) => {
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
    // Delete uploaded file if exists
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'Only game participants can upload photos',
    });
  }

  // Check photo limit
  const photoCount = gamePhotos.countByGameId(game.id);
  if (photoCount >= 10) {
    // Delete uploaded file if exists
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    return res.status(400).render('error', {
      title: 'Limit Reached',
      message: 'Maximum of 10 photos per game',
    });
  }

  // Check if file was uploaded
  if (!req.file) {
    return res.redirect(`/games/${req.params.id}`);
  }

  // Get caption from form
  const caption = req.body.caption ? req.body.caption.trim().slice(0, 200) : null;

  // Create photo record
  gamePhotos.create(game.id, req.user.id, req.file.filename, caption);

  res.redirect(`/games/${req.params.id}`);
});

// Delete photo
router.post('/:gameId/photos/:photoId/delete', (req, res) => {
  const game = games.findById(req.params.gameId);

  if (!game) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Game not found',
    });
  }

  const photo = gamePhotos.findById(req.params.photoId);

  if (!photo) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Photo not found',
    });
  }

  // Only photo uploader or admin can delete
  if (photo.user_id !== req.user.id && !req.user.is_admin) {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'You can only delete your own photos',
    });
  }

  // Delete file from disk
  const filePath = path.join(uploadDir, photo.filename);
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('Failed to delete photo file:', err);
    }
  });

  // Delete database record
  gamePhotos.delete(photo.id);

  res.redirect(`/games/${req.params.gameId}`);
});

module.exports = router;
