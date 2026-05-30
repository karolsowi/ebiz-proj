import { NextFunction, Request, Response } from 'express';
import { authService } from '../services/authService.js';
import { AuthUser } from '../types/auth.js';

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing authorization token' });
      return;
    }

    const user = authService.verifyAccessToken(token);
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired authorization token' });
  }
}

export function requireRole(...allowedRoles: AuthUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = req.user?.role;
    if (!userRole) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!allowedRoles.includes(userRole)) {
      res.status(403).json({ error: 'Forbidden: insufficient role' });
      return;
    }

    next();
  };
}
