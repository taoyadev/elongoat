/**
 * Unit Tests for tieredCache.ts
 *
 * Tests the L1 (in-memory) and L2 (Redis) tiered caching system
 * including stampede protection, tag-based invalidation, and statistics.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Redis before importing tieredCache
vi.mock("../../src/lib/redis", () => ({
  getConnectedRedisFromPool: vi.fn(),
}));

vi.mock("../../src/lib/env", () => ({
  getEnv: () => ({
    NODE_ENV: "test",
    TIERED_CACHE_L1_TTL_MS: 300000,
    TIERED_CACHE_L2_TTL_MS: 3600000,
    TIERED_CACHE_L1_MAX_ENTRIES: 1000,
    TIERED_CACHE_L1_CLEANUP_MS: 60000,
    TIERED_CACHE_STAMP_TIMEOUT_MS: 5000,
  }),
}));

import {
  get,
  set,
  del,
  clear,
  getStats,
  resetStats,
  getMetrics,
  buildKey,
  invalidateByTag,
  invalidateByTags,
  getTagsForKey,
  getTagStats,
  invalidatePattern,
} from "../../src/lib/tieredCache";
import { getConnectedRedisFromPool } from "../../src/lib/redis";

describe("tieredCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStats();
    void clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("get", () => {
    it("should return data from L1 cache on hit", async () => {
      const fetchFn = vi.fn().mockResolvedValue("fetched-data");

      // First call - cache miss
      const result1 = await get("test-key", fetchFn);
      expect(result1.data).toBe("fetched-data");
      expect(result1.level).toBe("miss");
      expect(result1.hit).toBe(false);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Second call - L1 hit
      const result2 = await get("test-key", fetchFn);
      expect(result2.data).toBe("fetched-data");
      expect(result2.level).toBe("l1");
      expect(result2.hit).toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("should call fetchFn on cache miss", async () => {
      const fetchFn = vi.fn().mockResolvedValue({ value: 42 });

      const result = await get("new-key", fetchFn);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual({ value: 42 });
      expect(result.hit).toBe(false);
    });

    it("should respect forceRefresh option", async () => {
      const fetchFn = vi.fn().mockResolvedValue("fresh-data");

      // Populate cache
      await get("refresh-key", fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Force refresh should bypass cache
      const result = await get("refresh-key", fetchFn, { forceRefresh: true });
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result.data).toBe("fresh-data");
      expect(result.hit).toBe(false);
    });

    it("should respect skipL1 option", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");

      // First call with skipL1
      await get("skip-l1-key", fetchFn, { skipL1: true });

      // Second call should still miss L1
      const result = await get("skip-l1-key", fetchFn, { skipL1: true });
      expect(result.level).toBe("miss");
    });

    it("should include latency in result", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");

      const result = await get("latency-key", fetchFn);

      expect(typeof result.latency).toBe("number");
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it("should handle fetchFn errors", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("Fetch failed"));

      await expect(get("error-key", fetchFn)).rejects.toThrow("Fetch failed");
    });
  });

  describe("set", () => {
    it("should store data in cache", async () => {
      await set("set-key", { test: "value" });

      const fetchFn = vi.fn();
      const result = await get("set-key", fetchFn);

      expect(result.data).toEqual({ test: "value" });
      expect(result.hit).toBe(true);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("should accept custom TTL options", async () => {
      await set("ttl-key", "data", { l1Ttl: 1000, l2Ttl: 5000 });

      const fetchFn = vi.fn();
      const result = await get("ttl-key", fetchFn);

      expect(result.hit).toBe(true);
    });
  });

  describe("del", () => {
    it("should remove data from cache", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");

      // Populate cache
      await get("del-key", fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Delete
      await del("del-key");

      // Should miss now
      await get("del-key", fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("clear", () => {
    it("should clear all L1 cache entries", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");

      // Populate cache
      await get("clear-key-1", fetchFn);
      await get("clear-key-2", fetchFn);

      // Clear
      await clear();

      // Both should miss
      await get("clear-key-1", fetchFn);
      await get("clear-key-2", fetchFn);

      expect(fetchFn).toHaveBeenCalledTimes(4);
    });
  });

  describe("statistics", () => {
    it("should track L1 hits and misses", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");

      // Miss
      await get("stats-key", fetchFn);

      // Hit
      await get("stats-key", fetchFn);

      const stats = getStats();
      expect(stats.l1Hits).toBe(1);
      expect(stats.l1Misses).toBeGreaterThanOrEqual(1);
      expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
    });

    it("should calculate hit rate", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");

      // 1 miss, 3 hits
      await get("rate-key", fetchFn);
      await get("rate-key", fetchFn);
      await get("rate-key", fetchFn);
      await get("rate-key", fetchFn);

      const stats = getStats();
      expect(stats.hitRate).toBeGreaterThan(0);
    });

    it("should reset statistics", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");

      await get("reset-key", fetchFn);
      await get("reset-key", fetchFn);

      resetStats();

      const stats = getStats();
      expect(stats.l1Hits).toBe(0);
      expect(stats.l1Misses).toBe(0);
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe("getMetrics", () => {
    it("should return comprehensive metrics", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");
      await get("metrics-key", fetchFn);

      const metrics = getMetrics();

      expect(metrics).toHaveProperty("stats");
      expect(metrics).toHaveProperty("l1Entries");
      expect(metrics).toHaveProperty("l1Pending");
      expect(metrics).toHaveProperty("config");
      expect(metrics.config).toHaveProperty("l1MaxTtl");
      expect(metrics.config).toHaveProperty("l2MaxTtl");
      expect(metrics.config).toHaveProperty("l1MaxEntries");
      expect(metrics.config).toHaveProperty("stampedeTimeout");
    });
  });

  describe("buildKey", () => {
    it("should build cache key from parts", () => {
      const key = buildKey(["user", 123, "profile"]);
      expect(key).toBe("cache:user:123:profile");
    });

    it("should use custom prefix", () => {
      const key = buildKey(["data", "test"], "api");
      expect(key).toBe("api:data:test");
    });

    it("should handle boolean values", () => {
      const key = buildKey(["feature", true, "enabled"]);
      expect(key).toBe("cache:feature:true:enabled");
    });
  });

  describe("tag-based invalidation", () => {
    it("should associate tags with cache entries", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");

      await get("tagged-key", fetchFn, { tags: ["user", "profile"] });

      const tags = getTagsForKey("tagged-key");
      expect(tags).toContain("user");
      expect(tags).toContain("profile");
    });

    it("should invalidate entries by tag", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");

      await get("tag-key-1", fetchFn, { tags: ["category-a"] });
      await get("tag-key-2", fetchFn, { tags: ["category-a"] });
      await get("tag-key-3", fetchFn, { tags: ["category-b"] });

      const invalidated = invalidateByTag("category-a");
      expect(invalidated).toBe(2);

      // category-a keys should miss
      await get("tag-key-1", fetchFn);
      await get("tag-key-2", fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(5);

      // category-b key should still hit
      const result = await get("tag-key-3", fetchFn);
      expect(result.hit).toBe(true);
    });

    it("should invalidate entries by multiple tags", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");

      await get("multi-tag-1", fetchFn, { tags: ["tag-x"] });
      await get("multi-tag-2", fetchFn, { tags: ["tag-y"] });
      await get("multi-tag-3", fetchFn, { tags: ["tag-z"] });

      const invalidated = invalidateByTags(["tag-x", "tag-y"]);
      expect(invalidated).toBe(2);
    });

    it("should return 0 for non-existent tag", () => {
      const invalidated = invalidateByTag("non-existent");
      expect(invalidated).toBe(0);
    });

    it("should return empty array for untagged key", () => {
      const tags = getTagsForKey("untagged-key");
      expect(tags).toEqual([]);
    });
  });

  describe("getTagStats", () => {
    it("should return tag statistics", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");

      await get("stat-key-1", fetchFn, { tags: ["popular-tag"] });
      await get("stat-key-2", fetchFn, { tags: ["popular-tag"] });
      await get("stat-key-3", fetchFn, { tags: ["rare-tag"] });

      const stats = getTagStats();

      expect(stats.totalTags).toBeGreaterThanOrEqual(2);
      expect(stats.totalTaggedKeys).toBeGreaterThanOrEqual(3);
      expect(stats.topTags).toBeInstanceOf(Array);
    });
  });

  describe("invalidatePattern", () => {
    it("should invalidate entries matching pattern", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");

      await get("user:123:profile", fetchFn);
      await get("user:456:profile", fetchFn);
      await get("product:789:details", fetchFn);

      const invalidated = await invalidatePattern("user:*");
      expect(invalidated).toBe(2);
    });

    it("should return 0 for non-matching pattern", async () => {
      const fetchFn = vi.fn().mockResolvedValue("data");
      await get("some-key", fetchFn);

      const invalidated = await invalidatePattern("non-matching:*");
      expect(invalidated).toBe(0);
    });
  });

  describe("stampede protection", () => {
    it("should prevent concurrent fetches for same key", async () => {
      let fetchCount = 0;
      const fetchFn = vi.fn().mockImplementation(async () => {
        fetchCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return `data-${fetchCount}`;
      });

      // Clear cache first
      await clear();

      // Start multiple concurrent requests
      const promises = [
        get("stampede-key", fetchFn),
        get("stampede-key", fetchFn),
        get("stampede-key", fetchFn),
      ];

      const results = await Promise.all(promises);

      // All should get the same data
      expect(results[0].data).toBe(results[1].data);
      expect(results[1].data).toBe(results[2].data);

      // fetchFn should only be called once
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("L2 Redis integration", () => {
    it("should promote L2 data to L1", async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue(
          JSON.stringify({
            data: "redis-data",
            expiresAt: Date.now() + 60000,
          })
        ),
        set: vi.fn().mockResolvedValue("OK"),
        del: vi.fn().mockResolvedValue(1),
      };

      vi.mocked(getConnectedRedisFromPool).mockResolvedValue(
        mockRedis as unknown as ReturnType<typeof getConnectedRedisFromPool>
      );

      // Clear L1 cache
      await clear();

      const fetchFn = vi.fn().mockResolvedValue("fresh-data");

      // First call should get from L2
      const result = await get("l2-key", fetchFn);

      expect(result.data).toBe("redis-data");
      expect(result.level).toBe("l2");
      expect(result.hit).toBe(true);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("should handle L2 errors gracefully", async () => {
      vi.mocked(getConnectedRedisFromPool).mockRejectedValue(
        new Error("Redis connection failed")
      );

      const fetchFn = vi.fn().mockResolvedValue("fallback-data");

      // Should fall through to fetchFn
      const result = await get("l2-error-key", fetchFn);

      expect(result.data).toBe("fallback-data");
      expect(result.hit).toBe(false);
    });
  });
});
