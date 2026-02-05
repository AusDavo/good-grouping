/**
 * WebSocket Server for Live Dart Scoring
 * Handles real-time game updates with room-based connections
 */

const WebSocket = require('ws');
const { liveGames, liveGameSeries } = require('./db');
const {
  processThrow,
  checkGameComplete,
  advanceTurn,
  reverseTurn,
  calculateRawValue,
  handleBust,
} = require('./game-logic');

// Store for game rooms and their connections
const gameRooms = new Map(); // gameId -> Set of { ws, userId, userName }

// Store session lookup function (set during init)
let getSessionUser = null;

/**
 * Initialize WebSocket server
 * @param {http.Server} server - HTTP server instance
 * @param {Function} sessionParser - Express session middleware
 */
function initWebSocket(server, sessionParser) {
  const wss = new WebSocket.Server({
    server,
    path: '/ws',
  });

  // Session parser for authentication
  getSessionUser = (req) => {
    return new Promise((resolve) => {
      sessionParser(req, {}, () => {
        resolve(req.session?.userId ? req.session : null);
      });
    });
  };

  wss.on('connection', async (ws, req) => {
    // Authenticate via session
    const session = await getSessionUser(req);
    if (!session || !session.userId) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    ws.userId = session.userId;
    ws.userName = session.userName || 'Unknown';
    ws.isAlive = true;
    ws.gameId = null;

    // Heartbeat
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        handleMessage(ws, message);
      } catch (e) {
        console.error('WebSocket message error:', e);
        sendError(ws, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      leaveGame(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      leaveGame(ws);
    });
  });

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        leaveGame(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  console.log('WebSocket server initialized on /ws');
  return wss;
}

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(ws, message) {
  const { type, payload } = message;

  switch (type) {
    case 'join_game':
      handleJoinGame(ws, payload);
      break;
    case 'leave_game':
      handleLeaveGame(ws);
      break;
    case 'throw_dart':
      handleThrowDart(ws, payload);
      break;
    case 'undo_throw':
      handleUndoThrow(ws, payload);
      break;
    case 'start_game':
      handleStartGame(ws, payload);
      break;
    case 'end_game':
      handleEndGame(ws, payload);
      break;
    default:
      sendError(ws, `Unknown message type: ${type}`);
  }
}

/**
 * Join a game room
 */
function handleJoinGame(ws, payload) {
  const { gameId } = payload;
  if (!gameId) {
    return sendError(ws, 'Game ID required');
  }

  const game = liveGames.findById(gameId);
  if (!game) {
    return sendError(ws, 'Game not found');
  }

  // Leave any previous game
  leaveGame(ws);

  // Join new game room
  ws.gameId = gameId;
  if (!gameRooms.has(gameId)) {
    gameRooms.set(gameId, new Set());
  }
  gameRooms.get(gameId).add(ws);

  // Send current game state
  sendGameState(ws, game);

  // Notify others
  broadcastToRoom(gameId, {
    type: 'player_joined',
    payload: {
      userId: ws.userId,
      userName: ws.userName,
    },
  }, ws);
}

/**
 * Leave current game room
 */
function handleLeaveGame(ws) {
  leaveGame(ws);
}

function leaveGame(ws) {
  if (ws.gameId && gameRooms.has(ws.gameId)) {
    const room = gameRooms.get(ws.gameId);
    room.delete(ws);

    // Notify others
    broadcastToRoom(ws.gameId, {
      type: 'player_left',
      payload: {
        userId: ws.userId,
        userName: ws.userName,
      },
    });

    // Clean up empty rooms
    if (room.size === 0) {
      gameRooms.delete(ws.gameId);
    }

    ws.gameId = null;
  }
}

/**
 * Handle dart throw
 */
function handleThrowDart(ws, payload) {
  const { gameId, segment, multiplier } = payload;

  if (!gameId) {
    return sendError(ws, 'Game ID required');
  }

  const game = liveGames.findById(gameId);
  if (!game) {
    return sendError(ws, 'Game not found');
  }

  if (game.status !== 'playing') {
    return sendError(ws, 'Game is not in progress');
  }

  // Get current player
  const currentPlayer = game.players[game.current_player_index];
  if (!currentPlayer) {
    return sendError(ws, 'Invalid game state');
  }

  // Store score at turn start for bust handling (01 games)
  let turnStartScore = null;
  if ((game.game_type === '301' || game.game_type === '501') && game.current_dart === 1) {
    turnStartScore = currentPlayer.remaining_score;
  }

  // Process the throw
  const throwResult = processThrow(
    game,
    currentPlayer.id,
    segment || null,
    multiplier || 1
  );

  const rawValue = calculateRawValue(segment || null, multiplier || 1);

  // Handle bust for 01 games
  if (throwResult.isBust) {
    // Get score at start of this turn from throws
    const turnThrows = liveGames.getThrowsByPlayerAndTurn(gameId, currentPlayer.id, game.current_turn);
    if (turnThrows.length === 0 && turnStartScore !== null) {
      // First dart of turn, we have the score
    } else if (turnThrows.length > 0) {
      // Calculate what score was at turn start by reversing previous throws
      const startingScore = game.starting_score || 501;
      let score = startingScore;
      // Replay all throws except current turn to get turn start score
      for (const t of game.throws) {
        if (t.player_id === currentPlayer.id && t.turn_number < game.current_turn) {
          if (!t.is_bust) {
            score -= t.raw_value;
          }
        }
      }
      turnStartScore = score;
    }

    // Restore score (bust)
    if (turnStartScore !== null) {
      handleBust(game, currentPlayer.id, turnStartScore);
      liveGames.updateRemainingScore(currentPlayer.id, turnStartScore);
    }
  }

  // Record the throw
  const throwId = liveGames.addThrow(
    gameId,
    currentPlayer.id,
    game.current_turn,
    game.current_dart,
    segment || null,
    multiplier || 1,
    rawValue,
    throwResult.isBust || false,
    ws.userId
  );

  // Update player state in DB based on game type
  if (game.game_type === 'Cricket') {
    liveGames.updateCricketMarks(
      currentPlayer.id,
      currentPlayer.marks_15,
      currentPlayer.marks_16,
      currentPlayer.marks_17,
      currentPlayer.marks_18,
      currentPlayer.marks_19,
      currentPlayer.marks_20,
      currentPlayer.marks_bull,
      currentPlayer.cricket_points
    );
  } else if (game.game_type === '301' || game.game_type === '501') {
    if (!throwResult.isBust) {
      liveGames.updateRemainingScore(currentPlayer.id, currentPlayer.remaining_score);
    }
  } else if (game.game_type === 'Around the World') {
    liveGames.updateCurrentTarget(currentPlayer.id, currentPlayer.current_target);
  }

  // Check for game completion
  const winner = checkGameComplete(game);
  if (winner) {
    // Game over
    liveGames.finish(gameId, winner.winnerId);

    // Handle series win tracking
    let seriesStandings = null;
    let seriesDecided = false;
    let seriesWinnerName = null;
    if (game.series_id) {
      // Find the winner's user_id
      const winnerPlayer = game.players.find(p => p.id === winner.winnerId);
      if (winnerPlayer) {
        liveGameSeries.incrementWins(game.series_id, winnerPlayer.user_id);
      }

      // Reload series data to get updated standings
      const series = liveGameSeries.findById(game.series_id);
      if (series) {
        seriesStandings = series.players.map(p => ({
          name: p.name,
          wins: p.wins,
          user_id: p.user_id,
        }));
        const decidedWinner = liveGameSeries.checkSeriesDecided(series);
        if (decidedWinner) {
          seriesDecided = true;
          seriesWinnerName = decidedWinner.name;
          liveGameSeries.finish(game.series_id);
        }
      }
    }

    // Broadcast game ended
    broadcastToRoom(gameId, {
      type: 'game_ended',
      payload: {
        winnerId: winner.winnerId,
        winnerUserId: winner.winnerUserId,
        reason: winner.reason,
        seriesStandings,
        seriesDecided,
        seriesWinnerName,
      },
    });

    // Send final game state
    const finalGame = liveGames.findById(gameId);
    broadcastGameState(gameId, finalGame);
    return;
  }

  // Advance turn (unless bust on 01 games - still advances, score just doesn't change)
  const turnInfo = advanceTurn(game);
  liveGames.updateTurnState(gameId, turnInfo.current_player_index, turnInfo.current_dart, turnInfo.current_turn);

  // Broadcast throw recorded
  broadcastToRoom(gameId, {
    type: 'throw_recorded',
    payload: {
      throwId,
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      segment,
      multiplier,
      rawValue,
      isBust: throwResult.isBust || false,
      enteredBy: ws.userName,
      ...throwResult,
    },
  });

  // Send updated game state to all
  const updatedGame = liveGames.findById(gameId);
  broadcastGameState(gameId, updatedGame);
}

/**
 * Handle undo last throw
 */
function handleUndoThrow(ws, payload) {
  const { gameId } = payload;

  if (!gameId) {
    return sendError(ws, 'Game ID required');
  }

  const game = liveGames.findById(gameId);
  if (!game) {
    return sendError(ws, 'Game not found');
  }

  if (game.status !== 'playing') {
    return sendError(ws, 'Game is not in progress');
  }

  // Get last throw
  const lastThrow = liveGames.getLastThrow(gameId);
  if (!lastThrow) {
    return sendError(ws, 'No throws to undo');
  }

  // Get the player who made the throw
  const player = liveGames.getPlayer(lastThrow.player_id);
  if (!player) {
    return sendError(ws, 'Player not found');
  }

  // Reverse the turn state first
  reverseTurn(game);

  // Reverse the throw effect based on game type
  if (game.game_type === 'Cricket') {
    // Recalculate marks from remaining throws
    const allThrows = game.throws.filter(t => t.id !== lastThrow.id && t.player_id === player.id);
    let marks = { 15: 0, 16: 0, 17: 0, 18: 0, 19: 0, 20: 0, bull: 0 };
    let points = 0;

    // This is a simplified recalculation - for full accuracy we'd need to replay all throws
    // For now, just reverse the last throw's contribution
    if (lastThrow.segment) {
      const markField = lastThrow.segment === 25 ? 'bull' : lastThrow.segment;
      const currentMarks = player[`marks_${markField}`] || player.marks_bull || 0;
      const newMarks = Math.max(0, currentMarks - lastThrow.multiplier);

      if (lastThrow.segment === 25) {
        player.marks_bull = newMarks;
      } else {
        player[`marks_${lastThrow.segment}`] = newMarks;
      }

      // Reverse points if applicable (simplified - may need improvement for edge cases)
      const marksBeforeThrow = currentMarks - lastThrow.multiplier;
      if (marksBeforeThrow >= 3) {
        points = lastThrow.multiplier * lastThrow.segment;
      } else if (currentMarks > 3) {
        points = (currentMarks - 3) * lastThrow.segment;
      }
      player.cricket_points = Math.max(0, (player.cricket_points || 0) - points);
    }

    liveGames.updateCricketMarks(
      player.id,
      player.marks_15,
      player.marks_16,
      player.marks_17,
      player.marks_18,
      player.marks_19,
      player.marks_20,
      player.marks_bull,
      player.cricket_points
    );
  } else if (game.game_type === '301' || game.game_type === '501') {
    // Add back the score if it wasn't a bust
    if (!lastThrow.is_bust) {
      player.remaining_score = (player.remaining_score || 0) + lastThrow.raw_value;
      liveGames.updateRemainingScore(player.id, player.remaining_score);
    }
  } else if (game.game_type === 'Around the World') {
    // Check if the throw was a hit and reverse target
    // The segment for a hit would have matched the previous target
    const previousTarget = player.current_target - 1;
    const expectedSegment = previousTarget === 21 ? 25 : previousTarget;
    if (lastThrow.segment === expectedSegment && previousTarget >= 1) {
      player.current_target = previousTarget;
      liveGames.updateCurrentTarget(player.id, player.current_target);
    }
  }

  // Delete the throw
  liveGames.deleteThrow(lastThrow.id);

  // Update turn state in DB
  liveGames.updateTurnState(gameId, game.current_player_index, game.current_dart, game.current_turn);

  // Broadcast undo
  broadcastToRoom(gameId, {
    type: 'throw_undone',
    payload: {
      throwId: lastThrow.id,
      playerId: player.id,
      undoneBy: ws.userName,
    },
  });

  // Send updated game state
  const updatedGame = liveGames.findById(gameId);
  broadcastGameState(gameId, updatedGame);
}

/**
 * Handle starting a game from WebSocket
 */
function handleStartGame(ws, payload) {
  const { gameId } = payload;

  if (!gameId) {
    return sendError(ws, 'Game ID required');
  }

  const game = liveGames.findById(gameId);
  if (!game) {
    return sendError(ws, 'Game not found');
  }

  // Only creator can start
  if (game.created_by !== ws.userId) {
    return sendError(ws, 'Only the game creator can start the game');
  }

  if (game.status !== 'waiting') {
    return sendError(ws, 'Game already started');
  }

  liveGames.start(gameId);

  // Broadcast game started
  broadcastToRoom(gameId, {
    type: 'game_started',
    payload: { gameId },
  });

  // Send game state
  const updatedGame = liveGames.findById(gameId);
  broadcastGameState(gameId, updatedGame);
}

/**
 * Handle ending/abandoning a game
 */
function handleEndGame(ws, payload) {
  const { gameId } = payload;

  if (!gameId) {
    return sendError(ws, 'Game ID required');
  }

  const game = liveGames.findById(gameId);
  if (!game) {
    return sendError(ws, 'Game not found');
  }

  // Only creator can end
  if (game.created_by !== ws.userId) {
    return sendError(ws, 'Only the game creator can end the game');
  }

  // Mark as abandoned (could also delete)
  liveGames.delete(gameId);

  // Broadcast game ended
  broadcastToRoom(gameId, {
    type: 'game_abandoned',
    payload: {
      gameId,
      abandonedBy: ws.userName,
    },
  });
}

/**
 * Send game state to a single client
 */
function sendGameState(ws, game) {
  ws.send(JSON.stringify({
    type: 'game_state',
    payload: formatGameState(game),
  }));
}

/**
 * Broadcast game state to all clients in a room
 */
function broadcastGameState(gameId, game) {
  broadcastToRoom(gameId, {
    type: 'game_state',
    payload: formatGameState(game),
  });
}

/**
 * Format game state for sending to clients
 */
function formatGameState(game) {
  return {
    id: game.id,
    game_type: game.game_type,
    status: game.status,
    starting_score: game.starting_score,
    current_player_index: game.current_player_index,
    current_dart: game.current_dart,
    current_turn: game.current_turn,
    created_by: game.created_by,
    winner_player_id: game.winner_player_id,
    series_id: game.series_id || null,
    players: game.players.map(p => ({
      id: p.id,
      user_id: p.user_id,
      name: p.name,
      avatar_url: p.avatar_url,
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
    throws: game.throws || [],
  };
}

/**
 * Broadcast message to all clients in a room
 */
function broadcastToRoom(gameId, message, excludeWs = null) {
  const room = gameRooms.get(gameId);
  if (!room) return;

  const data = JSON.stringify(message);
  room.forEach((client) => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

/**
 * Send error message to client
 */
function sendError(ws, message) {
  ws.send(JSON.stringify({
    type: 'error',
    payload: { message },
  }));
}

module.exports = {
  initWebSocket,
  gameRooms,
};
