import "server-only";

import { getDbPool } from "../db";
import { getEnv } from "../env";

const env = getEnv();

// ============================================================================
// Cache Warmup Service
// ============================================================================

/**
 * Cache warmup service for pre-loading frequently accessed data.
 * Reduces cold start latency for critical endpoints.
 */

interface WarmupTask {
  name: string;
  priority: number; // 0-10, higher = earlier
  execute: () => Promise<unknown>;
  dependencies?: string[]; // Names of tasks that must complete first
}

interface WarmupResult {
  task: string;
  success: boolean;
  duration: number;
  error?: string;
}

interface WarmupStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalDuration: number;
  results: WarmupResult[];
}

const warmupRegistry = new Map<string, WarmupTask>();

// ============================================================================
// Task Registration
// ============================================================================

/**
 * Register a warmup task.
 */
export function registerWarmupTask(task: WarmupTask): void {
  warmupRegistry.set(task.name, task);
}

/**
 * Register multiple warmup tasks.
 */
export function registerWarmupTasks(tasks: WarmupTask[]): void {
  for (const task of tasks) {
    registerWarmupTask(task);
  }
}

/**
 * Unregister a warmup task.
 */
export function unregisterWarmupTask(name: string): void {
  warmupRegistry.delete(name);
}

/**
 * Clear all registered warmup tasks.
 */
export function clearWarmupTasks(): void {
  warmupRegistry.clear();
}

// ============================================================================
// Warmup Execution
// ============================================================================

/**
 * Execute warmup tasks in priority order, respecting dependencies.
 */
export async function executeWarmup(options: {
  concurrency?: number;
  timeoutMs?: number;
  filter?: (task: WarmupTask) => boolean;
}): Promise<WarmupStats> {
  const concurrency = options.concurrency ?? env.WARMUP_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? 30000;
  const startTime = performance.now();

  let tasks = Array.from(warmupRegistry.values());

  // Apply filter if provided
  if (options.filter) {
    tasks = tasks.filter(options.filter);
  }

  // Sort by priority (descending)
  tasks.sort((a, b) => b.priority - a.priority);

  const results: WarmupResult[] = [];
  const completed = new Set<string>();
  let failedCount = 0;

  // Execute tasks with dependency resolution
  while (completed.size < tasks.length) {
    // Find tasks that can be executed (all dependencies met, not yet completed)
    const readyTasks = tasks.filter(
      (task) =>
        !completed.has(task.name) &&
        (task.dependencies?.every((dep) => completed.has(dep)) ?? true),
    );

    if (readyTasks.length === 0) {
      // Circular dependency or all remaining tasks have unmet dependencies
      break;
    }

    // Process a batch of ready tasks
    const batch = readyTasks.slice(0, concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((task) =>
        Promise.race([
          executeTask(task),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), timeoutMs),
          ),
        ]),
      ),
    );

    for (let i = 0; i < batch.length; i++) {
      const task = batch[i];
      const result = batchResults[i];
      const taskStart = performance.now();

      if (result.status === "fulfilled") {
        completed.add(task.name);
        results.push({
          task: task.name,
          success: true,
          duration: performance.now() - taskStart,
        });
      } else {
        failedCount++;
        results.push({
          task: task.name,
          success: false,
          duration: performance.now() - taskStart,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
        completed.add(task.name); // Mark as completed even if failed
      }
    }
  }

  return {
    totalTasks: tasks.length,
    completedTasks: completed.size,
    failedTasks: failedCount,
    totalDuration: performance.now() - startTime,
    results,
  };
}

async function executeTask(task: WarmupTask): Promise<unknown> {
  return task.execute();
}

// ============================================================================
// Built-in Warmup Tasks
// ============================================================================

/**
 * Register default warmup tasks for common data.
 */
export function registerDefaultWarmupTasks(): void {
  const pool = getDbPool();
  if (!pool) return;

  // Warm up topic hubs (most accessed)
  registerWarmupTask({
    name: "warm-topics",
    priority: 10,
    execute: async () => {
      const result = await pool.query(
        `SELECT topic_slug, topic, COUNT(*) as page_count
         FROM elongoat.cluster_pages
         GROUP BY topic_slug, topic
         ORDER BY page_count DESC
         LIMIT $1`,
        [env.WARM_CLUSTER_COUNT],
      );
      return result.rows;
    },
  });

  // Warm up high-volume PAA questions
  registerWarmupTask({
    name: "warm-paa",
    priority: 9,
    execute: async () => {
      const result = await pool.query(
        `SELECT slug, question, answer, volume
         FROM elongoat.paa_tree
         WHERE answer IS NOT NULL AND length(answer) > 50
         ORDER BY volume DESC
         LIMIT $1`,
        [env.WARM_PAA_COUNT],
      );
      return result.rows;
    },
  });

  // Warm up dynamic variables (frequently accessed)
  registerWarmupTask({
    name: "warm-variables",
    priority: 10,
    execute: async () => {
      const result = await pool.query(
        `SELECT key, value, updated_at
         FROM elongoat.dynamic_variables
         WHERE is_active = true`,
      );
      return result.rows;
    },
  });

  // Warm up recent content cache entries
  registerWarmupTask({
    name: "warm-recent-content",
    priority: 8,
    dependencies: ["warm-variables"],
    execute: async () => {
      const result = await pool.query(
        `SELECT slug, kind, generated_at, word_count
         FROM elongoat.content_cache
         WHERE (expires_at IS NULL OR expires_at > NOW())
         ORDER BY generated_at DESC
         LIMIT 20`,
      );
      return result.rows;
    },
  });

  // Warm up popular tweets
  registerWarmupTask({
    name: "warm-popular-tweets",
    priority: 7,
    execute: async () => {
      const result = await pool.query(
        `SELECT tweet_id, full_text, like_count, created_at
         FROM elongoat.musk_tweets
         WHERE is_retweet = false
         ORDER BY like_count DESC
         LIMIT 20`,
      );
      return result.rows;
    },
  });
}

// ============================================================================
// Automatic Warmup
// ============================================================================

/**
 * Execute warmup after a delay (useful for startup).
 */
export async function delayedWarmup(
  delayMs = env.WARMUP_DELAY_MS,
): Promise<WarmupStats> {
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (warmupRegistry.size === 0) {
    registerDefaultWarmupTasks();
  }

  return executeWarmup({});
}

// ============================================================================
// Warmup Status
// ============================================================================

/**
 * Get information about registered warmup tasks.
 */
export function getWarmupTaskInfo(): Array<{
  name: string;
  priority: number;
  dependencies: string[];
}> {
  return Array.from(warmupRegistry.values()).map((task) => ({
    name: task.name,
    priority: task.priority,
    dependencies: task.dependencies ?? [],
  }));
}

/**
 * Check if a warmup task is registered.
 */
export function hasWarmupTask(name: string): boolean {
  return warmupRegistry.has(name);
}

// ============================================================================
// Cache Warmup Metrics
// ============================================================================

/**
 * Get metrics about the last warmup execution.
 */
let lastWarmupStats: WarmupStats | null = null;

export function setLastWarmupStats(stats: WarmupStats): void {
  lastWarmupStats = stats;
}

export function getLastWarmupStats(): WarmupStats | null {
  return lastWarmupStats;
}

/**
 * Generate a summary of warmup effectiveness.
 */
export function getWarmupSummary(): {
  registeredTasks: number;
  lastExecution: WarmupStats | null;
  healthStatus: "healthy" | "degraded" | "failed";
} {
  let healthStatus: "healthy" | "degraded" | "failed" = "healthy";

  if (lastWarmupStats) {
    const failureRate =
      lastWarmupStats.failedTasks / lastWarmupStats.totalTasks;
    if (failureRate > 0.5) {
      healthStatus = "failed";
    } else if (failureRate > 0.1) {
      healthStatus = "degraded";
    }
  }

  return {
    registeredTasks: warmupRegistry.size,
    lastExecution: lastWarmupStats,
    healthStatus,
  };
}
