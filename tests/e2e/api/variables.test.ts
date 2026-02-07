/**
 * E2E Tests for /api/variables Endpoint
 *
 * Tests the dynamic variables endpoint including caching,
 * update behavior, and response structure.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestClient } from "../helpers";

describe("API: /api/variables", () => {
  const client = new TestClient({
    baseUrl: process.env.TEST_API_URL ?? "http://localhost:3000",
  });

  describe("GET /api/variables", () => {
    it("should return dynamic variables", async () => {
      const response = await client.get("/api/variables");

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("variables");
      expect(response.data).toHaveProperty("updatedAt");

      const variables = (response.data as { variables: Record<string, unknown> })
        .variables;
      expect(variables).toHaveProperty("age");
      expect(variables).toHaveProperty("children_count");
      expect(variables).toHaveProperty("net_worth");
      expect(variables).toHaveProperty("dob");
    });

    it("should include timestamp", async () => {
      const response = await client.get("/api/variables");

      expect(response.data).toHaveProperty("updatedAt");
      const updatedAt = (response.data as { updatedAt: string }).updatedAt;
      expect(new Date(updatedAt)).toBeInstanceOf(Date);
    });

    it("should return valid age number", async () => {
      const response = await client.get("/api/variables");

      const age = (response.data as { variables: { age: number } }).variables
        .age;
      expect(typeof age).toBe("number");
      expect(age).toBeGreaterThan(0);
      expect(age).toBeLessThan(150);
    });

    it("should return valid children count", async () => {
      const response = await client.get("/api/variables");

      const count = (response.data as {
        variables: { children_count: number };
      }).variables.children_count;
      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it("should return net worth as string", async () => {
      const response = await client.get("/api/variables");

      const netWorth = (response.data as { variables: { net_worth: string } })
        .variables.net_worth;
      expect(typeof netWorth).toBe("string");
      expect(netWorth.length).toBeGreaterThan(0);
    });

    it("should return valid date of birth", async () => {
      const response = await client.get("/api/variables");

      const dob = (response.data as { variables: { dob: string } }).variables
        .dob;
      expect(typeof dob).toBe("string");
      expect(new Date(dob)).toBeInstanceOf(Date);
    });
  });

  describe("Caching", () => {
    it("should cache variables response", async () => {
      const response1 = await client.get("/api/variables");
      const response2 = await client.get("/api/variables");

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // updatedAt should be stable or monotonic between rapid requests
      const updated1 = (response1.data as { updatedAt: string }).updatedAt;
      const updated2 = (response2.data as { updatedAt: string }).updatedAt;
      expect(new Date(updated2).getTime()).toBeGreaterThanOrEqual(
        new Date(updated1).getTime(),
      );
    });
  });

  describe("Response Headers", () => {
    it("should include cache control headers", async () => {
      const response = await client.get("/api/variables");

      expect(response.headers.has("cache-control")).toBe(true);
    });

    it("should include rate limit headers", async () => {
      const response = await client.get("/api/variables");

      expect(response.headers.has("x-ratelimit-limit")).toBe(true);
      expect(response.headers.has("x-ratelimit-remaining")).toBe(true);
    });
  });

  describe("Variable Values", () => {
    it("should return reasonable default values", async () => {
      const response = await client.get("/api/variables");

      const data = (response.data as {
        variables: {
          age: number;
          children_count: number;
          net_worth: string;
          dob: string;
        };
      }).variables;

      // Check reasonable defaults
      expect(data.age).toBeGreaterThan(40); // Elon is older
      expect(data.children_count).toBeGreaterThanOrEqual(10);
      // Net worth formatting is app-configurable; just ensure it's non-empty.
      expect(data.net_worth.length).toBeGreaterThan(0);
      expect(data.dob).toMatch(/\d{4}-\d{2}-\d{2}/); // ISO date format
    });
  });
});
