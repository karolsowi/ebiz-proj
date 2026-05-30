/** US/Eastern helpers for cron callbacks (avoid using server-local `Date#getHours`). */

const EASTERN_TZ = 'America/New_York';

const WEEKDAY_SHORT_TO_NUM: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Weekday 0 = Sunday … 6 = Saturday; hour = 0–23 in America/New_York. */
export function getEasternWallClock(now: Date = new Date()): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TZ,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);

  let hour = 0;
  let wk: keyof typeof WEEKDAY_SHORT_TO_NUM | undefined;
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10);
    if (p.type === 'weekday') wk = p.value as keyof typeof WEEKDAY_SHORT_TO_NUM;
  }
  const weekday = wk !== undefined ? (WEEKDAY_SHORT_TO_NUM[wk] ?? 0) : 0;
  return { weekday, hour };
}

/**
 * After-hours cron runs every clock hour ET; skip duplicates while the weekday
 * market-hours job (every five minutes, 9–16 ET) is responsible.
 */
export function shouldSkipAfterHoursMarketDataPoll(now: Date = new Date()): boolean {
  const { weekday, hour } = getEasternWallClock(now);
  return weekday >= 1 && weekday <= 5 && hour >= 9 && hour <= 16;
}
