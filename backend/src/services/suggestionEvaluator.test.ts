import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeEvaluationTargetDate,
  SuggestionEvaluator,
} from './suggestionEvaluator.js';
import { priceService } from './databaseService.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function makePendingSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    symbol: 'AAPL',
    generatedAt: new Date('2023-01-06T15:30:00.000Z'),
    horizonDays: 5,
    entryPrice: '100.00000000',
    signal: 'buy',
    ...overrides,
  };
}

describe('computeEvaluationTargetDate', () => {
  it('adds horizon days from the generated day start in UTC', () => {
    const target = computeEvaluationTargetDate(
      new Date('2023-01-06T15:30:00.000Z'),
      5
    );

    expect(target.toISOString()).toBe('2023-01-11T00:00:00.000Z');
  });

  it('preserves a weekend target so price lookup can fall forward to the next trading day', () => {
    const target = computeEvaluationTargetDate(
      new Date('2023-01-02T18:45:00.000Z'),
      5
    );

    expect(target.toISOString()).toBe('2023-01-07T00:00:00.000Z');
  });
});

describe('SuggestionEvaluator', () => {
  it('evaluates using the first price on or after the horizon date', async () => {
    const evaluator = new SuggestionEvaluator() as any;
    evaluator.fetchPending = vi.fn().mockResolvedValue([makePendingSuggestion()]);
    evaluator.writeEvaluation = vi.fn().mockResolvedValue(undefined);

    const priceSpy = vi.spyOn(priceService, 'getPriceOnOrAfter').mockResolvedValue([
      { close: '110.00000000' },
    ] as any);

    const result = await evaluator.evaluatePending();

    expect(result).toEqual({ checked: 1, evaluated: 1, skipped: 0 });
    expect(priceSpy).toHaveBeenCalledTimes(1);
    expect(priceSpy.mock.calls[0]![0]).toBe('AAPL');
    expect(priceSpy.mock.calls[0]![1].toISOString()).toBe('2023-01-11T00:00:00.000Z');
    expect(priceSpy.mock.calls[0]![2]).toBe('daily');
    expect(priceSpy.mock.calls[0]![3]).toBe(5);
    expect(evaluator.writeEvaluation).toHaveBeenCalledWith(1, 110, 10, true);
  });

  it('skips suggestions when no price is available in the lookahead window', async () => {
    const evaluator = new SuggestionEvaluator() as any;
    evaluator.fetchPending = vi.fn().mockResolvedValue([
      makePendingSuggestion({
        symbol: 'MSFT',
        generatedAt: new Date('2023-01-02T18:45:00.000Z'),
      }),
    ]);
    evaluator.writeEvaluation = vi.fn().mockResolvedValue(undefined);

    const priceSpy = vi.spyOn(priceService, 'getPriceOnOrAfter').mockResolvedValue([]);

    const result = await evaluator.evaluatePending();

    expect(result).toEqual({ checked: 1, evaluated: 0, skipped: 1 });
    expect(priceSpy.mock.calls[0]![1].toISOString()).toBe('2023-01-07T00:00:00.000Z');
    expect(evaluator.writeEvaluation).not.toHaveBeenCalled();
  });
});
