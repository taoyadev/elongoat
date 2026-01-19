import "server-only";

import type { RagContext } from "./rag";

// Re-export types from rag for convenience
export type { RagContext, RagResult } from "./rag";

// ============================================================================
// RAG Result Diversification
// ============================================================================

/**
 * Advanced result diversification for RAG search.
 * Ensures search results are diverse and representative of different sources.
 */

export interface DiversificationOptions {
  maxSimilarity?: number; // Maximum similarity threshold (0-1)
  sourceBalance?: boolean; // Balance results across sources
  minSources?: number; // Minimum number of unique sources
  boostRecent?: boolean; // Boost recently updated content
  maxPerSource?: number; // Maximum results per source
}

export interface DiversifiedContext extends RagContext {
  diversityScore: number;
  originalRank: number;
}

/**
 * Diversify RAG contexts to reduce redundancy and improve coverage.
 */
export function diversifyContexts(
  contexts: RagContext[],
  options: DiversificationOptions = {},
): DiversifiedContext[] {
  const {
    maxSimilarity = 0.85,
    sourceBalance = true,
    minSources = 2,
    maxPerSource = 5,
  } = options;

  if (contexts.length === 0) {
    return [];
  }

  // Add original rank and normalize content for comparison
  let ranked: DiversifiedContext[] = contexts.map((ctx, idx) => ({
    ...ctx,
    diversityScore: 0,
    originalRank: idx,
  }));

  // Step 1: Remove near-duplicates based on content similarity
  ranked = removeNearDuplicates(ranked, maxSimilarity);

  // Step 2: Balance across sources if enabled
  if (sourceBalance) {
    ranked = balanceAcrossSources(ranked, maxPerSource);
  }

  // Step 3: Ensure minimum source diversity
  ranked = ensureSourceDiversity(ranked, minSources);

  // Step 4: Calculate final diversity scores
  ranked = calculateDiversityScores(ranked);

  // Step 5: Sort by diversity score (descending)
  ranked.sort((a, b) => b.diversityScore - a.diversityScore);

  return ranked;
}

/**
 * Remove near-duplicate contexts based on text similarity.
 */
function removeNearDuplicates(
  contexts: DiversifiedContext[],
  threshold: number,
): DiversifiedContext[] {
  const deduplicated: DiversifiedContext[] = [];
  const seenSignatures = new Set<string>();

  for (const ctx of contexts) {
    const signature = generateContentSignature(ctx);

    // Check for similar signatures
    let isDuplicate = false;
    for (const seen of seenSignatures) {
      if (cosineSimilarity(signature, seen) >= threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      deduplicated.push(ctx);
      seenSignatures.add(signature);
    }
  }

  return deduplicated;
}

/**
 * Generate a content signature for similarity comparison.
 */
function generateContentSignature(ctx: RagContext): string {
  // Combine key content fields for comparison
  const parts: string[] = [];

  if (ctx.question) {
    parts.push(ctx.question.toLowerCase());
  }
  if (ctx.answer) {
    parts.push(ctx.answer.toLowerCase());
  }
  if (ctx.title) {
    parts.push(ctx.title.toLowerCase());
  }
  if (ctx.snippet) {
    parts.push(ctx.snippet.toLowerCase().slice(0, 200));
  }

  // Normalize by removing common words and sorting
  const text = parts.join(" ");
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !isStopWord(w));

  // Create a sorted word signature
  return Array.from(new Set(words)).sort().join(" ");
}

/**
 * Check if a word is a stop word (common words to ignore).
 */
const STOP_WORDS = new Set([
  "the",
  "and",
  "that",
  "have",
  "for",
  "not",
  "you",
  "with",
  "this",
  "but",
  "his",
  "from",
  "they",
  "she",
  "her",
  "been",
  "than",
  "its",
  "were",
  "said",
  "each",
  "which",
  "their",
  "time",
  "will",
  "about",
  "would",
  "more",
  "when",
  "what",
  "also",
  "into",
  "only",
  "other",
  "some",
  "could",
  "them",
  "these",
  "then",
  "than",
  "been",
  "have",
  "were",
  "said",
  "each",
  "from",
  "that",
]);

function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word);
}

/**
 * Calculate cosine similarity between two text signatures.
 */
function cosineSimilarity(sig1: string, sig2: string): number {
  const words1 = new Set(sig1.split(" "));
  const words2 = new Set(sig2.split(" "));

  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  if (union.size === 0) return 0;

  return intersection.size / union.size;
}

/**
 * Balance results across different sources.
 */
function balanceAcrossSources(
  contexts: DiversifiedContext[],
  maxPerSource: number,
): DiversifiedContext[] {
  const sourceCounts = new Map<string, number>();
  const balanced: DiversifiedContext[] = [];

  // Sort by original rank first (preserving relevance)
  const sorted = [...contexts].sort((a, b) => a.originalRank - b.originalRank);

  for (const ctx of sorted) {
    const source = ctx.source;
    const count = sourceCounts.get(source) ?? 0;

    if (count < maxPerSource) {
      balanced.push(ctx);
      sourceCounts.set(source, count + 1);
    }
  }

  return balanced;
}

/**
 * Ensure minimum source diversity in results.
 */
function ensureSourceDiversity(
  contexts: DiversifiedContext[],
  minSources: number,
): DiversifiedContext[] {
  if (contexts.length === 0) {
    return contexts;
  }

  const sourceCounts = new Map<string, number>();
  const totalSources = new Set<string>();

  for (const ctx of contexts) {
    totalSources.add(ctx.source);
    sourceCounts.set(ctx.source, (sourceCounts.get(ctx.source) ?? 0) + 1);
  }

  // If we already have enough diversity, return as-is
  if (totalSources.size >= minSources) {
    return contexts;
  }

  // Not enough sources - return what we have (can't create diversity)
  return contexts;
}

/**
 * Calculate diversity scores for each context.
 * Higher scores indicate more unique/valuable content.
 */
function calculateDiversityScores(
  contexts: DiversifiedContext[],
): DiversifiedContext[] {
  if (contexts.length === 0) {
    return contexts;
  }

  // Calculate source diversity component
  const sourceCounts = new Map<string, number>();
  for (const ctx of contexts) {
    sourceCounts.set(ctx.source, (sourceCounts.get(ctx.source) ?? 0) + 1);
  }

  // Calculate diversity score for each context
  for (const ctx of contexts) {
    const sourceCount = sourceCounts.get(ctx.source) ?? 1;
    const sourceUniqueness = 1 / sourceCount; // Rarer sources get higher score
    const positionScore = 1 - ctx.originalRank / contexts.length; // Earlier ranks get higher score

    // Weight factors
    const sourceWeight = 0.6;
    const positionWeight = 0.4;

    ctx.diversityScore =
      sourceUniqueness * sourceWeight + positionScore * positionWeight;
  }

  return contexts;
}

/**
 * Re-rank contexts based on query relevance and diversity.
 */
export function rerankByRelevance(
  contexts: RagContext[],
  query: string,
  options: {
    diversityWeight?: number; // 0-1, how much to weight diversity vs relevance
  } = {},
): RagContext[] {
  const { diversityWeight = 0.3 } = options;

  if (contexts.length === 0) {
    return [];
  }

  // Calculate relevance scores
  const withScores = contexts.map((ctx) => {
    const relevance = calculateRelevance(ctx, query);
    // Use calculated relevance as the base score
    const boosted = relevance;

    return {
      ctx,
      relevance: boosted,
    };
  });

  // Diversify contexts
  const diversified = diversifyContexts(contexts, {
    maxSimilarity: 0.85,
    sourceBalance: true,
  });

  // Create a map of context to diversity score
  const diversityMap = new Map<string, number>();
  for (const d of diversified) {
    const key = getContextKey(d);
    diversityMap.set(key, d.diversityScore);
  }

  // Combine relevance and diversity for final score
  const withFinalScores = withScores.map(({ ctx, relevance }) => {
    const key = getContextKey(ctx);
    const diversity = diversityMap.get(key) ?? 0.5;

    const finalScore =
      relevance * (1 - diversityWeight) + diversity * diversityWeight;

    return {
      ctx,
      finalScore,
    };
  });

  // Sort by final score
  withFinalScores.sort((a, b) => b.finalScore - a.finalScore);

  return withFinalScores.map(({ ctx }) => ctx);
}

/**
 * Calculate relevance of a context to a query.
 */
function calculateRelevance(ctx: RagContext, query: string): number {
  const queryWords = new Set(
    query
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

  const content =
    (ctx.question ?? "") +
    " " +
    (ctx.answer ?? "") +
    " " +
    (ctx.title ?? "") +
    " " +
    (ctx.snippet ?? "");
  const contentLower = content.toLowerCase();

  let matches = 0;
  for (const word of queryWords) {
    if (contentLower.includes(word)) {
      matches++;
    }
  }

  return queryWords.size > 0 ? matches / queryWords.size : 0;
}

/**
 * Generate a unique key for a context.
 */
function getContextKey(ctx: RagContext): string {
  const parts: string[] = [ctx.source];

  if (ctx.question) parts.push(ctx.question);
  else if (ctx.title) parts.push(ctx.title);
  else if (ctx.snippet) parts.push(ctx.snippet.slice(0, 50));

  return parts.join(":");
}

/**
 * Get representative contexts from a large set.
 * Useful for summarizing or when you need a diverse subset.
 */
export function getRepresentativeContexts(
  contexts: RagContext[],
  count: number,
): RagContext[] {
  if (contexts.length <= count) {
    return contexts;
  }

  // First, diversify the contexts
  const diversified = diversifyContexts(contexts, {
    maxSimilarity: 0.75,
    sourceBalance: true,
    maxPerSource: Math.ceil(count / 3),
  });

  // Return top N by diversity score
  return diversified.slice(0, count).map((d) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { diversityScore, originalRank, ...ctx } = d;
    return ctx;
  });
}

/**
 * Cluster similar contexts for structured presentation.
 */
export function clusterContexts(
  contexts: RagContext[],
  options: {
    maxClusters?: number;
    minClusterSize?: number;
  } = {},
): Map<string, RagContext[]> {
  const { maxClusters = 5, minClusterSize = 2 } = options;

  if (contexts.length === 0) {
    return new Map();
  }

  const clusters = new Map<string, RagContext[]>();

  // Group by source first
  const bySource = new Map<string, RagContext[]>();
  for (const ctx of contexts) {
    const source = ctx.source;
    if (!bySource.has(source)) {
      bySource.set(source, []);
    }
    bySource.get(source)!.push(ctx);
  }

  // For each source, create topic-based clusters
  for (const [source, sourceContexts] of bySource) {
    if (sourceContexts.length < minClusterSize) {
      // Add to a "misc" cluster
      const key = source + ":misc";
      if (!clusters.has(key)) {
        clusters.set(key, []);
      }
      clusters.get(key)!.push(...sourceContexts);
      continue;
    }

    // Simple clustering by keyword similarity
    const used = new Set<number>();
    let clusterNum = 0;

    for (
      let i = 0;
      i < sourceContexts.length && clusterNum < maxClusters;
      i++
    ) {
      if (used.has(i)) continue;

      const ctx = sourceContexts[i];
      const cluster = [ctx];
      used.add(i);

      // Find similar contexts
      const signature = generateContentSignature(ctx);

      for (let j = i + 1; j < sourceContexts.length; j++) {
        if (used.has(j)) continue;

        const otherSig = generateContentSignature(sourceContexts[j]);
        if (cosineSimilarity(signature, otherSig) > 0.3) {
          cluster.push(sourceContexts[j]);
          used.add(j);
        }
      }

      if (cluster.length >= minClusterSize) {
        const key = source + ":cluster" + clusterNum;
        clusters.set(key, cluster);
        clusterNum++;
      }
    }

    // Add unclustered items to misc
    for (let i = 0; i < sourceContexts.length; i++) {
      if (!used.has(i)) {
        const key = source + ":misc";
        if (!clusters.has(key)) {
          clusters.set(key, []);
        }
        clusters.get(key)!.push(sourceContexts[i]);
      }
    }
  }

  return clusters;
}

/**
 * Get statistics about context diversity.
 */
export function getDiversityStats(contexts: RagContext[]): {
  total: number;
  uniqueSources: number;
  sourceDistribution: Record<string, number>;
  avgSimilarity: number;
  diversityScore: number;
} {
  const sourceCounts = new Map<string, number>();
  let totalSimilarity = 0;
  let comparisonCount = 0;

  for (const ctx of contexts) {
    sourceCounts.set(ctx.source, (sourceCounts.get(ctx.source) ?? 0) + 1);
  }

  // Calculate average similarity
  for (let i = 0; i < contexts.length; i++) {
    for (let j = i + 1; j < contexts.length; j++) {
      const sig1 = generateContentSignature(contexts[i]);
      const sig2 = generateContentSignature(contexts[j]);
      totalSimilarity += cosineSimilarity(sig1, sig2);
      comparisonCount++;
    }
  }

  const avgSimilarity =
    comparisonCount > 0 ? totalSimilarity / comparisonCount : 0;
  const diversityScore = 1 - avgSimilarity;

  const sourceDistribution: Record<string, number> = {};
  for (const [source, count] of sourceCounts) {
    sourceDistribution[source] = count;
  }

  return {
    total: contexts.length,
    uniqueSources: sourceCounts.size,
    sourceDistribution,
    avgSimilarity: Math.round(avgSimilarity * 1000) / 1000,
    diversityScore: Math.round(diversityScore * 1000) / 1000,
  };
}
