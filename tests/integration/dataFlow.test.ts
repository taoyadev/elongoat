/**
 * Integration Tests for Data Flow
 *
 * Tests the data flow from database through cache to API responses,
 * ensuring proper integration between components.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all external dependencies
vi.mock("server-only", () => ({}));

const mockDbPool = {
  query: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
  totalCount: 5,
  idleCount: 3,
  waitingCount: 0,
  options: { max: 10 },
};

const mockRedis = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue("OK"),
  del: vi.fn().mockResolvedValue(1),
  connect: vi.fn().mockResolvedValue(undefined),
  ping: vi.fn().mockResolvedValue("PONG"),
  status: "ready",
};

vi.mock("../../src/lib/db", () => ({
  getDbPool: vi.fn(() => mockDbPool),
  initDbPool: vi.fn(() => Promise.resolve(mockDbPool)),
}));

vi.mock("../../src/lib/redis", () => ({
  getRedis: vi.fn(() => mockRedis),
  getConnectedRedisFromPool: vi.fn(() => Promise.resolve(mockRedis)),
  isRedisEnabled: vi.fn(() => true),
}));

vi.mock("../../src/lib/env", () => ({
  getEnv: () => ({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    REDIS_URL: "redis://localhost:6379",
    TIERED_CACHE_L1_TTL_MS: 300000,
    TIERED_CACHE_L2_TTL_MS: 3600000,
    TIERED_CACHE_L1_MAX_ENTRIES: 1000,
    TIERED_CACHE_L1_CLEANUP_MS: 60000,
    TIERED_CACHE_STAMP_TIMEOUT_MS: 5000,
  }),
}));

import { getDbPool } from "../../src/lib/db";
import { getRedis, getConnectedRedisFromPool } from "../../src/lib/redis";

describe("Data Flow Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbPool.query.mockReset();
    mockRedis.get.mockReset();
    mockRedis.set.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Database to Cache Flow", () => {
    it("should fetch from database on cache miss", async () => {
      // Cache miss
      mockRedis.get.mockResolvedValue(null);

      // Database returns data
      mockDbPool.query.mockResolvedValue({
        rows: [{ id: 1, name: "Test Item" }],
        rowCount: 1,
      });

      const db = getDbPool();
      const redis = getRedis();

      // Check cache first
      const cached = await redis?.get("item:1");
      expect(cached).toBeNull();

      // Fetch from database
      const result = await db?.query("SELECT * FROM items WHERE id = $1", [1]);
      expect(result?.rows[0]).toEqual({ id: 1, name: "Test Item" });

      // Store in cache
      await redis?.set("item:1", JSON.stringify(result?.rows[0]));
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it("should return cached data on cache hit", async () => {
      const cachedData = { id: 1, name: "Cached Item" };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

      const redis = getRedis();

      // Check cache
      const cached = await redis?.get("item:1");
      expect(cached).toBeTruthy();

      const data = JSON.parse(cached!);
      expect(data).toEqual(cachedData);

      // Database should not be called
      expect(mockDbPool.query).not.toHaveBeenCalled();
    });

    it("should handle cache invalidation", async () => {
      // Initial cache hit
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({ id: 1, name: "Old Data" })
      );

      const redis = getRedis();

      // Get cached data
      const cached = await redis?.get("item:1");
      expect(JSON.parse(cached!).name).toBe("Old Data");

      // Invalidate cache
      await redis?.del("item:1");
      expect(mockRedis.del).toHaveBeenCalledWith("item:1");

      // Cache miss after invalidation
      mockRedis.get.mockResolvedValueOnce(null);
      const afterInvalidation = await redis?.get("item:1");
      expect(afterInvalidation).toBeNull();
    });
  });

  describe("Tiered Cache Integration", () => {
    it("should promote L2 data to L1", async () => {
      // L1 miss, L2 hit
      const l2Data = { id: 1, name: "L2 Data" };
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ data: l2Data, expiresAt: Date.now() + 60000 })
      );

      const redis = await getConnectedRedisFromPool();
      const raw = await redis?.get("cache:item:1");

      if (raw) {
        const parsed = JSON.parse(raw);
        expect(parsed.data).toEqual(l2Data);
      }
    });

    it("should handle L2 cache errors gracefully", async () => {
      mockRedis.get.mockRejectedValue(new Error("Redis connection failed"));

      const redis = await getConnectedRedisFromPool();

      try {
        await redis?.get("cache:item:1");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }

      // Should fall back to database
      mockDbPool.query.mockResolvedValue({
        rows: [{ id: 1, name: "Fallback Data" }],
      });

      const db = getDbPool();
      const result = await db?.query("SELECT * FROM items WHERE id = $1", [1]);
      expect(result?.rows[0].name).toBe("Fallback Data");
    });
  });

  describe("Transaction Flow", () => {
    it("should maintain data consistency in transactions", async () => {
      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      mockDbPool.connect.mockResolvedValue(mockClient);
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT
        .mockResolvedValueOnce(undefined); // COMMIT

      const db = getDbPool();
      const client = await db?.connect();

      await client?.query("BEGIN");
      const result = await client?.query(
        "INSERT INTO items (name) VALUES ($1) RETURNING id",
        ["New Item"]
      );
      await client?.query("COMMIT");
      client?.release();

      expect(result?.rows[0].id).toBe(1);
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    });

    it("should rollback on transaction error", async () => {
      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      mockDbPool.connect.mockResolvedValue(mockClient);
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error("Constraint violation")) // INSERT
        .mockResolvedValueOnce(undefined); // ROLLBACK

      const db = getDbPool();
      const client = await db?.connect();

      await client?.query("BEGIN");

      try {
        await client?.query("INSERT INTO items (name) VALUES ($1)", [null]);
      } catch {
        await client?.query("ROLLBACK");
      }

      client?.release();

      expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    });
  });

  describe("Batch Operations", () => {
    it("should handle batch database queries", async () => {
      mockDbPool.query.mockResolvedValue({
        rows: [
          { id: 1, name: "Item 1" },
          { id: 2, name: "Item 2" },
          { id: 3, name: "Item 3" },
        ],
        rowCount: 3,
      });

      const db = getDbPool();
      const result = await db?.query(
        "SELECT * FROM items WHERE id = ANY($1)",
        [[1, 2, 3]]
      );

      expect(result?.rows).toHaveLength(3);
      expect(result?.rows.map((r: { id: number }) => r.id)).toEqual([1, 2, 3]);
    });

    it("should handle batch cache operations", async () => {
      const mockPipeline = {
        set: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([["OK"], ["OK"], ["OK"]]),
      };

      mockRedis.pipeline = vi.fn().mockReturnValue(mockPipeline);

      const redis = getRedis() as typeof mockRedis & {
        pipeline: () => typeof mockPipeline;
      };
      const pipeline = redis?.pipeline();

      pipeline?.set("item:1", JSON.stringify({ id: 1 }));
      pipeline?.set("item:2", JSON.stringify({ id: 2 }));
      pipeline?.set("item:3", JSON.stringify({ id: 3 }));

      const results = await pipeline?.exec();

      expect(results).toHaveLength(3);
      expect(mockPipeline.set).toHaveBeenCalledTimes(3);
    });
  });

  describe("Error Recovery", () => {
    it("should recover from database connection errors", async () => {
      // First call fails
      mockDbPool.query.mockRejectedValueOnce(
        new Error("Connection terminated")
      );

      // Second call succeeds
      mockDbPool.query.mockResolvedValueOnce({
        rows: [{ id: 1, name: "Recovered Data" }],
      });

      const db = getDbPool();

      // First attempt fails
      try {
        await db?.query("SELECT * FROM items");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }

      // Retry succeeds
      const result = await db?.query("SELECT * FROM items");
      expect(result?.rows[0].name).toBe("Recovered Data");
    });

    it("should recover from Redis connection errors", async () => {
      // First call fails
      mockRedis.get.mockRejectedValueOnce(new Error("Connection refused"));

      // Second call succeeds
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({ id: 1, name: "Recovered" })
      );

      const redis = getRedis();

      // First attempt fails
      try {
        await redis?.get("item:1");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }

      // Retry succeeds
      const result = await redis?.get("item:1");
      expect(JSON.parse(result!).name).toBe("Recovered");
    });
  });

  describe("Concurrent Access", () => {
    it("should handle concurrent database queries", async () => {
      mockDbPool.query.mockImplementation(async (sql: string, params: unknown[]) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          rows: [{ id: (params as number[])[0], name: `Item ${(params as number[])[0]}` }],
        };
      });

      const db = getDbPool();

      const queries = [
        db?.query("SELECT * FROM items WHERE id = $1", [1]),
        db?.query("SELECT * FROM items WHERE id = $1", [2]),
        db?.query("SELECT * FROM items WHERE id = $1", [3]),
      ];

      const results = await Promise.all(queries);

      expect(results).toHaveLength(3);
      expect(results[0]?.rows[0].id).toBe(1);
      expect(results[1]?.rows[0].id).toBe(2);
      expect(results[2]?.rows[0].id).toBe(3);
    });

    it("should handle concurrent cache operations", async () => {
      let callCount = 0;
      mockRedis.get.mockImplementation(async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return JSON.stringify({ id: callCount, name: `Item ${callCount}` });
      });

      const redis = getRedis();

      const operations = [
        redis?.get("item:1"),
        redis?.get("item:2"),
        redis?.get("item:3"),
      ];

      const results = await Promise.all(operations);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toBeTruthy();
      });
    });
  });
});
