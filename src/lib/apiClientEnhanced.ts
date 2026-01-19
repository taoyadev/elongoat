"use client";

import { withRetry } from "./retry";

const DEFAULT_TIMEOUT = 15000; // 15 seconds
const DEFAULT_MAX_RETRIES = 3;

// ============================================================================
// Types
// ============================================================================

export interface ApiFetchOptions {
  timeout?: number;
  retries?: number;
  retryableErrors?: (error: unknown) => boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export type ApiErrorCode =
  | "NETWORK_ERROR"
  | "TIMEOUT_ERROR"
  | "SERVER_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "UNKNOWN_ERROR";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  status?: number;
  retryable: boolean;
  originalError?: unknown;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
  cached: boolean;
}

// ============================================================================
// Error Utilities
// ============================================================================

function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === "AbortError" ||
      error.message.includes("timeout") ||
      error.message.includes("aborted")
    );
  }
  return false;
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes("fetch failed") ||
      error.message.includes("NetworkError") ||
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("ECONNRESET") ||
      error.message.includes("ETIMEDOUT")
    );
  }
  return false;
}

function createApiError(status: number | undefined, error: unknown): ApiError {
  if (isTimeoutError(error)) {
    return {
      code: "TIMEOUT_ERROR",
      message: "Request took too long. Please try again.",
      retryable: true,
      originalError: error,
    };
  }

  if (isNetworkError(error)) {
    return {
      code: "NETWORK_ERROR",
      message: "Network connection failed. Please check your internet.",
      retryable: true,
      originalError: error,
    };
  }

  if (status === 404) {
    return {
      code: "NOT_FOUND",
      message: "The requested content was not found.",
      retryable: false,
      status,
      originalError: error,
    };
  }

  if (status === 401 || status === 403) {
    return {
      code: "UNAUTHORIZED",
      message: "You are not authorized to access this content.",
      retryable: false,
      status,
      originalError: error,
    };
  }

  if (status === 429) {
    return {
      code: "RATE_LIMITED",
      message: "Too many requests. Please wait a moment.",
      retryable: true,
      status,
      originalError: error,
    };
  }

  if (status && status >= 500) {
    return {
      code: "SERVER_ERROR",
      message: "Server error. Our team has been notified.",
      retryable: true,
      status,
      originalError: error,
    };
  }

  if (status && status >= 400) {
    return {
      code: "SERVER_ERROR",
      message: "Request failed. Please try again.",
      retryable: false,
      status,
      originalError: error,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "An unexpected error occurred. Please try again.",
    retryable: true,
    originalError: error,
  };
}

// ============================================================================
// Timeout Wrapper
// ============================================================================

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  // Clear timeout if the signal is aborted
  if (signal) {
    signal.addEventListener("abort", () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    });
  }

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}

// ============================================================================
// Enhanced API Client
// ============================================================================

class ApiClient {
  private baseUrl: string;
  private defaultTimeout: number;
  private defaultRetries: number;

  constructor(baseUrl = "", defaultTimeout = DEFAULT_TIMEOUT) {
    this.baseUrl = baseUrl;
    this.defaultTimeout = defaultTimeout;
    this.defaultRetries = DEFAULT_MAX_RETRIES;
  }

  /**
   * Core fetch method with retry, timeout, and error handling
   */
  private async fetchCore<T>(
    endpoint: string,
    options: RequestInit & ApiFetchOptions = {},
  ): Promise<ApiResponse<T>> {
    const {
      timeout = this.defaultTimeout,
      retries = this.defaultRetries,
      retryableErrors,
      signal,
      headers: customHeaders,
      ...fetchOptions
    } = options;

    // Build URL
    const url = `${this.baseUrl}${endpoint}`;

    // Build headers
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...customHeaders,
    };

    // Combine signals if both provided
    let combinedSignal = signal;
    if (timeout && !signal) {
      const controller = new AbortController();
      combinedSignal = controller.signal;
      setTimeout(() => controller.abort(), timeout);
    }

    const fetchOptionsWithSignal: RequestInit = {
      ...fetchOptions,
      headers,
      signal: combinedSignal,
    };

    // Execute fetch with retry
    const response = await withRetry(
      async () => {
        const fetchPromise = fetch(url, fetchOptionsWithSignal);
        const result = timeout
          ? withTimeout(fetchPromise, timeout, combinedSignal)
          : fetchPromise;

        const res = await result;

        if (!res.ok) {
          const error = new Error(`HTTP ${res.status}: ${res.statusText}`);
          (error as Error & { status: number }).status = res.status;
          throw error;
        }

        return res;
      },
      {
        maxAttempts: retries,
        initialDelayMs: 200,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        retryableErrors: (error) => {
          // Always retry on network/timeout errors
          if (isNetworkError(error) || isTimeoutError(error)) return true;

          // Use custom retryable check if provided
          if (retryableErrors) return retryableErrors(error);

          // Retry on 5xx errors
          if (error && typeof error === "object" && "status" in error) {
            const status = (error as Error & { status: number }).status;
            return status >= 500 || status === 429;
          }

          return false;
        },
        onRetry: (attempt, error) => {
          console.warn(`[ApiClient] Retry attempt ${attempt}:`, error);
        },
      },
    );

    // Parse response
    const data = await response.json();

    // Check for cached response
    const cached = response.headers.get("X-Cache") === "HIT";

    return {
      data,
      status: response.status,
      headers: response.headers,
      cached,
    };
  }

  /**
   * GET request
   */
  async get<T>(
    endpoint: string,
    options: Omit<ApiFetchOptions, "headers"> & {
      headers?: Record<string, string>;
    } = {},
  ): Promise<ApiResponse<T>> {
    return this.fetchCore<T>(endpoint, {
      ...options,
      method: "GET",
    });
  }

  /**
   * POST request
   */
  async post<T>(
    endpoint: string,
    data?: unknown,
    options: Omit<ApiFetchOptions, "headers"> & {
      headers?: Record<string, string>;
    } = {},
  ): Promise<ApiResponse<T>> {
    return this.fetchCore<T>(endpoint, {
      ...options,
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PUT request
   */
  async put<T>(
    endpoint: string,
    data?: unknown,
    options: Omit<ApiFetchOptions, "headers"> & {
      headers?: Record<string, string>;
    } = {},
  ): Promise<ApiResponse<T>> {
    return this.fetchCore<T>(endpoint, {
      ...options,
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * DELETE request
   */
  async delete<T>(
    endpoint: string,
    options: Omit<ApiFetchOptions, "headers"> & {
      headers?: Record<string, string>;
    } = {},
  ): Promise<ApiResponse<T>> {
    return this.fetchCore<T>(endpoint, {
      ...options,
      method: "DELETE",
    });
  }

  /**
   * Streaming request for chat (SSE)
   */
  async stream(
    endpoint: string,
    data?: unknown,
    options: Omit<ApiFetchOptions, "headers"> & {
      headers?: Record<string, string>;
    } = {},
  ): Promise<ReadableStream> {
    const {
      timeout = this.defaultTimeout,
      signal,
      headers: customHeaders,
    } = options;

    const url = `${this.baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...customHeaders,
    };

    // Set up timeout abort
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    if (timeout && !signal) {
      controller = new AbortController();
      timeoutHandle = setTimeout(() => controller?.abort(), timeout);
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: data ? JSON.stringify(data) : undefined,
        signal: signal || controller?.signal,
      });

      if (!response.ok || !response.body) {
        const error = new Error(
          `HTTP ${response.status}: ${response.statusText}`,
        );
        (error as Error & { status: number }).status = response.status;
        throw error;
      }

      // Clear timeout on success
      if (timeoutHandle) clearTimeout(timeoutHandle);

      return response.body;
    } catch (error) {
      // Clear timeout on error
      if (timeoutHandle) clearTimeout(timeoutHandle);
      throw error;
    }
  }

  /**
   * Safe GET with error handling - returns null on failure
   */
  async safeGet<T>(
    endpoint: string,
    options: Omit<ApiFetchOptions, "headers"> & {
      headers?: Record<string, string>;
    } = {},
  ): Promise<T | null> {
    try {
      const response = await this.get<T>(endpoint, options);
      return response.data;
    } catch (error) {
      const apiError = createApiError(
        error && typeof error === "object" && "status" in error
          ? (error as Error & { status: number }).status
          : undefined,
        error,
      );
      console.warn("[ApiClient] safeGet failed:", apiError.message);
      return null;
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let clientInstance: ApiClient | null = null;

function getApiClient(): ApiClient {
  if (!clientInstance) {
    // Determine base URL
    let baseUrl = "";
    if (typeof window !== "undefined") {
      baseUrl = window.location.origin;
    }

    clientInstance = new ApiClient(baseUrl);
  }
  return clientInstance;
}

// ============================================================================
// Exported Functions (backward compatible)
// ============================================================================

/**
 * Enhanced fetch with retry, timeout, and error handling
 */
export async function apiFetch<T>(
  endpoint: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const client = getApiClient();
  const response = await client.get<T>(endpoint, options);
  return response.data;
}

/**
 * Safe fetch that returns null on error
 */
export async function safeApiFetch<T>(
  endpoint: string,
  options: ApiFetchOptions = {},
): Promise<T | null> {
  const client = getApiClient();
  return client.safeGet<T>(endpoint, options);
}

/**
 * Streaming fetch for chat
 */
export async function apiStream(
  endpoint: string,
  data?: unknown,
  options: ApiFetchOptions = {},
): Promise<ReadableStream> {
  const client = getApiClient();
  return client.stream(endpoint, data, options);
}

/**
 * Convert ApiError to user-friendly message
 */
export function getUserMessage(error: ApiError): string {
  return error.message;
}

/**
 * Check if error is retryable
 */
export function isRetryable(error: ApiError): boolean {
  return error.retryable;
}

/**
 * Get the ApiClient instance for advanced usage
 */
export { getApiClient };
// Types already exported above as interface/type
