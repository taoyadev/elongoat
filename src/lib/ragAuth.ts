import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { apiUnauthorized, apiForbidden } from "./apiResponse";
import { getEnv } from "./env";

const env = getEnv();
/**
 * RAG API Authentication Middleware
 *
 * Validates X-API-Key header against ELONGOAT_RAG_API_KEY environment variable.
 * Used for external API access to RAG search endpoints.
 *
 * SECURITY: Uses timingSafeEqual to prevent timing attacks on API key comparison.
 */
// ============================================================================
// Types
// ============================================================================

export interface RagAuthResult {
  authenticated: boolean;
  error?: NextResponse;
}

// ============================================================================
// Constants
// ============================================================================

const RAG_API_KEY_HEADER = "X-API-Key";
const RAG_API_KEY_HEADER_ALT = "x-api-key"; // case-insensitive fallback

// ============================================================================
// Authentication Functions
// ============================================================================

/**
 * Get the configured RAG API key from environment
 */
function getRagApiKey(): string | null {
  return env.ELONGOAT_RAG_API_KEY || null;
}

/**
 * Check if RAG API authentication is enabled
 */
export function isRagAuthEnabled(): boolean {
  const key = getRagApiKey();
  return key !== null && key.length > 0;
}

/**
 * Validate RAG API authentication from request headers
 *
 * @param request - The incoming request
 * @returns Authentication result with error response if failed
 */
export function validateRagAuth(request: Request): RagAuthResult {
  const configuredKey = getRagApiKey();

  // If no key is configured, allow access (development mode)
  if (!configuredKey) {
    if (env.NODE_ENV === "production") {
      console.warn(
        "[RAG Auth] No ELONGOAT_RAG_API_KEY configured in production",
      );
      return {
        authenticated: false,
        error: apiForbidden("RAG API not configured"),
      };
    }
    // In development, allow unauthenticated access
    return { authenticated: true };
  }

  // Get API key from request headers
  const providedKey =
    request.headers.get(RAG_API_KEY_HEADER) ||
    request.headers.get(RAG_API_KEY_HEADER_ALT);

  // No key provided
  if (!providedKey) {
    return {
      authenticated: false,
      error: apiUnauthorized("Missing API key. Provide X-API-Key header."),
    };
  }

  // SECURITY: Use timing-safe comparison to prevent timing attacks
  // Convert strings to buffers for timingSafeEqual
  const keyBuffer = Buffer.from(configuredKey, "utf8");
  const providedBuffer = Buffer.from(providedKey, "utf8");

  // Length must match for timing-safe comparison (short-circuit is safe here
  // as it only leaks length, not content - length is generally observable anyway)
  if (keyBuffer.length !== providedBuffer.length) {
    return {
      authenticated: false,
      error: apiForbidden("Invalid API key"),
    };
  }

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(keyBuffer, providedBuffer)) {
    return {
      authenticated: false,
      error: apiForbidden("Invalid API key"),
    };
  }

  return { authenticated: true };
}

/**
 * Higher-order function to wrap route handlers with RAG authentication
 *
 * @param handler - The route handler to wrap
 * @returns Wrapped handler with authentication
 */
export function withRagAuth<T extends Request>(
  handler: (request: T) => Promise<NextResponse> | NextResponse,
): (request: T) => Promise<NextResponse> {
  return async (request: T): Promise<NextResponse> => {
    const authResult = validateRagAuth(request);

    if (!authResult.authenticated && authResult.error) {
      return authResult.error;
    }

    return handler(request);
  };
}

/**
 * Rate limit configuration for RAG API endpoints
 */
export const RAG_RATE_LIMIT_CONFIG = {
  // Search endpoint: 100 requests per minute
  search: {
    limit: 100,
    windowSeconds: 60,
  },
  // Article endpoint: 200 requests per minute
  article: {
    limit: 200,
    windowSeconds: 60,
  },
  // Stats/topics endpoint: 60 requests per minute
  meta: {
    limit: 60,
    windowSeconds: 60,
  },
} as const;
