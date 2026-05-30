# API reference (all mounted endpoints)

Auto-generated from `backend/src/openapi/routeCatalog.ts`.
Regenerate: `npm run docs:api`. Index: [README.md](README.md).

Interactive Swagger UI: http://localhost:3001/api/docs

OpenAPI JSON: http://localhost:3001/api/openapi.json

**Auth:** send `Authorization: Bearer <accessToken>` from `POST /api/auth/login`.

**Demo user (Docker seed):** `demo@demo.com` / `Demo1234!`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health check |
| GET | `/api` | No | API index (docs link, demo user hint) |
| POST | `/api/auth/register` | No | Register a new user |
| POST | `/api/auth/login` | No | Login and receive JWT tokens |
| POST | `/api/auth/refresh` | No | Refresh access token |
| POST | `/api/auth/logout` | No | Revoke refresh token |
| GET | `/api/auth/me` | JWT | Current authenticated user profile |
| GET | `/api/auth/admin/ping` | JWT (admin) | Admin-only health ping |
| GET | `/api/portfolio` | JWT | List portfolio holdings |
| GET | `/api/portfolio/summary` | JWT | Portfolio summary (totals, gain/loss) |
| POST | `/api/portfolio` | JWT | Add portfolio holding |
| POST | `/api/portfolio/refresh-prices` | JWT | Refresh current prices for user holdings |
| PUT | `/api/portfolio/:id` | JWT | Update portfolio holding |
| DELETE | `/api/portfolio/:id` | JWT | Delete portfolio holding |
| GET | `/api/watchlist` | JWT | List watchlist symbols |
| GET | `/api/watchlist/:id` | JWT | Get single watchlist entry |
| POST | `/api/watchlist` | JWT | Add symbol to watchlist |
| PUT | `/api/watchlist/:id` | JWT | Update watchlist entry |
| DELETE | `/api/watchlist/:id` | JWT | Remove watchlist entry |
| GET | `/api/calendar/events` | JWT | Calendar events and reminders in date range — Query: from, to (YYYY-MM-DD), optional symbol, type |
| POST | `/api/calendar/reminders` | JWT | Create personal reminder |
| PUT | `/api/calendar/reminders/:id` | JWT | Update reminder |
| DELETE | `/api/calendar/reminders/:id` | JWT | Delete reminder |
| GET | `/api/market/search/:query` | JWT | Search symbols by query string |
| GET | `/api/market/search` | JWT | Search symbols (query param q) — Query: q |
| GET | `/api/market/movers` | JWT | Top market movers |
| GET | `/api/market/overview` | JWT | Market overview snapshot |
| GET | `/api/market/company/:symbol` | JWT | Company profile for symbol |
| GET | `/api/market/news/:symbol` | JWT | News for symbol (optional path segment) |
| GET | `/api/market/status` | JWT | Market data provider status |
| GET | `/api/market/prices/:symbol` | JWT | Seeded historical prices (no external API key) |
| GET | `/api/market/usage` | JWT | Market API usage statistics |
| GET | `/api/technical/:symbol/chart` | JWT | OHLCV chart data with indicator arrays — Query: timeframe, days, startDate, endDate, limit. Uses DB history; may backfill via Stooq when STOOQ_API_KEY is set. |
| GET | `/api/technical/:symbol` | JWT | Technical analysis indicators for symbol — Query: timeframe (default daily). Requires sufficient historical prices in DB. |
| POST | `/api/reddit/fetch` | JWT | Fetch Reddit posts for configured subreddits — Requires Reddit API keys (Account → API keys) |
| GET | `/api/reddit/stats` | JWT | Reddit ingestion statistics |
| GET | `/api/reddit/trending` | JWT | Trending tickers from Reddit |
| GET | `/api/reddit/health` | JWT | Reddit integration health |
| GET | `/api/reddit/backfill/status` | JWT | Backfill job status |
| POST | `/api/reddit/backfill/chunk` | JWT | Run one backfill chunk |
| POST | `/api/reddit/backfill/smart-history` | JWT | Smart historical backfill |
| POST | `/api/reddit/sentiment/process` | JWT | Process sentiment for stored posts |
| POST | `/api/reddit/automated/start` | JWT | Start automated Reddit fetch |
| POST | `/api/reddit/automated/stop` | JWT | Stop automated Reddit fetch |
| GET | `/api/reddit/automated/status` | JWT | Automated fetch status |
| GET | `/api/reddit/posts/quality` | JWT | Quality-filtered Reddit posts |
| GET | `/api/reddit/recommendations` | JWT | Stock recommendations from Reddit sentiment |
| GET | `/api/reddit/sentiment/analytics` | JWT | Aggregate Reddit sentiment analytics |
| GET | `/api/reddit/sentiment/stocks` | JWT | Per-stock Reddit sentiment scores |
| GET | `/api/reddit/sentiment/history` | JWT | Historical Reddit sentiment series |
| GET | `/api/news/articles` | JWT | Fetch news articles — preferCache=true (default): shared DB — no caller keys. Live fetch needs caller NewsData.io/Finnhub keys. |
| POST | `/api/news/refresh` | JWT | Fetch fresh headlines (caller NewsData.io and/or Finnhub keys required) |
| POST | `/api/news/sentiment/analyze` | JWT | Analyze sentiment for news batch |
| GET | `/api/news/sentiment/trends/daily` | JWT | Daily news sentiment trends |
| GET | `/api/news/sentiment/analytics` | JWT | News sentiment analytics dashboard data |
| POST | `/api/news/sentiment/text` | JWT | Score sentiment for arbitrary text |
| GET | `/api/news/sentiment/stock/:symbol` | JWT | News sentiment for a stock symbol |
| GET | `/api/alpaca/account` | JWT | Alpaca paper account info — Requires Alpaca API keys (Account → API keys) |
| GET | `/api/alpaca/positions` | JWT | Open Alpaca positions |
| GET | `/api/alpaca/orders` | JWT | List Alpaca orders |
| POST | `/api/alpaca/orders` | JWT | Place Alpaca paper order |
| DELETE | `/api/alpaca/orders/:orderId` | JWT | Cancel Alpaca order |
| GET | `/api/alpaca/portfolio/history` | JWT | Alpaca portfolio history |
| GET | `/api/alpaca/watchlists` | JWT | Alpaca watchlists |
| GET | `/api/alpaca/assets` | JWT | Tradable Alpaca assets |
| GET | `/api/finnhub/quote/:symbol` | JWT | Finnhub real-time quote — Requires Finnhub API key (Account → API keys) |
| GET | `/api/finnhub/company/:symbol` | JWT | Finnhub company profile |
| GET | `/api/finnhub/news/:symbol` | JWT | Finnhub company news |
| GET | `/api/finnhub/news` | JWT | Finnhub general market news |
| GET | `/api/finnhub/search` | JWT | Finnhub symbol search — Query: q |
| GET | `/api/finnhub/financials/:symbol` | JWT | Finnhub financial statements |
| GET | `/api/finnhub/recommendations/:symbol` | JWT | Analyst recommendations |
| GET | `/api/finnhub/earnings/:symbol` | JWT | Earnings calendar for symbol |
| GET | `/api/alphavantage/quote/:symbol` | JWT | Alpha Vantage quote — Requires Alpha Vantage API key (Account → API keys) |
| GET | `/api/alphavantage/overview/:symbol` | JWT | Alpha Vantage company overview |
| GET | `/api/alphavantage/timeseries/:symbol` | JWT | Alpha Vantage time series |
| GET | `/api/alphavantage/search` | JWT | Alpha Vantage symbol search — Query: keywords |
| GET | `/api/alphavantage/movers` | JWT | Alpha Vantage top movers |
| GET | `/api/user/profile` | JWT | Get user profile |
| PUT | `/api/user/profile` | JWT | Update user profile |
| GET | `/api/user/settings` | JWT | Get user settings |
| PUT | `/api/user/settings` | JWT | Update user settings |
| GET | `/api/user/integrations` | JWT | Integration status for current user (which services have DB keys) |
| GET | `/api/user/api-keys` | JWT | List stored API keys (masked) |
| POST | `/api/user/api-keys` | JWT | Add external API key |
| PUT | `/api/user/api-keys/:keyId` | JWT | Update API key |
| DELETE | `/api/user/api-keys/:keyId` | JWT | Delete API key |
| GET | `/api/user/security` | JWT | Security settings overview |
| POST | `/api/user/security/2fa/enable` | JWT | Enable two-factor authentication |
| POST | `/api/user/security/2fa/disable` | JWT | Disable two-factor authentication |
| PUT | `/api/user/change-password` | JWT | Change password |
| POST | `/api/user/send-verification` | JWT | Send email verification |
| POST | `/api/user/verify-email` | JWT | Verify email with code |
| POST | `/api/user/create-account` | JWT | Create account (extended registration flow) |
| POST | `/api/user/send-email-change-verification` | JWT | Send email change verification |
| POST | `/api/user/verify-email-change` | JWT | Confirm email change |
| POST | `/api/trading/initialize` | JWT | Initialize trading account for user |
| GET | `/api/trading/account` | JWT | Trading account snapshot |
| POST | `/api/trading/sync` | JWT | Sync balances from broker |
| POST | `/api/trading/sync-orders` | JWT | Sync orders from broker |
| POST | `/api/trading/orders` | JWT | Place internal/paper trade order |
| GET | `/api/trading/risk-settings` | JWT | Get risk management settings |
| PUT | `/api/trading/risk-settings` | JWT | Update risk management settings |
| DELETE | `/api/trading/orders/:orderId` | JWT | Cancel order |
| GET | `/api/trading/history` | JWT | Trade history |
| GET | `/api/trading/stats` | JWT | Trading statistics |
| GET | `/api/trading/positions` | JWT | Open trading positions |
| POST | `/api/trading/positions/:symbol/close` | JWT | Close position for symbol |
| GET | `/api/trading/environment` | JWT | Trading environment (paper/live) |
| GET | `/api/trading/executions` | JWT | Order executions |
| GET | `/api/trading/sessions` | JWT | Trading sessions |
| GET | `/api/trading/orders` | JWT | List orders |
| GET | `/api/trading/health` | JWT | Trading subsystem health |
| GET | `/api/data/quote/:symbol` | JWT | Aggregated quote for symbol |
| POST | `/api/data/quotes` | JWT | Bulk quotes (max 50 symbols) |
| GET | `/api/data/historical/:symbol` | JWT | Historical OHLCV data |
| GET | `/api/data/news` | JWT | Aggregated news feed |
| GET | `/api/data/sentiment/reddit` | JWT | Reddit sentiment snapshot |
| GET | `/api/data/trading/sync` | JWT | Trigger trading data sync |
| POST | `/api/data/portfolio/refresh` | JWT | Bulk refresh portfolio prices |
| GET | `/api/data/status` | JWT | Data services status |
| POST | `/api/data/maintenance` | JWT (admin) | Run data maintenance (admin) |
| GET | `/api/data/validate` | JWT | Validate data integrity |
| DELETE | `/api/data/cache/expired` | JWT (admin) | Purge expired cache entries (admin) |
| GET | `/api/data/analytics/usage` | JWT | API usage analytics |
| GET | `/api/data/scheduler/status` | JWT (admin) | Background scheduler status (admin) |
| POST | `/api/data/scheduler/trigger/market` | JWT (admin) | Trigger market data job (admin) |
| POST | `/api/data/scheduler/trigger/news` | JWT (admin) | Trigger news job (admin) |
| POST | `/api/data/scheduler/trigger/sentiment` | JWT (admin) | Trigger sentiment job (admin) |
| POST | `/api/data/scheduler/trigger/full` | JWT (admin) | Trigger full sync job (admin) |
| POST | `/api/data/scheduler/trigger/maintenance` | JWT (admin) | Trigger maintenance job (admin) |

## Example: login and list portfolio

```bash
curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@demo.com","password":"Demo1234!"}'

# Use accessToken from response:
curl -s http://localhost:3001/api/portfolio \
  -H "Authorization: Bearer <accessToken>"
```

## Integrations & paper trading

- **Paper trading only** — Alpaca routes target the paper API; see [INTEGRATIONS.md](INTEGRATIONS.md#paper-trading-only-current-setup).
- **Per-user keys** — `GET /api/user/integrations` returns `canUseAlpaca`, `canManageReddit`, `canFetchNews`.
- **Shared read-only data** — Reddit/News GET routes use stored PostgreSQL data without the caller’s provider keys; `POST /api/reddit/fetch`, `POST /api/news/refresh`, etc. require the caller’s keys in `user_api_keys`.

## HTTP status codes

**200**, **201**, **400**, **401**, **403**, **404**, **422**, **500**

Missing integration keys often return **400** with `code: INTEGRATION_KEYS_MISSING`.
