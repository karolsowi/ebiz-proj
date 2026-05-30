import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validate } from '../middleware/validate.js';
import { watchlistController } from '../controllers/watchlistController.js';
import {
  createWatchlistSchema,
  updateWatchlistSchema,
  watchlistIdParamSchema,
} from '../validation/watchlistSchemas.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(watchlistController.list));
router.get('/:id', validate(watchlistIdParamSchema, 'params'), asyncHandler(watchlistController.getOne));
router.post('/', validate(createWatchlistSchema), asyncHandler(watchlistController.create));
router.put(
  '/:id',
  validate(watchlistIdParamSchema, 'params'),
  validate(updateWatchlistSchema),
  asyncHandler(watchlistController.update)
);
router.delete(
  '/:id',
  validate(watchlistIdParamSchema, 'params'),
  asyncHandler(watchlistController.remove)
);

export default router;
