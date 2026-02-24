# Good Grouping

A self-hosted darts scoreboard for tracking games with your mates. Live scoring with WebSockets, a crown system to track who's king of each game type, and passwordless auth with passkeys.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/AusDavo/good-grouping)

<!-- Screenshots - replace these paths with actual screenshots -->
<!-- ![Home Feed](docs/screenshots/home.png) -->
<!-- ![Live Scoring](docs/screenshots/live-scoring.png) -->
<!-- ![Crown Leaderboard](docs/screenshots/crowns.png) -->

## Features

**Live Scoring**
- Real-time dart-by-dart scoring via WebSocket
- Cricket, 301, 501, and Around the World
- Undo throws, keyboard shortcuts, haptic feedback
- Series support (best-of-N matches)

**Crown System**
- Win a game type to claim the crown
- Defend it or lose it to your opponent
- Defense streak tracking on the leaderboard

**Game Recording**
- Log completed games retroactively
- Player confirmation system to prevent disputed scores
- Photo uploads and comments on games
- Multi-player deletion voting

**Player Profiles**
- Win rates by game type
- Win streaks (current and best)
- Head-to-head records against opponents

**Passwordless Auth**
- Passkeys via WebAuthn (Touch ID, Face ID, security keys)
- Nostr browser extension (NIP-07)
- Invite-only registration

**Progressive Web App**
- Install to home screen on any device
- Push notifications for game confirmations and crown changes
- Works great on mobile

## Screenshots

> **TODO:** Add screenshots to `docs/screenshots/` and uncomment the image tags above.
>
> Suggested screenshots:
> - `home.png` — Home feed with game cards and crown holders
> - `live-scoring.png` — Cricket live scoring view
> - `crowns.png` — Crown leaderboard
> - `game-detail.png` — Game detail with photos and comments
> - `profile.png` — Player profile with stats

## Quick Start

### One-Click Deploy (Render)

Click the **Deploy to Render** button above. You'll be prompted for:

| Variable | Example | Description |
|----------|---------|-------------|
| `RP_ID` | `good-grouping.onrender.com` | Your domain (no protocol) |
| `ORIGIN` | `https://good-grouping.onrender.com` | Full URL |
| `BASE_URL` | `https://good-grouping.onrender.com` | Same as ORIGIN |

Render auto-generates a `SESSION_SECRET` and provisions a persistent disk for your SQLite database. After deploy, the console will print a one-time setup URL to create your admin account.

> Requires Render Starter plan ($7/mo) for persistent disk support.

### Docker (Recommended for Self-Hosting)

```bash
git clone https://github.com/AusDavo/good-grouping.git
cd good-grouping
cp .env.example .env
# Edit .env with your domain and a secure SESSION_SECRET
docker compose up -d
```

The app runs on port 3000. Put it behind a reverse proxy (Caddy, nginx, Traefik) for HTTPS — passkeys require a secure context.

### Manual

```bash
git clone https://github.com/AusDavo/good-grouping.git
cd good-grouping
cp .env.example .env
npm install
npm run build:css
npm start
```

### First Run

On first start with no users, the console prints a one-time registration URL:

```
========================================
FIRST RUN SETUP
========================================
No users found. Create your admin account at:
http://localhost:3000/register?token=abc123...
========================================
```

Visit that URL to create your admin account. From there, generate invite links for your mates under **Admin > Invites**.

## Configuration

See [`.env.example`](.env.example) for all options:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `SESSION_SECRET` | — | **Required.** Random string for session encryption |
| `RP_ID` | `localhost` | Your domain for WebAuthn (e.g. `darts.example.com`) |
| `ORIGIN` | `http://localhost:3000` | Full URL where the app is accessed |
| `BASE_URL` | `http://localhost:3000` | Used for invite link generation |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy |

VAPID keys for push notifications are auto-generated on first run and stored in `data/vapid-keys.json`.

## Tech Stack

- **Backend** — Node.js, Express, WebSocket (ws)
- **Database** — SQLite (better-sqlite3)
- **Auth** — SimpleWebAuthn, nostr-tools
- **Frontend** — EJS templates, Tailwind CSS
- **Theme** — 1980s English pub aesthetic with neon accents
- **Notifications** — Web Push API

## Project Structure

```
├── src/
│   ├── index.js            # Express app & main routes
│   ├── db.js               # SQLite schema & data layer
│   ├── auth.js             # WebAuthn server logic
│   ├── nostr.js            # Nostr auth helpers
│   ├── websocket.js        # Live scoring WebSocket engine
│   ├── game-logic.js       # Cricket, 01, ATW scoring rules
│   ├── pushService.js      # Push notification service
│   ├── middleware/auth.js   # Auth middleware
│   └── routes/             # Express route handlers
├── views/                  # EJS templates
├── public/
│   ├── js/                 # Client-side scripts
│   ├── css/style.css       # Built Tailwind output
│   └── manifest.webmanifest
├── data/                   # SQLite DB, uploads, VAPID keys (Docker volume)
├── Dockerfile              # Multi-stage build
├── docker-compose.yml
└── render.yaml             # Render one-click deploy blueprint
```

## Development

```bash
npm run dev          # Start with CSS watch + auto-reload
npm test             # Run tests
npm run test:watch   # Tests in watch mode
```

## Game Types

| Type | Objective | Scoring |
|------|-----------|---------|
| **Cricket** | Close 15–20 and Bull | Points scored on open numbers; highest score wins |
| **301** | Count down from 301 | Must finish on a double |
| **501** | Count down from 501 | Must finish on a double |
| **Around the World** | Hit 1–20 then Bull | First to complete the sequence wins |

## License

[MIT](LICENSE)
