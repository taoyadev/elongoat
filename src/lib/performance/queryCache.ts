import "server-only";

import { getConnectedRedisFromPool, isRedisEnabled } from "../redis";
import { getEnv } from "../env";

const env = getEnv();

// ============================================================================
// Query Result Cache
// ============================================================================

interface QueryCacheEntry<T> {
  result: T;
  cachedAt: number;
  ttl: number;
  queryHash: string;
  tags?: string[];
}

interface QueryCacheStats {
  hits: number;
  misses: number;
  invalidations: number;
  totalQueries: number;
  hitRate: number;
  avgLatencySaved: number;
}

const QUERY_CACHE_PREFIX = "query:";
const DEFAULT_TTL_MS = 60000;
const MAX_MEMORY_ENTRIES = 500;
const MAX_LATENCY_TRACKING = 1000;

const memoryCache = new Map<string, QueryCacheEntry<unknown>>();
const latencySavings: number[] = [];

const stats: QueryCacheStats = {
  hits: 0,
  misses: 0,
  invalidations: 0,
  totalQueries: 0,
  hitRate: 0,
  avgLatencySaved: 0,
};

// ============================================================================
// Query Hashing
// ============================================================================

export function hashQuery(config: {
  table: string;
  operation: string;
  params?: Record<string, unknown>;
  filters?: Record<string, unknown>;
}): string {
  const normalized = {
    table: config.table,
    operation: config.operation,
    params: config.params ? normalizeObject(config.params) : {},
    filters: config.filters ? normalizeObject(config.filters) : {},
  };
  const str = JSON.stringify(normalized);
  return simpleHash(str);
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function normalizeObject(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    normalized[key] = obj[key];
  }
  return normalized;
}

// ============================================================================
// Query Cache Operations
// ============================================================================

export async function getCachedQuery<T>(
  queryHash: string,
  fallback: () => Promise<T>,
  options: {
    ttlMs?: number;
    tags?: string[];
    skipCache?: boolean;
  } = {},
): Promise<T> {
  const startTime = performance.now();
  const { ttlMs = DEFAULT_TTL_MS, tags, skipCache } = options;
  const cacheKey = QUERY_CACHE_PREFIX + queryHash;

  stats.totalQueries++;

  if (skipCache || !env.QUERY_CACHE_ENABLED) {
    return fallback();
  }

  const memEntry = memoryCache.get(queryHash) as QueryCacheEntry<T> | undefined;
  if (memEntry) {
    const now = Date.now();
    if (now - memEntry.cachedAt < memEntry.ttl) {
      stats.hits++;
      stats.hitRate = stats.hits / stats.totalQueries;
      return memEntry.result;
    }
    memoryCache.delete(queryHash);
  }

  if (isRedisEnabled()) {
    try {
      const redis = await getConnectedRedisFromPool();
      if (redis) {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as QueryCacheEntry<T>;
          const now = Date.now();
          if (now - parsed.cachedAt < parsed.ttl) {
            setMemoryCache(queryHash, parsed.result, parsed.ttl, parsed.tags);
            stats.hits++;
            stats.hitRate = stats.hits / stats.totalQueries;
            const latency = performance.now() - startTime;
            trackLatencySaving(latency);
            return parsed.result;
          }
        }
      }
    } catch {
      // Redis error, continue to fallback
    }
  }

  stats.misses++;
  stats.hitRate = stats.hits / stats.totalQueries;

  const result = await fallback();

  const entry: QueryCacheEntry<T> = {
    result,
    cachedAt: Date.now(),
    ttl: ttlMs,
    queryHash,
    tags,
  };

  setMemoryCache(queryHash, result, ttlMs, tags);

  if (isRedisEnabled()) {
    try {
      const redis = await getConnectedRedisFromPool();
      if (redis) {
        const expirySeconds = Math.max(1, Math.floor(ttlMs / 1000));
        await redis.set(cacheKey, JSON.stringify(entry), "EX", expirySeconds);
      }
    } catch {
      // Redis error, ignore
    }
  }

  return result;
}

function setMemoryCache<T>(
  queryHash: string,
  result: T,
  ttlMs: number,
  tags?: string[],
): void {
  if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) {
      memoryCache.delete(oldestKey);
    }
  }

  memoryCache.set(queryHash, {
    result,
    cachedAt: Date.now(),
    ttl: ttlMs,
    queryHash,
    tags,
  });
}

export async function invalidateQueries(options: {
  table?: string;
  tags?: string[];
}): Promise<number> {
  let count = 0;

  if (options.table) {
    const tablePrefix = options.table + ":";
    for (const [key, entry] of memoryCache.entries()) {
      if (key.startsWith(tablePrefix) || entry.tags?.includes(options.table)) {
        memoryCache.delete(key);
        count++;
      }
    }

    if (isRedisEnabled()) {
      try {
        const redis = await getConnectedRedisFromPool();
        if (redis) {
          const pattern = QUERY_CACHE_PREFIX + options.table + "*";
          const keys = await redis.keys(pattern);
          if (keys.length > 0) {
            await redis.del(...keys);
            count += keys.length;
          }
        }
      } catch {
        // Redis error, ignore
      }
    }
  }

  if (options.tags && options.tags.length > 0) {
    for (const tag of options.tags) {
      for (const [key, entry] of memoryCache.entries()) {
        if (entry.tags?.includes(tag)) {
          memoryCache.delete(key);
          count++;
        }
      }

      if (isRedisEnabled()) {
        try {
          const redis = await getConnectedRedisFromPool();
          if (redis) {
            const pattern = QUERY_CACHE_PREFIX + "tag:" + tag + "*";
            const keys = await redis.keys(pattern);
            if (keys.length > 0) {
              await redis.del(...keys);
              count += keys.length;
            }
          }
        } catch {
          // Redis error, ignore
        }
      }
    }
  }

  stats.invalidations += count;
  return count;
}

export async function clearQueryCache(): Promise<number> {
  const count = memoryCache.size;
  memoryCache.clear();

  if (isRedisEnabled()) {
    try {
      const redis = await getConnectedRedisFromPool();
      if (redis) {
        const keys = await redis.keys(QUERY_CACHE_PREFIX + "*");
        if (keys.length > 0) {
          await redis.del(...keys);
        }
        return count + keys.length;
      }
    } catch {
      // Redis error, ignore
    }
  }

  return count;
}

// ============================================================================
// Statistics & Monitoring
// ============================================================================

function trackLatencySaving(cacheLatency: number): void {
  latencySavings.push(cacheLatency);
  if (latencySavings.length > MAX_LATENCY_TRACKING) {
    latencySavings.shift();
  }

  const avgLatency =
    latencySavings.reduce((a, b) => a + b, 0) / latencySavings.length;
  stats.avgLatencySaved = Math.round(avgLatency);
}

export function getQueryCacheStats(): QueryCacheStats {
  return { ...stats };
}

export function resetQueryCacheStats(): void {
  stats.hits = 0;
  stats.misses = 0;
  stats.invalidations = 0;
  stats.totalQueries = 0;
  stats.hitRate = 0;
  stats.avgLatencySaved = 0;
  latencySavings.length = 0;
}

export async function warmupQueryCache<T>(
  queries: Array<{
    hash: string;
    fetch: () => Promise<T>;
    ttlMs?: number;
    tags?: string[];
  }>,
  concurrency = 3,
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (let i = 0; i < queries.length; i += concurrency) {
    const batch = queries.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((q) =>
        getCachedQuery(q.hash, q.fetch, {
          ttlMs: q.ttlMs,
          tags: q.tags,
        }),
      ),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        success++;
      } else {
        failed++;
      }
    }
  }

  return { success, failed };
}
