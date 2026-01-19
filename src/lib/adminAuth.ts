import "server-only";

import { timingSafeEqual } from "node:crypto";
import { createHmac, randomBytes, createHash } from "node:crypto";
import { getEnv } from "./env";

const env = getEnv();
const IS_STATIC_EXPORT = process.env.NEXT_BUILD_TARGET === "export";
// ============================================================================
// Configuration
// ============================================================================

const ADMIN_SESSION_COOKIE_NAME = "elongoat_admin_session";
const ADMIN_CSRF_COOKIE_NAME = "elongoat_admin_csrf";
const SESSION_EXPIRY_SECONDS = 60 * 60 * 8; // 8 hours
const CSRF_EXPIRY_SECONDS = 60 * 60 * 24; // 24 hours
const ADMIN_COOKIE_PATH = "/"; // Cover both /admin UI and /api/admin endpoints

// ============================================================================
// Types
// ============================================================================

interface AdminSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number;
  csrfToken: string;
}

interface SessionValidationResult {
  valid: boolean;
  session?: AdminSession;
  reason?: string;
}

// ============================================================================
// JWT Implementation (minimal, stateless)
// ============================================================================

interface JwtPayload {
  sid: string; // session ID
  iat: number; // issued at
  exp: number; // expires at
  csrf: string; // CSRF token
}

function base64UrlEncode(data: string): string {
  const base64 = Buffer.from(data).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlDecode(data: string): string {
  let base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  return Buffer.from(base64, "base64").toString("utf-8");
}

function createHmacSha256(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/**
 * Create a JWT for admin session
 * Note: This is a minimal implementation. For production, consider using jsonwebtoken
 */
function createSessionToken(payload: JwtPayload): string {
  const secret = getSessionSecret();
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmacSha256(
    `${encodedHeader}.${encodedPayload}`,
    secret,
  );
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify and decode a JWT session token
 */
function verifySessionToken(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const secret = getSessionSecret();

    // Verify signature
    const expectedSignature = createHmacSha256(
      `${encodedHeader}.${encodedPayload}`,
      secret,
    );
    if (signature !== expectedSignature) return null;

    // Decode payload
    const payload: JwtPayload = JSON.parse(base64UrlDecode(encodedPayload));

    // Verify expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Get the session secret from environment
 * In production, this should be a long, random string
 */
function getSessionSecret(): string {
  const secret = env.ELONGOAT_ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "ELONGOAT_ADMIN_SESSION_SECRET must be set for secure admin authentication",
    );
  }
  return secret;
}

/**
 * Generate a cryptographically secure random token
 */
export function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Hash a token for storage (timing-safe comparison)
 * NOTE: Currently unused but exported for potential future token storage needs
 */
export function hashToken(token: string): string {
  const secret = getSessionSecret();
  return createHash("sha256")
    .update(token + secret)
    .digest("hex");
}

/**
 * Create a new admin session
 * SECURITY: Returns csrfToken for server-side use only (not exposed to client)
 */
export async function createAdminSession(): Promise<{
  success: boolean;
  error?: string;
  cookieHeader?: string;
  csrfToken?: string; // For server-side injection only, never sent to client
}> {
  const adminToken = env.ELONGOAT_ADMIN_TOKEN;
  if (!adminToken) {
    return { success: false, error: "Admin authentication not configured" };
  }

  const sessionId = generateSecureToken();
  const csrfToken = generateSecureToken();
  const now = Math.floor(Date.now() / 1000);

  const payload: JwtPayload = {
    sid: sessionId,
    iat: now,
    exp: now + SESSION_EXPIRY_SECONDS,
    csrf: csrfToken,
  };

  const sessionToken = createSessionToken(payload);

  // Set httpOnly cookie with the session token
  const cookieHeader = buildSetCookieHeader({
    name: ADMIN_SESSION_COOKIE_NAME,
    value: sessionToken,
    maxAge: SESSION_EXPIRY_SECONDS,
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: ADMIN_COOKIE_PATH,
  });

  // SECURITY: CSRF token stored in httpOnly cookie to prevent XSS access
  // Client-side code should NOT read the CSRF token directly
  // Instead, use SameSite cookies and double-submit pattern via headers
  // For API requests, the CSRF token is validated from the session cookie itself
  // The X-Admin-CSRF header is used as a secondary verification (nonce-like pattern)
  const csrfCookieHeader = buildSetCookieHeader({
    name: ADMIN_CSRF_COOKIE_NAME,
    value: csrfToken,
    maxAge: CSRF_EXPIRY_SECONDS,
    httpOnly: true, // SECURITY: Changed to httpOnly to prevent XSS token theft
    secure: isProduction(),
    sameSite: "strict", // SECURITY: Changed to strict for better CSRF protection
    path: ADMIN_COOKIE_PATH,
  });

  return {
    success: true,
    cookieHeader: `${cookieHeader}, ${csrfCookieHeader}`,
    csrfToken, // Return to server-side rendering only, NOT exposed to client
  };
}

/**
 * Validate the current admin session from cookies
 */
export async function validateAdminSession(
  request: Request,
): Promise<SessionValidationResult> {
  if (IS_STATIC_EXPORT) {
    return { valid: false, reason: "static_export" };
  }
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return { valid: false, reason: "no_cookie" };
  }

  // Parse session cookie
  const sessionMatch = cookieHeader.match(
    new RegExp(`${ADMIN_SESSION_COOKIE_NAME}=([^;]+)`),
  );
  if (!sessionMatch) {
    return { valid: false, reason: "no_session_cookie" };
  }

  const sessionToken = sessionMatch[1];
  const payload = verifySessionToken(sessionToken);

  if (!payload) {
    return { valid: false, reason: "invalid_token" };
  }

  // Verify CSRF if this is a state-changing request
  const method = request.method.toUpperCase();
  if (
    method === "POST" ||
    method === "PUT" ||
    method === "DELETE" ||
    method === "PATCH"
  ) {
    const csrfMatch = cookieHeader.match(
      new RegExp(`${ADMIN_CSRF_COOKIE_NAME}=([^;]+)`),
    );
    if (!csrfMatch || csrfMatch[1] !== payload.csrf) {
      return { valid: false, reason: "csrf_mismatch" };
    }
  }

  // Check CSRF header for API requests
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const requestCsrf = request.headers.get("x-admin-csrf");
    if (requestCsrf !== payload.csrf) {
      return { valid: false, reason: "csrf_header_missing" };
    }
  }

  const session: AdminSession = {
    id: payload.sid,
    createdAt: payload.iat * 1000,
    expiresAt: payload.exp * 1000,
    lastUsedAt: Date.now(),
    csrfToken: payload.csrf,
  };

  return { valid: true, session };
}

/**
 * Clear admin session cookies
 */
export function clearAdminSession(): string {
  const headers = [
    buildSetCookieHeader({
      name: ADMIN_SESSION_COOKIE_NAME,
      value: "",
      maxAge: 0,
      httpOnly: true,
      secure: isProduction(),
      sameSite: "lax",
      path: ADMIN_COOKIE_PATH,
    }),
    // SECURITY: Clear CSRF cookie with httpOnly=true to match set behavior
    buildSetCookieHeader({
      name: ADMIN_CSRF_COOKIE_NAME,
      value: "",
      maxAge: 0,
      httpOnly: true,
      secure: isProduction(),
      sameSite: "strict",
      path: ADMIN_COOKIE_PATH,
    }),
  ];

  return headers.join(", ");
}

// ============================================================================
// Legacy Auth (for backward compatibility during transition)
// ============================================================================

/**
 * Check admin auth via Authorization header (Bearer token)
 * @deprecated Use validateAdminSession for cookie-based auth instead
 */
export function checkAdminAuth(req: Request): boolean {
  if (IS_STATIC_EXPORT) return false;
  const token = env.ELONGOAT_ADMIN_TOKEN;
  if (!token) return false;

  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length).trim();

  try {
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(token, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Check admin auth via either session cookie or Authorization header
 * This provides a transition path from header-based to cookie-based auth
 */
export async function checkAdminAuthEither(req: Request): Promise<boolean> {
  // Try session-based auth first (more secure)
  const sessionResult = await validateAdminSession(req);
  if (sessionResult.valid) return true;

  // Fall back to header-based auth for backward compatibility
  return checkAdminAuth(req);
}

/**
 * Return an unauthorized response
 */
export function unauthorized(reason: string = "unauthorized"): Response {
  return Response.json(
    { error: reason },
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Bearer realm="ElonGoat Admin"',
      },
    },
  );
}

/**
 * Return a forbidden response
 */
export function forbidden(reason: string = "forbidden"): Response {
  return Response.json({ error: reason }, { status: 403 });
}

// ============================================================================
// CSRF Protection
// ============================================================================

/**
 * Generate a CSRF token for API requests
 * Returns the current session's CSRF token
 */
export async function getCsrfToken(request: Request): Promise<string | null> {
  const result = await validateAdminSession(request);
  return result.valid ? (result.session?.csrfToken ?? null) : null;
}

/**
 * Verify CSRF token from request
 */
export async function verifyCsrfToken(
  request: Request,
  providedToken: string,
): Promise<boolean> {
  const result = await validateAdminSession(request);
  if (!result.valid || !result.session) return false;

  return timingSafeEqual(
    Buffer.from(result.session.csrfToken),
    Buffer.from(providedToken),
  );
}

// ============================================================================
// Audit Logging
// ============================================================================

interface AuditLogEntry {
  timestamp: string;
  ip: string;
  userAgent: string;
  action: string;
  resource?: string;
  success: boolean;
  reason?: string;
}

const auditLogs: AuditLogEntry[] = [];
const MAX_AUDIT_LOGS = 1000;

/**
 * Log an admin action for security auditing
 */
export function logAdminAction(params: {
  request: Request;
  action: string;
  resource?: string;
  success: boolean;
  reason?: string;
}): void {
  if (IS_STATIC_EXPORT) return;
  const ip = getClientIp(params.request);
  const userAgent = params.request.headers.get("user-agent") ?? "unknown";

  const entry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    ip,
    userAgent: sanitizeUserAgent(userAgent),
    action: params.action,
    resource: params.resource,
    success: params.success,
    reason: params.reason,
  };

  auditLogs.push(entry);

  // Keep only the most recent logs
  if (auditLogs.length > MAX_AUDIT_LOGS) {
    auditLogs.shift();
  }

  // Log to console in production (should go to proper logging system)
  if (isProduction()) {
    console.log(
      `[ADMIN_AUDIT] ${entry.timestamp} ${ip} ${entry.action} ${entry.success ? "SUCCESS" : "FAIL"} ${entry.reason ?? ""}`,
    );
  }
}

/**
 * Get recent audit logs (for admin review)
 */
export function getAuditLogs(limit: number = 100): AuditLogEntry[] {
  return auditLogs.slice(-limit).reverse();
}

/**
 * Get client IP address from request
 */
function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

/**
 * Sanitize user agent for logging (prevent log injection)
 */
function sanitizeUserAgent(ua: string): string {
  return ua.replace(/[\x00-\x1F\x7F]/g, "").slice(0, 200);
}

// ============================================================================
// Middleware Helper
// ============================================================================

/**
 * Next.js middleware helper to protect admin routes
 * Usage in middleware.ts:
 *   if (pathname.startsWith('/admin')) {
 *     return await protectAdminRoute(request);
 *   }
 */
export async function protectAdminRoute(request: Request): Promise<Response> {
  const result = await validateAdminSession(request);

  if (!result.valid) {
    logAdminAction({
      request,
      action: "admin_access_denied",
      success: false,
      reason: result.reason,
    });

    // For API routes, return JSON
    if (request.headers.get("accept")?.includes("application/json")) {
      return unauthorized(result.reason);
    }

    // For page requests, redirect to login (could implement login page)
    return new Response("Unauthorized", {
      status: 302,
      headers: {
        Location: "/",
      },
    });
  }

  // Valid session - continue to the route
  logAdminAction({
    request,
    action: "admin_access",
    success: true,
  });

  return new Response(null, {
    status: 200,
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

interface CookieOptions {
  name: string;
  value: string;
  maxAge: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "strict" | "lax" | "none";
  path: string;
}

function buildSetCookieHeader(options: CookieOptions): string {
  const parts = [
    `${options.name}=${options.value}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    options.httpOnly ? "HttpOnly" : "",
    options.secure ? "Secure" : "",
    `SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`,
  ];

  return parts.filter(Boolean).join("; ");
}

function isProduction(): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Validate that required security environment variables are set
 */
export function validateSecurityConfig(): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!env.ELONGOAT_ADMIN_TOKEN) {
    errors.push("ELONGOAT_ADMIN_TOKEN is not set");
  } else if (env.ELONGOAT_ADMIN_TOKEN.length < 32) {
    errors.push("ELONGOAT_ADMIN_TOKEN should be at least 32 characters");
  }

  if (!env.ELONGOAT_ADMIN_SESSION_SECRET) {
    errors.push("ELONGOAT_ADMIN_SESSION_SECRET is not set");
  } else if (env.ELONGOAT_ADMIN_SESSION_SECRET.length < 32) {
    errors.push(
      "ELONGOAT_ADMIN_SESSION_SECRET should be at least 32 characters",
    );
  }

  if (isProduction() && !env.DATABASE_URL) {
    errors.push("DATABASE_URL should be set in production for audit logging");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
