import "server-only";

import {
  registerDefaultWarmupTasks,
  delayedWarmup,
  executeWarmup,
} from "./cacheWarmup";
import { startMonitoring } from "./dbPoolMonitor";
import { getEnv } from "../env";

const env = getEnv();

// ============================================================================
// Performance Startup Service
// ============================================================================

/**
 * Initializes all performance optimization services on application startup.
 * This should be called early in the application lifecycle.
 */

export interface StartupOptions {
  enableWarmup?: boolean;
  enableMonitoring?: boolean;
  warmupDelay?: number;
}

export interface StartupResult {
  warmup: {
    enabled: boolean;
    completed: boolean;
    stats?: Awaited<ReturnType<typeof executeWarmup>>;
  };
  monitoring: {
    enabled: boolean;
    running: boolean;
  };
  timestamp: string;
}

let initialized = false;
let startupResult: StartupResult | null = null;

/**
 * Initialize performance services.
 */
export async function initPerformanceServices(
  options: StartupOptions = {},
): Promise<StartupResult> {
  if (initialized) {
    return startupResult!;
  }

  const {
    enableWarmup = true,
    enableMonitoring = true,
    warmupDelay = env.WARMUP_DELAY_MS,
  } = options;

  console.log("[Performance] Initializing performance services...");

  // Start database pool monitoring
  let monitoringRunning = false;
  if (enableMonitoring) {
    try {
      startMonitoring(30000);
      monitoringRunning = true;
      console.log("[Performance] Database pool monitoring started");
    } catch (error) {
      console.error("[Performance] Failed to start monitoring:", error);
    }
  }

  // Register default warmup tasks
  if (enableWarmup) {
    try {
      registerDefaultWarmupTasks();
      console.log("[Performance] Warmup tasks registered");
    } catch (error) {
      console.error("[Performance] Failed to register warmup tasks:", error);
    }
  }

  // Execute warmup after delay
  let warmupStats: Awaited<ReturnType<typeof executeWarmup>> | undefined;
  const warmupCompleted = false;

  if (enableWarmup) {
    // Start warmup in background
    delayedWarmup(warmupDelay)
      .then((stats) => {
        console.log(
          "[Performance] Warmup completed: " +
            stats.completedTasks +
            "/" +
            stats.totalTasks +
            " tasks, " +
            stats.failedTasks +
            " failed, " +
            Math.round(stats.totalDuration) +
            "ms",
        );
      })
      .catch((error) => {
        console.error("[Performance] Warmup failed:", error);
      });
  }

  startupResult = {
    warmup: {
      enabled: enableWarmup,
      completed: warmupCompleted,
      stats: warmupStats,
    },
    monitoring: {
      enabled: enableMonitoring,
      running: monitoringRunning,
    },
    timestamp: new Date().toISOString(),
  };

  initialized = true;

  return startupResult;
}

/**
 * Get the last startup result.
 */
export function getStartupResult(): StartupResult | null {
  return startupResult;
}

/**
 * Check if performance services are initialized.
 */
export function isPerformanceInitialized(): boolean {
  return initialized;
}

// Auto-initialize on module load (in non-test environments)
if (env.NODE_ENV !== "test" && typeof process !== "undefined") {
  // Initialize but don't block startup
  initPerformanceServices({
    enableWarmup: true,
    enableMonitoring: true,
  }).catch((error) => {
    console.error("[Performance] Initialization error:", error);
  });
}
