export class PoolAbortError extends Error {
  constructor(message = 'Pool aborted') {
    super(message);
    this.name = 'PoolAbortError';
  }
}

/** Run async tasks with a fixed concurrency limit (no extra dependencies). */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  options?: { shouldAbort?: () => boolean | Promise<boolean> }
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      if (options?.shouldAbort && (await options.shouldAbort())) {
        throw new PoolAbortError();
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}
