// Server-only module (import removed for backend compatibility)
import { Pool, PoolConfig, PoolClient } from "pg";
import { getEnv } from "./env";

// P0 Security: Validate secrets on import (auto-validates in production)
import "./validateEnv";

const env = getEnv();

// ============================================================================
// Types
// ============================================================================

interface PoolMetrics {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxCount: number;
}

interface DbPoolWithMetrics extends Pool {
  _metrics?: PoolMetrics | null;
  _connectionTimeout?: NodeJS.Timeout;
}

// ============================================================================
// Pool Configuration
// ============================================================================

let pool: DbPoolWithMetrics | null = null;
let isShuttingDown = false;
let poolInitialized = false;

const DEFAULT_POOL_CONFIG: PoolConfig = {
  max: 10,
  min: 2, // Keep minimum connections warm
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 60000,
  query_timeout: 60000,
  allowExitOnIdle: false, // Prevent pool from closing on idle in serverless
};

/**
 * Get pool configuration from environment variables
 */
function getPoolConfig(): PoolConfig {
  return {
    ...DEFAULT_POOL_CONFIG,
    max: env.PGPOOL_MAX,
    idleTimeoutMillis: env.PGPOOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.PGPOOL_CONNECT_TIMEOUT_MS,
    statement_timeout: env.PG_STATEMENT_TIMEOUT_MS,
  };
}

// ============================================================================
// Pool Metrics
// ============================================================================

/**
 * Initialize the database pool explicitly
 * Must be called before any database operations
 */
export async function initDbPool(): Promise<Pool> {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  if (isShuttingDown) {
    throw new Error("Cannot initialize pool during shutdown");
  }

  if (poolInitialized && pool) {
    return pool;
  }

  const config = getPoolConfig();
  pool = new Pool({
    ...config,
    connectionString,
  }) as DbPoolWithMetrics;

  // Set up error handler
  pool.on("error", (err) => {
    console.error("[DB] Unexpected pool error", err);
  });

  // Set up connection timeout handler
  // SECURITY: Use parameterized query to prevent SQL injection
  pool.on("connect", (client) => {
    client
      .query("SET statement_timeout = $1", [config.statement_timeout])
      .catch((e) => console.error("[DB] Failed to set statement_timeout", e));
  });

  // Verify connection
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    poolInitialized = true;
    console.log(
      "[DB] Pool initialized and verified with max connections:",
      config.max,
    );
  } catch (error) {
    pool = null;
    poolInitialized = false;
    throw new Error(
      `Failed to initialize database pool: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Log pool status periodically (only in development)
  if (env.NODE_ENV === "development") {
    const metricsInterval = setInterval(() => {
      if (pool && poolInitialized && !isShuttingDown) {
        logPoolMetrics();
      } else {
        clearInterval(metricsInterval);
      }
    }, 60000); // Every minute

    // Don't keep the process alive for this interval
    metricsInterval.unref();
  }

  return pool;
}

/**
 * Get current pool metrics for monitoring
 */
export function getPoolMetrics(): PoolMetrics | null {
  if (!pool) return null;

  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    maxCount: pool.options.max || 10,
  };
}

/**
 * Log pool metrics for debugging
 */
export function logPoolMetrics(): void {
  const metrics = getPoolMetrics();
  if (!metrics) {
    console.log("[DB] Pool not initialized");
    return;
  }

  const { totalCount, idleCount, waitingCount, maxCount } = metrics;
  const activeCount = totalCount - idleCount;
  const utilizationPercent = (activeCount / maxCount) * 100;

  console.log(
    `[DB] Pool metrics: ${activeCount}/${maxCount} active (${utilizationPercent.toFixed(1)}%), ${idleCount} idle, ${waitingCount} waiting`,
  );
}

// ============================================================================
// Pool Management
// ============================================================================

/**
 * Get the database connection pool
 * - Returns null if DATABASE_URL is not set (static generation)
 * - Returns null if pool not yet initialized (caller should handle gracefully)
 * - Returns Pool if ready for use
 */
export function getDbPool(): Pool | null {
  // Static generation or no DATABASE_URL: return null
  if (!env.DATABASE_URL) {
    return null;
  }

  // Pool not initialized yet - return null for graceful degradation
  if (!poolInitialized || !pool) {
    // Log warning for runtime (not during build)
    if (pool && poolInitialized === false && env.NODE_ENV === "production") {
      console.warn("[DB] Pool accessed before initDbPool() completed");
    }
    return null;
  }

  if (isShuttingDown) {
    return null;
  }

  // Update metrics
  pool._metrics = getPoolMetrics();
  return pool;
}

/**
 * Get or create the database connection pool (legacy compatibility)
 * @deprecated Use initDbPool() + getDbPool() instead
 */
export function getDbPoolLegacy(): Pool | null {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) return null;

  if (isShuttingDown) {
    console.warn("[DB] Attempted to get pool during shutdown");
    return null;
  }

  if (pool) {
    // Update metrics
    pool._metrics = getPoolMetrics();
    return pool;
  }

  const config = getPoolConfig();
  pool = new Pool({
    ...config,
    connectionString,
  }) as DbPoolWithMetrics;

  // Set up error handler
  pool.on("error", (err) => {
    console.error("[DB] Unexpected pool error", err);
  });

  // Set up connection timeout handler
  // SECURITY: Use parameterized query to prevent SQL injection
  pool.on("connect", (client) => {
    client
      .query("SET statement_timeout = $1", [config.statement_timeout])
      .catch((e) => console.error("[DB] Failed to set statement_timeout", e));
  });

  console.log("[DB] Pool created with max connections:", config.max);
  poolInitialized = true;
  return pool;
}

/**
 * Gracefully close the database pool
 */
export async function closeDbPool(): Promise<void> {
  if (!pool || isShuttingDown) return;

  isShuttingDown = true;
  poolInitialized = false;
  console.log("[DB] Closing pool...");

  try {
    // Set a hard timeout for pool shutdown
    const timeout = Promise.race([
      pool.end(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Pool close timeout")), 10000),
      ),
    ]);

    await timeout;
    pool = null;
    console.log("[DB] Pool closed successfully");
  } catch (error) {
    console.error("[DB] Error closing pool:", error);
    pool = null;
  }
}

/**
 * Health check for the database pool
 */
export async function checkDbHealth(): Promise<{
  healthy: boolean;
  metrics: PoolMetrics | null;
  error?: string;
}> {
  try {
    const dbPool = poolInitialized ? pool : null;
    if (!dbPool) {
      return {
        healthy: false,
        metrics: null,
        error: "Pool not initialized",
      };
    }

    const client = await dbPool.connect();
    const result = await client.query("SELECT 1 as health_check");
    client.release();

    if (result.rows[0]?.health_check !== 1) {
      throw new Error("Unexpected health check result");
    }

    return {
      healthy: true,
      metrics: getPoolMetrics(),
    };
  } catch (error) {
    return {
      healthy: false,
      metrics: getPoolMetrics(),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

/**
 * Set up graceful shutdown handlers for database pool cleanup
 */
export function setupDbShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    console.log(`[DB] Received ${signal}, closing pool gracefully...`);
    await closeDbPool();
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Auto-setup shutdown handlers in production
if (env.NODE_ENV === "production") {
  setupDbShutdownHandlers();
}

// ============================================================================
// Transaction Support
// ============================================================================

/**
 * Executes a function within a database transaction.
 * Returns null if no database pool is available.
 *
 * SECURITY: Preserves original error even if ROLLBACK fails.
 * If both fn(client) and ROLLBACK throw, the original error is re-thrown.
 *
 * @param fn - Function to execute within the transaction
 * @returns The result of the function, or null if no database
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T | null> {
  const db = getDbPool();
  if (!db) return null;

  const client = await db.connect();

  let originalError: unknown = null;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    // Store original error before attempting rollback
    originalError = err;
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      // Log rollback error but preserve original error
      console.error("[DB] ROLLBACK failed:", rollbackErr);
    }
    // Re-throw the original error, not any rollback error
    throw originalError;
  } finally {
    client.release();
  }
}
