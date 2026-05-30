import type { Request, Response } from 'express';
import { portfolioService } from '../services/portfolioService.js';
import { BadRequestError, NotFoundError } from '../errors/AppError.js';

function uid(req: Request): string {
  return req.user!.userId;
}

export const portfolioController = {
  async list(req: Request, res: Response): Promise<void> {
    const entries = await portfolioService.getPortfolioEntries(uid(req));
    res.json(entries);
  },

  async summary(req: Request, res: Response): Promise<void> {
    const summary = await portfolioService.getPortfolioSummary(uid(req));
    res.json(summary);
  },

  async create(req: Request, res: Response): Promise<void> {
    const newEntry = await portfolioService.addPortfolioEntry(req.body, uid(req));
    res.status(201).json(newEntry);
  },

  async update(req: Request, res: Response): Promise<void> {
    const id = req.params.id as unknown as number;
    try {
      const updated = await portfolioService.updatePortfolioEntry(id, req.body, uid(req));
      res.json(updated);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundError(error.message);
      }
      throw error;
    }
  },

  async remove(req: Request, res: Response): Promise<void> {
    const id = req.params.id as unknown as number;
    try {
      const result = await portfolioService.deletePortfolioEntry(id, uid(req));
      res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundError(error.message);
      }
      throw error;
    }
  },

  async refreshPrices(req: Request, res: Response): Promise<void> {
    const result = await portfolioService.refreshPortfolioPrices(uid(req));
    res.json(result);
  },
};

export function parsePortfolioId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestError('Invalid portfolio entry id');
  }
  return id;
}
