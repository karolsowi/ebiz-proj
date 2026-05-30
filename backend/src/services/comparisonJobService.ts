import { EventEmitter } from 'events';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { strategyComparisonJobs } from '../db/schema.js';
import type {
  ComparisonJobCheckpoint,
  ComparisonJobProgress,
  ComparisonJobRecord,
  ComparisonJobStatus,
  ComparisonJobType,
} from './comparisonJobTypes.js';
import type { ComparisonConfig, StrategyComparisonReport } from './strategyComparison.js';
import type { BacktestStrategyName } from './strategyBacktester.js';
import { strategyMlStrategyService } from './strategyMlStrategyService.js';

export const comparisonJobEvents = new EventEmitter();
comparisonJobEvents.setMaxListeners(50);

function rowToRecord(row: typeof strategyComparisonJobs.$inferSelect): ComparisonJobRecord {
  return {
    id: row.id,
    jobType: row.jobType as ComparisonJobType,
    status: row.status as ComparisonJobStatus,
    requestConfig: row.requestConfig as ComparisonConfig,
    checkpoint: (row.checkpoint as ComparisonJobCheckpoint | null) ?? null,
    progress: (row.progress as ComparisonJobProgress | null) ?? null,
    result: (row.result as StrategyComparisonReport | null) ?? null,
    errorMessage: row.errorMessage,
    runIds: (row.runIds as Record<string, number> | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

export async function createComparisonJob(
  requestConfig: ComparisonConfig,
  jobType: ComparisonJobType = 'comparison'
): Promise<ComparisonJobRecord> {
  const [row] = await db
    .insert(strategyComparisonJobs)
    .values({
      jobType,
      status: 'queued',
      requestConfig: requestConfig as unknown as Record<string, unknown>,
    })
    .returning();
  return rowToRecord(row!);
}

export async function getComparisonJob(id: number): Promise<ComparisonJobRecord | null> {
  const [row] = await db
    .select()
    .from(strategyComparisonJobs)
    .where(eq(strategyComparisonJobs.id, id))
    .limit(1);
  return row ? rowToRecord(row) : null;
}

export async function listActiveComparisonJobs(): Promise<ComparisonJobRecord[]> {
  const rows = await db
    .select()
    .from(strategyComparisonJobs)
    .where(eq(strategyComparisonJobs.status, 'running'))
    .orderBy(desc(strategyComparisonJobs.updatedAt));
  return rows.map(rowToRecord);
}

export async function listResumableComparisonJobs(limit = 10): Promise<ComparisonJobRecord[]> {
  const rows = await db
    .select()
    .from(strategyComparisonJobs)
    .orderBy(desc(strategyComparisonJobs.updatedAt))
    .limit(limit);
  return rows
    .map(rowToRecord)
    .filter((j) => ['queued', 'running', 'paused'].includes(j.status));
}

async function patchJob(
  id: number,
  patch: Partial<typeof strategyComparisonJobs.$inferInsert>
): Promise<ComparisonJobRecord> {
  const [row] = await db
    .update(strategyComparisonJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(strategyComparisonJobs.id, id))
    .returning();
  if (!row) throw new Error(`Job ${id} not found`);
  return rowToRecord(row);
}

export async function setComparisonJobStatus(
  id: number,
  status: ComparisonJobStatus,
  extra?: Partial<typeof strategyComparisonJobs.$inferInsert>
): Promise<ComparisonJobRecord> {
  return patchJob(id, { status, ...extra });
}

export async function updateComparisonJobProgress(
  id: number,
  progress: ComparisonJobProgress
): Promise<void> {
  await patchJob(id, { progress: progress as unknown as Record<string, unknown> });
  comparisonJobEvents.emit(`progress:${id}`, progress);
}

export async function updateComparisonJobCheckpoint(
  id: number,
  checkpoint: ComparisonJobCheckpoint
): Promise<void> {
  await patchJob(id, { checkpoint: checkpoint as unknown as Record<string, unknown> });
}

export async function completeComparisonJob(
  id: number,
  result: StrategyComparisonReport,
  runIds: Record<string, number>
): Promise<ComparisonJobRecord> {
  const lightResult: Record<string, unknown> = { ...result };
  if (lightResult.results && typeof lightResult.results === 'object') {
    const lightResults: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(lightResult.results as Record<string, any>)) {
      lightResults[key] = {
        ...val,
        trades: `[${val.trades?.length ?? 0} trades — see strategy_backtest_trades]`,
        equityCurve: `[${val.equityCurve?.length ?? 0} points — see strategy_backtest_runs]`,
      };
    }
    lightResult.results = lightResults;
  }
  delete lightResult.benchmarkCurve;

  const job = await patchJob(id, {
    status: 'completed',
    result: lightResult as unknown as Record<string, unknown>,
    runIds: runIds as unknown as Record<string, unknown>,
    checkpoint: null,
    completedAt: new Date(),
    progress: {
      phase: 'complete',
      overallPct: 100,
      message: 'Comparison complete',
      updatedAt: new Date().toISOString(),
    } as unknown as Record<string, unknown>,
  });
  comparisonJobEvents.emit(`complete:${id}`, { result, runIds });
  return job;
}

export async function failComparisonJob(id: number, message: string): Promise<ComparisonJobRecord> {
  const job = await patchJob(id, {
    status: 'failed',
    errorMessage: message,
  });
  comparisonJobEvents.emit(`error:${id}`, message);
  return job;
}

export async function pauseComparisonJob(id: number): Promise<ComparisonJobRecord> {
  const job = await getComparisonJob(id);
  if (!job) throw new Error(`Job ${id} not found`);
  if (job.status === 'paused') return job;
  if (!['running', 'queued'].includes(job.status)) {
    throw new Error(`Job ${id} is ${job.status} and cannot be paused`);
  }
  return setComparisonJobStatus(id, 'paused');
}

export interface ComparisonJobResumeOptions {
  config?: Partial<ComparisonConfig>;
  restartStrategies?: BacktestStrategyName[];
}

export async function prepareComparisonJobResume(
  id: number,
  options?: ComparisonJobResumeOptions
): Promise<ComparisonJobRecord> {
  const job = await getComparisonJob(id);
  if (!job) throw new Error(`Job ${id} not found`);
  if (job.status !== 'paused' && job.status !== 'queued') {
    throw new Error(`Job ${id} is ${job.status} and cannot be resumed`);
  }

  let requestConfig = job.requestConfig;
  let checkpoint = job.checkpoint;

  if (options?.config) {
    requestConfig = {
      ...requestConfig,
      ...options.config,
      ...(options.config.mlConfig
        ? { mlConfig: { ...requestConfig.mlConfig, ...options.config.mlConfig } }
        : {}),
    };
  }

  const restartStrategies = options?.restartStrategies ?? options?.config?.restartStrategies ?? [];
  if (restartStrategies.length > 0) {
    const touchesMl = restartStrategies.some(
      (s) => s === 'ml_baseline' || s === 'hybrid_baseline'
    );
    if (touchesMl) {
      strategyMlStrategyService.clearModelCache();
    }
    if (checkpoint) {
      const inFlightResumes = { ...(checkpoint.inFlightResumes ?? {}) };
      for (const strategy of restartStrategies) {
        delete inFlightResumes[strategy];
      }
      checkpoint = { ...checkpoint, inFlightResumes };
    }
    requestConfig = { ...requestConfig, restartStrategies };
  }

  const patches: Partial<typeof strategyComparisonJobs.$inferInsert> = { requestConfig: requestConfig as unknown as Record<string, unknown> };
  if (checkpoint !== job.checkpoint) {
    patches.checkpoint = checkpoint as unknown as Record<string, unknown>;
  }
  return patchJob(id, patches);
}

export async function resumeComparisonJob(
  id: number,
  options?: ComparisonJobResumeOptions
): Promise<ComparisonJobRecord> {
  const job = await prepareComparisonJobResume(id, options);
  return setComparisonJobStatus(id, 'running', { startedAt: job.startedAt ?? new Date() });
}

export async function cancelComparisonJob(id: number): Promise<ComparisonJobRecord> {
  const job = await setComparisonJobStatus(id, 'cancelled');
  comparisonJobEvents.emit(`cancel:${id}`);
  return job;
}

export async function isComparisonJobPausedOrCancelled(id: number): Promise<boolean> {
  const job = await getComparisonJob(id);
  return job?.status === 'paused' || job?.status === 'cancelled';
}
