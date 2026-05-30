# External integrations

All endpoints below require **JWT** (after `POST /api/auth/login`), unless noted as public in [API.md](API.md).

## Paper trading only (current setup)

This project is configured for **simulated / paper trading only**. There is **no live (real-money) brokerage** integration in the current codebase.

| Area | What is supported |
|------|-------------------|
| **Alpaca** | **Paper** API only (`https://paper-api.alpaca.markets` via `ALPACA_BASE_URL`) |
| **Trading UI** (`/trading`) | Paper account sync, paper orders, positions — requires **your own** Alpaca **paper** API keys |
| **Portfolio** (`/api/portfolio`) | Local holdings CRUD (not broker live account) |
| **Live trading** | **Not implemented** — do not point `ALPACA_BASE_URL` at live endpoints in a shared/demo environment without understanding the risk |

When adding keys under **Account → API keys**, use an [Alpaca paper trading](https://alpaca.markets) key pair. The UI labels accounts as **PAPER**.

## Credentials: `.env` vs per-user keys

The app is **multi-user**. Each logged-in user has their own integration keys. `.env` is **not** a shared keyring for all users — it only configures the server and optional dev shortcuts.

```
┌──────────────────────────────────────────────────────────────────┐
│  backend/.env  (server — one file for the whole app)             │
│  • DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, CORS, scheduler     │
│  • Optional dev: ALPACA_API_KEY, FINNHUB_API_KEY, … (see below)  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
         keys:import-env      │  Account → API keys (UI)
         (demo user only)     │  POST /api/user/api-keys
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  PostgreSQL: user_api_keys (one row set per user × service)      │
│  user A → encrypted Alpaca / Finnhub / Reddit / …              │
│  user B → own keys (isolated from A)                             │
└────────────────────────────┬─────────────────────────────────────┘
                             │
              getUserCredentials(req.user.userId, service)
                             ▼
                    Alpaca, Finnhub, Reddit, NewsData.io …
```

### Runtime resolution (`credentialResolver.ts`)

For each request, the backend uses the **JWT user id**:

1. Load and decrypt keys from `user_api_keys` for that user and service (`alpaca`, `finnhub`, …).
2. If the user has no DB keys, return 400 — *Add your keys under Account → API keys* (no `.env` fallback for HTTP requests).

**Shared read-only data:** Reddit sentiment and news charts read from PostgreSQL without the caller’s API keys. Live fetch/update endpoints (`POST /api/reddit/fetch`, `POST /api/news/refresh`, …) require the caller’s own keys in DB.

User A never reads user B’s keys. Two users can use different Alpaca **paper** accounts at the same time.

### What each user sees (UI behaviour)

| Feature | Without your API keys | With your API keys |
|---------|------------------------|-------------------|
| **Trading** (`/trading`) | Message to add Alpaca keys — **no mock balances or fake orders** | Paper account, sync, place/cancel orders via Alpaca paper API |
| **Reddit** (`/market/reddit`) | Shared posts, charts, analytics from DB | Above + **Fetch New Posts**, auto-fetch, backfill controls |
| **News** (`/market/news`) | Shared headlines and sentiment charts from DB | Above + **Refresh headlines** (live fetch via your NewsData.io / Finnhub keys) |
| **Finnhub / Alpha Vantage** | Endpoints return 400 until keys are set | Proxied quotes/news for that user |

Check configured services: `GET /api/user/integrations` → `canUseAlpaca`, `canManageReddit`, `canFetchNews`, plus `integrations.{service}` booleans.

### How to add keys

| Method | Who gets the keys | When to use |
|--------|-------------------|-------------|
| **Account → API keys** (UI) | The logged-in user | Normal setup; production; any extra user |
| **`npm run keys:import-env`** | Demo user by default (`demo@demo.com`) | Copy dev keys from `.env` into that user’s DB rows once |

Docker entrypoint runs `keys:import-env` on startup **only when** integration variables exist in an optional `backend/.env`. That seeds the **demo account**, not every user.

Override import target: `API_KEYS_OWNER_USER_ID` (default: `00000000-0000-0000-0000-000000000001` from seed).

### What belongs in `.env`

| Category | Examples | Scope |
|----------|----------|--------|
| **Server (required for local dev)** | `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` | Whole app; Docker sets dev defaults |
| **Server (optional)** | `CORS_ORIGINS`, `SCHEDULER_ENABLED`, `STOOQ_API_KEY`, `ML_SENTIMENT_URL` | Whole app |
| **Provider URLs (not secrets)** | `ALPACA_BASE_URL`, `ALPACA_DATA_URL` | Shared endpoints; credentials still per user in DB |
| **Optional dev import** | `ALPACA_API_KEY`, `FINNHUB_API_KEY`, `REDDIT_CLIENT_ID`, … | Imported into **one** user’s DB rows via `keys:import-env`; not the multi-user store |

`ENCRYPTION_KEY` (32 characters) encrypts all rows in `user_api_keys`. Changing it invalidates existing stored keys.

See [`backend/.env.example`](../backend/.env.example) for the full variable list.

## Works without external keys

Auth, portfolio, watchlist, calendar API, `GET /api/market/prices/:symbol` (seed data), technical analysis (when enough price history exists in the DB), **Reddit/News read-only dashboards** (shared DB content).

**Does not work without keys:** Alpaca/trading broker features, live Reddit fetch, live news refresh, Finnhub/Alpha Vantage proxies.

## Alpaca (paper trading only)

| UI / DB service | `alpaca` |
| Endpoints | `/api/alpaca/*`, `/api/trading/*` (broker sync & orders) |
| Sign up | https://alpaca.markets — create a **paper** trading account and API keys |

Server default: `ALPACA_BASE_URL=https://paper-api.alpaca.markets` (see `backend/.env.example`). **Credentials** are always the logged-in user’s encrypted keys in `user_api_keys` — never another user’s keys and no runtime `.env` fallback on HTTP requests.

| Endpoint | Requires your Alpaca paper keys |
|----------|--------------------------------|
| `GET /api/alpaca/account`, `/positions`, `/orders` | Yes |
| `POST /api/alpaca/orders`, `DELETE /api/alpaca/orders/:id` | Yes |
| `GET /api/trading/account`, `POST /api/trading/orders`, sync endpoints | Yes |

Example paper order: `POST /api/alpaca/orders` with body `{ "symbol": "AAPL", "qty": 1, "side": "buy", "type": "market", "time_in_force": "day" }`.

## Market data

| Provider | DB service name | API prefix |
|----------|-----------------|------------|
| Finnhub | `finnhub` | `/api/finnhub` |
| Alpha Vantage | `alphavantage` | `/api/alphavantage` |
| Aggregation | — | `/api/market`, `/api/data` |

`marketDataService` uses fallback and cache; route details in [API.md](API.md).

## Technical analysis & Stooq

| Prefix | `/api/technical` |
| Env | `STOOQ_API_KEY` (optional) — server-side key for EOD CSV backfill when DB history is thin |

Endpoints: `GET /api/technical/:symbol`, `GET /api/technical/:symbol/chart`.

## Reddit (sentiment)

| UI / DB service | `reddit` |
| Prefix | `/api/reddit` |
| Setup | “script” app at https://www.reddit.com/prefs/apps |

| Type | Examples | Your Reddit keys required? |
|------|----------|----------------------------|
| **Read (shared DB)** | `GET /posts/quality`, `/sentiment/analytics`, `/trending`, … | No |
| **Write / fetch** | `POST /fetch`, `/backfill/*`, `/automated/start` | Yes |

Optional in `.env`: `REDDIT_USERNAME`, `REDDIT_USER_AGENT` (bot identity for server jobs — OAuth secrets still go in **Account → API keys** or demo import).

## News (sentiment)

| UI / DB service | `news` (NewsData.io); also **Finnhub** for fetch |
| Prefix | `/api/news` |

| Type | Examples | Your news/finnhub keys required? |
|------|----------|----------------------------------|
| **Read (shared DB)** | `GET /articles?preferCache=true`, `/sentiment/trends/daily`, `/sentiment/analytics` | No |
| **Live refresh** | `POST /news/refresh` | Yes (NewsData.io and/or Finnhub in your API keys) |
| **Batch analyze** | `POST /sentiment/analyze` | No (processes stored articles; optional ML service) |

## Email (optional)

`RESEND_API_KEY`, `EMAIL_FROM` in `.env` — account verification in `/api/user/*`.

## ML sentiment (optional)

`ML_SENTIMENT_URL` (default `http://localhost:8000`) — optional Python FinBERT service in `python-reddit-service/`. **Not** part of Docker Compose. See `python-reddit-service/ARCHIVED.md`. Reddit/news analyzers fall back when the service is unreachable.

## Scheduler and admin

`SCHEDULER_ENABLED=true` — background jobs (default `false` in Docker Compose).  
`/api/data/scheduler/*` and `/api/data/maintenance` require **admin** role.

Background jobs use the demo user’s (or `API_KEYS_OWNER_USER_ID`) encrypted keys from the DB.

## Per-user keys in the UI

**Account → API keys** (`GET/POST/PUT/DELETE /api/user/api-keys`) — each user manages their own keys. This is the intended model for production and for any account other than the demo user after a one-time `.env` import.
