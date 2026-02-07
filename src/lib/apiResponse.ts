import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "./env";
import type { JsonValue } from "./elongoat.types";

const env = getEnv();
/**
 * API Response Standardization
 *
 * Provides standard success/error response wrappers, consistent headers,
 * CORS helpers, and response building utilities.
 */
/* -------------------------------------------------------------------------------------------------
 * Standard Response Types
 * ------------------------------------------------------------------------------------------------- */

/**
 * Standard API response metadata.
 */
export interface ApiResponseMeta {
  requestId?: string;
  timestamp: string;
  version?: string;
  [key: string]: JsonValue | string | undefined;
}

/**
 * Standard success response structure.
 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: ApiResponseMeta;
}

/**
 * Standard error response structure.
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: JsonValue;
  };
  meta: ApiResponseMeta;
}

/**
 * Standard paginated response structure.
 */
export interface ApiPaginatedResponse<T = unknown> {
  success: true;
  data: T[];
  meta: ApiResponseMeta & {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

/**
 * Union of all standard response types.
 */
export type ApiResponse<T = unknown> =
  | ApiSuccessResponse<T>
  | ApiErrorResponse
  | ApiPaginatedResponse<T>;

/* -------------------------------------------------------------------------------------------------
 * Standard Headers
 * ------------------------------------------------------------------------------------------------- */

/**
 * Standard response header names.
 */
export const STANDARD_HEADERS = {
  REQUEST_ID: "X-Request-ID",
  TRACE_ID: "X-Trace-ID",
  RATE_LIMIT_LIMIT: "X-RateLimit-Limit",
  RATE_LIMIT_REMAINING: "X-RateLimit-Remaining",
  RATE_LIMIT_RESET: "X-RateLimit-Reset",
  RATE_LIMIT_RETRY_AFTER: "Retry-After",
  RESPONSE_TIME: "X-Response-Time",
  CONTENT_TYPE: "Content-Type",
  CACHE_CONTROL: "Cache-Control",
  ETAG: "ETag",
} as const;

/**
 * Creates standard headers for API responses.
 */
export interface StandardHeadersOptions {
  requestId?: string;
  traceId?: string;
  rateLimit?: {
    limit: number;
    remaining: number;
    reset: number; // Unix timestamp or seconds until reset
    retryAfter?: number;
  };
  cacheControl?: string;
  eTag?: string;
  responseTime?: number; // milliseconds
  contentType?: string;
  cors?: {
    origin?: string | string[];
    methods?: readonly string[] | string[];
    headers?: readonly string[] | string[];
    maxAge?: number;
    credentials?: boolean;
  };
  additionalHeaders?: Record<string, string>;
}

/**
 * Creates a headers object with standard API headers.
 */
export function createStandardHeaders(
  options: StandardHeadersOptions = {},
): HeadersInit {
  const headers: Record<string, string> = {};

  // Content-Type
  headers[STANDARD_HEADERS.CONTENT_TYPE] =
    options.contentType ?? "application/json";

  // Request/Trace IDs
  if (options.requestId) {
    headers[STANDARD_HEADERS.REQUEST_ID] = options.requestId;
  }
  if (options.traceId) {
    headers[STANDARD_HEADERS.TRACE_ID] = options.traceId;
  }

  // Rate limiting headers
  if (options.rateLimit) {
    headers[STANDARD_HEADERS.RATE_LIMIT_LIMIT] = String(
      options.rateLimit.limit,
    );
    headers[STANDARD_HEADERS.RATE_LIMIT_REMAINING] = String(
      options.rateLimit.remaining,
    );
    headers[STANDARD_HEADERS.RATE_LIMIT_RESET] = String(
      options.rateLimit.reset,
    );
    if (options.rateLimit.retryAfter) {
      headers[STANDARD_HEADERS.RATE_LIMIT_RETRY_AFTER] = String(
        options.rateLimit.retryAfter,
      );
    }
  }

  // Cache control
  if (options.cacheControl) {
    headers[STANDARD_HEADERS.CACHE_CONTROL] = options.cacheControl;
  }

  // ETag
  if (options.eTag) {
    headers[STANDARD_HEADERS.ETAG] = options.eTag;
  }

  // Response time
  if (options.responseTime !== undefined) {
    headers[STANDARD_HEADERS.RESPONSE_TIME] = `${options.responseTime}ms`;
  }

  // CORS headers
  if (options.cors) {
    const cors = options.cors;
    if (cors.origin) {
      headers["Access-Control-Allow-Origin"] = Array.isArray(cors.origin)
        ? cors.origin.join(", ")
        : cors.origin;
    }
    if (cors.methods) {
      headers["Access-Control-Allow-Methods"] = cors.methods.join(", ");
    }
    if (cors.headers) {
      headers["Access-Control-Allow-Headers"] = cors.headers.join(", ");
    }
    if (cors.maxAge) {
      headers["Access-Control-Max-Age"] = String(cors.maxAge);
    }
    if (cors.credentials) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }
    // Expose headers that client can read
    const exposedHeaders = [
      STANDARD_HEADERS.REQUEST_ID,
      STANDARD_HEADERS.RATE_LIMIT_LIMIT,
      STANDARD_HEADERS.RATE_LIMIT_REMAINING,
      STANDARD_HEADERS.RATE_LIMIT_RESET,
      STANDARD_HEADERS.RESPONSE_TIME,
    ].filter(Boolean);
    if (exposedHeaders.length > 0) {
      headers["Access-Control-Expose-Headers"] = exposedHeaders.join(", ");
    }
  }

  // Additional headers
  if (options.additionalHeaders) {
    for (const [key, value] of Object.entries(options.additionalHeaders)) {
      headers[key] = value;
    }
  }

  return headers;
}

/* -------------------------------------------------------------------------------------------------
 * Response Builders
 * ------------------------------------------------------------------------------------------------- */

/**
 * Creates a standard success response.
 */
export function apiSuccess<T>(
  data: T,
  options: {
    status?: number;
    headers?: StandardHeadersOptions;
    meta?: Omit<ApiResponseMeta, "timestamp">;
  } = {},
): NextResponse<ApiSuccessResponse<T>> {
  const meta: ApiResponseMeta = {
    timestamp: new Date().toISOString(),
    ...options.meta,
  };

  const body: ApiSuccessResponse<T> = {
    success: true,
    data,
    ...(Object.keys(meta).length > 1 ? { meta } : {}),
  };

  return NextResponse.json(body, {
    status: options.status ?? 200,
    headers: createStandardHeaders(options.headers ?? {}),
  });
}

/**
 * Creates a standard error response.
 */
export function apiError(
  code: string,
  message: string,
  options: {
    status?: number;
    details?: JsonValue;
    headers?: StandardHeadersOptions;
  } = {},
): NextResponse<ApiErrorResponse> {
  const meta: ApiResponseMeta = {
    timestamp: new Date().toISOString(),
    ...(options.headers?.requestId
      ? { requestId: options.headers.requestId }
      : {}),
  };

  const body: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(options.details && { details: options.details }),
    },
    meta,
  };

  return NextResponse.json(body, {
    status: options.status ?? 500,
    headers: createStandardHeaders(options.headers ?? {}),
  });
}

/**
 * Creates a paginated response.
 */
export function apiPaginated<T>(
  items: T[],
  options: {
    page: number;
    limit: number;
    total: number;
    status?: number;
    headers?: StandardHeadersOptions;
    meta?: Omit<ApiResponseMeta, "timestamp">;
  },
): NextResponse<ApiPaginatedResponse<T>> {
  const { page, limit, total } = options;
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrevious = page > 1;

  const meta: ApiResponseMeta & {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  } = {
    timestamp: new Date().toISOString(),
    page,
    limit,
    total,
    totalPages,
    hasNext,
    hasPrevious,
    ...options.meta,
  };

  const body: ApiPaginatedResponse<T> = {
    success: true,
    data: items,
    meta,
  };

  return NextResponse.json(body, {
    status: options.status ?? 200,
    headers: createStandardHeaders(options.headers ?? {}),
  });
}

/**
 * Creates a no-content response (204).
 */
export function apiNoContent(
  options: {
    headers?: StandardHeadersOptions;
  } = {},
): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: createStandardHeaders(options.headers ?? {}),
  });
}

/**
 * Creates a not-found response (404).
 */
export function apiNotFound(
  message: string = "Resource not found",
  details?: JsonValue,
): NextResponse<ApiErrorResponse> {
  return apiError("NOT_FOUND", message, {
    status: 404,
    details,
  });
}

/**
 * Creates a bad-request response (400).
 */
export function apiBadRequest(
  message: string = "Bad request",
  details?: JsonValue,
): NextResponse<ApiErrorResponse> {
  return apiError("BAD_REQUEST", message, {
    status: 400,
    details,
  });
}

/**
 * Creates an unauthorized response (401).
 */
export function apiUnauthorized(
  message: string = "Authentication required",
): NextResponse<ApiErrorResponse> {
  return apiError("UNAUTHORIZED", message, {
    status: 401,
  });
}

/**
 * Creates a forbidden response (403).
 */
export function apiForbidden(
  message: string = "Access denied",
): NextResponse<ApiErrorResponse> {
  return apiError("FORBIDDEN", message, {
    status: 403,
  });
}

/**
 * Creates a conflict response (409).
 */
export function apiConflict(
  message: string = "Resource conflict",
  details?: JsonValue,
): NextResponse<ApiErrorResponse> {
  return apiError("CONFLICT", message, {
    status: 409,
    details,
  });
}

/**
 * Creates a rate-limited response (429).
 */
export function apiRateLimited(
  options: {
    limit: number;
    remaining: number;
    reset: number;
    retryAfter?: number;
  } & { message?: string },
): NextResponse<ApiErrorResponse> {
  return apiError("RATE_LIMITED", options.message ?? "Rate limit exceeded", {
    status: 429,
    details: {
      limit: options.limit,
      remaining: options.remaining,
      reset: options.reset,
    },
    headers: {
      rateLimit: {
        limit: options.limit,
        remaining: options.remaining,
        reset: options.reset,
        retryAfter: options.retryAfter,
      },
    },
  });
}

/**
 * Creates an internal server error response (500).
 */
export function apiInternalError(
  message: string = "Internal server error",
  details?: JsonValue,
): NextResponse<ApiErrorResponse> {
  return apiError("INTERNAL_ERROR", message, {
    status: 500,
    details,
  });
}

/**
 * Creates a service unavailable response (503).
 */
export function apiServiceUnavailable(
  message: string = "Service temporarily unavailable",
  options: {
    retryAfter?: number;
    details?: JsonValue;
  } = {},
): NextResponse<ApiErrorResponse> {
  return apiError("SERVICE_UNAVAILABLE", message, {
    status: 503,
    details: options.details,
    headers: options.retryAfter
      ? {
          additionalHeaders: {
            [STANDARD_HEADERS.RATE_LIMIT_RETRY_AFTER]: String(
              options.retryAfter,
            ),
          },
        }
      : undefined,
  });
}

/* -------------------------------------------------------------------------------------------------
 * CORS Helpers
 * ------------------------------------------------------------------------------------------------- */

/**
 * Default CORS configuration.
 */
export const DEFAULT_CORS_CONFIG = {
  origin: "*", // In production, specify exact origins
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  headers: ["Content-Type", "Authorization", "X-Request-ID"],
  maxAge: 86400, // 24 hours
  credentials: false,
} as const;

/**
 * Creates CORS headers for a response.
 */
export function createCorsHeaders(
  config: Partial<typeof DEFAULT_CORS_CONFIG> = {},
): Record<string, string> {
  const merged = { ...DEFAULT_CORS_CONFIG, ...config };

  const headers: Record<string, string> = {};

  if (merged.origin) {
    headers["Access-Control-Allow-Origin"] = Array.isArray(merged.origin)
      ? merged.origin.join(", ")
      : merged.origin;
  }

  if (merged.methods) {
    headers["Access-Control-Allow-Methods"] = merged.methods.join(", ");
  }

  if (merged.headers) {
    headers["Access-Control-Allow-Headers"] = merged.headers.join(", ");
  }

  if (merged.maxAge) {
    headers["Access-Control-Max-Age"] = String(merged.maxAge);
  }

  if (merged.credentials) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  // Expose standard headers
  headers["Access-Control-Expose-Headers"] = [
    STANDARD_HEADERS.REQUEST_ID,
    STANDARD_HEADERS.RATE_LIMIT_LIMIT,
    STANDARD_HEADERS.RATE_LIMIT_REMAINING,
    STANDARD_HEADERS.RATE_LIMIT_RESET,
  ].join(", ");

  return headers;
}

/**
 * Handles OPTIONS preflight requests.
 */
export function handleCorsOptions(
  config: Partial<typeof DEFAULT_CORS_CONFIG> = {},
): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: createCorsHeaders(config),
  });
}

/**
 * Wraps a response with CORS headers.
 */
export function withCorsHeaders(
  response: NextResponse,
  config: Partial<typeof DEFAULT_CORS_CONFIG> = {},
): NextResponse {
  const corsHeaders = createCorsHeaders(config);

  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }

  return response;
}

/* -------------------------------------------------------------------------------------------------
 * Response Timing Middleware
 * ------------------------------------------------------------------------------------------------- */

/**
 * Wraps a handler to add response time tracking.
 */
export function withResponseTime<T extends NextRequest>(
  handler: (req: T) => Promise<NextResponse> | NextResponse,
): (req: T) => Promise<NextResponse> {
  return async (req: T): Promise<NextResponse> => {
    const startTime = performance.now();
    const response = await handler(req);
    const responseTime = Math.round(performance.now() - startTime);

    response.headers.set(STANDARD_HEADERS.RESPONSE_TIME, `${responseTime}ms`);

    return response;
  };
}

/**
 * Gets the response time from a response (in milliseconds).
 */
export function getResponseTime(response: NextResponse): number | null {
  const header = response.headers.get(STANDARD_HEADERS.RESPONSE_TIME);
  if (!header) return null;

  const match = header.match(/^(\d+(?:\.\d+)?)ms$/);
  return match ? Number.parseFloat(match[1]) : null;
}

/* -------------------------------------------------------------------------------------------------
 * Request ID Generation
 * ------------------------------------------------------------------------------------------------- */

/**
 * Generates a unique request ID.
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Extracts or generates a request ID from the request.
 */
export function getOrCreateRequestId(request: Request): string {
  const existing = request.headers.get(STANDARD_HEADERS.REQUEST_ID);
  if (existing) return existing;

  return generateRequestId();
}

/**
 * Wraps a handler to ensure request ID is present.
 */
export function withRequestId<T extends NextRequest>(
  handler: (req: T & { id: string }) => Promise<NextResponse> | NextResponse,
): (req: T) => Promise<NextResponse> {
  return async (req: T): Promise<NextResponse> => {
    const requestId = getOrCreateRequestId(req);

    // Create a proxy to add the id property
    const reqWithId = new Proxy(req, {
      get(target, prop) {
        if (prop === "id") return requestId;
        return target[prop as keyof T];
      },
    }) as T & { id: string };

    const response = await handler(reqWithId);
    response.headers.set(STANDARD_HEADERS.REQUEST_ID, requestId);

    return response;
  };
}

/* -------------------------------------------------------------------------------------------------
 * Cache Control Helpers
 * ------------------------------------------------------------------------------------------------- */

/**
 * Cache control directives.
 */
export const CACHE_CONTROL = {
  /**
   * No caching at all.
   */
  NO_STORE: "no-store, no-cache, must-revalidate, private",

  /**
   * Cache but revalidate each time.
   */
  NO_CACHE: "no-cache, must-revalidate",

  /**
   * Cache for a short time (1 minute).
   */
  SHORT: "public, max-age=60, stale-while-revalidate=120",

  /**
   * Cache for a medium time (5 minutes).
   */
  MEDIUM: "public, max-age=300, stale-while-revalidate=600",

  /**
   * Cache for a long time (1 hour).
   */
  LONG: "public, max-age=3600, stale-while-revalidate=7200",

  /**
   * Cache for a very long time (1 day).
   */
  VERY_LONG: "public, max-age=86400, stale-while-revalidate=172800, immutable",

  /**
   * Creates a custom cache control header.
   */
  custom: (options: {
    maxAge?: number;
    sMaxAge?: number;
    staleWhileRevalidate?: number;
    staleIfError?: number;
    private?: boolean;
    noCache?: boolean;
    noStore?: boolean;
    mustRevalidate?: boolean;
    immutable?: boolean;
  }): string => {
    const parts: string[] = [];

    if (options.noStore) {
      parts.push("no-store", "private");
    }

    if (options.noCache) {
      parts.push("no-cache");
    }

    if (options.private) {
      parts.push("private");
    } else if (!options.noStore) {
      parts.push("public");
    }

    if (options.maxAge !== undefined) {
      parts.push(`max-age=${options.maxAge}`);
    }

    if (options.sMaxAge !== undefined) {
      parts.push(`s-maxage=${options.sMaxAge}`);
    }

    if (options.staleWhileRevalidate !== undefined) {
      parts.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
    }

    if (options.staleIfError !== undefined) {
      parts.push(`stale-if-error=${options.staleIfError}`);
    }

    if (options.mustRevalidate) {
      parts.push("must-revalidate");
    }

    if (options.immutable) {
      parts.push("immutable");
    }

    return parts.join(", ");
  },
} as const;

/* -------------------------------------------------------------------------------------------------
 * ETag Generation
 * ------------------------------------------------------------------------------------------------- */

/**
 * Generates a weak ETag for the given data.
 */
export async function generateETag(data: unknown): Promise<string> {
  const str = JSON.stringify(data);
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `W/"${hashHex.slice(0, 16)}"`;
}

/**
 * Checks if the request's If-None-Match header matches the ETag.
 */
export function checkETagMatch(request: Request, eTag: string): boolean {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (!ifNoneMatch) return false;

  // Handle multiple ETags
  const tags = ifNoneMatch.split(",").map((t) => t.trim());
  return tags.includes(eTag) || tags.includes("*");
}

/* -------------------------------------------------------------------------------------------------
 * Combined Response Helpers
 * ------------------------------------------------------------------------------------------------- */

/**
 * Creates a response with full standard headers (CORS, timing, request ID, etc).
 */
export function createStandardResponse<T>(
  data: T,
  options: {
    status?: number;
    requestId?: string;
    cacheControl?: string;
    cors?: boolean | Partial<typeof DEFAULT_CORS_CONFIG>;
  } = {},
): NextResponse<ApiSuccessResponse<T>> {
  const requestId = options.requestId ?? generateRequestId();

  return apiSuccess(data, {
    status: options.status,
    headers: {
      requestId,
      cacheControl: options.cacheControl,
      cors:
        options.cors === true ? DEFAULT_CORS_CONFIG : options.cors || undefined,
    },
  });
}

/**
 * Wraps a handler with all standard middleware (timing, request ID, CORS).
 */
export function withStandardMiddleware<T extends NextRequest>(
  handler: (req: T & { id: string }) => Promise<NextResponse> | NextResponse,
  options: {
    cors?: boolean | Partial<typeof DEFAULT_CORS_CONFIG>;
    timing?: boolean;
  } = {},
): (req: T) => Promise<NextResponse> {
  let wrapped = handler;

  // Add request ID
  wrapped = withRequestId(wrapped) as typeof handler;

  // Add timing
  if (options.timing !== false) {
    wrapped = withResponseTime(
      wrapped as (req: T) => Promise<NextResponse> | NextResponse,
    ) as typeof handler;
  }

  return async (req: T): Promise<NextResponse> => {
    const response = await wrapped(req as T & { id: string });

    // Add CORS headers if enabled
    if (options.cors) {
      return withCorsHeaders(
        response,
        options.cors === true ? DEFAULT_CORS_CONFIG : options.cors,
      );
    }

    return response;
  };
}

/* -------------------------------------------------------------------------------------------------
 * Performance-Optimized Response Helpers
 * ------------------------------------------------------------------------------------------------- */

/**
 * Creates a performance-optimized JSON response with compression hints.
 * Optimized for Core Web Vitals (LCP, FID).
 */
export function apiOptimized<T>(
  data: T,
  options: {
    status?: number;
    cache?: "no-store" | "short" | "medium" | "long" | "immutable";
    compress?: boolean;
    requestId?: string;
  } = {},
): NextResponse<ApiSuccessResponse<T>> {
  const { status = 200, cache = "short", compress = true, requestId } = options;

  const cacheControl =
    cache === "no-store"
      ? CACHE_CONTROL.NO_STORE
      : cache === "short"
        ? CACHE_CONTROL.SHORT
        : cache === "medium"
          ? CACHE_CONTROL.MEDIUM
          : cache === "long"
            ? CACHE_CONTROL.LONG
            : CACHE_CONTROL.VERY_LONG;

  const headers: StandardHeadersOptions = {
    cacheControl,
    requestId: requestId ?? generateRequestId(),
  };

  // Add compression hints
  if (compress) {
    headers.additionalHeaders = {
      Vary: "Accept-Encoding",
    };
  }

  return apiSuccess(data, { status, headers });
}

/* -------------------------------------------------------------------------------------------------
 * Response Filtering (for development vs production)
 * ------------------------------------------------------------------------------------------------- */

/**
 * Filters response data based on environment.
 * In production, sensitive/debug fields are removed.
 */
export function filterResponseData<T extends Record<string, unknown>>(
  data: T,
  isProduction: boolean = env.NODE_ENV === "production",
): Partial<T> {
  if (!isProduction) {
    return data; // Return everything in development
  }

  // Fields to exclude in production
  const excludedKeys = new Set([
    "stack",
    "internal",
    "debug",
    "query",
    "sql",
    "password",
    "secret",
    "token",
    "apiKey",
  ]);

  const filtered: Partial<T> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!excludedKeys.has(key)) {
      filtered[key as keyof T] = value as T[keyof T];
    }
  }

  return filtered;
}
