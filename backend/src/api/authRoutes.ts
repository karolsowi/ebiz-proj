import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validate } from '../middleware/validate.js';
import { authController } from '../controllers/authController.js';
import { registerSchema, loginSchema, refreshSchema } from '../validation/authSchemas.js';

export const authRouter = Router();

authRouter.post('/register', validate(registerSchema), asyncHandler(authController.register));
authRouter.post('/login', validate(loginSchema), asyncHandler(authController.login));
authRouter.post('/refresh', validate(refreshSchema), asyncHandler(authController.refresh));
authRouter.post('/logout', asyncHandler(authController.logout));
authRouter.get('/me', requireAuth, asyncHandler(authController.me));

authRouter.get('/admin/ping', requireAuth, requireRole('admin'), (_req, res) => {
  res.json({ ok: true, message: 'Admin access confirmed' });
});
