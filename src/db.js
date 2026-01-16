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
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkeys(user_id);
    CREATE INDEX IF NOT EXISTS idx_passkeys_credential_id ON passkeys(credential_id);
    CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
    CREATE INDEX IF NOT EXISTS idx_games_played_at ON games(played_at);
    CREATE INDEX IF NOT EXISTS idx_game_players_game_id ON game_players(game_id);
`);

// Migration: Add avatar_url column if it doesn't exist
try {
  db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
} catch (e) {
  // Column already exists, ignore
}

// User queries
const userQueries = {
  create: db.prepare(`
    INSERT INTO users (id, name, is_admin)
    VALUES (?, ?, ?)
  `),

  findById: db.prepare('SELECT * FROM users WHERE id = ?'),
  findByName: db.prepare('SELECT * FROM users WHERE name = ?'),
  findAll: db.prepare('SELECT * FROM users ORDER BY name'),
  countAll: db.prepare('SELECT COUNT(*) as count FROM users'),
  updateName: db.prepare('UPDATE users SET name = ? WHERE id = ?'),
  updateAvatar: db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?'),
};

// Passkey queries
const passkeyQueries = {
  create: db.prepare(`
    INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  findByCredentialId: db.prepare('SELECT * FROM passkeys WHERE credential_id = ?'),
  findByUserId: db.prepare('SELECT * FROM passkeys WHERE user_id = ?'),
  findAll: db.prepare('SELECT * FROM passkeys'),

  updateCounter: db.prepare('UPDATE passkeys SET counter = ? WHERE id = ?'),
};

// Invitation queries
const invitationQueries = {
  create: db.prepare(`
    INSERT INTO invitations (id, token, created_by, expires_at)
    VALUES (?, ?, ?, ?)
  `),

  findByToken: db.prepare('SELECT * FROM invitations WHERE token = ?'),
  findActive: db.prepare(`
    SELECT i.*, COALESCE(u.name, i.created_by) as created_by_name
    FROM invitations i
    LEFT JOIN users u ON i.created_by = u.id
    WHERE i.used_by IS NULL AND i.revoked = 0 AND i.expires_at > datetime('now')
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

  delete: db.prepare('DELETE FROM games WHERE id = ?'),
};

// Game player queries
const gamePlayerQueries = {
  create: db.prepare(`
    INSERT INTO game_players (id, game_id, user_id, score, position, is_winner)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  findByGameId: db.prepare(`
    SELECT gp.*, u.name
    FROM game_players gp
    JOIN users u ON gp.user_id = u.id
    WHERE gp.game_id = ?
    ORDER BY gp.position, gp.is_winner DESC
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
  findAll: () => userQueries.findAll.all(),
  count: () => userQueries.countAll.get().count,
  updateName: (id, name) => userQueries.updateName.run(name, id),
  updateAvatar: (id, avatarUrl) => userQueries.updateAvatar.run(avatarUrl, id),
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
  findByUserId: (userId) => {
    const keys = passkeyQueries.findByUserId.all(userId);
    return keys.map(k => {
      if (k.transports) k.transports = JSON.parse(k.transports);
      return k;
    });
  },
  findAll: () => passkeyQueries.findAll.all(),
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
  findByToken: (token) => invitationQueries.findByToken.get(token),
  findActive: () => invitationQueries.findActive.all(),
  findExpired: () => invitationQueries.findExpired.all(),
  findUsed: () => invitationQueries.findUsed.all(),
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
        gamePlayerQueries.create.run(
          playerId,
          id,
          player.userId,
          player.score || null,
          player.position || null,
          player.isWinner ? 1 : 0
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

  delete: (id) => gameQueries.delete.run(id),
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

module.exports = {
  db,
  users,
  passkeys,
  invitations,
  games,
  getOrCreateSetupToken,
};
