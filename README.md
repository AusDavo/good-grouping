# Good Grouping

A web app for tracking dart games among friends and family. Record scores, track crown holders, and settle debates about who's really the best.

## Features

- **Game Tracking** - Record games for Cricket, 301, 501, and Around the World
- **Crown System** - Track who holds the crown for each game type
- **Passwordless Auth** - Sign in with passkeys (WebAuthn) or Nostr browser extension (NIP-07)
- **Push Notifications** - Get notified when games need confirmation
- **Player Confirmations** - Games require player confirmation to prevent disputed scores

## Tech Stack

- Node.js / Express
- SQLite (better-sqlite3)
- Tailwind CSS
- SimpleWebAuthn
- nostr-tools

## Setup

1. Clone the repo
2. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   # Edit .env with your domain and a secure SESSION_SECRET
   ```
3. Install dependencies and build CSS:
   ```bash
   npm install
   npm run build:css
   ```
4. Run:
   ```bash
   npm start
   ```

## Docker

```bash
docker-compose up -d
```

## License

MIT
