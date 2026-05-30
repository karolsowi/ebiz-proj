import { db } from '../db/connection.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { strategySuggestions } from '../db/schema.js';
import { priceService } from './databaseService.js';

const MAX_EVALUATION_LOOKAHEAD_DAYS = 5;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
}

export function computeEvaluationTargetDate(
  generatedAt: Date,
  horizonDays: number
): Date {
  const target = startOfUtcDay(generatedAt);
  target.setUTCDate(target.getUTCDate() + Math.max(0, Math.floor(horizonDays)));
  return target;
}

export class SuggestionEvaluator {
  private async fetchPending(): Promise<(typeof strategySuggestions.$inferSelect)[]> {
    return db
      .select()
      .from(strategySuggestions)
      .where(
        and(
          isNull(strategySuggestions.evaluatedAt),
          sql`${strategySuggestions.generatedAt} +
            (${strategySuggestions.horizonDays}::text || ' days')::interval <= NOW()`
        )
      )
      .limit(100);
  }

  private async getEvaluationPrice(
    symbol: string,
    generatedAt: Date,
    horizonDays: number
  ): Promise<number | null> {
    const evaluationDate = computeEvaluationTargetDate(generatedAt, horizonDays);
    const rows = await priceService.getPriceOnOrAfter(
      symbol.toUpperCase(),
      evaluationDate,
      'daily',
      MAX_EVALUATION_LOOKAHEAD_DAYS
    );
    if (rows.length === 0) return null;

    const close = parseFloat(rows[0]!.close);
    return isNaN(close) ? null : close;
  }

  private computeReturn(
    entryPrice: string | null,
    currentPrice: number
  ): number | null {
    if (!entryPrice) return null;
    const entry = parseFloat(entryPrice);
    if (isNaN(entry) || entry <= 0) return null;
    const returnPct = (currentPrice - entry) / entry * 100;
    return parseFloat(returnPct.toFixed(4));
  }

  private isPredictionCorrect(
    signal: string,
    returnPct: number | null
  ): boolean | null {
    if (returnPct === null) return null;

    const isBullish = signal === 'strong_buy' || signal === 'buy';
    const isBearish = signal === 'strong_sell' || signal === 'sell';
    const isHold = signal === 'hold';

    if (isBullish) return returnPct > 0;
    if (isBearish) return returnPct < 0;
    if (isHold) return Math.abs(returnPct) < 2.0;
    return null;
  }

  private async writeEvaluation(
    id: number,
    currentPrice: number,
    actualReturnPct: number | null,
    predictionCorrect: boolean | null
  ): Promise<void> {
    await db
      .update(strategySuggestions)
      .set({
        evaluatedAt: new Date(),
        priceAtEvaluation: currentPrice.toFixed(8),
        actualReturnPct:
          actualReturnPct !== null ? actualReturnPct.toFixed(4) : null,
        predictionCorrect,
      })
      .where(eq(strategySuggestions.id, id));
  }

  async evaluatePending(): Promise<{
    checked: number;
    evaluated: number;
    skipped: number;
  }> {
    const counts = { checked: 0, evaluated: 0, skipped: 0 };

    const pending = await this.fetchPending();
    counts.checked = pending.length;

    for (const s of pending) {
      try {
        const currentPrice = await this.getEvaluationPrice(
          s.symbol,
          s.generatedAt,
          s.horizonDays
        );
        if (currentPrice === null) {
          counts.skipped++;
          continue;
        }

        const actualReturnPct = this.computeReturn(s.entryPrice, currentPrice);
        const predictionCorrect = this.isPredictionCorrect(s.signal, actualReturnPct);

        await this.writeEvaluation(s.id, currentPrice, actualReturnPct, predictionCorrect);
        counts.evaluated++;
      } catch (err) {
        console.error(`Evaluation failed for suggestion ${s.id} (${s.symbol}):`, err);
        counts.skipped++;
      }
    }

    return counts;
  }
}

export const suggestionEvaluator = new SuggestionEvaluator();
