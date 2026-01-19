import { NextRequest, NextResponse } from "next/server";
import {
  getSecurityHeaders,
  getNonce,
  getContentSecurityPolicy,
} from "./lib/securityHeaders";
import { getPublicEnv } from "./lib/env";

const env = getPublicEnv();
/**
 * Middleware for applying security headers, CORS, request tracing, and compression
 * Run on every request to ensure consistent security posture and performance
 *
 * SECURITY: Implements CSP nonce system to eliminate unsafe-inline in production
 */

/**
 * Generate a UUID v4 for request tracing
 */
function generateRequestId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const ALLOWED_ORIGINS = new Set([
  env.NEXT_PUBLIC_SITE_URL ?? "https://elongoat.io",
  "https://elongoat.io",
]);

const API_URL = env.NEXT_PUBLIC_API_URL ?? "https://api.elongoat.io";

export function middleware(request: NextRequest) {
  // Generate or retrieve request ID for distributed tracing
  let requestId = request.headers.get("x-request-id");
  if (!requestId) {
    requestId = generateRequestId();
  }

  // Clone headers and add request ID
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  // SECURITY: Generate nonce for inline scripts (eliminates unsafe-inline)
  // In production, use nonce-based CSP. In development, allow unsafe-inline for Next.js
  const isProd = env.NODE_ENV === "production";
  const nonce = isProd ? getNonce() : undefined;

  // Pass nonce to pages via header for use in script tags
  if (nonce) {
    requestHeaders.set("x-csp-nonce", nonce);
  }

  // Create response with request ID header
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Add X-Request-ID to response for tracing
  response.headers.set("X-Request-ID", requestId);

  // Pass nonce to response for client-side access if needed
  if (nonce) {
    response.headers.set("X-CSP-Nonce", nonce);
  }

  // Handle CORS preflight requests
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    const preflightResponse = new NextResponse(null, { status: 200 });

    if (origin && ALLOWED_ORIGINS.has(origin)) {
      preflightResponse.headers.set("Access-Control-Allow-Origin", origin);
      preflightResponse.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      preflightResponse.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With, X-Request-ID",
      );
      preflightResponse.headers.set("Access-Control-Max-Age", "86400");
    }

    // Add request ID to preflight response
    preflightResponse.headers.set("X-Request-ID", requestId);

    return preflightResponse;
  }

  // Apply CORS for regular requests
  const origin = request.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "false");
    response.headers.set(
      "Access-Control-Expose-Headers",
      "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After, X-Request-ID",
    );
  }

  // Get base security headers with nonce for CSP
  const { headers } = getSecurityHeaders({
    contentSecurityPolicy: true,
    strictTransportSecurity: true,
    xContentTypeOptions: true,
    xFrameOptions: true,
    xXssProtection: true,
    referrerPolicy: true,
    permissionsPolicy: true,
    customCsp: nonce ? undefined : undefined, // Will use nonce in getContentSecurityPolicy
  });

  // Apply security headers, modifying CSP to include API URL and nonce
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      if (key === "Content-Security-Policy") {
        // Add API URL to connect-src for cross-origin API calls
        const apiOrigin = new URL(API_URL).origin;
        let cspValue = value.replace(/connect-src[^;]*/, `$& ${apiOrigin}`);

        // If we have a nonce, the CSP should already include it from securityHeaders.ts
        // But we need to regenerate with the nonce since middleware generates it
        if (nonce) {
          cspValue = getContentSecurityPolicy(nonce);
          // Still need to add API URL
          cspValue = cspValue.replace(/connect-src[^;]*/, `$& ${apiOrigin}`);
        }

        response.headers.set(key, cspValue);
      } else {
        response.headers.set(key, value);
      }
    }
  }

  // Remove X-Powered-By header to reduce information disclosure
  response.headers.delete("x-powered-by");

  // Add Vary header for proper caching with compression
  // nginx-proxy handles actual compression, but we need to signal it
  response.headers.set("Vary", "Accept-Encoding");

  return response;
}

/**
 * Configure which routes the middleware should run on
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
