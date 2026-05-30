import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, ValidationError } from '../errors/AppError.js';
import { logger } from '../services/logger.js';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    const validationErr = new ValidationError('Validation failed', err.flatten());
    res.status(validationErr.statusCode).json({
      error: validationErr.message,
      details: validationErr.details,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  if (err.message?.includes('not found')) {
    res.status(404).json({ error: err.message });
    return;
  }

  logger.error({ err, method: req.method, url: req.url }, 'Unhandled error');
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
}
