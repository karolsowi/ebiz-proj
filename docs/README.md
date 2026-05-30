# Inwest App — documentation

Investment platform (e-business project): JWT auth, portfolio & watchlist, **paper-only** trading (Alpaca paper API), market data, shared sentiment dashboards (Reddit/news), and per-user encrypted API keys.

| Topic | Document |
|-------|----------|
| Paper trading & API keys model | [INTEGRATIONS.md](INTEGRATIONS.md) |
| Docker / local setup | [SETUP.md](SETUP.md) |

## Table of contents

| Document | Description |
|----------|-------------|
| [SETUP.md](SETUP.md) | Getting started (Docker — recommended), local dev, tests |
| [API.md](API.md) | All mounted REST endpoints (generated) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack, repo layout, credentials, UI routes |
| [INTEGRATIONS.md](INTEGRATIONS.md) | API keys, external services, scheduler |

## Quick start

```bash
git clone <repo-url>
cd ebiz-proj
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5175 |
| Backend | http://localhost:3001 |
| Swagger | http://localhost:3001/api/docs |

Demo account: `demo@demo.com` / `Demo1234!`

Docker needs no `.env` file for server config (Compose sets dev defaults).

- **Paper trading only** — no live brokerage; Alpaca keys must be **paper** keys ([INTEGRATIONS.md](INTEGRATIONS.md#paper-trading-only-current-setup)).
- Integration keys are **per user** in PostgreSQL — add under **Account → API keys**, or import once for the demo user from `.env` ([credentials](INTEGRATIONS.md#credentials-env-vs-per-user-keys)).
- Reddit/News: everyone can **view** shared DB data; **fetch/refresh** needs your own keys ([UI behaviour](INTEGRATIONS.md#what-each-user-sees-ui-behaviour)).

Local dev without Docker: `npm run setup` + `ENCRYPTION_KEY` in `backend/.env` ([SETUP.md](SETUP.md)).

## Regenerating the API table

After changing routes in `backend/src/app.ts`, update `backend/src/openapi/routeCatalog.ts`, then:

```bash
npm run docs:api
```
