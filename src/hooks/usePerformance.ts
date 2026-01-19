"use client";

import { useEffect, useRef, useState } from "react";

// ============================================================================
// Types
// ============================================================================

export interface CoreWebVitals {
  FCP?: number; // First Contentful Paint
  LCP?: number; // Largest Contentful Paint
  FID?: number; // First Input Delay
  CLS?: number; // Cumulative Layout Shift
  TTFB?: number; // Time to First Byte
}

export interface PerformanceMetrics {
  vitals: CoreWebVitals;
  navigationTiming: PerformanceNavigationTiming | null;
  resourceCount: number;
  memoryUsage: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  } | null;
}

// ============================================================================
// usePerformance Hook
// ============================================================================

/**
 * Monitor Core Web Vitals and performance metrics
 */
export function usePerformance() {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    vitals: {},
    navigationTiming: null,
    resourceCount: 0,
    memoryUsage: null,
  });
  const observerRefs = useRef<{
    fcp?: PerformanceObserver;
    lcp?: PerformanceObserver;
    fid?: PerformanceObserver;
    cls?: PerformanceObserver;
  }>({});

  useEffect(() => {
    if (typeof window === "undefined" || !window.PerformanceObserver) {
      return;
    }

    // Get navigation timing
    const navigation = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType("resource");

    // Get memory usage (Chrome-only)
    const memory = (
      performance as Performance & {
        memory?: {
          usedJSHeapSize: number;
          totalJSHeapSize: number;
          jsHeapSizeLimit: number;
        };
      }
    ).memory;

    setMetrics({
      vitals: {},
      navigationTiming: navigation || null,
      resourceCount: resources.length,
      memoryUsage: memory
        ? {
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
          }
        : null,
    });

    // Observe First Contentful Paint
    try {
      const fcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (const entry of entries) {
          if ("name" in entry && entry.name === "first-contentful-paint") {
            setMetrics((prev) => ({
              ...prev,
              vitals: { ...prev.vitals, FCP: Math.round(entry.startTime) },
            }));
          }
        }
      });
      fcpObserver.observe({ entryTypes: ["paint"] });
      observerRefs.current.fcp = fcpObserver;
    } catch {
      // FCP not supported
    }

    // Observe Largest Contentful Paint
    try {
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lcp = entries[entries.length - 1];
        if (lcp) {
          setMetrics((prev) => ({
            ...prev,
            vitals: { ...prev.vitals, LCP: Math.round(lcp.startTime) },
          }));
        }
      });
      lcpObserver.observe({ entryTypes: ["largest-contentful-paint"] });
      observerRefs.current.lcp = lcpObserver;
    } catch {
      // LCP not supported
    }

    // Observe First Input Delay
    try {
      const fidObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const fid = entries[0] as PerformanceEventTiming | undefined;
        if (fid && fid.processingStart) {
          setMetrics((prev) => ({
            ...prev,
            vitals: {
              ...prev.vitals,
              FID: Math.round(fid.processingStart - fid.startTime),
            },
          }));
        }
      });
      fidObserver.observe({ entryTypes: ["first-input"] });
      observerRefs.current.fid = fidObserver;
    } catch {
      // FID not supported
    }

    // Observe Cumulative Layout Shift
    try {
      let clsValue = 0;
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const layoutShift = entry as unknown as {
            hadRecentInput: boolean;
            value: number;
          };
          if (!layoutShift.hadRecentInput) {
            clsValue += layoutShift.value;
          }
        }
        setMetrics((prev) => ({
          ...prev,
          vitals: { ...prev.vitals, CLS: Math.round(clsValue * 1000) / 1000 },
        }));
      });
      clsObserver.observe({ entryTypes: ["layout-shift"] });
      observerRefs.current.cls = clsObserver;
    } catch {
      // CLS not supported
    }

    // Calculate TTFB from navigation timing
    if (navigation) {
      const ttfb = navigation.responseStart - navigation.requestStart;
      setMetrics((prev) => ({
        ...prev,
        vitals: { ...prev.vitals, TTFB: Math.round(ttfb) },
      }));
    }

    return () => {
      const refs = observerRefs.current;
      refs.fcp?.disconnect();
      refs.lcp?.disconnect();
      refs.fid?.disconnect();
      refs.cls?.disconnect();
    };
  }, []);

  return metrics;
}

// ============================================================================
// useResourceTiming Hook
// ============================================================================

export interface ResourceEntry {
  name: string;
  duration: number;
  size: number;
  type: string;
}

/**
 * Monitor resource loading performance
 */
export function useResourceTiming() {
  const [resources, setResources] = useState<ResourceEntry[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateResources = () => {
      const entries = performance.getEntriesByType(
        "resource",
      ) as PerformanceResourceTiming[];
      const processed = entries
        .filter((entry) => entry.duration > 0)
        .map((entry) => ({
          name: entry.name.split("/").pop() || entry.name,
          duration: Math.round(entry.duration),
          size: entry.transferSize,
          type: entry.initiatorType,
        }))
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 20); // Top 20 slowest resources

      setResources(processed);
    };

    // Initial load
    updateResources();

    // Update periodically
    const interval = setInterval(updateResources, 5000);

    // Update when page loads
    window.addEventListener("load", updateResources);

    return () => {
      clearInterval(interval);
      window.removeEventListener("load", updateResources);
    };
  }, []);

  return resources;
}

// ============================================================================
// useConnectionStatus Hook
// ============================================================================

export interface ConnectionStatus {
  online: boolean;
  effectiveType: string;
  downlink: number;
  rtt: number;
  saveData: boolean;
}

interface NetworkInformation extends EventTarget {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Monitor network connection status
 */
export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>({
    online: true,
    effectiveType: "4g",
    downlink: 10,
    rtt: 100,
    saveData: false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const connection =
      (
        navigator as unknown as {
          connection?: NetworkInformation;
          mozConnection?: NetworkInformation;
          webkitConnection?: NetworkInformation;
        }
      ).connection ||
      (navigator as unknown as { mozConnection?: NetworkInformation })
        .mozConnection ||
      (navigator as unknown as { webkitConnection?: NetworkInformation })
        .webkitConnection;

    const updateStatus = () => {
      setStatus({
        online: navigator.onLine,
        effectiveType: connection?.effectiveType || "4g",
        downlink: connection?.downlink || 10,
        rtt: connection?.rtt || 100,
        saveData: connection?.saveData || false,
      });
    };

    // Initial status
    updateStatus();

    // Listen for online/offline events
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    if (connection && connection.addEventListener) {
      connection.addEventListener("change", updateStatus);
    }

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
      if (connection && connection.removeEventListener) {
        connection.removeEventListener("change", updateStatus);
      }
    };
  }, []);

  return status;
}

// ============================================================================
// useRenderTime Hook
// ============================================================================

/**
 * Measure component render time
 */
export function useRenderTime(componentName: string) {
  const startTimeRef = useRef<number>();

  useEffect(() => {
    startTimeRef.current = performance.now();

    return () => {
      if (startTimeRef.current) {
        const duration = performance.now() - startTimeRef.current;
        if (typeof window !== "undefined") {
          const win = window as unknown as Record<string, unknown>;
          win.__RENDER_TIMES =
            (win.__RENDER_TIMES as Record<string, number>) || {};
          (win.__RENDER_TIMES as Record<string, number>)[componentName] =
            duration;
        }
      }
    };
  }, [componentName]);
}

// ============================================================================
// useIdleCallback Hook
// ============================================================================

/**
 * Run callback during browser idle time
 */
export function useIdleCallback(
  callback: () => void,
  deps: React.DependencyList = [],
) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const requestIdleCallback =
      window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 1));

    const idleId = requestIdleCallback(() => {
      callback();
    });

    return () => {
      const cancelIdleCallback = window.cancelIdleCallback || clearTimeout;
      cancelIdleCallback(idleId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ============================================================================
// Performance Reporting
// ============================================================================

/**
 * Log performance metrics to console (development only)
 */
export function logPerformanceMetrics(metrics: PerformanceMetrics) {
  if (process.env.NODE_ENV !== "development") return;

  const { vitals, navigationTiming, memoryUsage } = metrics;

  console.group("Performance Metrics");

  if (vitals.FCP) console.log(`FCP: ${vitals.FCP}ms`);
  if (vitals.LCP) console.log(`LCP: ${vitals.LCP}ms`);
  if (vitals.FID) console.log(`FID: ${vitals.FID}ms`);
  if (vitals.CLS) console.log(`CLS: ${vitals.CLS}`);
  if (vitals.TTFB) console.log(`TTFB: ${vitals.TTFB}ms`);

  if (navigationTiming) {
    console.log(
      `DOM Loaded: ${navigationTiming.domContentLoadedEventEnd - navigationTiming.fetchStart}ms`,
    );
    console.log(
      `Page Load: ${navigationTiming.loadEventEnd - navigationTiming.fetchStart}ms`,
    );
  }

  if (memoryUsage) {
    const usedMB = Math.round(memoryUsage.usedJSHeapSize / 1048576);
    const limitMB = Math.round(memoryUsage.jsHeapSizeLimit / 1048576);
    console.log(`Memory: ${usedMB}MB / ${limitMB}MB`);
  }

  console.groupEnd();
}

/**
 * Get performance grade based on thresholds
 */
export function getPerformanceGrade(metrics: CoreWebVitals): {
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
} {
  let score = 100;

  // LCP scoring (0-100)
  if (metrics.LCP) {
    if (metrics.LCP > 4000) score -= 30;
    else if (metrics.LCP > 2500) score -= 20;
    else if (metrics.LCP > 1800) score -= 10;
  }

  // FID scoring
  if (metrics.FID) {
    if (metrics.FID > 300) score -= 30;
    else if (metrics.FID > 100) score -= 20;
    else if (metrics.FID > 50) score -= 10;
  }

  // CLS scoring
  if (metrics.CLS) {
    if (metrics.CLS > 0.25) score -= 30;
    else if (metrics.CLS > 0.1) score -= 20;
    else if (metrics.CLS > 0.05) score -= 10;
  }

  let grade: "A" | "B" | "C" | "D" | "F";
  if (score >= 90) grade = "A";
  else if (score >= 80) grade = "B";
  else if (score >= 70) grade = "C";
  else if (score >= 60) grade = "D";
  else grade = "F";

  return { grade, score: Math.max(0, score) };
}
