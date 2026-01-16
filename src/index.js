require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { games, getOrCreateSetupToken } = require('./db');
const { loadUser } = require('./middleware/auth');

const app = express();
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

// Session middleware
app.use(session({
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
}));

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

app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/games', gamesRoutes);

// Home page - game feed
app.get('/', (req, res) => {
  if (!req.user) {
    return res.redirect('/login');
  }

  const recentGames = games.findRecent(20);

  res.render('index', {
    title: 'Dart Scores',
    games: recentGames,
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

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Check for first-run setup
  const setupToken = getOrCreateSetupToken();
  if (setupToken) {
    console.log('\n========================================');
    console.log('FIRST RUN SETUP');
    console.log('========================================');
    console.log(`No users found. Create your admin account at:`);
    console.log(`http://localhost:${PORT}/register?token=${setupToken}`);
    console.log('========================================\n');
  }
});
