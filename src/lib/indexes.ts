import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const TopicSchema = z.object({
  slug: z.string().min(1),
  topic: z.string().min(1),
  pageCount: z.number().int().nonnegative(),
  totalVolume: z.number().int().nonnegative(),
  pages: z.array(z.string().min(1)),
});
export type ClusterTopic = z.infer<typeof TopicSchema>;

const KeywordSchema = z.object({
  keyword: z.string().min(1),
  volume: z.number().int().nonnegative(),
  kd: z.number().int().nonnegative(),
  intent: z.string().optional().default(""),
  cpc: z.string().optional().default(""),
  serp_features: z.string().optional().default(""),
});
export type ClusterKeyword = z.infer<typeof KeywordSchema>;

const PageSchema = z.object({
  slug: z.string().min(1), // `${topicSlug}/${pageSlug}`
  topicSlug: z.string().min(1),
  topic: z.string().min(1),
  pageSlug: z.string().min(1),
  page: z.string().min(1),
  pageType: z.string().nullable().optional(),
  seedKeyword: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  keywordCount: z.number().int().nonnegative(),
  maxVolume: z.number().int().nonnegative(),
  totalVolume: z.number().int().nonnegative(),
  minKd: z.number().int().nullable().optional(),
  maxKd: z.number().int().nullable().optional(),
  topKeywords: z.array(KeywordSchema),
});
export type ClusterPage = z.infer<typeof PageSchema>;

const ClusterIndexSchema = z.object({
  generatedAt: z.string().min(1),
  source: z.string().min(1),
  topics: z.array(TopicSchema),
  pages: z.array(PageSchema),
});
export type ClusterIndex = z.infer<typeof ClusterIndexSchema>;

const PaaQuestionSchema = z.object({
  slug: z.string().min(1),
  question: z.string().min(1),
  parent: z.string().nullable().optional(),
  answer: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  sourceTitle: z.string().nullable().optional(),
  volume: z.number().int().nonnegative(),
});
export type PaaQuestion = z.infer<typeof PaaQuestionSchema>;

const PaaIndexSchema = z.object({
  generatedAt: z.string().min(1),
  source: z.string().min(1),
  questions: z.array(PaaQuestionSchema),
});
export type PaaIndex = z.infer<typeof PaaIndexSchema>;

const TopListSchema = z.object({
  generatedAt: z.string().min(1),
  source: z.string().min(1),
  count: z.number().int().nonnegative(),
  slugs: z.array(z.string().min(1)),
});

function projectPath(...segments: string[]): string {
  const candidates = [
    path.join(process.cwd(), ...segments),
    path.resolve(process.cwd(), "..", "..", ...segments),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

// Use Promise-based lazy loading for better concurrent access
let clusterIndexPromise: Promise<ClusterIndex> | null = null;
let paaIndexPromise: Promise<PaaIndex> | null = null;
let topPagesPromise: Promise<string[]> | null = null;
let topQuestionsPromise: Promise<string[]> | null = null;

// Lookup maps for O(1) access
let pagesBySlugMap: Map<string, ClusterPage> | null = null;
let topicsBySlugMap: Map<string, ClusterTopic> | null = null;
let questionsBySlugMap: Map<string, PaaQuestion> | null = null;

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as unknown;
}

async function loadClusterIndex(): Promise<ClusterIndex> {
  const data = await readJsonFile(
    projectPath("data", "generated", "cluster-index.json"),
  );
  const index = ClusterIndexSchema.parse(data);

  // Build lookup maps for O(1) access
  pagesBySlugMap = new Map(index.pages.map((p) => [p.slug, p]));
  topicsBySlugMap = new Map(index.topics.map((t) => [t.slug, t]));

  return index;
}

export async function getClusterIndex(): Promise<ClusterIndex> {
  if (!clusterIndexPromise) {
    clusterIndexPromise = loadClusterIndex();
  }
  return clusterIndexPromise;
}

async function loadPaaIndex(): Promise<PaaIndex> {
  const data = await readJsonFile(
    projectPath("data", "generated", "paa-index.json"),
  );
  const index = PaaIndexSchema.parse(data);

  // Build lookup map for O(1) access
  questionsBySlugMap = new Map(index.questions.map((q) => [q.slug, q]));

  return index;
}

export async function getPaaIndex(): Promise<PaaIndex> {
  if (!paaIndexPromise) {
    paaIndexPromise = loadPaaIndex();
  }
  return paaIndexPromise;
}

export async function getTopPageSlugs(): Promise<string[]> {
  if (!topPagesPromise) {
    topPagesPromise = readJsonFile(
      projectPath("data", "generated", "top-pages.json"),
    ).then((data) => TopListSchema.parse(data).slugs);
  }
  return topPagesPromise;
}

export async function getTopQuestionSlugs(): Promise<string[]> {
  if (!topQuestionsPromise) {
    topQuestionsPromise = readJsonFile(
      projectPath("data", "generated", "top-questions.json"),
    ).then((data) => TopListSchema.parse(data).slugs);
  }
  return topQuestionsPromise;
}

export async function findTopic(
  topicSlug: string,
): Promise<ClusterTopic | null> {
  // Ensure index is loaded and maps are built
  await getClusterIndex();
  return topicsBySlugMap?.get(topicSlug) ?? null;
}

export async function listTopicPages(
  topicSlug: string,
): Promise<ClusterPage[]> {
  const index = await getClusterIndex();
  return index.pages
    .filter((p) => p.topicSlug === topicSlug)
    .sort((a, b) => b.maxVolume - a.maxVolume);
}

export async function findPage(
  topicSlug: string,
  pageSlug: string,
): Promise<ClusterPage | null> {
  // Ensure index is loaded and maps are built
  await getClusterIndex();
  const fullSlug = `${topicSlug}/${pageSlug}`;
  return pagesBySlugMap?.get(fullSlug) ?? null;
}

export async function findPaaQuestion(
  slug: string,
): Promise<PaaQuestion | null> {
  // Ensure index is loaded and maps are built
  await getPaaIndex();
  return questionsBySlugMap?.get(slug) ?? null;
}
