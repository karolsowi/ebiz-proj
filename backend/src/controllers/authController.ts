import type { Request, Response } from 'express';
import { authService } from '../services/authService.js';
import { NotFoundError } from '../errors/AppError.js';

function getMeta(req: Request): { userAgent?: string; ipAddress?: string } {
  const ua = req.headers['user-agent'];
  const ip = (req.ip ?? req.socket.remoteAddress ?? '').replace('::ffff:', '');
  return {
    ...(ua ? { userAgent: ua } : {}),
    ...(ip ? { ipAddress: ip } : {}),
  };
}

export const authController = {
  async register(req: Request, res: Response): Promise<void> {
    try {
      const result = await authService.register(req.body, getMeta(req));
      res.status(201).json(result);
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      res.status(err?.status ?? 400).json({
        error: error instanceof Error ? error.message : 'Registration failed',
      });
    }
  },

  async login(req: Request, res: Response): Promise<void> {
    try {
      const result = await authService.login(
        { ...req.body, rememberMe: req.body.rememberMe === true },
        getMeta(req)
      );
      res.json(result);
    } catch (error: unknown) {
      const err = error as { status?: number };
      res.status(err?.status ?? 401).json({
        error: error instanceof Error ? error.message : 'Login failed',
      });
    }
  },

  async refresh(req: Request, res: Response): Promise<void> {
    try {
      const result = await authService.refresh(req.body.refreshToken, getMeta(req));
      res.json(result);
    } catch (error: unknown) {
      const err = error as { status?: number };
      res.status(err?.status ?? 401).json({
        error: error instanceof Error ? error.message : 'Token refresh failed',
      });
    }
  },

  async logout(req: Request, res: Response): Promise<void> {
    try {
      if (req.body.refreshToken) {
        await authService.logout(req.body.refreshToken);
      }
    } catch {
      // always succeed on logout
    }
    res.json({ success: true });
  },

  async me(req: Request, res: Response): Promise<void> {
    const user = await authService.getUser(req.user!.userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    res.json({ user });
  },
};
