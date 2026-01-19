"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { ApiError } from "../lib/apiClientEnhanced";

// ============================================================================
// Types
// ============================================================================

export type ApiState<T> =
  | { status: "idle"; data: undefined; error: undefined }
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "success"; data: T; error: undefined }
  | { status: "error"; data: undefined; error: ApiError };

export type UseApiOptions<T> = {
  enabled?: boolean;
  refetchInterval?: number;
  refetchOnWindowFocus?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: ApiError) => void;
  retry?: number;
  retryDelay?: number;
};

export type UseApiResult<T> = ApiState<T> & {
  refetch: () => Promise<void>;
  isLoading: boolean;
  isRefetching: boolean;
};

// ============================================================================
// useApi Hook
// ============================================================================

/**
 * Enhanced API fetch hook with caching, retry, and error handling.
 *
 * @example
 * ```tsx
 * const { data, error, isLoading, refetch } = useApi('/api/data', {
 *   enabled: true,
 *   refetchInterval: 60000,
 * });
 * ```
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  options: UseApiOptions<T> = {},
): UseApiResult<T> {
  const {
    enabled = true,
    refetchInterval,
    refetchOnWindowFocus = false,
    onSuccess,
    onError,
    retry = 0,
    retryDelay = 1000,
  } = options;

  const [state, setState] = useState<ApiState<T>>({
    status: "idle",
    data: undefined,
    error: undefined,
  });
  const [isRefetching, setIsRefetching] = useState(false);
  const [, startTransition] = useTransition();

  const retryCountRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    // Cancel previous request
    abortControllerRef.current?.abort();

    // Create new abort controller
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const isInitial = state.status === "idle";

    startTransition(() => {
      if (isInitial) {
        setState({ status: "loading", data: undefined, error: undefined });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setState((prev: any) => ({ ...prev, status: "loading" }));
      }
    });

    try {
      const data = await fetcher();
      controller.signal.throwIfAborted();

      retryCountRef.current = 0;
      startTransition(() => {
        setState({ status: "success", data, error: undefined });
        setIsRefetching(false);
      });
      onSuccess?.(data);
    } catch (err) {
      controller.signal.throwIfAborted();

      // Check if we should retry
      const apiError = err as ApiError;
      const shouldRetry =
        retry && retryCountRef.current < retry && apiError?.retryable;

      if (shouldRetry) {
        retryCountRef.current++;
        setTimeout(() => {
          fetchData();
        }, retryDelay * retryCountRef.current);
        return;
      }

      startTransition(() => {
        setState({
          status: "error",
          data: undefined,
          error: apiError,
        });
        setIsRefetching(false);
      });
      onError?.(apiError);
    }
  }, [
    fetcher,
    state.status,
    retry,
    retryDelay,
    isRefetching,
    onSuccess,
    onError,
  ]);

  // Initial fetch
  useEffect(() => {
    if (enabled) {
      fetchData();
    }

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [enabled, fetchData]);

  // Refetch interval
  useEffect(() => {
    if (!refetchInterval || !enabled) return;

    const interval = setInterval(() => {
      setIsRefetching(true);
      fetchData();
    }, refetchInterval);

    return () => clearInterval(interval);
  }, [refetchInterval, enabled, fetchData]);

  // Refetch on window focus
  useEffect(() => {
    if (!refetchOnWindowFocus || !enabled) return;

    const handleFocus = () => {
      setIsRefetching(true);
      fetchData();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refetchOnWindowFocus, enabled, fetchData]);

  return {
    ...state,
    refetch: fetchData,
    isLoading: state.status === "loading",
    isRefetching,
  };
}

// ============================================================================
// useApiWithCache Hook
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const apiCache = new Map<string, CacheEntry<unknown>>();

const DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function useApiWithCache<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseApiOptions<T> & { cacheTtl?: number } = {},
): UseApiResult<T> {
  const { cacheTtl = DEFAULT_CACHE_TTL, ...apiOptions } = options;

  // Create a wrapper that uses cache
  const cachedFetcher = useCallback(async (): Promise<T> => {
    if (!key) return fetcher();

    const cached = apiCache.get(key) as CacheEntry<T> | undefined;
    const now = Date.now();

    if (cached && now - cached.timestamp < cacheTtl) {
      return cached.data;
    }

    const data = await fetcher();
    apiCache.set(key, { data, timestamp: now });

    return data;
  }, [key, fetcher, cacheTtl]);

  return useApi(cachedFetcher, apiOptions);
}

/**
 * Clear API cache
 */
export function clearApiCache(key?: string): void {
  if (key) {
    apiCache.delete(key);
  } else {
    apiCache.clear();
  }
}

// ============================================================================
// useLazyApi Hook
// ============================================================================

export type UseLazyApiResult<T> = ApiState<T> & {
  fetch: () => Promise<void>;
  reset: () => void;
};

/**
 * Lazy API fetch hook that doesn't fetch automatically.
 */
export function useLazyApi<T>(
  fetcher: () => Promise<T>,
  options: Omit<UseApiOptions<T>, "enabled"> = {},
): UseLazyApiResult<T> {
  const [state, setState] = useState<ApiState<T>>({
    status: "idle",
    data: undefined,
    error: undefined,
  });

  const fetchCallback = useCallback(async () => {
    setState({ status: "loading", data: undefined, error: undefined });

    try {
      const data = await fetcher();
      setState({ status: "success", data, error: undefined });
      options.onSuccess?.(data);
    } catch (err) {
      const apiError = err as ApiError;
      setState({ status: "error", data: undefined, error: apiError });
      options.onError?.(apiError);
    }
  }, [fetcher, options]);

  const reset = useCallback(() => {
    setState({ status: "idle", data: undefined, error: undefined });
  }, []);

  return {
    ...state,
    fetch: fetchCallback,
    reset,
  };
}

// ============================================================================
// useMutation Hook
// ============================================================================

export type MutationState<T> =
  | { status: "idle"; data: undefined; error: undefined }
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "success"; data: T; error: undefined }
  | { status: "error"; data: undefined; error: ApiError };

export type UseMutationResult<TData, TVariables> = MutationState<TData> & {
  mutate: (variables: TVariables) => Promise<TData>;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  reset: () => void;
  isLoading: boolean;
};

export interface UseMutationOptions<TData, TVariables> {
  onMutate?: (variables: TVariables) => void;
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: ApiError, variables: TVariables) => void;
  onSettled?: (
    data: TData | undefined,
    error: ApiError | undefined,
    variables: TVariables,
  ) => void;
  retry?: number;
  retryDelay?: number;
}

/**
 * Mutation hook for POST/PUT/DELETE operations
 */
export function useMutation<TData = unknown, TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: UseMutationOptions<TData, TVariables> = {},
): UseMutationResult<TData, TVariables> {
  const [state, setState] = useState<MutationState<TData>>({
    status: "idle",
    data: undefined,
    error: undefined,
  });

  const retryCountRef = useRef(0);

  const mutate = useCallback(
    async (variables: TVariables): Promise<TData> => {
      options.onMutate?.(variables);
      setState({ status: "loading", data: undefined, error: undefined });

      try {
        const data = await mutationFn(variables);
        retryCountRef.current = 0;
        setState({ status: "success", data, error: undefined });
        options.onSuccess?.(data, variables);
        options.onSettled?.(data, undefined, variables);
        return data;
      } catch (err) {
        const apiError = err as ApiError;

        // Check if we should retry
        const shouldRetry =
          options.retry &&
          retryCountRef.current < options.retry &&
          apiError?.retryable;

        if (shouldRetry) {
          retryCountRef.current++;
          setTimeout(() => {
            mutate(variables);
          }, options.retryDelay || 1000);
          return Promise.reject(apiError);
        }

        retryCountRef.current = 0;
        setState({ status: "error", data: undefined, error: apiError });
        options.onError?.(apiError, variables);
        options.onSettled?.(undefined, apiError, variables);
        return Promise.reject(apiError);
      }
    },
    [mutationFn, options],
  );

  const reset = useCallback(() => {
    setState({ status: "idle", data: undefined, error: undefined });
    retryCountRef.current = 0;
  }, []);

  return {
    ...state,
    mutate,
    mutateAsync: mutate,
    reset,
    isLoading: state.status === "loading",
  };
}

// ============================================================================
// useInfiniteScroll Hook
// ============================================================================

export interface InfiniteScrollOptions<T> {
  enabled?: boolean;
  threshold?: number;
  initialData?: T[];
}

export type InfiniteScrollResult<T> = {
  data: T[];
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
};

/**
 * Infinite scroll hook for paginated data
 */
export function useInfiniteScroll<T>(
  fetcher: (page: number) => Promise<{ data: T[]; hasMore: boolean }>,
  options: InfiniteScrollOptions<T> = {},
): InfiniteScrollResult<T> {
  const { enabled = true, threshold = 200, initialData = [] } = options;

  const [data, setData] = useState<T[]>(initialData);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const loadMore = useCallback(async () => {
    if (!enabled || isLoading || !hasMore) return;

    setIsLoading(true);
    setIsError(false);

    try {
      const result = await fetcher(page + 1);
      setData((prev) => [...prev, ...result.data]);
      setPage((p) => p + 1);
      setHasMore(result.hasMore);
    } catch {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, fetcher, page, isLoading, hasMore]);

  const refetch = useCallback(async () => {
    setData([]);
    setPage(0);
    setHasMore(true);
    setIsError(false);

    try {
      const result = await fetcher(1);
      setData(result.data);
      setPage(1);
      setHasMore(result.hasMore);
    } catch {
      setIsError(true);
    }
  }, [fetcher]);

  // Set up intersection observer for auto-loading
  useEffect(() => {
    if (!enabled || !hasMore || isLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: `${threshold}px` },
    );

    // Find sentinel element
    const sentinel = document.querySelector("[data-infinite-scroll-sentinel]");
    if (sentinel) {
      observer.observe(sentinel);
    }

    return () => observer.disconnect();
  }, [enabled, hasMore, isLoading, loadMore, threshold]);

  return {
    data,
    isLoading,
    isError,
    hasMore,
    loadMore,
    refetch,
  };
}
