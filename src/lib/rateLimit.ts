// Server-only module (import removed for backend compatibility)
import { getRedis, type Redis } from "./redis";
import { getEnv } from "./env";

const env = getEnv();
const IS_STATIC_EXPORT = process.env.NEXT_BUILD_TARGET === "export";
const STATIC_EXPORT_RESULT: RateLimitResult = {
  ok: true,
  remaining: Number.MAX_SAFE_INTEGER,
  resetSeconds: 0,
  limit: Number.MAX_SAFE_INTEGER,
};

// ============================================================================
// Configuration
// ============================================================================

const RATE_LIMIT_ENABLED = env.RATE_LIMIT_ENABLED;
const RATE_LIMIT_WHITELIST = new Set(
  env.RATE_LIMIT_WHITELIST.split(",")
    .map((ip) => ip.trim())
    .filter(Boolean),
);

// Default limits (can be overridden via env vars)
const DEFAULT_LIMITS = {
  // General API endpoints
  api: {
    limit: env.RATE_LIMIT_API,
    windowSeconds: env.RATE_LIMIT_API_WINDOW,
  },
  // Chat endpoint (more restrictive)
  chat: {
    limit: env.RATE_LIMIT_CHAT,
    windowSeconds: env.RATE_LIMIT_CHAT_WINDOW,
  },
  // Admin endpoints
  admin: {
    limit: env.RATE_LIMIT_ADMIN,
    windowSeconds: env.RATE_LIMIT_ADMIN_WINDOW,
  },
  // Health endpoint (very permissive)
  health: {
    limit: env.RATE_LIMIT_HEALTH,
    windowSeconds: env.RATE_LIMIT_HEALTH_WINDOW,
  },
  // Metrics endpoint (monitoring)
  metrics: {
    limit: env.RATE_LIMIT_METRICS,
    windowSeconds: env.RATE_LIMIT_METRICS_WINDOW,
  },
} as const;

type LimitType = keyof typeof DEFAULT_LIMITS;

// ============================================================================
// Types
// ============================================================================

export type RateLimitResult =
  | { ok: true; remaining: number; resetSeconds: number; limit: number }
  | {
      ok: false;
      remaining: 0;
      resetSeconds: number;
      limit: number;
      retryAfter?: number;
    };

export interface RateLimitOptions {
  identifier: string;
  limit?: number;
  windowSeconds?: number;
  type?: LimitType;
  skipSuccess?: boolean; // Don't count successful requests
}

interface RateLimitHeaders {
  "X-RateLimit-Limit": string;
  "X-RateLimit-Remaining": string;
  "X-RateLimit-Reset": string;
  "Retry-After"?: string;
}

// ============================================================================
// Redis-based Sliding Window Rate Limiting
// ============================================================================

/**
 * Lua script for atomic sliding window rate limiting
 * Uses a sorted set to track request timestamps
 * - Removes expired entries
 * - Adds current request timestamp
 * - Counts requests in the window
 * - Sets expiration on the key
 */
const LUA_SLIDING_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

-- Remove entries outside the time window
redis.call('ZREMRANGEBYSCORE', key, 0, now - window * 1000)

-- Add current request
redis.call('ZADD', key, now, now)

-- Set expiration to window duration + 1 second
redis.call('EXPIRE', key, window + 1)

-- Count requests in the window
local count = redis.call('ZCARD', key)

-- Calculate TTL for reset time
local ttl = redis.call('TTL', key)
if ttl < 0 then
  ttl = window
end

return {count, ttl}
`;

// In-memory fallback state
//
// SECURITY WARNING: In-memory rate limiting is NOT distributed.
// When using multiple server instances (horizontal scaling), each instance
// maintains its own counter, allowing requests to bypass limits by targeting
// different instances.
//
// Always use Redis-backed rate limiting in production environments with
// multiple instances.
type InMemoryState = {
  requests: number[]; // Timestamps
  windowStart: number;
  resetAt: number;
};
const memoryState = new Map<string, InMemoryState>();

// Track if we've warned about in-memory fallback
let memoryFallbackWarned = false;

/**
 * Clean up expired in-memory entries (run periodically)
 */
function cleanupMemoryState(): void {
  const now = Date.now();
  const expiredKeys: string[] = [];

  for (const [key, state] of memoryState.entries()) {
    if (state.resetAt < now) {
      expiredKeys.push(key);
    }
  }

  for (const key of expiredKeys) {
    memoryState.delete(key);
  }
}

// Run cleanup every 60 seconds
if (typeof setInterval !== "undefined") {
  setInterval(cleanupMemoryState, 60_000);
}

/**
 * Main rate limiting function with Redis sliding window
 * Falls back to in-memory if Redis is unavailable
 */
export async function rateLimit(
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  if (!RATE_LIMIT_ENABLED) {
    return {
      ok: true,
      remaining: Number.MAX_SAFE_INTEGER,
      resetSeconds: 0,
      limit: Number.MAX_SAFE_INTEGER,
    };
  }

  const { identifier, type } = options;
  const limit = options.limit ?? DEFAULT_LIMITS[type ?? "api"].limit;
  const windowSeconds =
    options.windowSeconds ?? DEFAULT_LIMITS[type ?? "api"].windowSeconds;

  // Check whitelist (for testing)
  if (RATE_LIMIT_WHITELIST.has(identifier)) {
    return {
      ok: true,
      remaining: limit,
      resetSeconds: 0,
      limit,
    };
  }

  const redis = getRedis();
  if (redis) {
    return await redisRateLimit(redis, identifier, limit, windowSeconds);
  }

  return memoryRateLimit(identifier, limit, windowSeconds);
}

/**
 * Redis-based sliding window rate limiting
 */
async function redisRateLimit(
  redis: Redis | null,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  if (!redis) {
    return memoryRateLimit(identifier, limit, windowSeconds);
  }

  try {
    await redis.connect();

    const key = `ratelimit:${identifier}`;
    const now = Date.now();

    const [count, ttl] = (await redis.eval(
      LUA_SLIDING_WINDOW,
      1,
      key,
      String(now),
      String(windowSeconds * 1000), // Convert to milliseconds
      String(limit),
    )) as [number, number];

    const resetSeconds = Math.max(1, Math.ceil(ttl));
    const remaining = Math.max(0, limit - count);

    if (count > limit) {
      return {
        ok: false,
        remaining: 0,
        resetSeconds,
        limit,
        retryAfter: resetSeconds,
      };
    }

    return {
      ok: true,
      remaining,
      resetSeconds,
      limit,
    };
  } catch (error) {
    // Redis error - fall back to in-memory
    // SECURITY: Log warning about in-memory fallback in production
    if (env.NODE_ENV === "production" && !memoryFallbackWarned) {
      console.warn(
        "[RateLimit] Redis unavailable, using in-memory rate limiting. " +
          "This is NOT secure in multi-instance deployments. " +
          "Check Redis connection.",
      );
      memoryFallbackWarned = true;
    } else if (env.NODE_ENV === "development") {
      console.error("[RateLimit] Redis error, falling back to memory:", error);
    }
    return memoryRateLimit(identifier, limit, windowSeconds);
  }
}

/**
 * In-memory rate limiting (fallback when Redis is unavailable)
 */
function memoryRateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const state = memoryState.get(identifier);

  // Initialize or reset if window expired
  if (!state || state.resetAt <= now) {
    memoryState.set(identifier, {
      requests: [now],
      windowStart: now,
      resetAt: now + windowMs,
    });
    return {
      ok: true,
      remaining: limit - 1,
      resetSeconds: windowSeconds,
      limit,
    };
  }

  // Remove expired requests from the current window
  const validRequests = state.requests.filter(
    (ts) => ts > now - windowMs && ts <= now,
  );
  validRequests.push(now);
  state.requests = validRequests;

  const remaining = Math.max(0, limit - validRequests.length);
  const resetSeconds = Math.max(1, Math.ceil((state.resetAt - now) / 1000));

  if (validRequests.length > limit) {
    return {
      ok: false,
      remaining: 0,
      resetSeconds,
      limit,
      retryAfter: resetSeconds,
    };
  }

  return {
    ok: true,
    remaining,
    resetSeconds,
    limit,
  };
}

// ============================================================================
// Convenience Functions for Common Use Cases
// ============================================================================

/**
 * Rate limit for chat endpoint
 */
export async function rateLimitChat(
  request: Request,
): Promise<{ result: RateLimitResult; headers: RateLimitHeaders }> {
  if (IS_STATIC_EXPORT) {
    return {
      result: STATIC_EXPORT_RESULT,
      headers: buildRateLimitHeaders(STATIC_EXPORT_RESULT),
    };
  }
  const identifier = getClientIdentifier(request);
  const result = await rateLimit({
    identifier,
    type: "chat",
  });
  return {
    result,
    headers: buildRateLimitHeaders(result),
  };
}

/**
 * Rate limit for admin API endpoints
 */
export async function rateLimitAdmin(
  request: Request,
): Promise<{ result: RateLimitResult; headers: RateLimitHeaders }> {
  if (IS_STATIC_EXPORT) {
    return {
      result: STATIC_EXPORT_RESULT,
      headers: buildRateLimitHeaders(STATIC_EXPORT_RESULT),
    };
  }
  const identifier = getClientIdentifier(request);
  const result = await rateLimit({
    identifier,
    type: "admin",
  });
  return {
    result,
    headers: buildRateLimitHeaders(result),
  };
}

/**
 * Rate limit for health endpoints
 */
export async function rateLimitHealth(
  request: Request,
): Promise<{ result: RateLimitResult; headers: RateLimitHeaders }> {
  if (IS_STATIC_EXPORT) {
    return {
      result: STATIC_EXPORT_RESULT,
      headers: buildRateLimitHeaders(STATIC_EXPORT_RESULT),
    };
  }
  const identifier = getClientIdentifier(request);
  const result = await rateLimit({
    identifier,
    type: "health",
  });
  return {
    result,
    headers: buildRateLimitHeaders(result),
  };
}

/**
 * Rate limit for metrics endpoint
 */
export async function rateLimitMetrics(
  request: Request,
): Promise<{ result: RateLimitResult; headers: RateLimitHeaders }> {
  if (IS_STATIC_EXPORT) {
    return {
      result: STATIC_EXPORT_RESULT,
      headers: buildRateLimitHeaders(STATIC_EXPORT_RESULT),
    };
  }
  const identifier = getClientIdentifier(request);
  const result = await rateLimit({
    identifier,
    type: "metrics",
  });
  return {
    result,
    headers: buildRateLimitHeaders(result),
  };
}

/**
 * Rate limit for general API endpoints
 */
export async function rateLimitApi(
  request: Request,
): Promise<{ result: RateLimitResult; headers: RateLimitHeaders }> {
  if (IS_STATIC_EXPORT) {
    return {
      result: STATIC_EXPORT_RESULT,
      headers: buildRateLimitHeaders(STATIC_EXPORT_RESULT),
    };
  }
  const identifier = getClientIdentifier(request);
  const result = await rateLimit({
    identifier,
    type: "api",
  });
  return {
    result,
    headers: buildRateLimitHeaders(result),
  };
}

/**
 * Generic rate limit with custom identifier
 */
export async function rateLimitByKey(key: string): Promise<RateLimitResult> {
  return rateLimit({
    identifier: key,
    type: "api",
  });
}

/**
 * Legacy rate limit function (backward compatibility)
 * @deprecated Use rateLimit() or typed variants instead
 */
export async function rateLimitLegacy(params: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  return rateLimit({
    identifier: params.key,
    limit: params.limit,
    windowSeconds: params.windowSeconds,
  });
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Build rate limit headers for response
 */
export function buildRateLimitHeaders(
  result: RateLimitResult,
): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.resetSeconds),
  };

  if (!result.ok && result.retryAfter) {
    headers["Retry-After"] = String(result.retryAfter);
  }

  return headers;
}

/**
 * Create a rate limit exceeded response
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    {
      error: "Rate limit exceeded",
      resetAt: new Date(Date.now() + result.resetSeconds * 1000).toISOString(),
    },
    {
      status: 429,
      headers: buildRateLimitHeaders(result) as unknown as HeadersInit,
    },
  );
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract client identifier from request
 * Uses IP address, with fallback to user agent hash
 */
export function getClientIdentifier(request: Request): string {
  // Try to get real IP from headers (for proxied requests)
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // Take the first IP in the chain (original client)
    const ip = forwardedFor.split(",")[0].trim();
    return `ip:${hashIp(ip)}`;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return `ip:${hashIp(realIp.trim())}`;
  }

  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return `ip:${hashIp(cfConnectingIp.trim())}`;
  }

  // Fallback to user agent hash (less reliable but better than nothing)
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto");
  const uaHash = createHash("sha256")
    .update(userAgent)
    .digest("hex")
    .slice(0, 16);
  return `ua:${uaHash}`;
}

// ============================================================================
// IP Hashing Secret Validation
// ============================================================================//

let IP_HASH_SECRET: string | null = null;

/**
 * Validate and initialize the IP hash secret
 * In production, a secret must be explicitly set
 */
function getIpHashSecret(): string {
  if (IP_HASH_SECRET) {
    return IP_HASH_SECRET;
  }

  const envSecret = env.RATE_LIMIT_IP_SECRET;
  const isProduction = env.NODE_ENV === "production";

  if (isProduction) {
    if (!envSecret || envSecret === "change_me_to_random_string") {
      throw new Error(
        "RATE_LIMIT_IP_SECRET must be set to a secure random value in production",
      );
    }
    if (envSecret.length < 16) {
      throw new Error(
        "RATE_LIMIT_IP_SECRET must be at least 16 characters long",
      );
    }
    IP_HASH_SECRET = envSecret;
  } else {
    // In development, generate a random secret if not set
    IP_HASH_SECRET = envSecret || generateDevSecret();
    console.warn(
      "[RateLimit] Using auto-generated IP hash secret for development. Set RATE_LIMIT_IP_SECRET for consistency.",
    );
  }

  return IP_HASH_SECRET;
}

/**
 * Generate a random secret for development use only
 */
function generateDevSecret(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require("node:crypto");
  return randomBytes(32).toString("hex");
}

/**
 * Hash IP address for privacy (GDPR compliance)
 * Stores only a hash, not the actual IP
 */
function hashIp(ip: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHmac } = require("node:crypto");
  const secret = getIpHashSecret();
  return createHmac("sha256", secret).update(ip).digest("hex").slice(0, 16);
}

/**
 * Check if an IP is whitelisted from rate limiting
 */
export function isWhitelisted(identifier: string): boolean {
  return RATE_LIMIT_WHITELIST.has(identifier);
}

/**
 * Get current rate limit statistics (for monitoring)
 */
export function getRateLimitStats(): {
  memoryEntries: number;
  redisConnected: boolean;
  whitelist: string[];
} {
  const redis = getRedis();
  return {
    memoryEntries: memoryState.size,
    redisConnected: redis !== null,
    whitelist: Array.from(RATE_LIMIT_WHITELIST),
  };
}

/**
 * Reset rate limit for a specific identifier (admin use only)
 */
export function resetRateLimit(identifier: string): boolean {
  memoryState.delete(identifier);
  return true;
}
