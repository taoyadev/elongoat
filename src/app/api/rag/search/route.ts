/**
 * RAG Search API Endpoint
 *
 * POST /api/rag/search
 *
 * Multi-source hybrid search across ElonGoat knowledge base.
 * Searches content_cache, paa_tree, and cluster_pages with configurable weights.
 *
 * Request body:
 * {
 *   "query": "elon musk net worth",  // Required: search query
 *   "sources": ["content_cache", "paa", "cluster"],  // Optional: filter sources
 *   "limit": 10,  // Optional: max results (1-50, default 10)
 *   "min_score": 0.01  // Optional: minimum relevance score
 * }
 *
 * Response:
 * {
 *   "query": "...",
 *   "results": [...],
 *   "metadata": { total_results, search_time_ms, source_weights, ... }
 * }
 *
 * Authentication: X-API-Key header required
 */

import "server-only";

import { NextResponse } from "next/server";
import {
  validateRagAuth,
  RAG_RATE_LIMIT_CONFIG,
} from "../../../../lib/ragAuth";
import {
  ragSearch,
  type RagSource,
  type RagSearchResponse,
} from "../../../../lib/ragSearch";
import {
  rateLimit,
  getClientIdentifier,
  buildRateLimitHeaders,
} from "../../../../lib/rateLimit";
import {
  createStandardHeaders,
  CACHE_CONTROL,
  generateRequestId,
} from "../../../../lib/apiResponse";
import {
  generateCacheKey,
  getCachedSearchResult,
  cacheSearchResult,
  getCacheConfig,
} from "../../../../lib/ragCache";
import { dynamicExport } from "../../../../lib/apiExport";

// Skip static export
export const dynamic = dynamicExport("force-dynamic");

// Valid sources for filtering
const VALID_SOURCES: RagSource[] = ["content_cache", "paa", "cluster"];

export async function POST(request: Request) {
  const requestId = generateRequestId();
  const startTime = performance.now();

  // Authenticate
  const authResult = validateRagAuth(request);
  if (!authResult.authenticated && authResult.error) {
    return authResult.error;
  }

  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimitResult = await rateLimit({
    identifier: `rag:search:${clientId}`,
    limit: RAG_RATE_LIMIT_CONFIG.search.limit,
    windowSeconds: RAG_RATE_LIMIT_CONFIG.search.windowSeconds,
  });

  if (!rateLimitResult.ok) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        retry_after: rateLimitResult.resetSeconds,
      },
      {
        status: 429,
        headers: {
          ...buildRateLimitHeaders(rateLimitResult),
          ...createStandardHeaders({
            requestId,
            cacheControl: CACHE_CONTROL.NO_STORE,
          }),
        },
      },
    );
  }

  // Parse request body
  let body: {
    query?: string;
    sources?: string[];
    limit?: number;
    min_score?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      {
        status: 400,
        headers: createStandardHeaders({
          requestId,
          cacheControl: CACHE_CONTROL.NO_STORE,
        }),
      },
    );
  }

  // Validate query
  const query = body.query?.trim();
  if (!query || query.length < 2) {
    return NextResponse.json(
      { error: "Query is required and must be at least 2 characters" },
      {
        status: 400,
        headers: createStandardHeaders({
          requestId,
          cacheControl: CACHE_CONTROL.NO_STORE,
        }),
      },
    );
  }

  if (query.length > 500) {
    return NextResponse.json(
      { error: "Query must be 500 characters or less" },
      {
        status: 400,
        headers: createStandardHeaders({
          requestId,
          cacheControl: CACHE_CONTROL.NO_STORE,
        }),
      },
    );
  }

  // Validate sources
  let sources: RagSource[] = VALID_SOURCES;
  if (body.sources && Array.isArray(body.sources)) {
    const filteredSources = body.sources.filter((s): s is RagSource =>
      VALID_SOURCES.includes(s as RagSource),
    );
    if (filteredSources.length > 0) {
      sources = filteredSources;
    }
  }

  // Validate limit
  let limit = 10;
  if (body.limit !== undefined) {
    limit = Math.max(1, Math.min(50, Math.floor(body.limit)));
  }

  // Validate min_score
  let minScore = 0.01;
  if (body.min_score !== undefined && typeof body.min_score === "number") {
    minScore = Math.max(0, body.min_score);
  }

  try {
    const cacheConfig = getCacheConfig();
    let searchResult: RagSearchResponse;
    let cacheHit = false;

    // Try to get from cache if enabled
    if (cacheConfig.enabled) {
      const cacheKey = generateCacheKey("search", query, sources, limit);
      const cached = await getCachedSearchResult<RagSearchResponse>(cacheKey);

      if (cached) {
        searchResult = cached;
        cacheHit = true;
      } else {
        // Execute search and cache result
        searchResult = await ragSearch({
          query,
          sources,
          limit,
          minScore,
        });

        // Cache the result asynchronously
        cacheSearchResult(cacheKey, searchResult, cacheConfig.ttlSeconds).catch(
          (err) => console.error("[RAG Search] Cache write error:", err),
        );
      }
    } else {
      // Caching disabled, execute search directly
      searchResult = await ragSearch({
        query,
        sources,
        limit,
        minScore,
      });
    }

    const responseTime = Math.round(performance.now() - startTime);

    return NextResponse.json(searchResult, {
      status: 200,
      headers: {
        ...buildRateLimitHeaders(rateLimitResult),
        ...createStandardHeaders({
          requestId,
          cacheControl: CACHE_CONTROL.SHORT,
          additionalHeaders: {
            "X-Response-Time": `${responseTime}ms`,
            "X-Cache": cacheHit ? "HIT" : "MISS",
          },
        }),
      },
    });
  } catch (error) {
    console.error("[RAG Search API] Error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      {
        status: 500,
        headers: createStandardHeaders({
          requestId,
          cacheControl: CACHE_CONTROL.NO_STORE,
        }),
      },
    );
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  const allowedOrigins = [
    "https://elongoat.io",
    process.env.NEXT_PUBLIC_SITE_URL,
  ].filter(Boolean);

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigins[0] || "https://elongoat.io",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
      "Access-Control-Max-Age": "86400",
    },
  });
}
