/**
 * Unit Tests for rateLimit.ts
 *
 * Tests the rate limiting functionality including in-memory fallback,
 * Redis-based sliding window, whitelist, and response helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing rateLimit
vi.mock("../../src/lib/redis", () => ({
  getRedis: vi.fn(),
}));

vi.mock("../../src/lib/env", () => ({
  getEnv: () => ({
    NODE_ENV: "test",
    RATE_LIMIT_ENABLED: true,
    RATE_LIMIT_WHITELIST: "127.0.0.1,test-ip",
    RATE_LIMIT_API: 100,
    RATE_LIMIT_API_WINDOW: 60,
    RATE_LIMIT_CHAT: 20,
    RATE_LIMIT_CHAT_WINDOW: 3600,
    RATE_LIMIT_ADMIN: 50,
    RATE_LIMIT_ADMIN_WINDOW: 60,
    RATE_LIMIT_HEALTH: 1000,
    RATE_LIMIT_HEALTH_WINDOW: 60,
    RATE_LIMIT_METRICS: 100,
    RATE_LIMIT_METRICS_WINDOW: 60,
    RATE_LIMIT_IP_SECRET: "test-secret-key-for-hashing",
  }),
}));

import {
  rateLimit,
  buildRateLimitHeaders,
  rateLimitResponse,
  getClientIdentifier,
  isWhitelisted,
  getRateLimitStats,
  resetRateLimit,
} from "../../src/lib/rateLimit";
import { getRedis } from "../../src/lib/redis";

describe("rateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset any in-memory state by using unique keys
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("in-memory rate limiting", () => {
    beforeEach(() => {
      // Ensure Redis is not available for in-memory tests
      vi.mocked(getRedis).mockReturnValue(null);
    });

    it("should allow requests within limit", async () => {
      const key = `test:${Date.now()}:${Math.random()}`;

      const result = await rateLimit({
        identifier: key,
        limit: 5,
        windowSeconds: 60,
      });

      expect(result.ok).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.limit).toBe(5);
    });

    it("should decrement remaining count", async () => {
      const key = `decrement:${Date.now()}:${Math.random()}`;

      const r1 = await rateLimit({
        identifier: key,
        limit: 3,
        windowSeconds: 60,
      });
      expect(r1.remaining).toBe(2);

      const r2 = await rateLimit({
        identifier: key,
        limit: 3,
        windowSeconds: 60,
      });
      expect(r2.remaining).toBe(1);

      const r3 = await rateLimit({
        identifier: key,
        limit: 3,
        windowSeconds: 60,
      });
      expect(r3.remaining).toBe(0);
    });

    it("should reject requests exceeding limit", async () => {
      const key = `exceed:${Date.now()}:${Math.random()}`;

      // Use up the limit
      await rateLimit({ identifier: key, limit: 2, windowSeconds: 60 });
      await rateLimit({ identifier: key, limit: 2, windowSeconds: 60 });

      // This should be rejected
      const result = await rateLimit({
        identifier: key,
        limit: 2,
        windowSeconds: 60,
      });

      expect(result.ok).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetSeconds).toBeGreaterThan(0);
    });

    it("should include retryAfter when rate limited", async () => {
      const key = `retry:${Date.now()}:${Math.random()}`;

      await rateLimit({ identifier: key, limit: 1, windowSeconds: 60 });
      const result = await rateLimit({
        identifier: key,
        limit: 1,
        windowSeconds: 60,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retryAfter).toBeGreaterThan(0);
      }
    });

    it("should use default API limits when type is specified", async () => {
      const key = `api-type:${Date.now()}:${Math.random()}`;

      const result = await rateLimit({
        identifier: key,
        type: "api",
      });

      expect(result.ok).toBe(true);
      expect(result.limit).toBe(100); // Default API limit from mock
    });

    it("should use chat limits when type is chat", async () => {
      const key = `chat-type:${Date.now()}:${Math.random()}`;

      const result = await rateLimit({
        identifier: key,
        type: "chat",
      });

      expect(result.ok).toBe(true);
      expect(result.limit).toBe(20); // Default chat limit from mock
    });
  });

  describe("whitelist", () => {
    beforeEach(() => {
      vi.mocked(getRedis).mockReturnValue(null);
    });

    it("should bypass rate limiting for whitelisted IPs", async () => {
      const result = await rateLimit({
        identifier: "127.0.0.1",
        limit: 1,
        windowSeconds: 60,
      });

      expect(result.ok).toBe(true);
      expect(result.remaining).toBe(1); // Full limit available
    });

    it("should check whitelist correctly", () => {
      expect(isWhitelisted("127.0.0.1")).toBe(true);
      expect(isWhitelisted("test-ip")).toBe(true);
      expect(isWhitelisted("unknown-ip")).toBe(false);
    });
  });

  describe("buildRateLimitHeaders", () => {
    it("should build headers for successful request", () => {
      const result = {
        ok: true as const,
        remaining: 5,
        resetSeconds: 60,
        limit: 10,
      };

      const headers = buildRateLimitHeaders(result);

      expect(headers["X-RateLimit-Limit"]).toBe("10");
      expect(headers["X-RateLimit-Remaining"]).toBe("5");
      expect(headers["X-RateLimit-Reset"]).toBe("60");
      expect(headers["Retry-After"]).toBeUndefined();
    });

    it("should include Retry-After for rate limited request", () => {
      const result = {
        ok: false as const,
        remaining: 0 as const,
        resetSeconds: 30,
        limit: 10,
        retryAfter: 30,
      };

      const headers = buildRateLimitHeaders(result);

      expect(headers["Retry-After"]).toBe("30");
    });
  });

  describe("rateLimitResponse", () => {
    it("should create 429 response", () => {
      const result = {
        ok: false as const,
        remaining: 0 as const,
        resetSeconds: 60,
        limit: 10,
        retryAfter: 60,
      };

      const response = rateLimitResponse(result);

      expect(response.status).toBe(429);
    });
  });

  describe("getClientIdentifier", () => {
    it("should extract IP from x-forwarded-for header", () => {
      const request = new Request("http://localhost/api/test", {
        headers: {
          "x-forwarded-for": "192.168.1.1, 10.0.0.1",
        },
      });

      const identifier = getClientIdentifier(request);

      expect(identifier).toMatch(/^ip:/);
    });

    it("should extract IP from x-real-ip header", () => {
      const request = new Request("http://localhost/api/test", {
        headers: {
          "x-real-ip": "192.168.1.100",
        },
      });

      const identifier = getClientIdentifier(request);

      expect(identifier).toMatch(/^ip:/);
    });

    it("should extract IP from cf-connecting-ip header", () => {
      const request = new Request("http://localhost/api/test", {
        headers: {
          "cf-connecting-ip": "203.0.113.50",
        },
      });

      const identifier = getClientIdentifier(request);

      expect(identifier).toMatch(/^ip:/);
    });

    it("should fallback to user-agent hash", () => {
      const request = new Request("http://localhost/api/test", {
        headers: {
          "user-agent": "Mozilla/5.0 Test Browser",
        },
      });

      const identifier = getClientIdentifier(request);

      expect(identifier).toMatch(/^ua:/);
    });

    it("should handle missing headers", () => {
      const request = new Request("http://localhost/api/test");

      const identifier = getClientIdentifier(request);

      expect(identifier).toMatch(/^ua:/);
    });

    it("should hash IPs for privacy", () => {
      const request1 = new Request("http://localhost/api/test", {
        headers: { "x-real-ip": "192.168.1.1" },
      });
      const request2 = new Request("http://localhost/api/test", {
        headers: { "x-real-ip": "192.168.1.2" },
      });

      const id1 = getClientIdentifier(request1);
      const id2 = getClientIdentifier(request2);

      // Different IPs should produce different hashes
      expect(id1).not.toBe(id2);

      // Same IP should produce same hash
      const id1Again = getClientIdentifier(request1);
      expect(id1).toBe(id1Again);
    });
  });

  describe("getRateLimitStats", () => {
    it("should return stats object", () => {
      const stats = getRateLimitStats();

      expect(stats).toHaveProperty("memoryEntries");
      expect(stats).toHaveProperty("redisConnected");
      expect(stats).toHaveProperty("whitelist");
      expect(Array.isArray(stats.whitelist)).toBe(true);
    });
  });

  describe("resetRateLimit", () => {
    beforeEach(() => {
      vi.mocked(getRedis).mockReturnValue(null);
    });

    it("should reset rate limit for identifier", async () => {
      const key = `reset:${Date.now()}:${Math.random()}`;

      // Use up limit
      await rateLimit({ identifier: key, limit: 1, windowSeconds: 60 });
      const blocked = await rateLimit({
        identifier: key,
        limit: 1,
        windowSeconds: 60,
      });
      expect(blocked.ok).toBe(false);

      // Reset
      const success = resetRateLimit(key);
      expect(success).toBe(true);

      // Should be allowed again
      const result = await rateLimit({
        identifier: key,
        limit: 1,
        windowSeconds: 60,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("Redis-based rate limiting", () => {
    it("should use Redis when available", async () => {
      const mockRedis = {
        connect: vi.fn().mockResolvedValue(undefined),
        eval: vi.fn().mockResolvedValue([1, 60]),
      };

      vi.mocked(getRedis).mockReturnValue(mockRedis as any);

      const key = `redis:${Date.now()}:${Math.random()}`;
      const result = await rateLimit({
        identifier: key,
        limit: 10,
        windowSeconds: 60,
      });

      expect(result.ok).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalled();
    });

    it("should fallback to memory on Redis error", async () => {
      const mockRedis = {
        connect: vi.fn().mockRejectedValue(new Error("Connection failed")),
        eval: vi.fn(),
      };

      vi.mocked(getRedis).mockReturnValue(mockRedis as any);

      const key = `redis-error:${Date.now()}:${Math.random()}`;
      const result = await rateLimit({
        identifier: key,
        limit: 10,
        windowSeconds: 60,
      });

      // Should still work via memory fallback
      expect(result.ok).toBe(true);
    });
  });
});
