require('dotenv').config();

const http = require('http');
const express = require('express');
const session = require('express-session');
const path = require('path');
const { games, crowns, liveGames, getOrCreateSetupToken } = require('./db');
const { loadUser } = require('./middleware/auth');
const { initWebSocket } = require('./websocket');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Session store setup
const SQLiteStore = require('connect-sqlite3')(session);
const sessionDbPath = process.env.SESSION_DB_PATH || path.join(__dirname, '../data/sessions.db');

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
// Serve uploads from data directory (for persistence across container restarts)
app.use('/uploads', express.static(path.join(__dirname, '../data/uploads')));

// Session middleware (saved for WebSocket auth)
const sessionMiddleware = session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, '../data'),
  }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY === 'true',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
});
app.use(sessionMiddleware);

// Trust proxy if configured (for running behind reverse proxy)
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Load user from session
app.use(loadUser);

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const gamesRoutes = require('./routes/games');
const liveGamesRoutes = require('./routes/live-games');
const notificationsRoutes = require('./routes/notifications');
const pushRoutes = require('./routes/push');
const usersRoutes = require('./routes/users');

app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/games', gamesRoutes);
app.use('/live-games', liveGamesRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/push', pushRoutes);
app.use('/users', usersRoutes);

// Home page - game feed
app.get('/', (req, res) => {
  if (!req.user) {
    return res.redirect('/login');
  }

  const recentGames = games.findRecent(20);
  const allCrowns = crowns.findAll();
  // Build a map of game_type -> crown holder for easy lookup
  const crownHolders = {};
  allCrowns.forEach(c => {
    crownHolders[c.game_type] = c;
  });

  // Count games needing confirmation from this user
  const userGames = games.findByUserId(req.user.id, 20);
  const unconfirmedGames = userGames.filter(g =>
    g.players.some(p => p.user_id === req.user.id && !p.confirmed_at)
  );

  // Check for active live games this user is in
  const activeGames = liveGames.findActive();
  const userActiveGame = activeGames.find(g =>
    g.status === 'playing' && g.players.some(p => p.user_id === req.user.id)
  );

  res.render('index', {
    title: 'Home',
    games: recentGames,
    crownHolders,
    unconfirmedCount: unconfirmedGames.length,
    userActiveGame,
  });
});

// Crowns leaderboard page
app.get('/crowns', (req, res) => {
  if (!req.user) {
    return res.redirect('/login');
  }

  const allCrowns = crowns.findAll();

  // Calculate defense streak for each crown
  allCrowns.forEach(crown => {
    // Count consecutive wins by the holder since they acquired the crown
    const holderGames = games.findByUserId(crown.holder_user_id, 50);
    let defenseCount = 0;
    for (const game of holderGames) {
      if (game.game_type !== crown.game_type) continue;
      if (new Date(game.played_at) < new Date(crown.acquired_at)) break;
      const holderPlayer = game.players.find(p => p.user_id === crown.holder_user_id);
      if (holderPlayer && holderPlayer.is_winner) {
        defenseCount++;
      } else {
        break;
      }
    }
    crown.defense_count = defenseCount;
  });

  res.render('crowns', {
    title: 'Crowns',
    allCrowns,
    crownGameTypes: crowns.GAME_TYPES,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not Found',
    message: 'The page you are looking for does not exist.',
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).render('error', {
    title: 'Error',
    message: 'An unexpected error occurred.',
  });
});

// Initialize WebSocket server
initWebSocket(server, sessionMiddleware);

// Start server
server.listen(PORT, () => {
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  console.log(`Server running on ${baseUrl}`);

  // Check for first-run setup
  const setupToken = getOrCreateSetupToken();
  if (setupToken) {
    console.log('\n========================================');
    console.log('FIRST RUN SETUP');
    console.log('========================================');
    console.log(`No users found. Create your admin account at:`);
    console.log(`${baseUrl}/register?token=${setupToken}`);
    console.log('========================================\n');
  }
});
