// Server-only module (import removed for backend compatibility)
import { getConnectedRedisFromPool } from "./redis";
import { getEnv } from "./env";

const env = getEnv();

// ============================================================================
// Configuration
// ============================================================================

const L1_MAX_TTL_MS = env.TIERED_CACHE_L1_TTL_MS; // 5 minutes default
const L2_MAX_TTL_MS = env.TIERED_CACHE_L2_TTL_MS; // 1 hour default
const L1_MAX_ENTRIES = env.TIERED_CACHE_L1_MAX_ENTRIES;
const L1_CLEANUP_INTERVAL_MS = env.TIERED_CACHE_L1_CLEANUP_MS;
const STAMP_PROTECTION_TIMEOUT_MS = env.TIERED_CACHE_STAMP_TIMEOUT_MS;

// ============================================================================
// Types
// ============================================================================

export type CacheLevel = "l1" | "l2" | "miss";

export interface CacheResult<T> {
  data: T;
  level: CacheLevel;
  hit: boolean;
  latency: number;
}

export interface CacheStats {
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
  stampedePreventions: number;
  totalRequests: number;
  hitRate: number;
  l1Size: number;
}

export interface CacheOptions {
  l1Ttl?: number; // milliseconds
  l2Ttl?: number; // milliseconds
  forceRefresh?: boolean;
  skipL1?: boolean;
  skipL2?: boolean;
  tags?: string[]; // Tag-based cache invalidation
  priority?: number; // 0-9, higher = less likely to be evicted
}

// Tag-based cache tracking
const tagIndex = new Map<string, Set<string>>(); // tag -> set of keys
const keyTags = new Map<string, Set<string>>(); // key -> set of tags

// ============================================================================
// L1: In-Memory Cache with TTL
// ============================================================================

interface L1Entry<T> {
  data: T;
  expiresAt: number;
  hits: number;
  lastAccessed: number;
  priority: number;
  tags?: Set<string>;
}

const l1Cache = new Map<string, L1Entry<unknown>>();
const l1PendingPromises = new Map<string, Promise<unknown>>();

/**
 * Checks if an L1 entry has expired.
 */
function isL1Expired(entry: L1Entry<unknown>): boolean {
  return Date.now() > entry.expiresAt;
}

/**
 * Cleans up expired L1 cache entries.
 */
function cleanupL1Cache(): void {
  let cleaned = 0;

  for (const [key, entry] of l1Cache.entries()) {
    if (isL1Expired(entry)) {
      l1Cache.delete(key);
      cleaned++;
    }
  }

  // Also enforce max entries by removing least recently accessed
  if (l1Cache.size > L1_MAX_ENTRIES) {
    const entries = Array.from(l1Cache.entries());
    entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    const toRemove = entries.slice(0, entries.length - L1_MAX_ENTRIES);
    for (const [key] of toRemove) {
      l1Cache.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0 && env.NODE_ENV === "development") {
    console.log(
      "[TieredCache] L1 cleanup: removed " + cleaned + " expired entries",
    );
  }
}

// Periodic L1 cleanup
if (typeof setInterval !== "undefined") {
  setInterval(cleanupL1Cache, L1_CLEANUP_INTERVAL_MS);
}

/**
 * Gets data from L1 cache.
 */
function getL1<T>(key: string): T | null {
  const entry = l1Cache.get(key) as L1Entry<T> | undefined;

  if (!entry) {
    return null;
  }

  if (isL1Expired(entry)) {
    l1Cache.delete(key);
    return null;
  }

  // Update access stats
  entry.lastAccessed = Date.now();
  entry.hits++;

  return entry.data;
}

/**
 * Sets data in L1 cache.
 */
function setL1<T>(
  key: string,
  data: T,
  ttlMs: number,
  tags?: string[],
  priority = 0,
): void {
  const now = Date.now();
  l1Cache.set(key, {
    data,
    expiresAt: now + Math.min(ttlMs, L1_MAX_TTL_MS),
    hits: 0,
    lastAccessed: now,
    priority: Math.max(0, Math.min(9, priority)),
    tags: tags ? new Set(tags) : undefined,
  });

  // Update tag index
  if (tags && tags.length > 0) {
    const tagSet = keyTags.get(key) || new Set<string>();
    for (const tag of tags) {
      const keys = tagIndex.get(tag) || new Set<string>();
      keys.add(key);
      tagIndex.set(tag, keys);
      tagSet.add(tag);
    }
    keyTags.set(key, tagSet);
  }
}

/**
 * Deletes a key from L1 cache.
 */
function deleteL1(key: string): void {
  l1Cache.delete(key);

  // Clean up tag index
  const tags = keyTags.get(key);
  if (tags) {
    for (const tag of tags) {
      const keys = tagIndex.get(tag);
      if (keys) {
        keys.delete(key);
        if (keys.size === 0) {
          tagIndex.delete(tag);
        }
      }
    }
    keyTags.delete(key);
  }
}

/**
 * Clears all L1 cache entries.
 */
function clearL1(): void {
  l1Cache.clear();
  keyTags.clear();
  tagIndex.clear();
}

// ============================================================================
// L2: Redis Cache
// ============================================================================

/**
 * Gets data from L2 (Redis) cache.
 * Uses getConnectedRedisFromPool() which handles connection state efficiently.
 */
async function getL2<T>(key: string): Promise<T | null> {
  try {
    const redis = await getConnectedRedisFromPool();
    if (!redis) return null;

    const raw = await redis.get(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { data: T; expiresAt: number };

    // Check if expired
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      await redis.del(key);
      return null;
    }

    return parsed.data;
  } catch (error) {
    if (env.NODE_ENV === "development") {
      console.error("[TieredCache] L2 get error:", error);
    }
    return null;
  }
}

/**
 * Sets data in L2 (Redis) cache.
 * Uses getConnectedRedisFromPool() which handles connection state efficiently.
 */
async function setL2<T>(key: string, data: T, ttlMs: number): Promise<boolean> {
  try {
    const redis = await getConnectedRedisFromPool();
    if (!redis) return false;

    const payload = {
      data,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : null,
    };
    const expirySeconds = Math.max(1, Math.floor(ttlMs / 1000));
    await redis.set(key, JSON.stringify(payload), "EX", expirySeconds);
    return true;
  } catch (error) {
    if (env.NODE_ENV === "development") {
      console.error("[TieredCache] L2 set error:", error);
    }
    return false;
  }
}

/**
 * Deletes a key from L2 cache.
 * Uses getConnectedRedisFromPool() which handles connection state efficiently.
 */
async function deleteL2(key: string): Promise<void> {
  try {
    const redis = await getConnectedRedisFromPool();
    if (!redis) return;

    await redis.del(key);
  } catch (error) {
    if (env.NODE_ENV === "development") {
      console.error("[TieredCache] L2 delete error:", error);
    }
  }
}

// ============================================================================
// Cache Stampede Protection (Single Flight)
// ============================================================================

/**
 * Executes a fetch function with stampede protection.
 * Only one request for a given key will be executed at a time.
 */
async function withStampedeProtection<T>(
  key: string,
  fetchFn: () => Promise<T>,
): Promise<T> {
  // Check if there's already a pending request for this key
  const existing = l1PendingPromises.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  // Create a new promise for this fetch
  const promise = (async () => {
    try {
      return await fetchFn();
    } finally {
      // Clean up the promise reference after completion
      l1PendingPromises.delete(key);
    }
  })();

  // Store the promise so other requests can wait for it
  l1PendingPromises.set(key, promise);

  // Set a timeout to prevent stuck promises
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      l1PendingPromises.delete(key);
      reject(new Error("Cache stampede protection timeout for key: " + key));
    }, STAMP_PROTECTION_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]);
}

// ============================================================================
// Statistics Tracking
// ============================================================================

const cacheStats: CacheStats = {
  l1Hits: 0,
  l1Misses: 0,
  l2Hits: 0,
  l2Misses: 0,
  stampedePreventions: 0,
  totalRequests: 0,
  hitRate: 0,
  l1Size: 0,
};

/**
 * Records a cache hit/miss for statistics.
 */
function recordStats(level: CacheLevel, hit: boolean): void {
  cacheStats.totalRequests++;

  if (level === "l1") {
    if (hit) cacheStats.l1Hits++;
    else cacheStats.l1Misses++;
  } else if (level === "l2") {
    if (hit) cacheStats.l2Hits++;
    else cacheStats.l2Misses++;
  }

  // Calculate hit rate
  const totalHits = cacheStats.l1Hits + cacheStats.l2Hits;
  cacheStats.hitRate =
    cacheStats.totalRequests > 0 ? totalHits / cacheStats.totalRequests : 0;

  cacheStats.l1Size = l1Cache.size;
}

/**
 * Records a stampede prevention event.
 * NOTE: Currently unused but reserved for future stampede prevention implementation
 */
export function recordStampedePrevention(): void {
  cacheStats.stampedePreventions++;
}

// ============================================================================
// Main Tiered Cache API
// ============================================================================

/**
 * Gets data from the tiered cache with automatic promotion.
 *
 * 1. Check L1 (in-memory) - fastest
 * 2. Check L2 (Redis) - fast
 * 3. Fetch from source - slow
 * 4. Promote data to higher levels
 *
 * @param key - Cache key
 * @param fetchFn - Function to fetch data on cache miss
 * @param options - Cache options
 * @returns Cached or fetched data with metadata
 */
export async function get<T>(
  key: string,
  fetchFn: () => Promise<T>,
  options: CacheOptions = {},
): Promise<CacheResult<T>> {
  const startTime = performance.now();
  const {
    l1Ttl = L1_MAX_TTL_MS,
    l2Ttl = L2_MAX_TTL_MS,
    forceRefresh = false,
    skipL1 = false,
    skipL2 = false,
    tags,
    priority = 0,
  } = options;

  // Level 1: In-memory cache
  if (!skipL1 && !forceRefresh) {
    const l1Data = getL1<T>(key);
    if (l1Data !== null) {
      recordStats("l1", true);
      return {
        data: l1Data,
        level: "l1",
        hit: true,
        latency: Math.round(performance.now() - startTime),
      };
    }
    recordStats("l1", false);
  }

  // Level 2: Redis cache
  if (!skipL2 && !forceRefresh) {
    const l2Data = await getL2<T>(key);
    if (l2Data !== null) {
      // Promote to L1
      setL1(key, l2Data, l1Ttl, tags, priority);
      recordStats("l2", true);
      return {
        data: l2Data,
        level: "l2",
        hit: true,
        latency: Math.round(performance.now() - startTime),
      };
    }
    recordStats("l2", false);
  }

  // Level 3: Fetch from source with stampede protection
  const data = await withStampedeProtection(key, fetchFn);

  // Store in cache levels
  if (!skipL2) {
    await setL2(key, data, l2Ttl);
  }
  if (!skipL1) {
    setL1(key, data, l1Ttl, tags, priority);
  }

  return {
    data,
    level: "miss",
    hit: false,
    latency: Math.round(performance.now() - startTime),
  };
}

/**
 * Sets data in the cache at specified levels.
 */
export async function set<T>(
  key: string,
  data: T,
  options: CacheOptions = {},
): Promise<void> {
  const { l1Ttl = L1_MAX_TTL_MS, l2Ttl = L2_MAX_TTL_MS } = options;

  // Set in L2 first (Redis)
  await setL2(key, data, l2Ttl);

  // Then set in L1
  setL1(key, data, l1Ttl);
}

/**
 * Deletes data from all cache levels.
 */
export async function del(key: string): Promise<void> {
  deleteL1(key);
  await deleteL2(key);
  l1PendingPromises.delete(key);
}

/**
 * Clears all cache levels.
 */
export async function clear(): Promise<void> {
  clearL1();
  // Note: Clearing all Redis keys would require a SCAN operation
  // which is potentially expensive. For safety, we only clear L1.
  if (env.NODE_ENV === "development") {
    console.warn(
      "[TieredCache] L2 clear not implemented (use key patterns or flushdb manually)",
    );
  }
}

/**
 * Invalidates cache entries matching a pattern.
 * For L1, this is a full scan. For L2, use Redis SCAN.
 */
export async function invalidatePattern(pattern: string): Promise<number> {
  let count = 0;

  // Clear matching L1 entries
  const regex = new RegExp(pattern.replace(/\*/g, ".*"));
  for (const key of l1Cache.keys()) {
    if (regex.test(key)) {
      l1Cache.delete(key);
      count++;
    }
  }

  // For L2, we would need to use Redis SCAN with MATCH
  // This is expensive, so we skip it by default
  if (env.NODE_ENV === "development") {
    console.log(
      "[TieredCache] Invalidated " + count + " L1 entries matching " + pattern,
    );
  }

  return count;
}

// ============================================================================
// Statistics & Monitoring
// ============================================================================

/**
 * Gets current cache statistics.
 */
export function getStats(): CacheStats {
  return { ...cacheStats, l1Size: l1Cache.size };
}

/**
 * Resets cache statistics.
 */
export function resetStats(): void {
  cacheStats.l1Hits = 0;
  cacheStats.l1Misses = 0;
  cacheStats.l2Hits = 0;
  cacheStats.l2Misses = 0;
  cacheStats.stampedePreventions = 0;
  cacheStats.totalRequests = 0;
  cacheStats.hitRate = 0;
}

/**
 * Gets detailed cache metrics for monitoring.
 */
export function getMetrics(): {
  stats: CacheStats;
  l1Entries: number;
  l1Pending: number;
  config: {
    l1MaxTtl: number;
    l2MaxTtl: number;
    l1MaxEntries: number;
    stampedeTimeout: number;
  };
} {
  return {
    stats: getStats(),
    l1Entries: l1Cache.size,
    l1Pending: l1PendingPromises.size,
    config: {
      l1MaxTtl: L1_MAX_TTL_MS,
      l2MaxTtl: L2_MAX_TTL_MS,
      l1MaxEntries: L1_MAX_ENTRIES,
      stampedeTimeout: STAMP_PROTECTION_TIMEOUT_MS,
    },
  };
}

// ============================================================================
// Decorators for Easy Use
// ============================================================================

/**
 * Creates a memoized function that uses the tiered cache.
 */
export function memoized<T extends (...args: never[]) => Promise<unknown>>(
  keyPrefix: string,
  fn: T,
  options: CacheOptions = {},
): T {
  return (async (...args: never[]) => {
    const serializedArgs = JSON.stringify(args);
    const key = keyPrefix + ":" + serializedArgs;
    return get(key, () => fn(...args) as Promise<unknown>, options);
  }) as unknown as T;
}

/**
 * Cache key builder helper.
 */
export function buildKey(
  parts: (string | number | boolean)[],
  prefix = "cache",
): string {
  return prefix + ":" + parts.join(":");
}

// ============================================================================
// Tag-Based Cache Invalidation
// ============================================================================

/**
 * Invalidate all cache entries associated with a specific tag.
 * This is useful for clearing related cache entries when data changes.
 *
 * @param tag - The tag to invalidate
 * @returns Number of entries invalidated
 */
export function invalidateByTag(tag: string): number {
  const keys = tagIndex.get(tag);
  if (!keys) return 0;

  let count = 0;
  for (const key of keys) {
    deleteL1(key);
    count++;
  }

  tagIndex.delete(tag);
  return count;
}

/**
 * Invalidate cache entries associated with any of the given tags.
 *
 * @param tags - Array of tags to invalidate
 * @returns Number of entries invalidated
 */
export function invalidateByTags(tags: string[]): number {
  let count = 0;
  const processedKeys = new Set<string>();

  for (const tag of tags) {
    const keys = tagIndex.get(tag);
    if (keys) {
      for (const key of keys) {
        if (!processedKeys.has(key)) {
          deleteL1(key);
          processedKeys.add(key);
          count++;
        }
      }
      tagIndex.delete(tag);
    }
  }

  return count;
}

/**
 * Get all tags associated with a cache key.
 *
 * @param key - The cache key
 * @returns Array of tags or empty array if key not found
 */
export function getTagsForKey(key: string): string[] {
  const tags = keyTags.get(key);
  return tags ? Array.from(tags) : [];
}

/**
 * Get statistics about tag usage.
 *
 * @returns Object with tag statistics
 */
export function getTagStats(): {
  totalTags: number;
  totalTaggedKeys: number;
  topTags: Array<{ tag: string; count: number }>;
} {
  const topTags: Array<{ tag: string; count: number }> = [];

  for (const [tag, keys] of tagIndex.entries()) {
    topTags.push({ tag, count: keys.size });
  }

  topTags.sort((a, b) => b.count - a.count);

  return {
    totalTags: tagIndex.size,
    totalTaggedKeys: keyTags.size,
    topTags: topTags.slice(0, 10),
  };
}
