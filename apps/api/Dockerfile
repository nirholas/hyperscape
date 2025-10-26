# Multi-stage Docker build for Asset Forge API Server
# Uses Bun runtime for optimal performance

# Stage 1: Base image with dependencies
FROM oven/bun:1 AS base
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Stage 2: Dependencies
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Stage 3: Production image
FROM base AS runner
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 apiserver

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY --chown=apiserver:nodejs . .

# Create directories for runtime data
RUN mkdir -p gdd-assets temp-images && \
    chown -R apiserver:nodejs gdd-assets temp-images

# Switch to non-root user
USER apiserver

# Expose API port
EXPOSE 3004

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3004/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Environment variables
ENV NODE_ENV=production
ENV API_PORT=3004

# Start the server
CMD ["bun", "run", "start"]
