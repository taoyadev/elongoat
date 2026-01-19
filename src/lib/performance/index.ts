/**
 * Performance optimization utilities index.
 *
 * Exports all performance-related modules for easy importing.
 */

export {
  hashQuery,
  getCachedQuery,
  invalidateQueries,
  clearQueryCache,
  getQueryCacheStats,
  resetQueryCacheStats,
  warmupQueryCache,
} from "./queryCache";

export {
  registerWarmupTask,
  registerWarmupTasks,
  unregisterWarmupTask,
  clearWarmupTasks,
  executeWarmup,
  registerDefaultWarmupTasks,
  delayedWarmup,
  getWarmupTaskInfo,
  hasWarmupTask,
  setLastWarmupStats,
  getLastWarmupStats,
  getWarmupSummary,
} from "./cacheWarmup";

export {
  collectPoolMetrics,
  getPoolHistory,
  getPoolTrends,
  getRecentAlerts,
  clearAlerts,
  getAlertSummary,
  updateMonitorConfig,
  getMonitorConfig,
  checkPoolHealth,
  startMonitoring,
  stopMonitoring,
} from "./dbPoolMonitor";

export {
  createCancellationToken,
  isCancelled,
  throwIfCancelled,
  processBatch,
  processBatchStream,
  parallelFetch,
  batchWrite,
  type CancellationToken,
  type CancelablePromise,
  type GenerationTask,
  type BatchProgress,
  type BatchOptions,
} from "../contentGenBatch";

export {
  initPerformanceServices,
  getStartupResult,
  isPerformanceInitialized,
  type StartupOptions,
  type StartupResult,
} from "./startup";

export {
  diversifyContexts,
  rerankByRelevance,
  getRepresentativeContexts,
  clusterContexts,
  getDiversityStats,
  type DiversificationOptions,
  type DiversifiedContext,
} from "../ragDiversify";

export {
  projectFields,
  projectFieldsArray,
  parseFieldProjection,
  calculatePagination,
  createPaginatedResponse,
  paginateArray,
  optimizeResponse,
  createApiResponse,
  createErrorResponse,
  generateCacheControl,
  CachePresets,
  createJsonStream,
  createSSEStream,
  type PaginatedResponse,
  type FieldProjection,
  type OptimizedResponseOptions,
  type OptimizedResponse,
  type CacheControlOptions,
} from "./apiResponseOptimizer";
