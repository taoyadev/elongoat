import "server-only";

import { getDbPool } from "../db";
import { getEnv } from "../env";

const env = getEnv();

// ============================================================================
// Database Pool Monitoring
// ============================================================================

/**
 * Real-time monitoring of PostgreSQL connection pool health and performance.
 * Provides alerts and metrics for proactive pool management.
 */

interface PoolAlert {
  type: "warning" | "critical";
  message: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: number;
}

interface PoolMetrics {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxCount: number;
}

interface PoolHistoryEntry {
  timestamp: number;
  metrics: PoolMetrics;
}

interface PoolMonitorConfig {
  warningThreshold: number;
  criticalThreshold: number;
  historySize: number;
  alertCooldown: number;
}

const DEFAULT_CONFIG: PoolMonitorConfig = {
  warningThreshold: 70,
  criticalThreshold: 90,
  historySize: 100,
  alertCooldown: 60000,
};

let monitorConfig = { ...DEFAULT_CONFIG };
const alertHistory: PoolAlert[] = [];
const metricHistory: PoolHistoryEntry[] = [];
const lastAlertTime = new Map<string, number>();

// Helper to get metrics from pool
function getPoolMetrics(): PoolMetrics | null {
  const pool = getDbPool();
  if (!pool) return null;

  // Access the _metrics property that's set by db.ts
  const poolWithMetrics = pool as unknown as { _metrics?: PoolMetrics | null };
  return poolWithMetrics._metrics || null;
}

// ============================================================================
// Metrics Collection
// ============================================================================

export function collectPoolMetrics(): {
  current: PoolMetrics | null;
  utilization: number;
  healthy: boolean;
  alerts: PoolAlert[];
} {
  const metrics = getPoolMetrics();
  if (!metrics) {
    return {
      current: null,
      utilization: 0,
      healthy: false,
      alerts: [],
    };
  }

  const utilization =
    metrics.maxCount > 0
      ? ((metrics.totalCount - metrics.idleCount) / metrics.maxCount) * 100
      : 0;

  metricHistory.push({
    timestamp: Date.now(),
    metrics,
  });

  while (metricHistory.length > monitorConfig.historySize) {
    metricHistory.shift();
  }

  const alerts = checkAlerts(metrics, utilization);
  const criticalAlert = alerts.find((a) => a.type === "critical");
  const healthy = !criticalAlert && metrics.waitingCount < 5;

  return {
    current: metrics,
    utilization: Math.round(utilization),
    healthy,
    alerts,
  };
}

function checkAlerts(metrics: PoolMetrics, utilization: number): PoolAlert[] {
  const alerts: PoolAlert[] = [];
  const now = Date.now();

  if (utilization >= monitorConfig.criticalThreshold) {
    if (shouldAlert("utilization", "critical", now)) {
      alerts.push({
        type: "critical",
        message: "Pool utilization at " + utilization.toFixed(1) + "%",
        metric: "utilization",
        value: utilization,
        threshold: monitorConfig.criticalThreshold,
        timestamp: now,
      });
    }
  } else if (utilization >= monitorConfig.warningThreshold) {
    if (shouldAlert("utilization", "warning", now)) {
      alerts.push({
        type: "warning",
        message: "Pool utilization at " + utilization.toFixed(1) + "%",
        metric: "utilization",
        value: utilization,
        threshold: monitorConfig.warningThreshold,
        timestamp: now,
      });
    }
  }

  if (metrics.waitingCount >= 10) {
    if (shouldAlert("waiting", "critical", now)) {
      alerts.push({
        type: "critical",
        message: metrics.waitingCount + " connections waiting for pool",
        metric: "waiting",
        value: metrics.waitingCount,
        threshold: 10,
        timestamp: now,
      });
    }
  } else if (metrics.waitingCount >= 5) {
    if (shouldAlert("waiting", "warning", now)) {
      alerts.push({
        type: "warning",
        message: metrics.waitingCount + " connections waiting for pool",
        metric: "waiting",
        value: metrics.waitingCount,
        threshold: 5,
        timestamp: now,
      });
    }
  }

  for (const alert of alerts) {
    alertHistory.push(alert);
  }

  while (alertHistory.length > 100) {
    alertHistory.shift();
  }

  return alerts;
}

function shouldAlert(
  metric: string,
  type: "warning" | "critical",
  now: number,
): boolean {
  const key = metric + ":" + type;
  const lastTime = lastAlertTime.get(key);
  if (!lastTime) return true;

  return now - lastTime >= monitorConfig.alertCooldown;
}

// ============================================================================
// Historical Analysis
// ============================================================================

export function getPoolHistory(limit?: number): PoolHistoryEntry[] {
  if (limit) {
    return metricHistory.slice(-limit);
  }
  return [...metricHistory];
}

export function getPoolTrends(): {
  averageUtilization: number;
  peakUtilization: number;
  trend: "rising" | "falling" | "stable";
  recommendations: string[];
} {
  if (metricHistory.length < 2) {
    return {
      averageUtilization: 0,
      peakUtilization: 0,
      trend: "stable",
      recommendations: [],
    };
  }

  const utilizations = metricHistory.map((entry) => {
    const m = entry.metrics;
    return m.maxCount > 0
      ? ((m.totalCount - m.idleCount) / m.maxCount) * 100
      : 0;
  });

  const averageUtilization =
    utilizations.reduce((a, b) => a + b, 0) / utilizations.length;
  const peakUtilization = Math.max(...utilizations);

  const recent = utilizations.slice(-10);
  const older = utilizations.slice(-20, -10);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg =
    older.length > 0
      ? older.reduce((a, b) => a + b, 0) / older.length
      : recentAvg;

  let trend: "rising" | "falling" | "stable" = "stable";
  if (recentAvg - olderAvg > 10) {
    trend = "rising";
  } else if (olderAvg - recentAvg > 10) {
    trend = "falling";
  }

  const recommendations: string[] = [];

  if (peakUtilization > 90) {
    recommendations.push("Consider increasing PGPOOL_MAX to handle peak load");
  }

  if (averageUtilization > 70) {
    recommendations.push(
      "Pool is consistently under high load - monitor for connection leaks",
    );
  }

  if (trend === "rising") {
    recommendations.push(
      "Pool utilization is trending upward - investigate query performance",
    );
  }

  const recentWaiting = metricHistory
    .slice(-10)
    .filter((e) => e.metrics.waitingCount > 0).length;

  if (recentWaiting > 5) {
    recommendations.push(
      "Frequent wait times detected - consider increasing pool size or optimizing slow queries",
    );
  }

  return {
    averageUtilization: Math.round(averageUtilization),
    peakUtilization: Math.round(peakUtilization),
    trend,
    recommendations,
  };
}

// ============================================================================
// Alert Management
// ============================================================================

export function getRecentAlerts(limit = 20): PoolAlert[] {
  return alertHistory.slice(-limit);
}

export function clearAlerts(): void {
  alertHistory.length = 0;
  lastAlertTime.clear();
}

export function getAlertSummary(): {
  total: number;
  warnings: number;
  critical: number;
  lastAlert: PoolAlert | null;
} {
  const warnings = alertHistory.filter((a) => a.type === "warning").length;
  const critical = alertHistory.filter((a) => a.type === "critical").length;

  return {
    total: alertHistory.length,
    warnings,
    critical,
    lastAlert: alertHistory[alertHistory.length - 1] ?? null,
  };
}

// ============================================================================
// Configuration
// ============================================================================

export function updateMonitorConfig(updates: Partial<PoolMonitorConfig>): void {
  monitorConfig = { ...monitorConfig, ...updates };
}

export function getMonitorConfig(): PoolMonitorConfig {
  return { ...monitorConfig };
}

// ============================================================================
// Health Check
// ============================================================================

export async function checkPoolHealth(): Promise<{
  healthy: boolean;
  metrics: PoolMetrics | null;
  utilization: number;
  alerts: PoolAlert[];
  recommendations: string[];
}> {
  const collection = collectPoolMetrics();
  const trends = getPoolTrends();

  return {
    healthy: collection.healthy,
    metrics: collection.current,
    utilization: collection.utilization,
    alerts: collection.alerts,
    recommendations: trends.recommendations,
  };
}

// ============================================================================
// Periodic Monitoring
// ============================================================================

let monitoringInterval: NodeJS.Timeout | null = null;

export function startMonitoring(intervalMs = 30000): void {
  stopMonitoring();

  monitoringInterval = setInterval(() => {
    const collection = collectPoolMetrics();

    for (const alert of collection.alerts) {
      if (alert.type === "critical") {
        console.error("[PoolMonitor] CRITICAL:", alert.message);
      }
    }

    if (env.NODE_ENV === "development" && collection.current) {
      const active =
        collection.current.totalCount - collection.current.idleCount;
      console.log(
        "[PoolMonitor] Utilization: " +
          collection.utilization +
          "%, " +
          "Active: " +
          active +
          "/" +
          collection.current.maxCount +
          ", " +
          "Waiting: " +
          collection.current.waitingCount,
      );
    }
  }, intervalMs);

  if (monitoringInterval.unref) {
    monitoringInterval.unref();
  }
}

export function stopMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}
