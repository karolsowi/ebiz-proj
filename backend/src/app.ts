import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import portfolioRouter from './api/portfolioRoutes.js';
import watchlistRouter from './api/watchlistRoutes.js';
import { authRouter } from './api/authRoutes.js';
import { calendarRouter } from './api/calendarRoutes.js';
import { marketRouter } from './api/marketRoutes.js';
import { redditRouter } from './api/redditRoutes.js';
import { newsRouter } from './api/newsRoutes.js';
import { alpacaRouter } from './api/alpacaRoutes.js';
import { finnhubRouter } from './api/finnhubRoutes.js';
import { alphaVantageRouter } from './api/alphaVantageRoutes.js';
import userRouter from './api/userRoutes.js';
import tradingRouter from './api/tradingRoutes.js';
import enhancedDataRouter from './api/enhancedDataRoutes.js';
import technicalRouter from './api/technicalRoutes.js';
import { openApiSpec } from './openapi/spec.js';
import { errorMiddleware } from './middleware/errorMiddleware.js';
import { logger } from './services/logger.js';

export function createApp() {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === 'production',
      crossOriginEmbedderPolicy: false,
    })
  );

  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
    : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];

  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      optionsSuccessStatus: 200,
    })
  );

  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res) => {
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req) => `${req.method} ${req.url} completed`,
    })
  );

  app.use(
    rateLimit({
      windowMs: 5 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests — please try again later.' },
    })
  );

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth attempts — please try again later.' },
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.use('/api/auth', authLimiter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
  });

  app.get('/api', (_req, res) => {
    res.json({
      message: 'Inwest App Backend API',
      docs: '/api/docs',
      demoUser: 'demo@demo.com',
      integrations: ['reddit', 'news', 'alpaca', 'market', 'finnhub', 'alphavantage'],
    });
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  app.get('/api/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });

  // Core e-business demo
  app.use('/api/auth', authRouter);
  app.use('/api/portfolio', portfolioRouter);
  app.use('/api/watchlist', watchlistRouter);
  app.use('/api/calendar', calendarRouter);

  // Market data & external integrations (JWT required)
  app.use('/api/market', marketRouter);
  app.use('/api/technical', technicalRouter);
  app.use('/api/reddit', redditRouter);
  app.use('/api/news', newsRouter);
  app.use('/api/alpaca', alpacaRouter);
  app.use('/api/finnhub', finnhubRouter);
  app.use('/api/alphavantage', alphaVantageRouter);
  app.use('/api/user', userRouter);
  app.use('/api/trading', tradingRouter);
  app.use('/api/data', enhancedDataRouter);

  app.use(errorMiddleware);

  app.use('*', (_req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  return app;
}
