import { getEnv } from "./env";

const env = getEnv();
// ============================================================================
// Types
// ============================================================================

export interface SecurityHeadersConfig {
  contentSecurityPolicy?: boolean;
  strictTransportSecurity?: boolean;
  xContentTypeOptions?: boolean;
  xFrameOptions?: boolean;
  xXssProtection?: boolean;
  referrerPolicy?: boolean;
  permissionsPolicy?: boolean;
  crossOriginEmbedderPolicy?: boolean;
  crossOriginOpenerPolicy?: boolean;
  crossOriginResourcePolicy?: boolean;
  customCsp?: string;
}

export interface SecurityHeadersResult {
  headers: Record<string, string>;
  csp: string;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get the site origin for CSP
 */
function getSiteOrigin(): string {
  const siteUrl = env.NEXT_PUBLIC_SITE_URL ?? "https://elongoat.io";
  try {
    return new URL(siteUrl).origin;
  } catch {
    return "https://elongoat.io";
  }
}

/**
 * Get API URL for CSP connect-src
 */
function getApiOrigin(): string {
  const apiUrl = env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return "";

  try {
    const url = new URL(apiUrl);
    return url.origin;
  } catch {
    return "";
  }
}

/**
 * Get nonce for inline scripts (if using nonce-based CSP)
 */
export function getNonce(): string {
  const bytes = new Uint8Array(16);

  // Edge runtime supports Web Crypto but not Node's `crypto` module.
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomBytes } = require("crypto") as typeof import("crypto");
    bytes.set(randomBytes(16));
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// ============================================================================
// Content Security Policy
// ============================================================================

/**
 * Get Content-Security-Policy header value
 * Based on OWASP CSP recommendations
 * In production, removes unsafe-inline and unsafe-eval in favor of nonce-based approach
 */
export function getContentSecurityPolicy(nonce?: string): string {
  const siteOrigin = getSiteOrigin();
  const apiOrigin = getApiOrigin();
  const isDev = env.NODE_ENV === "development";

  const directives: string[] = [];

  // Default directive - restrict by default
  directives.push("default-src 'self'");

  // Script sources
  if (nonce) {
    // Production with nonce - most secure approach
    // 'strict-dynamic' allows scripts loaded by trusted scripts (nonce-validated)
    directives.push(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
  } else if (isDev) {
    // More permissive in development for Next.js hot reload
    directives.push(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' localhost:3000 ws://localhost:3000",
    );
  } else {
    // Production without nonce - use strict-dynamic for CSP Level 3 browsers
    // strict-dynamic ignores unsafe-inline in modern browsers but allows it as fallback
    // This is the recommended migration path per OWASP
    directives.push("script-src 'self' 'unsafe-inline' 'strict-dynamic'");
  }

  // Style sources
  if (nonce) {
    // Production with nonce - use nonce for inline styles
    directives.push(`style-src 'self' 'nonce-${nonce}'`);
  } else if (isDev) {
    directives.push("style-src 'self' 'unsafe-inline'");
  } else {
    // Production without nonce - Next.js requires unsafe-inline for styled-jsx
    // TODO: Consider migrating to CSS-in-JS library with proper CSP support
    directives.push("style-src 'self' 'unsafe-inline'");
  }

  // Image sources
  directives.push("img-src 'self' data: blob: https: http:");

  // Font sources
  directives.push("font-src 'self' data:");

  // Connect sources (API calls, WebSocket, etc.)
  const connectSources = [`connect-src 'self'`, siteOrigin];
  if (apiOrigin && apiOrigin !== siteOrigin) {
    connectSources.push(apiOrigin);
  }
  // Add WebSocket support for same origin
  connectSources.push(`wss://${new URL(siteOrigin).hostname}`);
  directives.push(connectSources.join(" "));

  // Media sources
  directives.push("media-src 'self' blob:");

  // Object sources
  directives.push("object-src 'none'");

  // Frame sources - disallow framing
  directives.push("frame-ancestors 'none'");

  // Form action
  directives.push("form-action 'self'");

  // Base URI
  directives.push("base-uri 'self'");

  // Manifest-src
  directives.push("manifest-src 'self'");

  // Worker sources
  if (isDev) {
    directives.push("worker-src 'self' blob: localhost:3000");
  } else {
    directives.push("worker-src 'self' blob:");
  }

  // Upgrade insecure requests (HTTPS only in production)
  if (!isDev) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

/**
 * Get Report-Only CSP for testing (doesn't block, only reports)
 */
export function getContentSecurityPolicyReportOnly(): string {
  const siteOrigin = getSiteOrigin();
  const reportEndpoint = `${siteOrigin}/api/security/csp-report`;

  const baseCsp = getContentSecurityPolicy();
  return `${baseCsp}; report-uri ${reportEndpoint}; report-to csp-endpoint`;
}

// ============================================================================
// Individual Security Headers
// ============================================================================

/**
 * Strict-Transport-Security header
 * Forces HTTPS connections for the specified duration
 *
 * HSTS PRELOAD REQUIREMENTS:
 * - max-age must be at least 31536000 (1 year) - SATISFIED
 * - includeSubDomains must be present - AUTO-ENABLED IN PRODUCTION
 * - preload directive must be present - AUTO-ENABLED IN PRODUCTION
 *
 * To submit to HSTS preload list: https://hstspreload.org/
 *
 * DEV NOTE: Set HSTS_PRELOAD=0 to disable preload in staging/development
 */
export function getStrictTransportSecurity(): string {
  const maxAge = 60 * 60 * 24 * 365; // 1 year (31536000 seconds) - meets preload requirement
  const isProduction = env.NODE_ENV === "production";
  // Default to preload in production, allow opt-out with HSTS_PRELOAD=0
  const preload = isProduction && env.HSTS_PRELOAD;
  const includeSubDomains = isProduction;

  const parts = [`max-age=${maxAge}`];
  if (includeSubDomains) parts.push("includeSubDomains");
  if (preload) parts.push("preload");

  return parts.join("; ");
}

/**
 * X-Content-Type-Options header
 * Prevents MIME type sniffing
 */
export function getXContentTypeOptions(): string {
  return "nosniff";
}

/**
 * X-Frame-Options header
 * Prevents clickjacking attacks
 */
export function getXFrameOptions(): string {
  return "DENY";
}

/**
 * X-XSS-Protection header
 * Enables browser XSS filter (legacy, but still useful)
 */
export function getXXssProtection(): string {
  return "1; mode=block";
}

/**
 * Referrer-Policy header
 * Controls how much referrer information is sent
 */
export function getReferrerPolicy(): string {
  return "strict-origin-when-cross-origin";
}

/**
 * Permissions-Policy header (formerly Feature-Policy)
 * Controls which browser features can be used
 */
export function getPermissionsPolicy(): string {
  const policies = [
    // Geolocation
    "geolocation=()",
    // Camera
    "camera=()",
    // Microphone
    "microphone=()",
    // Payment
    "payment=()",
    // USB
    "usb=()",
    // Magnetometer
    "magnetometer=()",
    // Gyroscope
    "gyroscope=()",
    // Accelerometer
    "accelerometer=()",
    // Ambient light sensor
    "ambient-light-sensor=()",
    // Battery status
    "battery=()",
    // Clipboard (write only)
    "clipboard-write=(self)",
    // Sync XHR
    "sync-xhr=(self)",
    //Fullscreen
    "fullscreen=(self)",
    // Picture-in-picture
    "picture-in-picture=(self)",
  ];

  return policies.join(", ");
}

/**
 * Cross-Origin-Embedder-Policy header
 */
export function getCrossOriginEmbedderPolicy(): string {
  return "require-corp";
}

/**
 * Cross-Origin-Opener-Policy header
 */
export function getCrossOriginOpenerPolicy(): string {
  return "same-origin";
}

/**
 * Cross-Origin-Resource-Policy header
 */
export function getCrossOriginResourcePolicy(): string {
  return "same-origin";
}

/**
 * X-Permitted-Cross-Domain-Policies header
 * Restricts cross-domain policy files
 */
export function getXPermittedCrossDomainPolicies(): string {
  return "none";
}

/**
 * Cache-Control for sensitive endpoints
 */
export function getCacheControlNoStore(): string {
  return "no-store, no-cache, must-revalidate, proxy-revalidate";
}

/**
 * Pragma header for legacy HTTP/1.0 clients
 */
export function getPragmaNoCache(): string {
  return "no-cache";
}

// ============================================================================
// Combined Headers
// ============================================================================

/**
 * Get all security headers for production use
 */
export function getSecurityHeaders(
  config: SecurityHeadersConfig = {},
): SecurityHeadersResult {
  const headers: Record<string, string> = {};

  // Content Security Policy
  if (config.contentSecurityPolicy !== false) {
    headers["Content-Security-Policy"] =
      config.customCsp ?? getContentSecurityPolicy();
  }

  // Strict Transport Security (HTTPS only)
  if (
    config.strictTransportSecurity !== false &&
    env.NODE_ENV === "production"
  ) {
    headers["Strict-Transport-Security"] = getStrictTransportSecurity();
  }

  // X-Content-Type-Options
  if (config.xContentTypeOptions !== false) {
    headers["X-Content-Type-Options"] = getXContentTypeOptions();
  }

  // X-Frame-Options
  if (config.xFrameOptions !== false) {
    headers["X-Frame-Options"] = getXFrameOptions();
  }

  // X-XSS-Protection
  if (config.xXssProtection !== false) {
    headers["X-XSS-Protection"] = getXXssProtection();
  }

  // Referrer-Policy
  if (config.referrerPolicy !== false) {
    headers["Referrer-Policy"] = getReferrerPolicy();
  }

  // Permissions-Policy
  if (config.permissionsPolicy !== false) {
    headers["Permissions-Policy"] = getPermissionsPolicy();
  }

  // Cross-Origin headers
  if (config.crossOriginEmbedderPolicy !== false) {
    headers["Cross-Origin-Embedder-Policy"] = getCrossOriginEmbedderPolicy();
  }
  if (config.crossOriginOpenerPolicy !== false) {
    headers["Cross-Origin-Opener-Policy"] = getCrossOriginOpenerPolicy();
  }
  if (config.crossOriginResourcePolicy !== false) {
    headers["Cross-Origin-Resource-Policy"] = getCrossOriginResourcePolicy();
  }

  // X-Permitted-Cross-Domain-Policies
  headers["X-Permitted-Cross-Domain-Policies"] =
    getXPermittedCrossDomainPolicies();

  return {
    headers,
    csp: headers["Content-Security-Policy"] ?? "",
  };
}

/**
 * Get security headers for API responses
 * Slightly different from web headers
 */
export function getApiSecurityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": getXContentTypeOptions(),
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": getXXssProtection(),
    "Strict-Transport-Security":
      env.NODE_ENV === "production" ? getStrictTransportSecurity() : "",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": getPermissionsPolicy(),
  };
}

/**
 * Get security headers for admin endpoints
 * More restrictive than general headers
 */
export function getAdminSecurityHeaders(): Record<string, string> {
  return {
    ...getApiSecurityHeaders(),
    "Cache-Control": getCacheControlNoStore(),
    Pragma: getPragmaNoCache(),
  };
}

/**
 * Get security headers for static assets
 */
export function getStaticAssetHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": getXContentTypeOptions(),
    "X-Frame-Options": "SAMEORIGIN",
  };
}

// ============================================================================
// Next.js Integration
// ============================================================================

/**
 * Get headers for Next.js response
 * @param nonce - Optional nonce for CSP script-src/style-src directives
 */
export function getNextJsHeaders(nonce?: string): Record<string, string> {
  // If nonce is provided, regenerate CSP with nonce included
  const csp = nonce
    ? getContentSecurityPolicy(nonce)
    : getContentSecurityPolicy();

  const { headers } = getSecurityHeaders({
    customCsp: csp,
  });

  const result: Record<string, string> = {
    ...headers,
    "X-DNS-Prefetch-Control": "off",
    "X-Download-Options": "noopen",
  };

  return result;
}

/**
 * Middleware for adding security headers to all responses
 */
export function addSecurityHeaders(
  response: Response,
  config: SecurityHeadersConfig = {},
): Response {
  const { headers } = getSecurityHeaders(config);

  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      response.headers.set(key, value);
    }
  }

  return response;
}

// ============================================================================
// CSP Report Handler
// ============================================================================

/**
 * Generate CSP report endpoint handler
 * Logs CSP violations for monitoring
 */
export function handleCspViolation(report: unknown): void {
  console.error("[CSP Violation]", JSON.stringify(report, null, 2));

  // In production, send to monitoring service
  if (env.NODE_ENV === "production") {
    // TODO: Send to Sentry, DataDog, or other monitoring
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate that security headers are properly configured
 */
export function validateSecurityConfig(): {
  valid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  const siteUrl = env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    errors.push("NEXT_PUBLIC_SITE_URL is not set");
  } else if (!siteUrl.startsWith("https://") && env.NODE_ENV === "production") {
    errors.push("NEXT_PUBLIC_SITE_URL should use HTTPS in production");
  }

  if (env.NODE_ENV === "production") {
    if (!env.ELONGOAT_ADMIN_SESSION_SECRET) {
      errors.push("ELONGOAT_ADMIN_SESSION_SECRET must be set in production");
    }
    if (!env.ELONGOAT_ADMIN_TOKEN || env.ELONGOAT_ADMIN_TOKEN.length < 32) {
      errors.push(
        "ELONGOAT_ADMIN_TOKEN must be at least 32 characters in production",
      );
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
