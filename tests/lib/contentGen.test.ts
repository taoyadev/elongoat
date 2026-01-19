import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getClusterPageContent,
  generateClusterPageContent,
  getPaaAnswerContent,
  generatePaaAnswer,
} from "../../src/lib/contentGen";

// Mock dependencies
vi.mock("../../src/lib/indexes", () => ({
  findPage: vi.fn(),
  findPaaQuestion: vi.fn(),
}));

vi.mock("../../src/lib/contentCache", () => ({
  getCachedContent: vi.fn(),
  setCachedContent: vi.fn(),
}));

vi.mock("../../src/lib/variables", () => ({
  getDynamicVariables: vi.fn(),
}));

vi.mock("../../src/lib/vectorengine", () => ({
  vectorEngineChatComplete: vi.fn(),
}));

import { findPage, findPaaQuestion } from "../../src/lib/indexes";
import { getCachedContent, setCachedContent } from "../../src/lib/contentCache";
import { getDynamicVariables } from "../../src/lib/variables";
import { vectorEngineChatComplete } from "../../src/lib/vectorengine";

describe("contentGen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env.VECTORENGINE_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.VECTORENGINE_API_KEY;
    delete process.env.VECTORENGINE_CONTENT_MODEL;
  });

  const mockVars = {
    age: 54,
    children_count: 14,
    net_worth: "$400B",
    dob: "1971-06-28",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };

  const mockClusterPage = {
    slug: "mars/why-mars",
    topicSlug: "mars",
    topic: "Mars Colonization",
    pageSlug: "why-mars",
    page: "Why Mars?",
    pageType: null,
    seedKeyword: null,
    tags: null,
    keywordCount: 42,
    maxVolume: 50000,
    totalVolume: 120000,
    minKd: 20,
    maxKd: 80,
    topKeywords: [
      { keyword: "why mars", volume: 50000, kd: 20, intent: "informational" },
      { keyword: "mars colonization", volume: 30000, kd: 30 },
    ],
  };

  const mockPaaQuestion = {
    slug: "is-elon-musk-a-trillionaire",
    question: "Is Elon Musk a Trillionaire?",
    parent: "elon musk net worth",
    answer: "As of 2025, Elon Musk's net worth fluctuates...",
    sourceUrl: "https://example.com/article",
    sourceTitle: "Elon Musk Net Worth",
    volume: 25000,
  };

  describe("getClusterPageContent", () => {
    it("returns cached content when available", async () => {
      const cached = {
        kind: "cluster_page",
        slug: "mars/why-mars",
        model: "claude-sonnet-4",
        contentMd: "# Cached Content",
        updatedAt: "2025-01-01T00:00:00.000Z",
        expiresAt: "2025-01-08T00:00:00.000Z",
      };
      vi.mocked(getCachedContent).mockResolvedValue(cached);

      const result = await getClusterPageContent({
        topicSlug: "mars",
        pageSlug: "why-mars",
      });

      expect(result).toEqual({
        contentMd: "# Cached Content",
        model: "claude-sonnet-4",
        cached: true,
      });
    });

    it("returns static template when page not found", async () => {
      vi.mocked(getCachedContent).mockResolvedValue(null);
      vi.mocked(findPage).mockResolvedValue(null);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);

      const result = await getClusterPageContent({
        topicSlug: "nonexistent",
        pageSlug: "page",
      });

      expect(result.contentMd).toContain("Not found");
      expect(result.model).toBe("static-template");
      expect(result.cached).toBe(false);
    });

    it("generates static markdown from page data", async () => {
      vi.mocked(getCachedContent).mockResolvedValue(null);
      vi.mocked(findPage).mockResolvedValue(mockClusterPage);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);

      const result = await getClusterPageContent({
        topicSlug: "mars",
        pageSlug: "why-mars",
      });

      expect(result.contentMd).toContain("Why Mars?");
      expect(result.contentMd).toContain("Mars Colonization");
      expect(result.model).toBe("static-template");
      expect(result.cached).toBe(false);
    });

    it("includes age variable in static template", async () => {
      vi.mocked(getCachedContent).mockResolvedValue(null);
      vi.mocked(findPage).mockResolvedValue(mockClusterPage);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);

      const result = await getClusterPageContent({
        topicSlug: "mars",
        pageSlug: "why-mars",
      });

      expect(result.contentMd).toContain("54");
    });

    it("includes top keywords in static template", async () => {
      vi.mocked(getCachedContent).mockResolvedValue(null);
      vi.mocked(findPage).mockResolvedValue(mockClusterPage);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);

      const result = await getClusterPageContent({
        topicSlug: "mars",
        pageSlug: "why-mars",
      });

      expect(result.contentMd).toContain("why mars");
      // Current implementation uses popularity labels, not raw volume values
      expect(result.contentMd).toContain("popularity");
    });
  });

  describe("generateClusterPageContent", () => {
    it("throws when page not found", async () => {
      vi.mocked(findPage).mockResolvedValue(null);

      await expect(
        generateClusterPageContent({
          topicSlug: "mars",
          pageSlug: "why-mars",
        }),
      ).rejects.toThrow("Cluster page not found");
    });

    it("throws when VectorEngine not configured", async () => {
      delete process.env.VECTORENGINE_API_KEY;
      vi.mocked(findPage).mockResolvedValue(mockClusterPage);

      await expect(
        generateClusterPageContent({
          topicSlug: "mars",
          pageSlug: "why-mars",
        }),
      ).rejects.toThrow("VectorEngine content model not configured");

      process.env.VECTORENGINE_API_KEY = "test-key";
    });

    it("generates content using VectorEngine", async () => {
      vi.mocked(findPage).mockResolvedValue(mockClusterPage);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({
        text: "# Generated Content\n\nThis is generated content.",
      });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      const result = await generateClusterPageContent({
        topicSlug: "mars",
        pageSlug: "why-mars",
      });

      expect(result.contentMd).toContain("Generated Content");
      expect(result.model).toBe("claude-sonnet-4-5-20250929");
    });

    it("uses VECTORENGINE_CONTENT_MODEL from env when set", async () => {
      process.env.VECTORENGINE_CONTENT_MODEL = "custom-model";
      vi.mocked(findPage).mockResolvedValue(mockClusterPage);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({
        text: "Content",
      });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      const result = await generateClusterPageContent({
        topicSlug: "mars",
        pageSlug: "why-mars",
      });

      expect(result.model).toBe("custom-model");

      delete process.env.VECTORENGINE_CONTENT_MODEL;
    });

    it("includes top keywords in prompt", async () => {
      vi.mocked(findPage).mockResolvedValue(mockClusterPage);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({
        text: "Content",
      });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      await generateClusterPageContent({
        topicSlug: "mars",
        pageSlug: "why-mars",
      });

      const callArgs = vi.mocked(vectorEngineChatComplete).mock.calls[0];
      const userMessage = callArgs[0].messages[1].content;

      expect(userMessage).toContain("why mars");
      // Current implementation uses popularity labels, not raw volume values
      expect(userMessage).toContain("popularity");
    });

    it("includes variables in prompt", async () => {
      vi.mocked(findPage).mockResolvedValue(mockClusterPage);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({
        text: "Content",
      });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      await generateClusterPageContent({
        topicSlug: "mars",
        pageSlug: "why-mars",
      });

      const callArgs = vi.mocked(vectorEngineChatComplete).mock.calls[0];
      const userMessage = callArgs[0].messages[1].content;

      expect(userMessage).toContain("age=54");
      expect(userMessage).toContain("children_count=14");
    });

    it("caches generated content", async () => {
      vi.mocked(findPage).mockResolvedValue(mockClusterPage);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({
        text: "# Content",
      });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      await generateClusterPageContent({
        topicSlug: "mars",
        pageSlug: "why-mars",
        ttlSeconds: 3600,
      });

      expect(setCachedContent).toHaveBeenCalledWith({
        kind: "cluster_page",
        slug: "mars/why-mars",
        model: "claude-sonnet-4-5-20250929",
        contentMd: "# Content",
        ttlSeconds: 3600,
        sources: expect.objectContaining({
          kind: "cluster_page",
          slug: "mars/why-mars",
        }),
      });
    });

    it("uses default TTL of 7 days when not specified", async () => {
      vi.mocked(findPage).mockResolvedValue(mockClusterPage);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({
        text: "# Content",
      });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      await generateClusterPageContent({
        topicSlug: "mars",
        pageSlug: "why-mars",
      });

      expect(setCachedContent).toHaveBeenCalledWith(
        expect.objectContaining({
          ttlSeconds: 60 * 60 * 24 * 7,
        }),
      );
    });

    it("falls back to static template on empty response", async () => {
      vi.mocked(findPage).mockResolvedValue(mockClusterPage);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({ text: "" });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      const result = await generateClusterPageContent({
        topicSlug: "mars",
        pageSlug: "why-mars",
      });

      expect(result.contentMd).toContain("TL;DR");
    });
  });

  describe("getPaaAnswerContent", () => {
    it("returns cached content when available", async () => {
      const cached = {
        kind: "paa_question",
        slug: "test-question",
        model: "claude-sonnet-4",
        contentMd: "# Cached Answer",
        updatedAt: "2025-01-01T00:00:00.000Z",
        expiresAt: null,
      };
      vi.mocked(getCachedContent).mockResolvedValue(cached);

      const result = await getPaaAnswerContent({ slug: "test-question" });

      expect(result).toEqual({
        contentMd: "# Cached Answer",
        model: "claude-sonnet-4",
        cached: true,
      });
    });

    it("returns static template when question not found", async () => {
      vi.mocked(getCachedContent).mockResolvedValue(null);
      vi.mocked(findPaaQuestion).mockResolvedValue(null);

      const result = await getPaaAnswerContent({ slug: "nonexistent" });

      expect(result.contentMd).toContain("Not found");
      expect(result.model).toBe("static-template");
      expect(result.cached).toBe(false);
    });

    it("generates static markdown from question data", async () => {
      vi.mocked(getCachedContent).mockResolvedValue(null);
      vi.mocked(findPaaQuestion).mockResolvedValue(mockPaaQuestion);

      const result = await getPaaAnswerContent({
        slug: "is-elon-musk-a-trillionaire",
      });

      expect(result.contentMd).toContain("Short answer");
      expect(result.model).toBe("static-template");
      expect(result.cached).toBe(false);
    });

    it("includes existing answer snippet when available", async () => {
      vi.mocked(getCachedContent).mockResolvedValue(null);
      vi.mocked(findPaaQuestion).mockResolvedValue(mockPaaQuestion);

      const result = await getPaaAnswerContent({
        slug: "is-elon-musk-a-trillionaire",
      });

      expect(result.contentMd).toContain("As of 2025");
    });

    it("handles null answer gracefully", async () => {
      vi.mocked(getCachedContent).mockResolvedValue(null);
      vi.mocked(findPaaQuestion).mockResolvedValue({
        ...mockPaaQuestion,
        answer: null,
      });

      const result = await getPaaAnswerContent({
        slug: "test-question",
      });

      expect(result.contentMd).toContain("No snippet was captured");
    });
  });

  describe("generatePaaAnswer", () => {
    it("throws when question not found", async () => {
      vi.mocked(findPaaQuestion).mockResolvedValue(null);

      await expect(
        generatePaaAnswer({ slug: "test-question" }),
      ).rejects.toThrow("PAA question not found");
    });

    it("throws when VectorEngine not configured", async () => {
      delete process.env.VECTORENGINE_API_KEY;
      vi.mocked(findPaaQuestion).mockResolvedValue(mockPaaQuestion);

      await expect(
        generatePaaAnswer({ slug: "test-question" }),
      ).rejects.toThrow("VectorEngine content model not configured");

      process.env.VECTORENGINE_API_KEY = "test-key";
    });

    it("generates answer using VectorEngine", async () => {
      vi.mocked(findPaaQuestion).mockResolvedValue(mockPaaQuestion);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({
        text: "# Generated Answer\n\nFull answer here.",
      });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      const result = await generatePaaAnswer({ slug: "test-question" });

      expect(result.contentMd).toContain("Generated Answer");
      expect(result.model).toBe("claude-sonnet-4-5-20250929");
    });

    it("includes question in prompt", async () => {
      vi.mocked(findPaaQuestion).mockResolvedValue(mockPaaQuestion);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({ text: "Answer" });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      await generatePaaAnswer({ slug: "test-question" });

      const callArgs = vi.mocked(vectorEngineChatComplete).mock.calls[0];
      const userMessage = callArgs[0].messages[1].content;

      expect(userMessage).toContain("Is Elon Musk a Trillionaire?");
    });

    it("includes snippet in prompt when available", async () => {
      vi.mocked(findPaaQuestion).mockResolvedValue(mockPaaQuestion);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({ text: "Answer" });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      await generatePaaAnswer({ slug: "test-question" });

      const callArgs = vi.mocked(vectorEngineChatComplete).mock.calls[0];
      const userMessage = callArgs[0].messages[1].content;

      expect(userMessage).toContain("SNIPPET");
    });

    it("includes variables in prompt", async () => {
      vi.mocked(findPaaQuestion).mockResolvedValue(mockPaaQuestion);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({ text: "Answer" });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      await generatePaaAnswer({ slug: "test-question" });

      const callArgs = vi.mocked(vectorEngineChatComplete).mock.calls[0];
      const userMessage = callArgs[0].messages[1].content;

      expect(userMessage).toContain("age=54");
    });

    it("caches generated answer", async () => {
      vi.mocked(findPaaQuestion).mockResolvedValue(mockPaaQuestion);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({
        text: "# Answer",
      });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      await generatePaaAnswer({ slug: "test-question", ttlSeconds: 7200 });

      expect(setCachedContent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "paa_question",
          slug: "is-elon-musk-a-trillionaire", // Uses the question's actual slug
          model: "claude-sonnet-4-5-20250929",
          contentMd: "# Answer",
          ttlSeconds: 7200,
          sources: expect.objectContaining({
            kind: "paa_question",
          }),
        }),
      );
    });

    it("falls back to static template on empty response", async () => {
      vi.mocked(findPaaQuestion).mockResolvedValue(mockPaaQuestion);
      vi.mocked(getDynamicVariables).mockResolvedValue(mockVars);
      vi.mocked(vectorEngineChatComplete).mockResolvedValue({ text: "" });
      vi.mocked(setCachedContent).mockResolvedValue(undefined);

      const result = await generatePaaAnswer({ slug: "test-question" });

      expect(result.contentMd).toContain("Short answer");
    });
  });
});
