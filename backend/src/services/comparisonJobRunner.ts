import { strategyComparison, type ComparisonProgressEvent } from './strategyComparison.js';
import {
  cancelComparisonJob,
  completeComparisonJob,
  failComparisonJob,
  getComparisonJob,
  isComparisonJobPausedOrCancelled,
  pauseComparisonJob,
  resumeComparisonJob,
  setComparisonJobStatus,
  updateComparisonJobCheckpoint,
  updateComparisonJobProgress,
} from './comparisonJobService.js';
import { ComparisonPausedError } from './comparisonJobTypes.js';
import { persistComparisonReport } from './comparisonReportPersistence.js';
import { normalizeComparisonConfig } from './comparisonConfigNormalizer.js';

const runningWorkers = new Set<number>();

export function isComparisonJobWorkerActive(jobId: number): boolean {
  return runningWorkers.has(jobId);
}

export function startComparisonJobWorker(jobId: number): void {
  if (runningWorkers.has(jobId)) return;
  runningWorkers.add(jobId);
  setImmediate(() => {
    void executeComparisonJob(jobId).finally(() => {
      runningWorkers.delete(jobId);
    });
  });
}

export async function executeComparisonJob(jobId: number): Promise<void> {
  let job = await getComparisonJob(jobId);
  if (!job) return;

  if (['completed', 'failed', 'cancelled'].includes(job.status)) return;

  if (job.status === 'paused') {
    await resumeComparisonJob(jobId);
  } else if (job.status === 'queued') {
    await setComparisonJobStatus(jobId, 'running', { startedAt: new Date() });
  }

  job = (await getComparisonJob(jobId))!;
  const fullConfig = normalizeComparisonConfig(job.requestConfig);

  console.log(
    `Comparison job #${jobId}: strategyParallelism=${fullConfig.strategyParallelism} ` +
      `symbolParallelism=${fullConfig.symbolParallelism} ` +
      `(${fullConfig.symbols?.length ?? 0} symbols)`
  );

  fullConfig.onProgress = (event: ComparisonProgressEvent) => {
    void updateComparisonJobProgress(jobId, {
      ...event,
      updatedAt: new Date().toISOString(),
    });
  };

  try {
    const report = await strategyComparison.compareStrategies(fullConfig, {
      checkpoint: job.checkpoint,
      shouldPause: () => isComparisonJobPausedOrCancelled(jobId),
      onCheckpoint: (checkpoint) => updateComparisonJobCheckpoint(jobId, checkpoint),
    });

    const runIds = await persistComparisonReport(report);
    await completeComparisonJob(jobId, report, runIds);
  } catch (err) {
    if (err instanceof ComparisonPausedError) {
      await updateComparisonJobCheckpoint(jobId, err.checkpoint);
      const jobNow = await getComparisonJob(jobId);
      if (jobNow?.status === 'cancelled') return;
      await setComparisonJobStatus(jobId, 'paused');
      return;
    }
    const jobNow = await getComparisonJob(jobId);
    if (jobNow?.status === 'cancelled') return;
    await failComparisonJob(jobId, err instanceof Error ? err.message : String(err));
  }
}

export async function pauseComparisonJobWorker(jobId: number): Promise<void> {
  await pauseComparisonJob(jobId);
}

export async function resumeComparisonJobWorker(
  jobId: number,
  options?: import('./comparisonJobService.js').ComparisonJobResumeOptions
): Promise<void> {
  await resumeComparisonJob(jobId, options);
  startComparisonJobWorker(jobId);
}

export async function cancelComparisonJobWorker(jobId: number): Promise<void> {
  await cancelComparisonJob(jobId);
}
