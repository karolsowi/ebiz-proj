import { z } from 'zod';

export const createPortfolioSchema = z.object({
  symbol: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
  name: z.string().max(255).optional(),
  quantity: z.union([z.string(), z.number()]).transform(String),
  averageCost: z.union([z.string(), z.number()]).transform(String),
  currentPrice: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined ? undefined : String(v))),
  assetType: z.enum(['stock', 'crypto', 'etf', 'bond']).default('stock'),
  source: z.string().max(50).optional(),
  notes: z.string().optional(),
  sector: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
});

export const updatePortfolioSchema = z.object({
  quantity: z.union([z.string(), z.number()]).transform(String).optional(),
  averageCost: z.union([z.string(), z.number()]).transform(String).optional(),
  currentPrice: z.union([z.string(), z.number()]).transform(String).optional(),
  notes: z.string().optional(),
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
