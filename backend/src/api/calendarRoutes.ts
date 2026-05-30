import { Router, Request, Response } from 'express';
import { calendarService, CalendarEventType } from '../services/calendarService.js';
import { requireAuth } from '../middleware/authMiddleware.js';

export const calendarRouter = Router();

function parseTypes(rawTypes?: string): CalendarEventType[] | undefined {
  if (!rawTypes) return undefined;
  const parsed = rawTypes
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean) as CalendarEventType[];
  return parsed.length > 0 ? parsed : undefined;
}

const validTypes = new Set<CalendarEventType>(['earnings', 'holiday', 'economic', 'personal']);

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidSymbol(value: string): boolean {
  return /^[A-Z0-9.-]{1,10}$/.test(value);
}

calendarRouter.get('/events', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to, symbols, types } = req.query as {
      from?: string;
      to?: string;
      symbols?: string;
      types?: string;
    };

    if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) {
      res.status(400).json({ error: 'from and to query parameters are required in YYYY-MM-DD format' });
      return;
    }
    if (new Date(from) > new Date(to)) {
      res.status(400).json({ error: 'from must be before or equal to to' });
      return;
    }

    const symbolsList = symbols
      ? symbols.split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
      : undefined;
    if (symbolsList && symbolsList.some((symbol) => !isValidSymbol(symbol))) {
      res.status(400).json({ error: 'Invalid symbol provided' });
      return;
    }
    const typesList = parseTypes(types);
    if (typesList && typesList.some((type) => !validTypes.has(type))) {
      res.status(400).json({ error: 'Invalid type provided' });
      return;
    }

    const events = await calendarService.getEvents({
      userId: req.user!.userId,
      from,
      to,
      ...(symbolsList ? { symbols: symbolsList } : {}),
      ...(typesList ? { types: typesList } : {}),
    });

    res.json({ events });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch calendar events',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

calendarRouter.post('/reminders', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { title, start, end, description, allDay } = req.body as {
    title?: string;
    start?: string;
    end?: string;
    description?: string;
    allDay?: boolean;
  };

  if (!title || !start || !isIsoDate(start)) {
    res.status(400).json({ error: 'title and start (YYYY-MM-DD) are required' });
    return;
  }
  const normalizedTitle = title.trim();
  if (!normalizedTitle || normalizedTitle.length > 255) {
    res.status(400).json({ error: 'title must be between 1 and 255 characters' });
    return;
  }
  if (end && !isIsoDate(end)) {
    res.status(400).json({ error: 'end must be YYYY-MM-DD when provided' });
    return;
  }
  if (end && new Date(start) > new Date(end)) {
    res.status(400).json({ error: 'start must be before or equal to end' });
    return;
  }

  const actorId = req.user?.userId;
  if (!actorId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const reminder = await calendarService.createReminder({
    title: normalizedTitle,
    start,
    ...(end ? { end } : {}),
    ...(description ? { description } : {}),
    ...(typeof allDay === 'boolean' ? { allDay } : {}),
    createdBy: actorId,
  });
  res.status(201).json(reminder);
});

calendarRouter.put('/reminders/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { title, start, end, description, allDay } = req.body as {
    title?: string;
    start?: string;
    end?: string;
    description?: string;
    allDay?: boolean;
  };

  if (!id || !title || !start || !isIsoDate(start)) {
    res.status(400).json({ error: 'id, title and start (YYYY-MM-DD) are required' });
    return;
  }
  const normalizedTitle = title.trim();
  if (!normalizedTitle || normalizedTitle.length > 255) {
    res.status(400).json({ error: 'title must be between 1 and 255 characters' });
    return;
  }
  if (end && !isIsoDate(end)) {
    res.status(400).json({ error: 'end must be YYYY-MM-DD when provided' });
    return;
  }
  if (end && new Date(start) > new Date(end)) {
    res.status(400).json({ error: 'start must be before or equal to end' });
    return;
  }
  const actorId = req.user?.userId;
  if (!actorId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const reminder = await calendarService.updateReminder(id, {
    title: normalizedTitle,
    start,
    ...(end ? { end } : {}),
    ...(description ? { description } : {}),
    ...(typeof allDay === 'boolean' ? { allDay } : {}),
    createdBy: actorId,
  });
  if (!reminder) {
    res.status(404).json({ error: 'Reminder not found' });
    return;
  }

  res.json(reminder);
});

calendarRouter.delete('/reminders/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  const actorId = req.user?.userId;
  if (!actorId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const deleted = await calendarService.deleteReminder(id, actorId);
  if (!deleted) {
    res.status(404).json({ error: 'Reminder not found' });
    return;
  }

  res.json({ success: true });
});
