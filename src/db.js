const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/darts.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema immediately
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      is_admin INTEGER DEFAULT 0,
      avatar_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER DEFAULT 0,
      transports TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      created_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_by TEXT,
      used_at TEXT,
      revoked INTEGER DEFAULT 0,
      FOREIGN KEY (used_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      played_at TEXT NOT NULL,
      game_type TEXT DEFAULT 'Cricket',
      created_by TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS game_players (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      score INTEGER,
      position INTEGER,
      is_winner INTEGER DEFAULT 0,
      confirmed_at TEXT,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      reference_id TEXT,
      message TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS crowns (
      id TEXT PRIMARY KEY,
      game_type TEXT UNIQUE NOT NULL,
      holder_user_id TEXT NOT NULL,
      acquired_at TEXT DEFAULT (datetime('now')),
      acquired_in_game_id TEXT,
      FOREIGN KEY (holder_user_id) REFERENCES users(id),
      FOREIGN KEY (acquired_in_game_id) REFERENCES games(id)
    );

    CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkeys(user_id);
    CREATE INDEX IF NOT EXISTS idx_passkeys_credential_id ON passkeys(credential_id);
    CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
    CREATE INDEX IF NOT EXISTS idx_games_played_at ON games(played_at);
    CREATE INDEX IF NOT EXISTS idx_game_players_game_id ON game_players(game_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_crowns_holder ON crowns(holder_user_id);
`);

// Migration: Add avatar_url column if it doesn't exist
try {
  db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add confirmed_at column to game_players if it doesn't exist
try {
  db.exec('ALTER TABLE game_players ADD COLUMN confirmed_at TEXT');
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add checkout_darts column to game_players if it doesn't exist
try {
  db.exec('ALTER TABLE game_players ADD COLUMN checkout_darts INTEGER');
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add deleted_at column to users for soft delete
try {
  db.exec('ALTER TABLE users ADD COLUMN deleted_at TEXT');
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add game deletion request columns
try {
  db.exec('ALTER TABLE games ADD COLUMN deletion_requested_by TEXT');
} catch (e) {
  // Column already exists, ignore
}
try {
  db.exec('ALTER TABLE games ADD COLUMN deletion_requested_at TEXT');
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add nostr_pubkey column to users for Nostr login
try {
  db.exec('ALTER TABLE users ADD COLUMN nostr_pubkey TEXT');
} catch (e) {
  // Column already exists, ignore
}
// Create unique index on nostr_pubkey (partial index for non-null values)
try {
  db.exec('CREATE UNIQUE INDEX idx_users_nostr_pubkey ON users(nostr_pubkey) WHERE nostr_pubkey IS NOT NULL');
} catch (e) {
  // Index already exists, ignore
}

// Migration: Add recovery_for_user_id column to invitations for recovery invitations
try {
  db.exec('ALTER TABLE invitations ADD COLUMN recovery_for_user_id TEXT');
} catch (e) {
  // Column already exists, ignore
}

// Create game_deletion_approvals table
db.exec(`
  CREATE TABLE IF NOT EXISTS game_deletion_approvals (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    approved_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(game_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_game_deletion_approvals_game ON game_deletion_approvals(game_id);
`);

// User queries
const userQueries = {
  create: db.prepare(`
    INSERT INTO users (id, name, is_admin)
    VALUES (?, ?, ?)
  `),

  findById: db.prepare('SELECT * FROM users WHERE id = ?'),
  findByName: db.prepare('SELECT * FROM users WHERE name = ?'),
  findByNostrPubkey: db.prepare('SELECT * FROM users WHERE nostr_pubkey = ?'),
  findAll: db.prepare('SELECT * FROM users ORDER BY name'),
  findAllActive: db.prepare('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY name'),
  countAll: db.prepare('SELECT COUNT(*) as count FROM users'),
  countAdmins: db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1 AND deleted_at IS NULL'),
  updateName: db.prepare('UPDATE users SET name = ? WHERE id = ?'),
  updateAvatar: db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?'),
  setAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE id = ?'),
  softDelete: db.prepare('UPDATE users SET deleted_at = datetime(\'now\') WHERE id = ?'),
  linkNostrPubkey: db.prepare('UPDATE users SET nostr_pubkey = ? WHERE id = ?'),
  unlinkNostrPubkey: db.prepare('UPDATE users SET nostr_pubkey = NULL WHERE id = ?'),
};

// Passkey queries
const passkeyQueries = {
  create: db.prepare(`
    INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  findByCredentialId: db.prepare('SELECT * FROM passkeys WHERE credential_id = ?'),
  findByUserId: db.prepare('SELECT * FROM passkeys WHERE user_id = ?'),
  findById: db.prepare('SELECT * FROM passkeys WHERE id = ?'),
  findAll: db.prepare('SELECT * FROM passkeys'),
  countByUserId: db.prepare('SELECT COUNT(*) as count FROM passkeys WHERE user_id = ?'),
  deleteById: db.prepare('DELETE FROM passkeys WHERE id = ?'),

  updateCounter: db.prepare('UPDATE passkeys SET counter = ? WHERE id = ?'),
};

// Invitation queries
const invitationQueries = {
  create: db.prepare(`
    INSERT INTO invitations (id, token, created_by, expires_at)
    VALUES (?, ?, ?, ?)
  `),

  createRecovery: db.prepare(`
    INSERT INTO invitations (id, token, created_by, expires_at, recovery_for_user_id)
    VALUES (?, ?, ?, ?, ?)
  `),

  findByToken: db.prepare('SELECT * FROM invitations WHERE token = ?'),
  findActive: db.prepare(`
    SELECT i.*, COALESCE(u.name, i.created_by) as created_by_name
    FROM invitations i
    LEFT JOIN users u ON i.created_by = u.id
    WHERE i.used_by IS NULL AND i.revoked = 0 AND i.expires_at > datetime('now')
      AND i.recovery_for_user_id IS NULL
    ORDER BY i.expires_at
  `),
  findActiveRecovery: db.prepare(`
    SELECT i.*, COALESCE(u.name, i.created_by) as created_by_name, target.name as recovery_for_name
    FROM invitations i
    LEFT JOIN users u ON i.created_by = u.id
    LEFT JOIN users target ON i.recovery_for_user_id = target.id
    WHERE i.used_by IS NULL AND i.revoked = 0 AND i.expires_at > datetime('now')
      AND i.recovery_for_user_id IS NOT NULL
    ORDER BY i.expires_at
  `),
  findExpired: db.prepare(`
    SELECT i.*, COALESCE(u.name, i.created_by) as created_by_name
    FROM invitations i
    LEFT JOIN users u ON i.created_by = u.id
    WHERE i.used_by IS NULL AND i.revoked = 0 AND i.expires_at <= datetime('now')
    ORDER BY i.expires_at DESC
    LIMIT 20
  `),
  findUsed: db.prepare(`
    SELECT i.*, COALESCE(creator.name, i.created_by) as created_by_name, used.name as used_by_name
    FROM invitations i
    LEFT JOIN users creator ON i.created_by = creator.id
    LEFT JOIN users used ON i.used_by = used.id
    WHERE i.used_by IS NOT NULL
    ORDER BY i.used_at DESC
    LIMIT 20
  `),
  findRecoveryByUserId: db.prepare(`
    SELECT * FROM invitations
    WHERE recovery_for_user_id = ? AND used_by IS NULL AND revoked = 0 AND expires_at > datetime('now')
  `),

  markUsed: db.prepare('UPDATE invitations SET used_by = ?, used_at = datetime(\'now\') WHERE id = ?'),
  revoke: db.prepare('UPDATE invitations SET revoked = 1 WHERE id = ?'),
};

// Game queries
const gameQueries = {
  create: db.prepare(`
    INSERT INTO games (id, played_at, game_type, created_by, notes)
    VALUES (?, ?, ?, ?, ?)
  `),

  findById: db.prepare(`
    SELECT g.*, u.name as created_by_name
    FROM games g
    JOIN users u ON g.created_by = u.id
    WHERE g.id = ?
  `),

  findRecent: db.prepare(`
    SELECT g.*, u.name as created_by_name
    FROM games g
    JOIN users u ON g.created_by = u.id
    ORDER BY g.played_at DESC
    LIMIT ?
  `),

  findByUserId: db.prepare(`
    SELECT DISTINCT g.*, u.name as created_by_name
    FROM games g
    JOIN users u ON g.created_by = u.id
    JOIN game_players gp ON g.id = gp.game_id
    WHERE gp.user_id = ?
    ORDER BY g.played_at DESC
    LIMIT ?
  `),

  delete: db.prepare('DELETE FROM games WHERE id = ?'),
};

// Game player queries
const gamePlayerQueries = {
  create: db.prepare(`
    INSERT INTO game_players (id, game_id, user_id, score, position, is_winner, confirmed_at, checkout_darts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  findByGameId: db.prepare(`
    SELECT gp.*, u.name, u.avatar_url
    FROM game_players gp
    JOIN users u ON gp.user_id = u.id
    WHERE gp.game_id = ?
    ORDER BY gp.position, gp.is_winner DESC
  `),

  confirmGame: db.prepare(`
    UPDATE game_players SET confirmed_at = datetime('now')
    WHERE game_id = ? AND user_id = ?
  `),
};

// Notification queries
const notificationQueries = {
  create: db.prepare(`
    INSERT INTO notifications (id, user_id, type, reference_id, message)
    VALUES (?, ?, ?, ?, ?)
  `),

  findByUserId: db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `),

  findUnreadByUserId: db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? AND read_at IS NULL
    ORDER BY created_at DESC
  `),

  countUnread: db.prepare(`
    SELECT COUNT(*) as count FROM notifications
    WHERE user_id = ? AND read_at IS NULL
  `),

  markAsRead: db.prepare(`
    UPDATE notifications SET read_at = datetime('now') WHERE id = ?
  `),

  markAllAsRead: db.prepare(`
    UPDATE notifications SET read_at = datetime('now')
    WHERE user_id = ? AND read_at IS NULL
  `),

  findById: db.prepare('SELECT * FROM notifications WHERE id = ?'),
};

// Push subscription queries
const pushSubscriptionQueries = {
  create: db.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?, ?)
  `),

  findByUserId: db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?'),

  findByEndpoint: db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?'),

  deleteByEndpoint: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),

  deleteByUserId: db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?'),
};

// Crown queries
const crownQueries = {
  findByGameType: db.prepare(`
    SELECT c.*, u.name as holder_name, u.avatar_url as holder_avatar_url
    FROM crowns c
    JOIN users u ON c.holder_user_id = u.id
    WHERE c.game_type = ?
  `),

  findByUserId: db.prepare(`
    SELECT c.*, u.name as holder_name, u.avatar_url as holder_avatar_url
    FROM crowns c
    JOIN users u ON c.holder_user_id = u.id
    WHERE c.holder_user_id = ?
  `),

  findAll: db.prepare(`
    SELECT c.*, u.name as holder_name, u.avatar_url as holder_avatar_url
    FROM crowns c
    JOIN users u ON c.holder_user_id = u.id
    ORDER BY c.game_type
  `),

  create: db.prepare(`
    INSERT INTO crowns (id, game_type, holder_user_id, acquired_at, acquired_in_game_id)
    VALUES (?, ?, ?, datetime('now'), ?)
  `),

  update: db.prepare(`
    UPDATE crowns
    SET holder_user_id = ?, acquired_at = datetime('now'), acquired_in_game_id = ?
    WHERE game_type = ?
  `),

  clearGameReference: db.prepare(`
    UPDATE crowns SET acquired_in_game_id = NULL WHERE acquired_in_game_id = ?
  `),

  deleteByGameId: db.prepare(`
    DELETE FROM crowns WHERE acquired_in_game_id = ?
  `),
};

// Game deletion approval queries
const gameDeletionQueries = {
  requestDeletion: db.prepare(`
    UPDATE games SET deletion_requested_by = ?, deletion_requested_at = datetime('now')
    WHERE id = ?
  `),

  cancelDeletion: db.prepare(`
    UPDATE games SET deletion_requested_by = NULL, deletion_requested_at = NULL
    WHERE id = ?
  `),

  addApproval: db.prepare(`
    INSERT OR IGNORE INTO game_deletion_approvals (id, game_id, user_id)
    VALUES (?, ?, ?)
  `),

  findApprovals: db.prepare(`
    SELECT gda.*, u.name as user_name
    FROM game_deletion_approvals gda
    JOIN users u ON gda.user_id = u.id
    WHERE gda.game_id = ?
  `),

  countApprovals: db.prepare(`
    SELECT COUNT(*) as count FROM game_deletion_approvals WHERE game_id = ?
  `),

  deleteApprovals: db.prepare(`
    DELETE FROM game_deletion_approvals WHERE game_id = ?
  `),

  findGamesWithPendingDeletion: db.prepare(`
    SELECT g.id, g.deletion_requested_by, g.deletion_requested_at, u.name as requester_name
    FROM games g
    JOIN users u ON g.deletion_requested_by = u.id
    WHERE g.deletion_requested_by IS NOT NULL
  `),
};

// Helper functions
const users = {
  create(name, isAdmin = false) {
    const id = uuidv4();
    userQueries.create.run(id, name, isAdmin ? 1 : 0);
    return { id, name, is_admin: isAdmin };
  },
  findById: (id) => userQueries.findById.get(id),
  findByName: (name) => userQueries.findByName.get(name),
  findByNostrPubkey: (pubkey) => userQueries.findByNostrPubkey.get(pubkey),
  findAll: () => userQueries.findAll.all(),
  findAllActive: () => userQueries.findAllActive.all(),
  count: () => userQueries.countAll.get().count,
  countAdmins: () => userQueries.countAdmins.get().count,
  updateName: (id, name) => userQueries.updateName.run(name, id),
  updateAvatar: (id, avatarUrl) => userQueries.updateAvatar.run(avatarUrl, id),
  setAdmin: (id, isAdmin) => userQueries.setAdmin.run(isAdmin ? 1 : 0, id),
  softDelete: (id) => userQueries.softDelete.run(id),
  linkNostrPubkey: (id, pubkey) => userQueries.linkNostrPubkey.run(pubkey, id),
  unlinkNostrPubkey: (id) => userQueries.unlinkNostrPubkey.run(id),
};

const passkeys = {
  create(userId, credentialId, publicKey, counter, transports) {
    const id = uuidv4();
    passkeyQueries.create.run(id, userId, credentialId, publicKey, counter, transports ? JSON.stringify(transports) : null);
    return { id, user_id: userId, credential_id: credentialId };
  },
  findByCredentialId: (credentialId) => {
    const passkey = passkeyQueries.findByCredentialId.get(credentialId);
    if (passkey && passkey.transports) {
      passkey.transports = JSON.parse(passkey.transports);
    }
    return passkey;
  },
  findById: (id) => {
    const passkey = passkeyQueries.findById.get(id);
    if (passkey && passkey.transports) {
      passkey.transports = JSON.parse(passkey.transports);
    }
    return passkey;
  },
  findByUserId: (userId) => {
    const keys = passkeyQueries.findByUserId.all(userId);
    return keys.map(k => {
      if (k.transports) k.transports = JSON.parse(k.transports);
      return k;
    });
  },
  findAll: () => passkeyQueries.findAll.all(),
  countByUserId: (userId) => passkeyQueries.countByUserId.get(userId).count,
  deleteById: (id) => passkeyQueries.deleteById.run(id),
  updateCounter: (id, counter) => passkeyQueries.updateCounter.run(counter, id),
};

const invitations = {
  create(createdBy, expiresInDays = 7) {
    const id = uuidv4();
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    invitationQueries.create.run(id, token, createdBy, expiresAt);
    return { id, token, expires_at: expiresAt };
  },
  createRecovery(createdBy, recoveryForUserId, expiresInDays = 7) {
    const id = uuidv4();
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    invitationQueries.createRecovery.run(id, token, createdBy, expiresAt, recoveryForUserId);
    return { id, token, expires_at: expiresAt, recovery_for_user_id: recoveryForUserId };
  },
  findByToken: (token) => invitationQueries.findByToken.get(token),
  findActive: () => invitationQueries.findActive.all(),
  findActiveRecovery: () => invitationQueries.findActiveRecovery.all(),
  findExpired: () => invitationQueries.findExpired.all(),
  findUsed: () => invitationQueries.findUsed.all(),
  findRecoveryByUserId: (userId) => invitationQueries.findRecoveryByUserId.get(userId),
  markUsed: (id, userId) => invitationQueries.markUsed.run(userId, id),
  revoke: (id) => invitationQueries.revoke.run(id),
  isValid(invitation) {
    if (!invitation) return false;
    if (invitation.used_by) return false;
    if (invitation.revoked) return false;
    if (new Date(invitation.expires_at) <= new Date()) return false;
    return true;
  },
};

const games = {
  create(playedAt, gameType, createdBy, notes, players) {
    const id = uuidv4();

    const createGame = db.transaction(() => {
      gameQueries.create.run(id, playedAt, gameType, createdBy, notes || null);

      for (const player of players) {
        const playerId = uuidv4();
        // Auto-confirm if this player is the creator
        const confirmedAt = player.userId === createdBy ? new Date().toISOString() : null;
        gamePlayerQueries.create.run(
          playerId,
          id,
          player.userId,
          player.score || null,
          player.position || null,
          player.isWinner ? 1 : 0,
          confirmedAt,
          player.checkoutDarts || null
        );
      }

      return id;
    });

    return createGame();
  },

  findById(id) {
    const game = gameQueries.findById.get(id);
    if (game) {
      game.players = gamePlayerQueries.findByGameId.all(id);
    }
    return game;
  },

  findRecent(limit = 20) {
    const recentGames = gameQueries.findRecent.all(limit);
    return recentGames.map(game => {
      game.players = gamePlayerQueries.findByGameId.all(game.id);
      return game;
    });
  },

  findByUserId(userId, limit = 50) {
    const userGames = gameQueries.findByUserId.all(userId, limit);
    return userGames.map(game => {
      game.players = gamePlayerQueries.findByGameId.all(game.id);
      return game;
    });
  },

  delete: (id) => {
    // Delete any crowns awarded in this game before deleting
    crownQueries.deleteByGameId.run(id);
    return gameQueries.delete.run(id);
  },

  confirmForUser(gameId, userId) {
    return gamePlayerQueries.confirmGame.run(gameId, userId);
  },
};

const notifications = {
  create(userId, type, referenceId, message) {
    const id = uuidv4();
    notificationQueries.create.run(id, userId, type, referenceId, message);
    return { id, user_id: userId, type, reference_id: referenceId, message };
  },
  findByUserId: (userId, limit = 50) => notificationQueries.findByUserId.all(userId, limit),
  findUnread: (userId) => notificationQueries.findUnreadByUserId.all(userId),
  countUnread: (userId) => notificationQueries.countUnread.get(userId).count,
  markAsRead: (id) => notificationQueries.markAsRead.run(id),
  markAllAsRead: (userId) => notificationQueries.markAllAsRead.run(userId),
  findById: (id) => notificationQueries.findById.get(id),
};

const pushSubscriptions = {
  create(userId, endpoint, p256dh, auth) {
    const id = uuidv4();
    // Upsert - delete existing with same endpoint first
    pushSubscriptionQueries.deleteByEndpoint.run(endpoint);
    pushSubscriptionQueries.create.run(id, userId, endpoint, p256dh, auth);
    return { id, user_id: userId, endpoint };
  },
  findByUserId: (userId) => pushSubscriptionQueries.findByUserId.all(userId),
  findByEndpoint: (endpoint) => pushSubscriptionQueries.findByEndpoint.get(endpoint),
  deleteByEndpoint: (endpoint) => pushSubscriptionQueries.deleteByEndpoint.run(endpoint),
  deleteByUserId: (userId) => pushSubscriptionQueries.deleteByUserId.run(userId),
};

// Designated game types that have crowns (excludes "Other")
const CROWN_GAME_TYPES = ['Cricket', '301', '501', 'Around the World'];

const crowns = {
  GAME_TYPES: CROWN_GAME_TYPES,

  findByGameType: (gameType) => crownQueries.findByGameType.get(gameType),
  findByUserId: (userId) => crownQueries.findByUserId.all(userId),
  findAll: () => crownQueries.findAll.all(),

  // Award or transfer a crown based on game result
  // playerIds: array of user IDs who participated in the game
  // Returns { awarded: boolean, previousHolder: object|null } if crown changed hands
  processGameResult(gameType, winnerId, gameId, playerIds) {
    // Only process designated game types
    if (!CROWN_GAME_TYPES.includes(gameType)) {
      return { awarded: false, previousHolder: null };
    }

    const currentCrown = crownQueries.findByGameType.get(gameType);

    if (!currentCrown) {
      // No one holds this crown yet - award it to the winner
      const id = uuidv4();
      crownQueries.create.run(id, gameType, winnerId, gameId);
      return { awarded: true, previousHolder: null };
    }

    if (currentCrown.holder_user_id === winnerId) {
      // Winner already holds the crown - no change
      return { awarded: false, previousHolder: null };
    }

    // Check if the crown holder participated in this game
    const crownHolderPlayed = playerIds.includes(currentCrown.holder_user_id);
    if (!crownHolderPlayed) {
      // Crown holder wasn't in this game - crown stays with them
      return { awarded: false, previousHolder: null };
    }

    // Crown holder was in the game and was defeated - transfer the crown
    const previousHolder = {
      id: currentCrown.holder_user_id,
      name: currentCrown.holder_name,
    };
    crownQueries.update.run(winnerId, gameId, gameType);
    return { awarded: true, previousHolder };
  },
};

// Game deletion approval helpers
const gameDeletions = {
  requestDeletion(gameId, userId) {
    return gameDeletionQueries.requestDeletion.run(userId, gameId);
  },

  cancelDeletion(gameId) {
    gameDeletionQueries.deleteApprovals.run(gameId);
    return gameDeletionQueries.cancelDeletion.run(gameId);
  },

  addApproval(gameId, userId) {
    const id = uuidv4();
    return gameDeletionQueries.addApproval.run(id, gameId, userId);
  },

  findApprovals: (gameId) => gameDeletionQueries.findApprovals.all(gameId),
  countApprovals: (gameId) => gameDeletionQueries.countApprovals.get(gameId).count,
  findGamesWithPendingDeletion: () => gameDeletionQueries.findGamesWithPendingDeletion.all(),
};

// Bootstrap setup token for first admin
function getOrCreateSetupToken() {
  if (users.count() > 0) return null;

  // Check for existing unused setup invitation
  const existingSetup = db.prepare(`
    SELECT * FROM invitations
    WHERE created_by = 'SYSTEM' AND used_by IS NULL AND revoked = 0
  `).get();

  if (existingSetup) return existingSetup.token;

  // Create new setup token
  const id = uuidv4();
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  db.prepare(`
    INSERT INTO invitations (id, token, created_by, expires_at)
    VALUES (?, ?, 'SYSTEM', ?)
  `).run(id, token, expiresAt);

  return token;
}

// Helper to count user's auth methods (passkeys + nostr)
function countUserAuthMethods(userId) {
  const passkeyCount = passkeys.countByUserId(userId);
  const user = users.findById(userId);
  const hasNostr = user && !!user.nostr_pubkey;
  return {
    passkeys: passkeyCount,
    nostr: hasNostr,
    total: passkeyCount + (hasNostr ? 1 : 0),
  };
}

module.exports = {
  db,
  users,
  passkeys,
  invitations,
  games,
  notifications,
  pushSubscriptions,
  crowns,
  gameDeletions,
  getOrCreateSetupToken,
  countUserAuthMethods,
};
