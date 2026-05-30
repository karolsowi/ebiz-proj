import { routeCatalog } from './routeCatalog.js';
import { buildPathsFromCatalog } from './buildPaths.js';

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Inwest App API',
    version: '1.0.0',
    description:
      'Investment portfolio e-business API (coursework levels 3–5). ' +
      'Authenticate with JWT Bearer from POST /api/auth/login. ' +
      `This document lists all ${routeCatalog.length} mounted endpoints. ` +
      'Interactive docs: /api/docs · JSON spec: /api/openapi.json',
  },
  servers: [{ url: 'http://localhost:3001', description: 'Local development (Docker or npm run dev)' }],
  tags: [
    { name: 'System', description: 'Health and API index' },
    { name: 'Auth', description: 'Registration, login, tokens' },
    { name: 'Portfolio', description: 'Core e-business — holdings CRUD' },
    { name: 'Watchlist', description: 'Core e-business — watchlist CRUD' },
    { name: 'Calendar', description: 'Personal reminders' },
    { name: 'Market', description: 'Market data and seeded prices' },
    { name: 'Reddit', description: 'Reddit sentiment (API keys optional)' },
    { name: 'News', description: 'News sentiment (API keys optional)' },
    { name: 'Alpaca', description: 'Paper trading via Alpaca' },
    { name: 'Finnhub', description: 'Finnhub proxy' },
    { name: 'Alpha Vantage', description: 'Alpha Vantage proxy' },
    { name: 'User', description: 'Profile, settings, API keys' },
    { name: 'Trading', description: 'Internal trading sync and orders' },
    { name: 'Data', description: 'Aggregated data and scheduler (admin)' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          details: { type: 'object' },
        },
      },
      PortfolioEntry: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          symbol: { type: 'string', example: 'AAPL' },
          quantity: { type: 'string', example: '10' },
          averageCost: { type: 'string', example: '150.25' },
          assetType: { type: 'string', example: 'stock' },
        },
      },
      WatchlistEntry: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          symbol: { type: 'string', example: 'MSFT' },
          name: { type: 'string' },
          notes: { type: 'string' },
        },
      },
    },
  },
  paths: buildPathsFromCatalog(routeCatalog),
};
