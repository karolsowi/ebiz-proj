# Setup

## Docker (recommended)

Requirements: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (on Windows, start it before `docker compose`).

```bash
git clone <repo-url>
cd ebiz-proj
docker compose up --build
```

No `backend/.env` is required — Compose sets dev defaults (`JWT_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`).

Optional: copy `backend/.env.example` → `backend/.env` if you want to (a) override server settings or (b) **import provider keys into the demo user** on startup (`keys:import-env`). Other users still add keys in the app under **Account → API keys**. See [INTEGRATIONS.md](INTEGRATIONS.md#credentials-env-vs-per-user-keys).

Compose starts PostgreSQL, the backend, and the frontend. The backend entrypoint runs migrations, seed, and `keys:import-env` (only when integration variables are present in `backend/.env`).

| Service | Port | URL |
|---------|------|-----|
| Frontend | 5175 | http://localhost:5175 |
| Backend | 3001 | http://localhost:3001 |
| PostgreSQL | 5432 | `postgresql://inwest:inwest@localhost:5432/inwest` |

`docker-compose.yml` sets dev defaults for `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, and `CORS_ORIGINS`. An optional `backend/.env` can override server vars or supply provider keys for **demo-user import only** — not a global key pool for all users.

Stop: `docker compose down` (Postgres data persists in the `postgres_data` volume).

## Credentials (multi-user)

| What | Where | Who it affects |
|------|--------|----------------|
| Server config | `.env` or Compose `environment` | Whole application |
| Integration API keys | `user_api_keys` table (encrypted) | **Each user separately** |
| Dev import from `.env` | `npm run keys:import-env` | Demo user by default |
| HTTP API requests | `user_api_keys` only | **No** `.env` fallback — missing keys → 400 |

**Trading mode:** paper only ([INTEGRATIONS.md — Paper trading](INTEGRATIONS.md#paper-trading-only-current-setup)).

Full diagram and flow: [INTEGRATIONS.md — Credentials](INTEGRATIONS.md#credentials-env-vs-per-user-keys).

## Demo flow (UI)

1. http://localhost:5175 → sign in: `demo@demo.com` / `Demo1234!`
2. **Dashboard** (`/`) — portfolio snapshot and quick links.
3. **Trading** (`/trading`) — **paper trading only**; needs **your** Alpaca paper keys (demo user may already have them if imported from `.env` on startup). New users see a prompt to add keys — no fake account data.
4. **Market Data → Watchlist** — add symbols (no broker keys required).
5. **Market → Reddit / News** — view **shared** sentiment data from the database; fetch/refresh buttons appear only after you add your own API keys.
6. **Account → API keys** — per-user encrypted keys (Alpaca paper, Reddit, Finnhub, NewsData.io, …).
7. Optional: Swagger http://localhost:3001/api/docs → Authorize → Bearer token from `POST /api/auth/login`.

**Try a second user:** register a new account → Trading shows “keys not configured”; Reddit/News still show stored data but hide update actions.

## Development without Docker

```bash
npm run setup
# Edit backend/.env: DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY (required)
npm run db:migrate
npm run db:seed
# Optional: npm run keys:import-env   # move integration keys from .env into DB
npm run dev            # backend :3001 + frontend :5175
```

Requirements: Node.js 20+, PostgreSQL 16+ (local or DB-only container).

### Scripts (root `package.json`)

| Script | Action |
|--------|--------|
| `npm run setup` | Install deps + create `backend/.env` if missing |
| `npm run dev` | Backend + frontend in parallel |
| `npm run test` | Vitest in `backend/` |
| `npm run docs:api` | Regenerates `docs/API.md` |
| `npm run db:migrate` | Drizzle migrations |
| `npm run db:seed` | Demo data + sample prices |
| `npm run db:check` | Database connectivity check |
| `npm run docker:up` | `docker compose up --build` |

### Backend (`backend/package.json`)

`npm run dev` — API on `PORT` (default 3001).  
`npm run keys:import-env` — import integration keys from `.env` into encrypted DB rows.  
`npm run lint` — ESLint.

### Frontend (`frontend/package.json`)

`npm run dev` — Vite on 5175. In Docker, the dev server proxies `/api` to the backend (`VITE_PROXY_TARGET`).

## Environment variables

Full list: [`backend/.env.example`](../backend/.env.example).

### Server variables (global)

Required for **local dev without Docker** (Docker Compose injects dev defaults):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL |
| `JWT_SECRET` | JWT signing (min 32 characters) |
| `ENCRYPTION_KEY` | Encrypts/decrypts rows in `user_api_keys` (exactly 32 characters) |

Optional server config: `CORS_ORIGINS`, `RESEND_API_KEY`, `REDDIT_USERNAME`, `STOOQ_API_KEY`, `ML_SENTIMENT_URL`, `SCHEDULER_ENABLED` — see [INTEGRATIONS.md](INTEGRATIONS.md).

### Provider keys (per user in DB)

Do **not** treat `.env` as the multi-user key store. Each user’s Alpaca/Finnhub/Reddit keys live in PostgreSQL.

| Goal | What to do |
|------|------------|
| Any user (recommended) | **Account → API keys** after login — use **Alpaca paper** keys for trading |
| Seed demo user from `.env` | Set `ALPACA_API_KEY`, `FINNHUB_API_KEY`, … in `backend/.env`, then `npm run keys:import-env` (Docker runs this on startup) |
| Check what is configured | `GET /api/user/integrations` (or open Trading / Reddit / News in the UI) |

Never commit `backend/.env`.

## Tests

```bash
npm test
```

Includes Zod validation (422) and protected portfolio/watchlist routes.

## Production

Build `backend` and `frontend` (`npm run build`), set `NODE_ENV=production`, a strong `JWT_SECRET`, stable `ENCRYPTION_KEY`, CORS, and HTTPS behind a reverse proxy. Each user must configure integration keys via **Account → API keys** (no `.env` provider fallback in production). Stack details: [ARCHITECTURE.md](ARCHITECTURE.md).
