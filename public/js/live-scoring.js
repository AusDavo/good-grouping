/**
 * Live Scoring Client
 * WebSocket-based real-time dart scoring
 */

(function() {
  'use strict';

  const container = document.getElementById('live-game-container');
  if (!container) return;

  const gameId = container.dataset.gameId;
  const gameType = container.dataset.gameType;
  const customWsUrl = container.dataset.wsUrl;

  let ws = null;
  let reconnectAttempts = 0;
  let maxReconnectAttempts = 10;
  let reconnectDelay = 1000;
  let selectedMultiplier = 1;
  let gameState = null;

  // DOM Elements
  const connectionStatus = document.getElementById('connection-status');
  const connectionStatusText = document.getElementById('connection-status-text');
  const currentPlayerName = document.getElementById('current-player-name');
  const recentThrows = document.getElementById('recent-throws');
  const undoBtn = document.getElementById('undo-btn');

  // Initialize
  connect();
  setupEventListeners();

  /**
   * Connect to WebSocket server
   */
  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = customWsUrl || `${protocol}//${window.location.host}/ws`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        updateConnectionStatus('connected');
        reconnectAttempts = 0;

        // Join the game room
        send('join_game', { gameId });
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        updateConnectionStatus('disconnected');

        // Attempt reconnect
        if (reconnectAttempts < maxReconnectAttempts) {
          setTimeout(() => {
            reconnectAttempts++;
            connect();
          }, reconnectDelay * Math.min(reconnectAttempts + 1, 5));
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus('error');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      updateConnectionStatus('error');
    }
  }

  /**
   * Send message to server
   */
  function send(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }

  /**
   * Handle incoming messages
   */
  function handleMessage(message) {
    const { type, payload } = message;

    switch (type) {
      case 'game_state':
        handleGameState(payload);
        break;
      case 'throw_recorded':
        handleThrowRecorded(payload);
        break;
      case 'throw_undone':
        handleThrowUndone(payload);
        break;
      case 'game_started':
        window.location.reload();
        break;
      case 'game_ended':
        handleGameEnded(payload);
        break;
      case 'game_abandoned':
        alert('Game was abandoned');
        window.location.href = '/live-games';
        break;
      case 'player_joined':
        console.log('Player joined:', payload.userName);
        break;
      case 'player_left':
        console.log('Player left:', payload.userName);
        break;
      case 'error':
        console.error('Server error:', payload.message);
        showToast(payload.message, 'error');
        break;
    }
  }

  /**
   * Handle game state update
   */
  function handleGameState(state) {
    gameState = state;
    renderGameState();
  }

  /**
   * Render current game state
   */
  function renderGameState() {
    if (!gameState) return;

    // Update current player
    const currentPlayer = gameState.players[gameState.current_player_index];
    if (currentPlayer && currentPlayerName) {
      currentPlayerName.textContent = currentPlayer.name;
    }

    // Update dart indicators
    updateDartIndicators(gameState.current_dart);

    // Update scoreboard based on game type
    switch (gameType) {
      case 'Cricket':
        renderCricketScores();
        break;
      case '301':
      case '501':
        render01Scores();
        break;
      case 'Around the World':
        renderAtwScores();
        break;
    }

    // Update recent throws
    renderRecentThrows();

    // Highlight active player
    highlightActivePlayer();
  }

  /**
   * Update dart indicators
   */
  function updateDartIndicators(currentDart) {
    document.querySelectorAll('.dart-indicator').forEach((el, idx) => {
      const dartNum = idx + 1;
      el.classList.remove('thrown', 'current');
      if (dartNum < currentDart) {
        el.classList.add('thrown');
      } else if (dartNum === currentDart) {
        el.classList.add('current');
      }
    });
  }

  /**
   * Render Cricket scores
   */
  function renderCricketScores() {
    const tbody = document.getElementById('cricket-scores');
    if (!tbody) return;

    gameState.players.forEach((player, idx) => {
      const row = tbody.querySelector(`[data-player-id="${player.id}"]`);
      if (!row) return;

      row.querySelector('.marks-15').innerHTML = renderMarks(player.marks_15);
      row.querySelector('.marks-16').innerHTML = renderMarks(player.marks_16);
      row.querySelector('.marks-17').innerHTML = renderMarks(player.marks_17);
      row.querySelector('.marks-18').innerHTML = renderMarks(player.marks_18);
      row.querySelector('.marks-19').innerHTML = renderMarks(player.marks_19);
      row.querySelector('.marks-20').innerHTML = renderMarks(player.marks_20);
      row.querySelector('.marks-bull').innerHTML = renderMarks(player.marks_bull);
      row.querySelector('.cricket-points').textContent = player.cricket_points || 0;
    });

    // Update header strikethrough for closed numbers
    updateClosedNumbers();
  }

  /**
   * Check if a number is closed (all players have 3+ marks) and update header styling
   */
  function updateClosedNumbers() {
    const segments = ['15', '16', '17', '18', '19', '20', 'bull'];
    const markFields = {
      '15': 'marks_15',
      '16': 'marks_16',
      '17': 'marks_17',
      '18': 'marks_18',
      '19': 'marks_19',
      '20': 'marks_20',
      'bull': 'marks_bull'
    };

    segments.forEach(segment => {
      const header = document.querySelector(`.cricket-header[data-segment="${segment}"]`);
      if (!header) return;

      const allClosed = gameState.players.every(player => {
        const marks = player[markFields[segment]] || 0;
        return marks >= 3;
      });

      if (allClosed) {
        header.classList.add('closed');
      } else {
        header.classList.remove('closed');
      }
    });
  }

  /**
   * Render marks for Cricket
   */
  function renderMarks(count) {
    count = count || 0;
    if (count === 0) return '<span class="text-gray-600">---</span>';
    if (count === 1) return '<span class="text-yellow-500">/</span><span class="text-gray-600">--</span>';
    if (count === 2) return '<span class="text-yellow-500">//</span><span class="text-gray-600">-</span>';
    if (count >= 3) return '<span class="text-green-500">X</span>' + (count > 3 ? '<span class="text-pink-400">+' + (count - 3) + '</span>' : '');
    return '';
  }

  /**
   * Render 01 scores
   */
  function render01Scores() {
    const container = document.getElementById('score-01-container');
    if (!container) return;

    gameState.players.forEach((player) => {
      const card = container.querySelector(`[data-player-id="${player.id}"]`);
      if (!card) return;

      const scoreEl = card.querySelector('.remaining-score');
      if (scoreEl) {
        scoreEl.textContent = player.remaining_score;
      }
    });
  }

  /**
   * Render Around the World scores
   */
  function renderAtwScores() {
    const container = document.getElementById('atw-container');
    if (!container) return;

    gameState.players.forEach((player) => {
      const card = container.querySelector(`[data-player-id="${player.id}"]`);
      if (!card) return;

      // Update target display
      const targetEl = card.querySelector('.current-target');
      if (targetEl) {
        targetEl.textContent = 'Target: ' + (player.current_target > 20 ? 'Bull' : player.current_target);
      }

      // Update progress indicators
      card.querySelectorAll('[data-target]').forEach((el) => {
        const target = parseInt(el.dataset.target);
        el.className = 'w-6 h-6 rounded text-xs flex items-center justify-center ';
        if (target < player.current_target) {
          el.className += 'bg-green-700 text-green-200';
        } else if (target === player.current_target) {
          el.className += 'bg-yellow-400 text-black';
        } else {
          el.className += 'bg-gray-700 text-gray-400';
        }
      });
    });
  }

  /**
   * Render recent throws
   */
  function renderRecentThrows() {
    if (!recentThrows || !gameState.throws) return;

    const recent = gameState.throws.slice(-10);
    if (recent.length === 0) {
      recentThrows.innerHTML = '<span class="text-gray-500 text-sm">No throws yet</span>';
      return;
    }

    recentThrows.innerHTML = recent.map(t => {
      const classes = t.is_bust ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-200';
      let text = 'Miss';
      if (t.segment) {
        const prefix = t.multiplier === 3 ? 'T' : t.multiplier === 2 ? 'D' : '';
        text = prefix + (t.segment === 25 ? 'Bull' : t.segment);
      }
      if (t.is_bust) text += ' (Bust)';
      return `<span class="px-2 py-1 rounded text-xs ${classes}">${text}</span>`;
    }).join('');
  }

  /**
   * Highlight active player
   */
  function highlightActivePlayer() {
    // Remove active class from all
    document.querySelectorAll('.player-row, .player-score-card, .player-atw-card').forEach(el => {
      el.classList.remove('active');
    });

    // Add active class to current player
    const activeEl = document.querySelector(`[data-player-index="${gameState.current_player_index}"]`);
    if (activeEl) {
      activeEl.classList.add('active');
    }
  }

  /**
   * Handle throw recorded
   */
  function handleThrowRecorded(payload) {
    console.log('Throw recorded:', payload);
    // State will be updated via game_state message
  }

  /**
   * Handle throw undone
   */
  function handleThrowUndone(payload) {
    console.log('Throw undone:', payload);
    showToast('Throw undone by ' + payload.undoneBy, 'info');
  }

  /**
   * Handle game ended
   */
  function handleGameEnded(payload) {
    console.log('Game ended:', payload);
    // Redirect to summary page
    setTimeout(() => {
      window.location.href = `/live-games/${gameId}`;
    }, 1500);
  }

  /**
   * Setup event listeners
   */
  function setupEventListeners() {
    // Multiplier buttons
    document.querySelectorAll('.multiplier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.multiplier-btn').forEach(b => b.dataset.active = 'false');
        btn.dataset.active = 'true';
        selectedMultiplier = parseInt(btn.dataset.multiplier);
      });
    });

    // Segment buttons (Cricket and 01)
    document.querySelectorAll('.segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const segment = parseInt(btn.dataset.segment);
        const forceMultiplier = btn.dataset.forceMultiplier ? parseInt(btn.dataset.forceMultiplier) : null;
        const multiplier = forceMultiplier || selectedMultiplier;

        sendThrow(segment || null, segment ? multiplier : 1);

        // Reset multiplier to single after throw
        if (!forceMultiplier) {
          document.querySelectorAll('.multiplier-btn').forEach(b => b.dataset.active = 'false');
          document.querySelector('.multiplier-btn[data-multiplier="1"]').dataset.active = 'true';
          selectedMultiplier = 1;
        }
      });
    });

    // Around the World buttons
    const hitBtn = document.getElementById('hit-btn');
    const missBtn = document.getElementById('miss-btn');

    if (hitBtn) {
      hitBtn.addEventListener('click', () => {
        if (!gameState) return;
        const currentPlayer = gameState.players[gameState.current_player_index];
        const target = currentPlayer.current_target;
        const segment = target > 20 ? 25 : target;
        sendThrow(segment, 1);
      });
    }

    if (missBtn) {
      missBtn.addEventListener('click', () => {
        sendThrow(null, 1);
      });
    }

    // Undo button
    if (undoBtn) {
      undoBtn.addEventListener('click', () => {
        send('undo_throw', { gameId });
      });
    }
  }

  /**
   * Send throw to server
   */
  function sendThrow(segment, multiplier) {
    send('throw_dart', {
      gameId,
      segment,
      multiplier
    });
  }

  /**
   * Update connection status UI
   */
  function updateConnectionStatus(status) {
    if (!connectionStatus) return;

    connectionStatus.className = 'w-2 h-2 rounded-full ';
    switch (status) {
      case 'connected':
        connectionStatus.className += 'bg-green-500';
        if (connectionStatusText) connectionStatusText.textContent = 'Connected';
        break;
      case 'disconnected':
        connectionStatus.className += 'bg-yellow-500';
        if (connectionStatusText) connectionStatusText.textContent = 'Reconnecting...';
        break;
      case 'error':
        connectionStatus.className += 'bg-red-500';
        if (connectionStatusText) connectionStatusText.textContent = 'Connection error';
        break;
      default:
        connectionStatus.className += 'bg-gray-500';
        if (connectionStatusText) connectionStatusText.textContent = 'Unknown';
    }
  }

  /**
   * Show toast notification
   */
  function showToast(message, type = 'info') {
    // Simple toast implementation
    const toast = document.createElement('div');
    toast.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg text-white z-50 ${
      type === 'error' ? 'bg-red-600' : 'bg-blue-600'
    }`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

})();
