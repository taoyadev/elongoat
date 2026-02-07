/**
 * Simple Liveness Probe
 *
 * A lightweight health check for container orchestration.
 * Returns 200 if the Node.js process is running.
 *
 * This endpoint is designed for:
 * - Docker HEALTHCHECK directives
 * - Kubernetes liveness probes
 * - Load balancer health checks
 *
 * Unlike /api/health (which checks external services), this endpoint
 * only verifies that the server process is alive.
 */

import { NextResponse } from "next/server";

import { rateLimitHealth, rateLimitResponse } from "../../../lib/rateLimit";
import { dynamicExport } from "../../../lib/apiExport";

const SERVICE_NAME = "elongoat";
const APP_VERSION =
  process.env.APP_VERSION ?? process.env.npm_package_version ?? undefined;

export const dynamic = dynamicExport("force-dynamic");

export async function GET(request: Request) {
  const { result: rlResult, headers: rlHeaders } =
    await rateLimitHealth(request);
  if (!rlResult.ok) {
    return rateLimitResponse(rlResult);
  }

  return NextResponse.json(
    {
      service: SERVICE_NAME,
      status: "alive",
      version: APP_VERSION,
      buildTarget: process.env.NEXT_BUILD_TARGET ?? "unknown",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    { status: 200, headers: rlHeaders as unknown as HeadersInit },
  );
}

export async function HEAD(request: Request) {
  const { result: rlResult, headers: rlHeaders } =
    await rateLimitHealth(request);
  if (!rlResult.ok) {
    return new NextResponse(null, {
      status: 429,
      headers: rlHeaders as unknown as HeadersInit,
    });
  }

  return new NextResponse(null, {
    status: 200,
    headers: {
      ...((rlHeaders as unknown as HeadersInit) ?? {}),
      "X-ElonGoat-Service": SERVICE_NAME,
    },
  });
}
