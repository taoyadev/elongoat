"use client";

import { useEffect } from "react";

/**
 * Core Web Vitals monitoring component.
 * Reports LCP, FID, CLS, FCP, and TTFB to analytics.
 *
 * Targets:
 * - LCP < 2.5s (Largest Contentful Paint)
 * - FID < 100ms (First Input Delay)
 * - CLS < 0.1 (Cumulative Layout Shift)
 */
export function WebVitals() {
  useEffect(() => {
    // Only run in browser
    if (typeof window === "undefined") return;

    // Dynamic import to avoid SSR issues
    import("web-vitals").then(({ onCLS, onFID, onLCP, onFCP, onTTFB }) => {
      const reportMetric = (metric: {
        name: string;
        value: number;
        rating: string;
        id: string;
      }) => {
        // Log to console in development
        if (process.env.NODE_ENV === "development") {
          console.log(
            "[WebVitals] " + metric.name + ": " + metric.value.toFixed(2) + " (" + metric.rating + ")",
          );
        }

        // Send to analytics endpoint (if configured)
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        if (apiUrl) {
          // Fire and forget - don't block
          fetch(apiUrl + "/api/metrics/vitals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: metric.name,
              value: metric.value,
              rating: metric.rating,
              id: metric.id,
              url: window.location.pathname,
              timestamp: Date.now(),
            }),
            keepalive: true,
          }).catch(() => {
            // Silently fail - metrics are non-critical
          });
        }
      };

      // Register all Core Web Vitals
      onCLS(reportMetric);
      onFID(reportMetric);
      onLCP(reportMetric);
      onFCP(reportMetric);
      onTTFB(reportMetric);
    }).catch(() => {
      // web-vitals not available - skip
    });
  }, []);

  return null;
}

export default WebVitals;
