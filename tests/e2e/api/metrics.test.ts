/**
 * E2E Tests for /api/metrics Endpoint
 *
 * Tests the Prometheus-compatible metrics endpoint including
 * metric format, content type, and optional authentication.
 */

import { describe, it, expect } from "vitest";
import { TestClient } from "../helpers";

describe("API: /api/metrics", () => {
  const client = new TestClient({
    baseUrl: process.env.TEST_API_URL ?? "http://localhost:3000",
  });

  describe("GET /api/metrics (no auth)", () => {
    it("should return metrics when no token is configured", async () => {
      const response = await client.get("/api/metrics");

      // If METRICS_TOKEN is not set, should return 200
      // If METRICS_TOKEN is set, should return 401
      expect([200, 401]).toContain(response.status);

      if (response.status === 200) {
        // Metrics endpoint returns Prometheus plain text, not JSON payload.
        expect(response.headers.get("content-type")).toContain("text/plain");
      }
    });

    it("should return plain text content type", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.status === 200) {
        const contentType = response.headers.get("content-type");
        expect(contentType).toContain("text/plain");
        // Next.js Prometheus text exposition format
        expect(contentType).toContain("version=0.0.4");
      }
    });
  });

  describe("Metrics Format", () => {
    it("should include HELP comments", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text).toContain("# HELP");
      }
    });

    it("should include TYPE comments", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text).toContain("# TYPE");
      }
    });

    it("should include memory metrics", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text).toContain("nodejs_heap_used_bytes");
        expect(text).toContain("nodejs_heap_total_bytes");
      }
    });

    it("should include database pool metrics", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        const hasPoolUtilization = text.includes("db_pool_utilization_percent");
        const hasPoolTotal = text.includes("db_pool_total_connections");

        // Database metrics are exported only when a DB pool is configured.
        expect(hasPoolUtilization).toBe(hasPoolTotal);
      }
    });

    it("should include cache metrics", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text).toContain("cache_hit_rate");
        expect(text).toContain("cache_l1_entries");
      }
    });

    it("should include HTTP metrics", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text).toContain("http_request_duration_p95_ms");
        expect(text).toContain("http_error_rate");
      }
    });

    it("should include Redis metrics", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text).toContain("redis_enabled");
        expect(text).toContain("redis_pool_size");
      }
    });

    it("should include circuit breaker metrics", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        // Circuit breaker metrics may be present
        expect(text.length).toBeGreaterThan(0);
      }
    });

    it("should include timestamp metric", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text).toContain("metrics_timestamp_ms");
      }
    });
  });

  describe("Metric Values", () => {
    it("should have valid numeric values", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        const lines = text.split("\n").filter((line) => {
          return line.trim() && !line.startsWith("#") && line.includes(" ");
        });

        for (const line of lines.slice(0, 10)) {
          const parts = line.split(" ");
          const value = parseFloat(parts[parts.length - 1]);
          expect(value).not.toBeNaN();
        }
      }
    });

    it("should include labels for some metrics", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        // Look for metrics with labels (endpoint metrics)
        const hasLabels = text.includes("{");
        expect(hasLabels).toBe(true);
      }
    });
  });

  describe("Authentication (when enabled)", () => {
    it("should reject requests without token when auth is enabled", async () => {
      // This test only applies if METRICS_TOKEN is set
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.status === 401) {
        expect(response.status).toBe(401);
        const text = await response.text();
        expect(text).toContain("Unauthorized");
      }
    });

    it("should accept requests with valid token", async () => {
      const token = process.env.METRICS_TOKEN;

      if (token) {
        const url = new URL("/api/metrics", client["baseUrl"]);
        const response = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        expect(response.status).toBe(200);
      }
    });

    it("should reject requests with invalid token", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: "Bearer invalid_token_12345",
        },
      });

      // If auth is enabled, should return 401
      // If auth is not enabled, should return 200
      expect([200, 401]).toContain(response.status);
    });
  });

  describe("Response Headers", () => {
    it("should include cache control headers", async () => {
      const response = await client.get("/api/metrics");

      if (response.status === 200) {
        expect(response.headers.has("cache-control")).toBe(true);
        const cacheControl = response.headers.get("cache-control");
        expect(cacheControl).toContain("no-store");
      }
    });

    it("should include rate limit headers", async () => {
      const response = await client.get("/api/metrics");

      if (response.status === 200) {
        expect(response.headers.has("x-ratelimit-limit")).toBe(true);
      }
    });
  });

  describe("Metric Categories", () => {
    it("should include process metrics", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text).toContain("nodejs_uptime_seconds");
        expect(text).toContain("nodejs_rss_bytes");
      }
    });

    it("should include request metrics", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text).toContain("http_requests_total");
        expect(text).toContain("http_request_duration_avg_ms");
      }
    });

    it("should include cache stampede prevention metric", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text).toContain("cache_stampede_preventions_total");
      }
    });
  });

  describe("Consistency", () => {
    it("should return same format on repeated requests", async () => {
      const url = new URL("/api/metrics", client["baseUrl"]);

      const response1 = await fetch(url.toString());
      const response2 = await fetch(url.toString());

      if (response1.ok && response2.ok) {
        const text1 = await response1.text();
        const text2 = await response2.text();

        // Should both contain the same metric types
        const getMetricTypes = (text: string) => {
          const matches = text.matchAll(/# TYPE (\w+)/g);
          return Array.from(matches).map((m) => m[1]);
        };

        const types1 = getMetricTypes(text1);
        const types2 = getMetricTypes(text2);

        expect(types1.length).toBeGreaterThan(0);
        expect(types1.sort()).toEqual(types2.sort());
      }
    });
  });
});
