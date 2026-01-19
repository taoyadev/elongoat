# Multi-stage Dockerfile for elongoat backend
# Optimized for production deployments with security and performance best practices

# ============================================================================
# Base Stage - Shared dependencies
# ============================================================================
FROM node:20-alpine AS base
WORKDIR /app

# Install build dependencies in a single layer
RUN apk add --no-cache \
    python3 \
    py3-pip \
    openssl \
    ca-certificates \
    && update-ca-certificates

# Set npm configuration for production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_LOGLEVEL=warn \
    NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=768"

# ============================================================================
# Dependencies Stage - Cache friendly
# ============================================================================
FROM base AS dependencies
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies with explicit platform
RUN npm ci --only=production --no-audit --no-fund \
    && npm cache clean --force

# Install development dependencies for build
RUN npm ci --no-audit --no-fund

# ============================================================================
# Builder Stage - Build the application
# ============================================================================
FROM base AS builder
WORKDIR /app

# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./

# Copy source code
COPY . .

# Build the backend
RUN npm run build:backend \
    && rm -rf .next/cache \
    && find .next -type f -name "*.map" -delete

# ============================================================================
# Production Stage - Minimal runtime image
# ============================================================================
FROM node:20-alpine AS production
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install runtime dependencies only
RUN apk add --no-cache \
    openssl \
    ca-certificates \
    curl \
    tzdata \
    && update-ca-certificates

# Set environment
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=768" \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    NODE_OPTIONS="--enable-source-maps"

# Copy application files from builder
COPY --from=builder --chown=nodejs:nodejs /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=nodejs:nodejs /app/public ./public
COPY --from=builder --chown=nodejs:nodejs /app/data ./data
COPY --from=builder --chown=nodejs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nodejs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nodejs:nodejs /app/.next/server ./.next/server

# Reinstall platform-specific binaries (sharp)
RUN npm ci --only=production --no-audit --no-fund \
    && npm rebuild sharp

# Copy and setup entrypoint
COPY --chown=nodejs:nodejs entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create directories for runtime
RUN mkdir -p /app/.next/cache && \
    chown -R nodejs:nodejs /app/.next/cache

# Switch to non-root user
USER nodejs

# Health checks with proper intervals
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/healthz', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "server.js"]
