import { z } from 'zod';

export const createWatchlistSchema = z.object({
  symbol: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
  name: z.string().max(255).optional(),
  notes: z.string().optional(),
  alertPrice: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined ? undefined : String(v))),
  alertEnabled: z.boolean().optional(),
});

export const updateWatchlistSchema = z.object({
  name: z.string().max(255).optional(),
  notes: z.string().optional(),
  alertPrice: z.union([z.string(), z.number()]).nullable().optional().transform((v) => (v === undefined ? undefined : v === null ? null : String(v))),
  alertEnabled: z.boolean().optional(),
});

export const watchlistIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
