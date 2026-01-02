# ============================================================================
# Asset Forge API Server - Production Dockerfile
# ============================================================================
# Elysia API server for AI-powered 3D asset generation
# Based on Bun runtime for maximum performance
# ============================================================================

FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy workspace package files first for caching
COPY package.json bun.lock ./
COPY packages/asset-forge/package.json ./packages/asset-forge/

# Install dependencies
RUN bun install --ignore-scripts

# Copy source code
COPY packages/asset-forge/ ./packages/asset-forge/

# ============================================================================
# Runtime stage
# ============================================================================
FROM oven/bun:1-alpine AS runtime

WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache tini

# Copy package files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lock ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/asset-forge ./packages/asset-forge

# Create directories for runtime
RUN mkdir -p /app/packages/asset-forge/temp-images \
    && mkdir -p /app/packages/asset-forge/gdd-assets

# Set working directory to asset-forge
WORKDIR /app/packages/asset-forge

# Expose API port
EXPOSE 3401

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3401/api/health || exit 1

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start the Elysia server
CMD ["bun", "run", "server/api-elysia.ts"]
