/**
 * API Export Configuration Helper
 *
 * Provides conditional export configuration for API routes.
 * During static export (frontend build), routes are set to static.
 * During normal server operation (backend), routes can be dynamic.
 */

/**
 * Detects if the current build is a static export.
 *
 * IMPORTANT:
 * - `NEXT_PHASE` contains "build" for *all* `next build` runs (including
 *   backend/standalone builds). Treating that as "static export" will cause
 *   API routes to be marked `force-static` and executed at build time.
 * - In this repo we explicitly set `NEXT_BUILD_TARGET=export` for the
 *   Cloudflare Pages static export flow.
 */
export function isStaticExport(): boolean {
  if (process.env.NEXT_BUILD_TARGET) {
    return process.env.NEXT_BUILD_TARGET === "export";
  }

  // Fallback (mainly for running `next export` directly).
  return process.env.NEXT_PHASE === "phase-export";
}

/**
 * Returns the appropriate dynamic export value.
 * Use this in API routes instead of hardcoding `export const dynamic`.
 *
 * @example
 * ```ts
 * import { dynamicExport } from "@/lib/apiExport";
 * export const dynamic = dynamicExport("force-dynamic");
 * ```
 */
export function dynamicExport(
  defaultValue: "force-dynamic" | "error" | "force-static" = "force-dynamic",
): "force-dynamic" | "error" | "force-static" {
  return isStaticExport() ? "force-static" : defaultValue;
}

/**
 * Returns the appropriate revalidate value.
 * Static exports use longer cache times.
 *
 * @example
 * ```ts
 * import { revalidateExport } from "@/lib/apiExport";
 * export const revalidate = revalidateExport(0); // 0 for backend, 3600 for frontend
 * ```
 */
export function revalidateExport(
  backendValue: number,
  frontendValue: number = 3600,
): number {
  return isStaticExport() ? frontendValue : backendValue;
}
