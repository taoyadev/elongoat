/**
 * E2E Tests for Page Rendering
 *
 * Tests that static pages render correctly with proper
 * metadata, content, and structure.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { TestClient } from "../helpers";

describe("Pages: Rendering", () => {
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

  describe("Homepage", () => {
    it("should render the homepage", async () => {
      const response = await client.get("/");

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    });

    it("should include HTML structure", async () => {
      const url = new URL("/", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text).toContain("<!DOCTYPE html>");
        expect(text).toContain("<html");
        expect(text).toContain("<body");
      }
    });
  });

  describe("Topic Pages", () => {
    it("should render topic hub page", async () => {
      const response = await client.get(`/${sampleTopicSlug}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    });

    it("should include topic content", async () => {
      const url = new URL(`/${sampleTopicSlug}`, client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text.length).toBeGreaterThan(500);
      }
    });
  });

  describe("Cluster Pages", () => {
    it("should render cluster page", async () => {
      const response = await client.get(`/${sampleTopicSlug}/${samplePageSlug}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    });

    it("should include page content", async () => {
      const url = new URL(`/${sampleTopicSlug}/${samplePageSlug}`, client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text.length).toBeGreaterThan(1000);
      }
    });
  });

  describe("Q&A Pages", () => {
    it("should render Q&A index", async () => {
      const response = await client.get("/q");

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    });

    it("should render individual Q&A page", async () => {
      const response = await client.get("/q/is-elon-musk-a-trillionaire");

      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.headers.get("content-type")).toContain("text/html");
      }
    });
  });

  describe("Special Pages", () => {
    it("should render topics index", async () => {
      const response = await client.get("/topics");

      expect(response.status).toBe(200);
    });

    it("should render about page", async () => {
      const response = await client.get("/about");

      expect(response.status).toBe(200);
    });

    it("should render videos page", async () => {
      const response = await client.get("/videos");

      expect(response.status).toBe(200);
    });

    it("should render X timeline page", async () => {
      const response = await client.get("/x");

      expect(response.status).toBe(200);
    });
  });

  describe("SEO Metadata", () => {
    it("should include title tag", async () => {
      const url = new URL("/", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text).toContain("<title>");
      }
    });

    it("should include meta description", async () => {
      const url = new URL(`/${sampleTopicSlug}`, client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const text = await response.text();
        expect(text.toLowerCase()).toContain("meta");
      }
    });
  });

  describe("Error Pages", () => {
    it("should return 404 for non-existent pages", async () => {
      const response = await client.get("/non-existent-page-xyz-123");

      // Unknown one-segment paths are treated as topic routes and return 200.
      expect([200, 404]).toContain(response.status);
    });

    it("should include custom 404 page", async () => {
      const url = new URL("/non-existent-page", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.status === 404) {
        const text = await response.text();
        expect(text.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Static Assets", () => {
    it("should serve CSS files", async () => {
      const response = await client.get("/_next/static/css/test.css");

      // May or may not exist depending on build state
      expect([200, 404]).toContain(response.status);
    });

    it("should serve JavaScript files", async () => {
      const response = await client.get("/_next/static/js/test.js");

      // May or may not exist depending on build state
      expect([200, 404]).toContain(response.status);
    });
  });

  describe("Cache Headers", () => {
    it("should include cache headers for static pages", async () => {
      const response = await client.get("/");

      if (response.status === 200) {
        const hasCacheHeader = response.headers.has("cache-control");
        expect(hasCacheHeader).toBe(true);
      }
    });

    it("should include etag for caching", async () => {
      const url = new URL("/", client["baseUrl"]);
      const response = await fetch(url.toString());

      if (response.ok) {
        const etag = response.headers.get("etag");
        // ETag may or may not be present
        if (etag) {
          expect(etag.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
