# Inwest App

Investment platform (e-business project): dashboard, **paper-only trading** (Alpaca paper API), portfolio & watchlist, JWT authentication, and optional integrations (Reddit, news, market data).

- **Paper trading only** in the current setup — no live brokerage. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md#paper-trading-only-current-setup).
- Each user’s API keys are stored **encrypted in PostgreSQL**; new users without keys see prompts on Trading, while Reddit/News show **shared** stored data without fetch buttons. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md#credentials-env-vs-per-user-keys).

## Screenshots

### Dashboard

![Dashboard overview](docs/screenshots/dashboard1.png)

![Dashboard — portfolio and watchlist](docs/screenshots/dashboard2.png)

### Paper trading

![Trading — place orders](docs/screenshots/trading.png)

![Trading — order history](docs/screenshots/trading-history.png)

### Market data

![Market data overview](docs/screenshots/market-data-overview.png)

### News & sentiment

![News feed](docs/screenshots/news-feed.png)

![News sentiment analysis](docs/screenshots/news-sentiment.png)

### Reddit sentiment

![Reddit feed](docs/screenshots/reddit-feed.png)

![Reddit sentiment analysis](docs/screenshots/reddit-sentiment.png)

### Account settings

![API keys and integrations](docs/screenshots/api-settings.png)

## Getting started

```bash
git clone https://github.com/karolsowi/ebiz-proj.git
cd ebiz-proj
docker compose up --build
```

| | URL |
|---|-----|
| App | http://localhost:5175 |
| API / Swagger | http://localhost:3001/api/docs |
| Demo account | `demo@demo.com` / `Demo1234!` |

**Full documentation:** [docs/README.md](docs/README.md) (setup, API, architecture, integrations).

## At a glance

- `npm test` — backend tests
- `npm run docs:api` — regenerate [docs/API.md](docs/API.md)

## License

[LICENSE.md](LICENSE.md).
