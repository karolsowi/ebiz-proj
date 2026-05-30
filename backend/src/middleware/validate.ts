import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

type RequestTarget = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, target: RequestTarget = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      next(result.error);
      return;
    }
    req[target] = result.data;
    next();
  };
}
