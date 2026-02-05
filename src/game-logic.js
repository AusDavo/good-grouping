/**
 * Game Logic Engine for Live Dart Scoring
 * Handles scoring calculations for Cricket, 301/501, and Around the World
 */

const CRICKET_NUMBERS = [15, 16, 17, 18, 19, 20, 25]; // 25 = bull

/**
 * Process a Cricket throw
 * @param {Object} gameState - Current game state with players
 * @param {string} playerId - The live_game_player ID
 * @param {number} segment - The number hit (15-20, 25 for bull, null for miss)
 * @param {number} multiplier - 1, 2, or 3 (double/triple)
 * @returns {Object} Result with updated player state and points scored
 */
function processCricketThrow(gameState, playerId, segment, multiplier) {
  const player = gameState.players.find(p => p.id === playerId);
  if (!player) throw new Error('Player not found');

  const result = {
    playerId,
    segment,
    multiplier,
    marksAdded: 0,
    pointsScored: 0,
    closedNumber: false,
  };

  // Miss or non-cricket number
  if (!segment || !CRICKET_NUMBERS.includes(segment)) {
    return result;
  }

  const markField = segment === 25 ? 'marks_bull' : `marks_${segment}`;
  const currentMarks = player[markField] || 0;
  const marksToAdd = multiplier;

  // Check if this number is closed by all other players
  const otherPlayers = gameState.players.filter(p => p.id !== playerId);
  const isClosedByOthers = otherPlayers.every(p => {
    const pMarks = segment === 25 ? p.marks_bull : p[`marks_${segment}`];
    return pMarks >= 3;
  });

  // Calculate new marks (max tracking needed is 3 for display, but can go higher for scoring)
  const newMarks = currentMarks + marksToAdd;

  // Calculate points scored (only if player has 3+ marks and number not closed by all others)
  if (currentMarks >= 3 && !isClosedByOthers) {
    // All marks score points
    result.pointsScored = marksToAdd * segment;
  } else if (currentMarks < 3 && newMarks > 3 && !isClosedByOthers) {
    // Some marks close, some score
    const marksThatScore = newMarks - 3;
    result.pointsScored = marksThatScore * segment;
  }

  result.marksAdded = marksToAdd;
  result.newMarks = newMarks;
  result.closedNumber = newMarks >= 3 && currentMarks < 3;

  // Update player state
  if (segment === 25) {
    player.marks_bull = newMarks;
  } else {
    player[`marks_${segment}`] = newMarks;
  }
  player.cricket_points = (player.cricket_points || 0) + result.pointsScored;

  return result;
}

/**
 * Check if Cricket game is complete
 * @param {Object} gameState - Current game state
 * @returns {Object|null} Winner info or null if game continues
 */
function checkCricketComplete(gameState) {
  // Check if ALL players have closed all numbers
  const allPlayersClosed = gameState.players.every(player =>
    CRICKET_NUMBERS.every(num => {
      const marks = num === 25 ? player.marks_bull : player[`marks_${num}`];
      return marks >= 3;
    })
  );

  if (allPlayersClosed) {
    // Everyone closed - highest points wins (or draw/first player if tied)
    const sorted = [...gameState.players].sort((a, b) =>
      (b.cricket_points || 0) - (a.cricket_points || 0)
    );
    return {
      winnerId: sorted[0].id,
      winnerUserId: sorted[0].user_id,
      reason: 'all_closed'
    };
  }

  // Check if any single player closed all AND has strictly more points
  for (const player of gameState.players) {
    const allClosed = CRICKET_NUMBERS.every(num => {
      const marks = num === 25 ? player.marks_bull : player[`marks_${num}`];
      return marks >= 3;
    });

    if (!allClosed) continue;

    const playerPoints = player.cricket_points || 0;
    const otherPlayers = gameState.players.filter(p => p.id !== player.id);
    const hasStrictLead = otherPlayers.every(p =>
      playerPoints > (p.cricket_points || 0)
    );

    if (hasStrictLead) {
      return {
        winnerId: player.id,
        winnerUserId: player.user_id,
        reason: 'closed_all_with_lead'
      };
    }
  }

  return null;
}

/**
 * Process a 301/501 throw
 * @param {Object} gameState - Current game state
 * @param {string} playerId - The live_game_player ID
 * @param {number} segment - Number hit (1-20, 25 for outer bull, null for miss)
 * @param {number} multiplier - 1, 2, or 3
 * @returns {Object} Result with score deducted and bust status
 */
function process01Throw(gameState, playerId, segment, multiplier) {
  const player = gameState.players.find(p => p.id === playerId);
  if (!player) throw new Error('Player not found');

  const result = {
    playerId,
    segment,
    multiplier,
    rawValue: 0,
    isBust: false,
    newScore: player.remaining_score,
  };

  // Miss
  if (!segment) {
    return result;
  }

  // Calculate raw value
  const rawValue = segment * multiplier;
  result.rawValue = rawValue;

  const newScore = player.remaining_score - rawValue;

  // Bust conditions:
  // 1. Score goes below 0
  // 2. Score goes to exactly 1 (can't finish - need double)
  // 3. Score goes to 0 but not with a double (standard rules require double-out)
  if (newScore < 0 || newScore === 1 || (newScore === 0 && multiplier !== 2)) {
    result.isBust = true;
    // Score stays the same on bust (handled at turn level)
    return result;
  }

  result.newScore = newScore;
  player.remaining_score = newScore;

  return result;
}

/**
 * Check if 01 game is complete
 * @param {Object} gameState - Current game state
 * @returns {Object|null} Winner info or null if game continues
 */
function check01Complete(gameState) {
  for (const player of gameState.players) {
    if (player.remaining_score === 0) {
      return {
        winnerId: player.id,
        winnerUserId: player.user_id,
        reason: 'checked_out'
      };
    }
  }
  return null;
}

/**
 * Process an Around the World throw
 * @param {Object} gameState - Current game state
 * @param {string} playerId - The live_game_player ID
 * @param {number} segment - Number hit (1-20, 25 for bull, null for miss)
 * @param {number} multiplier - Not used for ATW, but included for consistency
 * @returns {Object} Result with target progression
 */
function processAroundTheWorldThrow(gameState, playerId, segment, multiplier) {
  const player = gameState.players.find(p => p.id === playerId);
  if (!player) throw new Error('Player not found');

  const result = {
    playerId,
    segment,
    multiplier,
    hit: false,
    newTarget: player.current_target,
  };

  // Current target: 1-20 then 21 = bull (25)
  const targetSegment = player.current_target === 21 ? 25 : player.current_target;

  // Check if hit the target
  if (segment === targetSegment) {
    result.hit = true;
    result.newTarget = player.current_target + 1;
    player.current_target = result.newTarget;
  }

  return result;
}

/**
 * Check if Around the World game is complete
 * @param {Object} gameState - Current game state
 * @returns {Object|null} Winner info or null if game continues
 */
function checkAroundTheWorldComplete(gameState) {
  for (const player of gameState.players) {
    // Target 22 means they've hit bull (21) and completed
    if (player.current_target > 21) {
      return {
        winnerId: player.id,
        winnerUserId: player.user_id,
        reason: 'completed_sequence'
      };
    }
  }
  return null;
}

/**
 * Advance turn state after a throw
 * @param {Object} gameState - Current game state
 * @returns {Object} Updated turn info
 */
function advanceTurn(gameState) {
  if (gameState.current_dart < 3) {
    gameState.current_dart++;
  } else {
    gameState.current_dart = 1;
    gameState.current_player_index =
      (gameState.current_player_index + 1) % gameState.players.length;
    gameState.current_turn++;
  }

  return {
    current_dart: gameState.current_dart,
    current_player_index: gameState.current_player_index,
    current_turn: gameState.current_turn,
  };
}

/**
 * Reverse turn state (for undo)
 * @param {Object} gameState - Current game state
 * @returns {Object} Updated turn info
 */
function reverseTurn(gameState) {
  if (gameState.current_dart > 1) {
    gameState.current_dart--;
  } else {
    gameState.current_dart = 3;
    gameState.current_player_index =
      (gameState.current_player_index - 1 + gameState.players.length) % gameState.players.length;
    if (gameState.current_turn > 1) {
      gameState.current_turn--;
    }
  }

  return {
    current_dart: gameState.current_dart,
    current_player_index: gameState.current_player_index,
    current_turn: gameState.current_turn,
  };
}

/**
 * Process a throw based on game type
 * @param {Object} gameState - Current game state
 * @param {string} playerId - The live_game_player ID
 * @param {number} segment - Number hit
 * @param {number} multiplier - 1, 2, or 3
 * @returns {Object} Throw result
 */
function processThrow(gameState, playerId, segment, multiplier) {
  switch (gameState.game_type) {
    case 'Cricket':
      return processCricketThrow(gameState, playerId, segment, multiplier);
    case '301':
    case '501':
      return process01Throw(gameState, playerId, segment, multiplier);
    case 'Around the World':
      return processAroundTheWorldThrow(gameState, playerId, segment, multiplier);
    default:
      throw new Error(`Unknown game type: ${gameState.game_type}`);
  }
}

/**
 * Check if game is complete based on game type
 * @param {Object} gameState - Current game state
 * @returns {Object|null} Winner info or null
 */
function checkGameComplete(gameState) {
  switch (gameState.game_type) {
    case 'Cricket':
      return checkCricketComplete(gameState);
    case '301':
    case '501':
      return check01Complete(gameState);
    case 'Around the World':
      return checkAroundTheWorldComplete(gameState);
    default:
      return null;
  }
}

/**
 * Handle bust for 01 games - restore score to start of turn
 * @param {Object} gameState - Current game state
 * @param {string} playerId - Player who busted
 * @param {number} turnStartScore - Score at start of the turn
 */
function handleBust(gameState, playerId, turnStartScore) {
  const player = gameState.players.find(p => p.id === playerId);
  if (player) {
    player.remaining_score = turnStartScore;
  }
}

/**
 * Calculate the raw value of a throw
 * @param {number} segment - The segment hit (1-20, 25 for bull)
 * @param {number} multiplier - 1, 2, or 3
 * @returns {number} The point value
 */
function calculateRawValue(segment, multiplier) {
  if (!segment) return 0;
  return segment * multiplier;
}

/**
 * Get display name for a throw
 * @param {number} segment - The segment hit
 * @param {number} multiplier - 1, 2, or 3
 * @returns {string} Display string like "T20", "D16", "25", "Miss"
 */
function getThrowDisplayName(segment, multiplier) {
  if (!segment) return 'Miss';
  if (segment === 25) {
    return multiplier === 2 ? 'D-Bull' : 'Bull';
  }
  const prefix = multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : '';
  return `${prefix}${segment}`;
}

module.exports = {
  processCricketThrow,
  process01Throw,
  processAroundTheWorldThrow,
  processThrow,
  checkCricketComplete,
  check01Complete,
  checkAroundTheWorldComplete,
  checkGameComplete,
  advanceTurn,
  reverseTurn,
  handleBust,
  calculateRawValue,
  getThrowDisplayName,
  CRICKET_NUMBERS,
};
