import { describe, expect, it } from 'vitest';
import { getEasternWallClock, shouldSkipAfterHoursMarketDataPoll } from './usMarketTime.js';

describe('usMarketTime', () => {
  it('maps a fixed instant to Eastern hour/weekday deterministically', () => {
    // 2026-06-03 14:30 UTC → 10:30 EDT (Wed)
    const d = new Date('2026-06-03T14:30:00.000Z');
    const { weekday, hour } = getEasternWallClock(d);
    expect(weekday).toBe(3); // Wed
    expect(hour).toBe(10);
  });

  it('does not skip after-hours poll outside Mon–Fri 9–16 ET', () => {
    expect(shouldSkipAfterHoursMarketDataPoll(new Date('2026-06-06T14:30:00.000Z'))).toBe(false); // Sat
  });

  it('skips during weekday 9–16 ET window', () => {
    expect(shouldSkipAfterHoursMarketDataPoll(new Date('2026-06-03T14:30:00.000Z'))).toBe(true); // Wed 10:30 ET
  });
});
