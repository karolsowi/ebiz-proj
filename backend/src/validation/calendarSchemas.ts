import { z } from 'zod';

export const createReminderSchema = z.object({
  title: z.string().min(1).max(255),
  start: z.string().min(1),
  end: z.string().min(1).optional(),
  description: z.string().optional(),
  allDay: z.boolean().optional(),
});

export const updateReminderSchema = createReminderSchema.partial();

export const reminderIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
