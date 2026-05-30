import type { Request, Response } from 'express';
import { watchlistService } from '../services/watchlistService.js';
import { NotFoundError } from '../errors/AppError.js';

function uid(req: Request): string {
  return req.user!.userId;
}

export const watchlistController = {
  async list(req: Request, res: Response): Promise<void> {
    const items = await watchlistService.getWatchlist(uid(req));
    res.json(items);
  },

  async getOne(req: Request, res: Response): Promise<void> {
    const id = req.params.id as unknown as number;
    const item = await watchlistService.getById(uid(req), id);
    if (!item) {
      throw new NotFoundError('Watchlist entry not found');
    }
    res.json(item);
  },

  async create(req: Request, res: Response): Promise<void> {
    const item = await watchlistService.addEntry(uid(req), req.body);
    res.status(201).json(item);
  },

  async update(req: Request, res: Response): Promise<void> {
    const id = req.params.id as unknown as number;
    const item = await watchlistService.updateById(uid(req), id, req.body);
    if (!item) {
      throw new NotFoundError('Watchlist entry not found');
    }
    res.json(item);
  },

  async remove(req: Request, res: Response): Promise<void> {
    const id = req.params.id as unknown as number;
    const item = await watchlistService.deleteById(uid(req), id);
    if (!item) {
      throw new NotFoundError('Watchlist entry not found');
    }
    res.json({ message: 'Watchlist entry deleted', id: item.id });
  },
};
