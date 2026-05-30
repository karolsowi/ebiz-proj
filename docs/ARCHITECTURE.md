# Architecture

**Trading:** the app supports **Alpaca paper trading only** in the current setup — no live brokerage. See [INTEGRATIONS.md — Paper trading](INTEGRATIONS.md#paper-trading-only-current-setup).

## Overview

```
┌─────────────┐     HTTP/JSON      ┌──────────────────┐     SQL      ┌────────────┐
│  React/Vite │ ◄────────────────► │ Express/Node/TS  │ ◄──────────► │ PostgreSQL │
│  frontend   │   JWT Bearer       │     backend      │   Drizzle    │  + encrypted│
└─────────────┘                    └────────┬─────────┘   API keys   │  user keys │
                                            │                          └────────────┘
                    optional                │
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       ▼
              Alpaca / Finnhub        Reddit / NewsData          Alpha Vantage
              (per-user keys)         (per-user keys)            (per-user keys)
                    │                       │
                    └─────────── optional: python-reddit-service (ML_SENTIMENT_URL)
```

## Backend layers

| Layer | Location | Role |
|-------|----------|------|
| Routes | `backend/src/api/*Routes.ts` | HTTP, `requireAuth` middleware, Zod validation |
| Controllers | `backend/src/controllers/` | Portfolio, watchlist, auth — thin HTTP layer |
| Services | `backend/src/services/` | Business logic, integrations, `credentialResolver` |
| DB | `backend/src/db/schema.ts` | Drizzle models (`users`, `user_api_keys`, `portfolio_entries`, …) |
| OpenAPI | `backend/src/openapi/` | Route catalog → Swagger |

### API credentials (multi-user)

| Store | Contents | Scope |
|-------|----------|--------|
| `backend/.env` | `JWT_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, scheduler, optional provider vars for **dev import** | One file per deployment |
| `user_api_keys` (PostgreSQL) | Encrypted Alpaca, Finnhub, Reddit, NewsData.io, Alpha Vantage credentials | **Per `userId`** |

Flow on each integration request:

1. `requireAuth` → `req.user.userId`
2. `getUserCredentials(userId, service)` in `credentialResolver.ts` — read/decrypt **only** that user’s row in `user_api_keys` (no `.env` fallback on HTTP)
3. Missing keys → `400` with `INTEGRATION_KEYS_MISSING` (or UI hides write actions via `GET /api/user/integrations`)
4. **Exception — shared reads:** Reddit/News **GET** routes query PostgreSQL without provider keys; **POST** fetch/refresh routes require the caller’s keys
5. UI: `userService` + `/api/user/api-keys`; encryption via `encryptionService` + `ENCRYPTION_KEY`

`keys:import-env` (`integrationKeysFromEnv.ts`) copies provider variables from `.env` into encrypted DB rows for **one** user (default: demo user from seed). Docker entrypoint runs this when `backend/.env` contains integration keys. Background jobs use `getApiKeysOwnerUserId()` (demo or `API_KEYS_OWNER_USER_ID`).

Details: [INTEGRATIONS.md](INTEGRATIONS.md#credentials-env-vs-per-user-keys).

## API mounted in `app.ts`

Active prefixes (see [API.md](API.md)):

| Prefix | Description |
|--------|-------------|
| `/api/auth` | Registration, login, JWT refresh, `/me` |
| `/api/portfolio` | Portfolio holdings CRUD |
| `/api/watchlist` | Watchlist CRUD |
| `/api/calendar` | Events and reminders |
| `/api/market` | Search, overview, **seeded** `/prices/:symbol` |
| `/api/technical` | Chart OHLCV + indicators, symbol analysis |
| `/api/reddit` | Posts, sentiment, backfill |
| `/api/news` | Articles and sentiment analysis |
| `/api/alpaca` | Alpaca **paper** API proxy (account, orders, positions) |
| `/api/user` | Profile, settings, API keys, `GET /integrations` status |
| `/api/finnhub` | Finnhub proxy |
| `/api/alphavantage` | Alpha Vantage proxy |
| `/api/trading` | Paper trading account, orders (Alpaca paper sync) |
| `/api/data` | Data aggregation, scheduler (partially admin) |

Public: `GET /health`, `GET /api` (index), `GET /api/docs`, `GET /api/openapi.json`.

## Internal services (not exposed as REST)

Strategy engine, backtester, automation rules, and analytics run via the background scheduler when enabled (`SCHEDULER_ENABLED`, `STRATEGY_ENGINE_ENABLED`, `AUTOMATION_ENABLED` in `.env`). Stooq is used internally by `/api/technical` and scheduled jobs — not as a standalone HTTP router.

## Frontend

- React 18 + TypeScript + Vite + Tailwind
- `AuthContext` + `ProtectedRoute` — JWT in localStorage
- Vite proxies `/api` to the backend in Docker (`VITE_API_URL` empty, `VITE_PROXY_TARGET` → backend)

### Main routes (`App.tsx`)

| Path | Page |
|------|------|
| `/` | Dashboard — portfolio snapshot, trades, market highlights, sentiment summary |
| `/trading` | Paper trading dashboard (requires user’s Alpaca paper keys) |
| `/market/overview` | Market overview |
| `/market/stocks/:symbol` | Stock details |
| `/market/watchlist` | Watchlist |
| `/market/news` | News sentiment |
| `/market/reddit` | Reddit sentiment |
| `/account/profile`, `/account/settings` | Account |
| `/account/authentication` | API keys management |
| `/signin`, `/signup` | Auth |

The calendar API (`/api/calendar`) is available for earnings/reminders; there is no calendar page in the main UI yet.

## Database

- PostgreSQL 16
- Migrations: `npm run db:migrate` (`backend/scripts/setup-database.js`)
- Seed: demo user, sample prices; optional `keys:import-env` after seed

Core entities: `users`, `user_api_keys`, `portfolio_entries`, `watchlist`, plus market/sentiment/trading tables.

## API documentation

- Route source: `backend/src/openapi/routeCatalog.ts`
- OpenAPI generator: `buildPaths.ts` → `spec.ts`
- Markdown: `npm run docs:api` → `docs/API.md`
