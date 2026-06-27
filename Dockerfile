# syntax=docker/dockerfile:1

# ---------- Stage 1: install full deps & build ----------
FROM node:24-alpine AS builder
WORKDIR /app

# Install deps from lockfile first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Build the Nest app -> /app/dist
COPY . .
RUN npm run build

# Drop dev dependencies so only production deps get copied into the runtime image.
RUN npm prune --omit=dev

# ---------- Stage 2: minimal runtime ----------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# App listens here; HOST defaults to 0.0.0.0 (see src/config/env.validation.ts).
ENV PORT=3100

# Run as the built-in unprivileged user, not root.
USER node

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/package.json ./package.json

EXPOSE 3100

# Container-level liveness check (orchestrators may override with their own probes).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:'+(process.env.PORT||3100)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main"]
