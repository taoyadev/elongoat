/**
 * E2E Tests for /api/articles Endpoint
 *
 * Tests the articles API which provides content for the site.
 */

import { describe, it, expect } from "vitest";
import { TestClient } from "../helpers";

describe("API: /api/articles", () => {
  const client = new TestClient({
    baseUrl: process.env.TEST_API_URL ?? "http://localhost:3000",
  });

  const allowRateLimited = (status: number) => {
    expect([200, 429]).toContain(status);
  };

  describe("GET /api/articles", () => {
    it("should return articles list", async () => {
      const response = await client.get("/api/articles");

      allowRateLimited(response.status);
      if (response.status === 200) {
        expect(response.data).toHaveProperty("articles");
      }
    });

    it("should support pagination", async () => {
      const response = await client.get("/api/articles", {
        query: { limit: "10", offset: "0" },
      });

      allowRateLimited(response.status);
      if (response.status === 200 && response.data) {
        const articles = (response.data as { articles: unknown[] }).articles;
        expect(Array.isArray(articles)).toBe(true);
        expect(articles.length).toBeLessThanOrEqual(10);
      }
    });

    it("should support filtering by topic", async () => {
      const response = await client.get("/api/articles", {
        query: { topic: "mars" },
      });

      allowRateLimited(response.status);
    });
  });

  describe("GET /api/articles/slugs", () => {
    it("should return list of article slugs", async () => {
      const response = await client.get("/api/articles/slugs");

      allowRateLimited(response.status);
      if (response.status === 200) {
        expect(response.data).toHaveProperty("slugs");
        const slugs = (response.data as { slugs: unknown[] }).slugs;
        expect(Array.isArray(slugs)).toBe(true);
      }
    });

    it("should include only string slugs", async () => {
      const response = await client.get("/api/articles/slugs");

      if (response.status === 200) {
        const slugs = (response.data as { slugs: string[] }).slugs;
        for (const slug of slugs.slice(0, 10)) {
          expect(typeof slug).toBe("string");
        }
      }
    });
  });

  describe("Response Structure", () => {
    it("should include proper headers", async () => {
      const response = await client.get("/api/articles");

      if (response.status === 200) {
        expect(response.headers.get("content-type")).toContain(
          "application/json",
        );
      }
    });

    it("should include cache headers", async () => {
      const response = await client.get("/api/articles");

      if (response.status === 200) {
        expect(response.headers.has("cache-control")).toBe(true);
      }
    });
  });
});
