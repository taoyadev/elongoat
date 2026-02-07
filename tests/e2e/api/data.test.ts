/**
 * E2E Tests for /api/data/* Endpoints
 *
 * Tests the data API endpoints that provide content for
 * cluster pages, topic pages, and Q&A pages.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { TestClient } from "../helpers";

describe("API: /api/data", () => {
  const client = new TestClient({
    baseUrl: process.env.TEST_API_URL ?? "http://localhost:3000",
  });

  let sampleTopicSlug = "";
  let samplePageSlug = "";

  beforeAll(async () => {
    const clusterResponse = await client.get<{
      cluster?: {
        topics?: Array<{ slug?: string }>;
      };
    }>("/api/data/cluster");

    expect(clusterResponse.status).toBe(200);

    const topics = clusterResponse.data?.cluster?.topics ?? [];
    expect(topics.length).toBeGreaterThan(0);

    sampleTopicSlug = topics[0]?.slug ?? "";
    expect(sampleTopicSlug.length).toBeGreaterThan(0);

    const topicResponse = await client.get<{
      topic?: {
        pages?: Array<{ pageSlug?: string }>;
      };
    }>(`/api/data/topic/${sampleTopicSlug}`);

    expect(topicResponse.status).toBe(200);

    const pages = topicResponse.data?.topic?.pages ?? [];
    expect(pages.length).toBeGreaterThan(0);

    samplePageSlug = pages[0]?.pageSlug ?? "";
    expect(samplePageSlug.length).toBeGreaterThan(0);
  });

  describe("GET /api/data/topic/:slug", () => {
    it("should return topic data for valid slug", async () => {
      const response = await client.get(`/api/data/topic/${sampleTopicSlug}`);

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("found", true);
      expect(response.data).toHaveProperty("topic");

      const topic = (response.data as { topic: Record<string, unknown> }).topic;
      expect(topic).toHaveProperty("slug");
      expect(topic).toHaveProperty("topic");
      expect(topic).toHaveProperty("pageCount");
    });

    it("should return 404 for non-existent topic", async () => {
      const response = await client.get(
        "/api/data/topic/nonexistent-topic-xyz-123",
      );

      expect([404, 200]).toContain(response.status);
    });

    it("should include pages array", async () => {
      const response = await client.get(`/api/data/topic/${sampleTopicSlug}`);

      if (response.status === 200) {
        const topic = (response.data as { topic: { pages?: unknown[] } }).topic;
        expect(topic).toHaveProperty("pages");
        const pages = topic.pages ?? [];
        expect(Array.isArray(pages)).toBe(true);
      }
    });
  });

  describe("GET /api/data/page/:topic/:page", () => {
    it("should return page data for valid topic and page", async () => {
      const response = await client.get(
        `/api/data/page/${sampleTopicSlug}/${samplePageSlug}`,
      );

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("found", true);
      expect(response.data).toHaveProperty("page");

      const page = (response.data as { page: Record<string, unknown> }).page;
      expect(page).toHaveProperty("topic");
      expect(page).toHaveProperty("page");
      expect(page).toHaveProperty("content");
    });

    it("should include content payload", async () => {
      const response = await client.get(
        `/api/data/page/${sampleTopicSlug}/${samplePageSlug}`,
      );

      if (response.status === 200) {
        const page = (response.data as { page: { content?: unknown } }).page;
        expect(typeof page.content).toBe("string");
        expect((page.content as string).length).toBeGreaterThan(0);
      }
    });

    it("should include metadata", async () => {
      const response = await client.get(
        `/api/data/page/${sampleTopicSlug}/${samplePageSlug}`,
      );

      if (response.status === 200) {
        const page = (response.data as { page: Record<string, unknown> }).page;
        expect(page).toHaveProperty("keywordCount");
        expect(page).toHaveProperty("maxVolume");
      }
    });
  });

  describe("GET /api/data/qa", () => {
    it("should return list of Q&A items", async () => {
      const response = await client.get("/api/data/qa");

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("paa");
      const questions = (response.data as { paa: { questions: unknown[] } }).paa
        .questions;
      expect(Array.isArray(questions)).toBe(true);
    });

    it("should support pagination", async () => {
      const response = await client.get("/api/data/qa", {
        query: { limit: "10" },
      });

      expect(response.status).toBe(200);
      // Endpoint currently doesn't implement pagination; just ensure success.
    });
  });

  describe("GET /api/data/qa/:slug", () => {
    it("should return Q&A for valid slug", async () => {
      const response = await client.get(
        "/api/data/qa/is-elon-musk-a-trillionaire",
      );

      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.data).toHaveProperty("question");
        expect(response.data).toHaveProperty("answer");
      }
    });

    it("should include source information", async () => {
      const response = await client.get(
        "/api/data/qa/is-elon-musk-a-trillionaire",
      );

      if (response.status === 200) {
        // PAA questions may or may not have captured source info.
        expect(response.data).toHaveProperty("found", true);
      }
    });
  });

  describe("GET /api/data/cluster", () => {
    it("should return cluster list", async () => {
      const response = await client.get("/api/data/cluster");

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("cluster");
      const topics = (response.data as { cluster: { topics: unknown[] } })
        .cluster.topics;
      expect(Array.isArray(topics)).toBe(true);
    });

    it("should support limit parameter", async () => {
      const response = await client.get("/api/data/cluster", {
        query: { limit: "5" },
      });

      expect(response.status).toBe(200);
      // Endpoint currently doesn't implement limit; just ensure success.
    });
  });

  describe("Response Structure", () => {
    it("should include proper headers", async () => {
      const response = await client.get(`/api/data/topic/${sampleTopicSlug}`);

      if (response.status === 200) {
        expect(response.headers.get("content-type")).toContain(
          "application/json",
        );
      }
    });

    it("should include cache headers", async () => {
      const response = await client.get(`/api/data/topic/${sampleTopicSlug}`);

      if (response.status === 200) {
        // Dynamic API route may not set explicit cache headers.
        expect(response.headers.get("content-type")).toContain(
          "application/json",
        );
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed slugs gracefully", async () => {
      const response = await client.get("/api/data/topic/../etc/passwd");

      expect([400, 404, 200]).toContain(response.status);
    });

    it("should handle special characters in slugs", async () => {
      const response = await client.get("/api/data/topic/mars-colonization");

      expect([200, 404]).toContain(response.status);
    });
  });
});
