import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validate } from '../middleware/validate.js';
import { portfolioController } from '../controllers/portfolioController.js';
import {
  createPortfolioSchema,
  updatePortfolioSchema,
  idParamSchema,
} from '../validation/portfolioSchemas.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(portfolioController.list));
router.get('/summary', asyncHandler(portfolioController.summary));
router.post('/refresh-prices', asyncHandler(portfolioController.refreshPrices));
router.post('/', validate(createPortfolioSchema), asyncHandler(portfolioController.create));
router.put(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updatePortfolioSchema),
  asyncHandler(portfolioController.update)
);
router.delete(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(portfolioController.remove)
);

export default router;
