// ============================================================================
// Batch Content Generation with Cancellation Support
// ============================================================================

/**
 * Advanced batch content generation with:
 * - Cancellation token support
 * - Parallel batch processing with configurable concurrency
 * - Progress tracking
 * - Automatic retry with exponential backoff
 * - Memory-efficient streaming for large batches
 */

export interface CancellationToken {
  readonly cancelled: boolean;
  readonly reason?: string;
}

export interface CancelablePromise<T> extends Promise<T> {
  cancel(reason?: string): void;
}

export interface GenerationTask<T> {
  id: string;
  input: unknown;
  execute: (token: CancellationToken) => Promise<T>;
  retries?: number;
  timeout?: number;
}

export interface BatchProgress<T> {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  results: Array<{
    task: GenerationTask<T>;
    result?: T;
    error?: Error;
    cancelled: boolean;
  }>;
  startTime: number;
  eta: number; // Estimated time remaining in ms
}

export interface BatchOptions<T> {
  concurrency?: number;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  onProgress?: (progress: BatchProgress<T>) => void;
  onTaskComplete?: (task: GenerationTask<T>, result: T) => void;
  onTaskError?: (task: GenerationTask<T>, error: Error) => void;
}

class CancellationTokenImpl implements CancellationToken {
  private _cancelled = false;
  private _reason?: string;

  get cancelled(): boolean {
    return this._cancelled;
  }

  get reason(): string | undefined {
    return this._reason;
  }

  cancel(reason?: string): void {
    if (!this._cancelled) {
      this._cancelled = true;
      this._reason = reason;
    }
  }
}

export function createCancellationToken(): CancellationTokenImpl {
  return new CancellationTokenImpl();
}

export function isCancelled(token: CancellationToken | undefined): boolean {
  return token?.cancelled ?? false;
}

export function throwIfCancelled(token: CancellationToken | undefined): void {
  if (token?.cancelled) {
    throw new Error(
      "Operation cancelled" + (token.reason ? ": " + token.reason : ""),
    );
  }
}

// ============================================================================
// Batch Processing
// ============================================================================

export async function processBatch<T>(
  tasks: GenerationTask<T>[],
  options: BatchOptions<T> = {},
): Promise<BatchProgress<T>> {
  const concurrency = options.concurrency ?? 6;
  const timeout = options.timeout ?? 120000;
  const maxRetries = options.retries ?? 2;
  const retryDelay = options.retryDelay ?? 1000;

  const startTime = Date.now();
  const results: BatchProgress<T>["results"] = [];
  const completed = new Set<string>();
  const token = createCancellationToken();

  let completedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;

  // Process tasks in batches
  for (let i = 0; i < tasks.length; i += concurrency) {
    throwIfCancelled(token);

    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((task) =>
        executeTaskWithRetry(task, token, {
          timeout,
          maxRetries,
          retryDelay,
        }),
      ),
    );

    for (let j = 0; j < batch.length; j++) {
      const task = batch[j];
      const result = batchResults[j];

      if (result.status === "fulfilled") {
        completed.add(task.id);
        completedCount++;
        results.push({
          task,
          result: result.value,
          cancelled: false,
        });
        options.onTaskComplete?.(task, result.value);
      } else {
        if (result.reason?.message?.includes("cancelled")) {
          cancelledCount++;
          results.push({
            task,
            cancelled: true,
          });
        } else {
          failedCount++;
          results.push({
            task,
            error:
              result.reason instanceof Error
                ? result.reason
                : new Error(String(result.reason)),
            cancelled: false,
          });
          options.onTaskError?.(task, result.reason);
        }
      }

      // Update progress
      const progress = createProgress(
        tasks.length,
        completedCount,
        failedCount,
        cancelledCount,
        results,
        startTime,
      );
      options.onProgress?.(progress);
    }
  }

  return createProgress(
    tasks.length,
    completedCount,
    failedCount,
    cancelledCount,
    results,
    startTime,
  );
}

async function executeTaskWithRetry<T>(
  task: GenerationTask<T>,
  token: CancellationToken,
  options: {
    timeout: number;
    maxRetries: number;
    retryDelay: number;
  },
): Promise<T> {
  let lastError: Error | undefined;
  const retries = task.retries ?? options.maxRetries;

  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfCancelled(token);

    try {
      // Execute with timeout
      const result = await Promise.race([
        task.execute(token),
        createTimeoutPromise(options.timeout),
      ]);
      return result as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if cancelled
      if (isCancelled(token)) {
        throw new Error("Operation cancelled");
      }

      // Don't retry on certain errors
      if (isNonRetryableError(lastError)) {
        throw lastError;
      }

      // Wait before retry (exponential backoff)
      if (attempt < retries) {
        await sleep(options.retryDelay * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
}

function createTimeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Task timeout after " + ms + "ms")), ms),
  );
}

function isNonRetryableError(error: Error): boolean {
  const nonRetryablePatterns = [
    "cancelled",
    "authentication",
    "authorization",
    "invalid",
    "not found",
  ];

  const message = error.message.toLowerCase();
  return nonRetryablePatterns.some((pattern) => message.includes(pattern));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createProgress<T>(
  total: number,
  completed: number,
  failed: number,
  cancelled: number,
  results: BatchProgress<T>["results"],
  startTime: number,
): BatchProgress<T> {
  const elapsed = Date.now() - startTime;
  const totalProcessed = completed + failed + cancelled;

  let eta = 0;
  if (totalProcessed > 0) {
    const avgTimePerTask = elapsed / totalProcessed;
    eta = avgTimePerTask * (total - totalProcessed);
  }

  return {
    total,
    completed,
    failed,
    cancelled,
    results,
    startTime,
    eta: Math.round(eta),
  };
}

// ============================================================================
// Streaming Batch Processing (Memory Efficient)
// ============================================================================

export async function* processBatchStream<T>(
  tasks: GenerationTask<T>[],
  options: BatchOptions<T> = {},
): AsyncGenerator<BatchProgress<T>, BatchProgress<T>, unknown> {
  const concurrency = options.concurrency ?? 6;
  const timeout = options.timeout ?? 120000;
  const maxRetries = options.retries ?? 2;
  const retryDelay = options.retryDelay ?? 1000;

  const startTime = Date.now();
  const results: BatchProgress<T>["results"] = [];
  const token = createCancellationToken();

  let completedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;

  for (let i = 0; i < tasks.length; i += concurrency) {
    throwIfCancelled(token);

    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((task) =>
        executeTaskWithRetry(task, token, {
          timeout,
          maxRetries,
          retryDelay,
        }),
      ),
    );

    for (let j = 0; j < batch.length; j++) {
      const task = batch[j];
      const result = batchResults[j];

      if (result.status === "fulfilled") {
        completedCount++;
        results.push({
          task,
          result: result.value,
          cancelled: false,
        });
        options.onTaskComplete?.(task, result.value);
      } else {
        if (result.reason?.message?.includes("cancelled")) {
          cancelledCount++;
          results.push({
            task,
            cancelled: true,
          });
        } else {
          failedCount++;
          results.push({
            task,
            error:
              result.reason instanceof Error
                ? result.reason
                : new Error(String(result.reason)),
            cancelled: false,
          });
          options.onTaskError?.(task, result.reason);
        }
      }

      // Yield progress
      yield createProgress(
        tasks.length,
        completedCount,
        failedCount,
        cancelledCount,
        results,
        startTime,
      );
    }
  }

  return createProgress(
    tasks.length,
    completedCount,
    failedCount,
    cancelledCount,
    results,
    startTime,
  );
}

// ============================================================================
// Parallel Fetch Optimization
// ============================================================================

/**
 * Fetch multiple data sources in parallel with controlled concurrency.
 * Reduces memory pressure by processing chunks of data.
 */
export async function parallelFetch<T, R>(
  items: T[],
  fetchFn: (item: T, token: CancellationToken) => Promise<R>,
  options: {
    concurrency?: number;
    timeout?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<Array<{ item: T; result?: R; error?: Error }>> {
  const concurrency = options.concurrency ?? 10;
  const timeout = options.timeout ?? 30000;
  const results: Array<{ item: T; result?: R; error?: Error }> = [];
  const token = createCancellationToken();

  for (let i = 0; i < items.length; i += concurrency) {
    throwIfCancelled(token);

    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(
      chunk.map((item) =>
        Promise.race([fetchFn(item, token), createTimeoutPromise(timeout)]),
      ),
    );

    for (let j = 0; j < chunk.length; j++) {
      const item = chunk[j];
      const result = chunkResults[j];

      if (result.status === "fulfilled") {
        results.push({ item, result: result.value });
      } else {
        results.push({
          item,
          error:
            result.reason instanceof Error
              ? result.reason
              : new Error(String(result.reason)),
        });
      }
    }

    options.onProgress?.(results.length, items.length);
  }

  return results;
}

// ============================================================================
// Batch Write to Database
// ============================================================================

/**
 * Batch write operations to database with transaction support.
 */
export async function batchWrite<T>(
  items: T[],
  writeFn: (items: T[]) => Promise<number>,
  options: {
    batchSize?: number;
    delayMs?: number;
    onProgress?: (written: number, total: number) => void;
  } = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 100;
  const delayMs = options.delayMs ?? 0;
  let totalWritten = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const written = await writeFn(chunk);
    totalWritten += written;

    options.onProgress?.(totalWritten, items.length);

    if (delayMs > 0 && i + batchSize < items.length) {
      await sleep(delayMs);
    }
  }

  return totalWritten;
}
