import { compress } from "../compression";

// ============================================================================
// API Response Optimization
// ============================================================================

export interface PaginationOptions {
  page?: number;
  pageSize?: number;
  maxPageSize?: number;
  defaultPageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export interface FieldProjection {
  include?: string[];
  exclude?: string[];
}

// ============================================================================
// Field Projection
// ============================================================================

export function projectFields<T extends Record<string, unknown>>(
  obj: T,
  projection: FieldProjection,
): Partial<T> {
  const result: Partial<T> = {};

  if (projection.include && projection.include.length > 0) {
    for (const field of projection.include) {
      if (field in obj) {
        result[field as keyof T] = obj[field as keyof T];
      }
    }
  } else {
    Object.assign(result, obj);
  }

  if (projection.exclude && projection.exclude.length > 0) {
    for (const field of projection.exclude) {
      delete result[field as keyof T];
    }
  }

  return result;
}

export function projectFieldsArray<T extends Record<string, unknown>>(
  arr: T[],
  projection: FieldProjection,
): Partial<T>[] {
  return arr.map((item) => projectFields(item, projection));
}

export function parseFieldProjection(
  fieldsParam: string | undefined,
): FieldProjection {
  if (!fieldsParam) {
    return {};
  }

  if (fieldsParam.startsWith("-")) {
    const exclude = fieldsParam
      .split(",")
      .map((f) => f.replace(/^[-]/, "").trim());
    return { exclude };
  }

  const include = fieldsParam.split(",").map((f) => f.trim());
  return { include };
}

// ============================================================================
// Pagination
// ============================================================================

export function calculatePagination(options: PaginationOptions): {
  offset: number;
  limit: number;
  page: number;
  pageSize: number;
} {
  const {
    page = 1,
    pageSize = options.defaultPageSize ?? 20,
    maxPageSize = 100,
  } = options;

  const validPage = Math.max(1, page);
  const validPageSize = Math.max(1, Math.min(maxPageSize, pageSize));

  const offset = (validPage - 1) * validPageSize;
  const limit = validPageSize;

  return {
    offset,
    limit,
    page: validPage,
    pageSize: validPageSize,
  };
}

export function createPaginatedResponse<T>(
  data: T[],
  totalCount: number,
  pagination: {
    page: number;
    pageSize: number;
  },
): PaginatedResponse<T> {
  const totalPages = Math.ceil(totalCount / pagination.pageSize);
  const hasNext = pagination.page < totalPages;
  const hasPrevious = pagination.page > 1;

  return {
    data,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalCount,
      totalPages,
      hasNext,
      hasPrevious,
    },
  };
}

export function paginateArray<T>(
  arr: T[],
  options: PaginationOptions,
): PaginatedResponse<T> {
  const { offset, limit, page, pageSize } = calculatePagination(options);

  const data = arr.slice(offset, offset + limit);
  const totalCount = arr.length;

  return createPaginatedResponse(data, totalCount, { page, pageSize });
}

// ============================================================================
// Response Optimization
// ============================================================================

export interface OptimizedResponseOptions {
  compress?: boolean;
  minCompressionSize?: number;
  compressionLevel?: number;
  project?: FieldProjection;
  paginate?: PaginationOptions;
}

export interface OptimizedResponse<T> {
  data: T | PaginatedResponse<T>;
  meta?: {
    compressed?: boolean;
    compressionRatio?: number;
    originalSize?: number;
    compressedSize?: number;
    fields?: FieldProjection;
  };
}

export async function optimizeResponse<
  T extends Record<string, unknown> | unknown[],
>(
  data: T,
  options: OptimizedResponseOptions = {},
): Promise<OptimizedResponse<T>> {
  let result = data;
  const meta: OptimizedResponse<T>["meta"] = {};

  if (options.project) {
    if (Array.isArray(result)) {
      result = projectFieldsArray(result, options.project) as T;
      meta.fields = options.project;
    } else if (typeof result === "object" && result !== null) {
      result = projectFields(
        result as Record<string, unknown>,
        options.project,
      ) as T;
      meta.fields = options.project;
    }
  }

  if (options.paginate && Array.isArray(result)) {
    result = paginateArray(result, options.paginate) as unknown as T;
  }

  if (options.compress !== false && result) {
    const json = JSON.stringify(result);
    const originalSize = Buffer.byteLength(json);

    if (originalSize >= (options.minCompressionSize ?? 1024)) {
      const compressed = await compress(json, {
        method: "gzip",
        level: options.compressionLevel ?? 6,
        minSize: options.minCompressionSize,
      });

      if (compressed.compressed && compressed.ratio < 0.95) {
        meta.compressed = true;
        meta.compressionRatio = compressed.ratio;
        meta.originalSize = compressed.originalSize;
        meta.compressedSize = compressed.compressedSize;
      }
    }
  }

  return {
    data: result,
    meta,
  };
}

export function createApiResponse<T>(
  data: T,
  meta?: {
    timestamp?: string;
    requestId?: string;
    duration?: number;
    cached?: boolean;
  },
): Response {
  const body = JSON.stringify({
    data,
    meta: {
      timestamp: meta?.timestamp ?? new Date().toISOString(),
      ...meta,
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

export function createErrorResponse(
  error: string | Error,
  status = 500,
  meta?: {
    code?: string;
    requestId?: string;
    timestamp?: string;
  },
): Response {
  const message = typeof error === "string" ? error : error.message;
  const code =
    meta?.code ??
    (status === 401
      ? "UNAUTHORIZED"
      : status === 403
        ? "FORBIDDEN"
        : status === 404
          ? "NOT_FOUND"
          : "INTERNAL_ERROR");

  const body = JSON.stringify({
    error: {
      message,
      code,
      timestamp: meta?.timestamp ?? new Date().toISOString(),
      requestId: meta?.requestId,
    },
  });

  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

// ============================================================================
// Response Caching Headers
// ============================================================================

export interface CacheControlOptions {
  maxAge?: number;
  sMaxAge?: number;
  private?: boolean;
  public?: boolean;
  noCache?: boolean;
  noStore?: boolean;
  mustRevalidate?: boolean;
  proxyRevalidate?: boolean;
  immutable?: boolean;
  staleWhileRevalidate?: number;
  staleIfError?: number;
}

export function generateCacheControl(options: CacheControlOptions): string {
  const directives: string[] = [];

  if (options.noStore) {
    return "no-store";
  }

  if (options.noCache) {
    directives.push("no-cache");
  }

  if (options.private) {
    directives.push("private");
  } else if (options.public) {
    directives.push("public");
  }

  if (options.maxAge !== undefined) {
    directives.push("max-age=" + options.maxAge);
  }

  if (options.sMaxAge !== undefined) {
    directives.push("s-maxage=" + options.sMaxAge);
  }

  if (options.mustRevalidate) {
    directives.push("must-revalidate");
  }

  if (options.proxyRevalidate) {
    directives.push("proxy-revalidate");
  }

  if (options.immutable) {
    directives.push("immutable");
  }

  if (options.staleWhileRevalidate !== undefined) {
    directives.push("stale-while-revalidate=" + options.staleWhileRevalidate);
  }

  if (options.staleIfError !== undefined) {
    directives.push("stale-if-error=" + options.staleIfError);
  }

  return directives.join(", ") || "no-cache";
}

export const CachePresets = {
  noStore: () => generateCacheControl({ noStore: true }),
  noCache: () => generateCacheControl({ noCache: true }),
  short: () => generateCacheControl({ maxAge: 60, private: true }),
  medium: () => generateCacheControl({ maxAge: 300, private: true }),
  long: () => generateCacheControl({ maxAge: 3600, public: true }),
  immutable: () =>
    generateCacheControl({ maxAge: 31536000, public: true, immutable: true }),
  api: () =>
    generateCacheControl({ maxAge: 300, private: true, mustRevalidate: true }),
  static: () =>
    generateCacheControl({ maxAge: 86400, public: true, immutable: true }),
};

// ============================================================================
// Streaming Response Helpers
// ============================================================================

export function createJsonStream<T>(generator: AsyncGenerator<T>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode("["));

        let first = true;
        for await (const item of generator) {
          if (!first) {
            controller.enqueue(encoder.encode(","));
          }
          first = false;

          const json = JSON.stringify(item);
          controller.enqueue(encoder.encode(json));
        }

        controller.enqueue(encoder.encode("]"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/json",
      "Transfer-Encoding": "chunked",
      "Cache-Control": CachePresets.noCache(),
    },
  });
}

export function createSSEStream<T>(
  generator: AsyncGenerator<T>,
  options: {
    event?: string;
    retry?: number;
  } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const data of generator) {
          const lines: string[] = [];

          if (options.event) {
            lines.push("event: " + options.event);
          }

          if (options.retry !== undefined) {
            lines.push("retry: " + options.retry);
          }

          lines.push("data: " + JSON.stringify(data));
          lines.push("");

          controller.enqueue(encoder.encode(lines.join("\n")));
        }

        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
