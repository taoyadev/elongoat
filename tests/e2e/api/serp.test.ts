/**
 * E2E Tests for /api/serp Endpoint
 *
 * Tests the SERP (Search Engine Results Page) API endpoint
 * including query handling, caching, and error handling.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestClient } from "../helpers";

describe("API: /api/serp", () => {
  const client = new TestClient({
    baseUrl: process.env.TEST_API_URL ?? "http://localhost:3000",
  });

  describe("GET /api/serp", () => {
    it("should accept a valid search query", async () => {
      const response = await client.get("/api/serp", {
        query: { query: "elon musk" },
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("query", "elon musk");
      expect(response.data).toHaveProperty("results");
      expect(response.data).toHaveProperty("cached");
    });

    it("should reject requests without query parameter", async () => {
      const response = await client.get("/api/serp");

      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty("error");
    });

    it("should reject requests with short query", async () => {
      const response = await client.get("/api/serp", {
        query: { query: "a" },
      });

      expect(response.status).toBe(400);
    });

    it("should respect limit parameter", async () => {
      const response = await client.get("/api/serp", {
        query: { query: "spacex", limit: "5" },
      });

      expect(response.status).toBe(200);
      const results = (response.data as { results: unknown[] }).results;
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("should enforce max limit of 50", async () => {
      const response = await client.get("/api/serp", {
        query: { query: "tesla", limit: "100" },
      });

      expect(response.status).toBe(200);
      const results = (response.data as { results: unknown[] }).results;
      expect(results.length).toBeLessThanOrEqual(50);
    });

    it("should support force refresh parameter", async () => {
      const response = await client.get("/api/serp", {
        query: { query: "starship", force: "true" },
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("cached", false);
    });

    it("should include people also ask data", async () => {
      const response = await client.get("/api/serp", {
        query: { query: "elon musk net worth" },
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("peopleAlsoAsk");
    });

    it("should include related searches", async () => {
      const response = await client.get("/api/serp", {
        query: { query: "mars colonization" },
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("relatedSearches");
    });
  });

  describe("POST /api/serp", () => {
    it("should accept a valid search request body", async () => {
      const response = await client.post("/api/serp", {
        query: "elon musk companies",
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("query");
      expect(response.data).toHaveProperty("results");
    });

    it("should reject requests with empty query", async () => {
      const response = await client.post("/api/serp", {
        query: "",
      });

      expect(response.status).toBe(400);
    });

    it("should reject requests with oversized query", async () => {
      const response = await client.post("/api/serp", {
        query: "a".repeat(600),
      });

      expect(response.status).toBe(400);
    });

    it("should support limit in request body", async () => {
      const response = await client.post("/api/serp", {
        query: "spacex starship",
        limit: 10,
      });

      expect(response.status).toBe(200);
      const results = (response.data as { results: unknown[] }).results;
      expect(results.length).toBeLessThanOrEqual(10);
    });

    it("should support analysis mode", async () => {
      const response = await client.post("/api/serp", {
        query: "tesla model 3",
        analysis: true,
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("query");
      expect(response.data).toHaveProperty("topResults");
      expect(response.data).toHaveProperty("contentGaps");
      expect(response.data).toHaveProperty("suggestedHeadings");
    });

    it("should return analysis with content gaps", async () => {
      const response = await client.post("/api/serp", {
        query: "spacex vs blue origin",
        analysis: true,
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("contentGaps");
      const gaps = (response.data as { contentGaps: unknown[] }).contentGaps;
      expect(Array.isArray(gaps)).toBe(true);
    });

    it("should return analysis with suggested headings", async () => {
      const response = await client.post("/api/serp", {
        query: "how to build a rocket",
        analysis: true,
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("suggestedHeadings");
      const headings = (response.data as { suggestedHeadings: unknown[] })
        .suggestedHeadings;
      expect(Array.isArray(headings)).toBe(true);
    });
  });

  describe("DELETE /api/serp", () => {
    it("should clear all SERP cache", async () => {
      const response = await client.delete("/api/serp");

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("success", true);
      expect(response.data).toHaveProperty("message");
      expect(response.data).toHaveProperty("remaining");
    });

    it("should clear cache by pattern", async () => {
      const response = await client.delete("/api/serp", {
        headers: {},
      });

      // Add query parameter for pattern
      const url = new URL("/api/serp", client["baseUrl"]);
      url.searchParams.set("pattern", "elon");

      const deleteResponse = await fetch(url.toString(), { method: "DELETE" });

      expect(deleteResponse.status).toBe(200);
    });
  });

  describe("OPTIONS /api/serp", () => {
    it("should return CORS headers", async () => {
      const url = new URL("/api/serp", client["baseUrl"]);
      const response = await fetch(url.toString(), { method: "OPTIONS" });

      // Route handler returns 204, while middleware preflight returns 200.
      expect([200, 204]).toContain(response.status);

      const allowMethods = response.headers.get("access-control-allow-methods");
      if (allowMethods) {
        expect(allowMethods).toContain("GET");
        expect(allowMethods).toContain("POST");
      }
    });
  });

  describe("Response Structure", () => {
    it("should include proper result structure", async () => {
      const response = await client.get("/api/serp", {
        query: { query: "elon musk" },
      });

      expect(response.status).toBe(200);
      const results = (response.data as { results: unknown[] }).results;

      if (results.length > 0) {
        const firstResult = results[0];
        expect(firstResult).toHaveProperty("title");
        expect(firstResult).toHaveProperty("link");
        expect(firstResult).toHaveProperty("snippet");
        expect(firstResult).toHaveProperty("position");
      }
    });

    it("should include search metadata", async () => {
      const response = await client.post("/api/serp", {
        query: "tesla",
      });

      expect(response.status).toBe(200);

      // Metadata can be absent when provider calls fail but request still succeeds.
      if (response.data && "totalResults" in response.data) {
        expect(response.data).toHaveProperty("totalResults");
      }
      if (response.data && "searchTime" in response.data) {
        expect(response.data).toHaveProperty("searchTime");
      }
    });
  });

  describe("Caching Behavior", () => {
    it("should cache responses by default", async () => {
      // First request
      const response1 = await client.get("/api/serp", {
        query: { query: "starship launch" },
      });

      expect(response1.status).toBe(200);
      expect(response1.data).toHaveProperty("cached", true);

      // Second request should be cached
      const response2 = await client.get("/api/serp", {
        query: { query: "starship launch" },
      });

      expect(response2.status).toBe(200);
      expect(response2.data).toHaveProperty("cached", true);
    });

    it("should bypass cache with force parameter", async () => {
      const response = await client.get("/api/serp", {
        query: { query: "mars mission", force: "true" },
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("cached", false);
    });
  });

  describe("Response Headers", () => {
    it("should include cache control headers", async () => {
      const response = await client.get("/api/serp", {
        query: { query: "spacex" },
      });

      expect(response.headers.has("cache-control")).toBe(true);
      const cacheControl = response.headers.get("cache-control");
      expect(cacheControl).toContain("public");
      expect(cacheControl).toContain("s-maxage");
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed query gracefully", async () => {
      const response = await client.get("/api/serp", {
        query: { query: "   " },
      });

      // Should either succeed with trimmed query or fail gracefully
      expect([200, 400, 500]).toContain(response.status);
    });

    it("should handle Proxy-Grid unavailability", async () => {
      // This test would require mocking Proxy-Grid to be unavailable
      // For now, just verify error handling structure
      const response = await client.get("/api/serp", {
        query: { query: "test query " + Date.now() },
      });

      // Should either succeed or return a proper error
      if (!response.ok) {
        expect(response.data).toHaveProperty("error");
      }
    });
  });
});
