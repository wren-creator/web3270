# ── Stage 1: deps ─────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Stage 2: runtime image ────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Non-root user for security
RUN addgroup -S tn3270 && adduser -S tn3270 -G tn3270

# Copy deps from stage 1, then app source
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=tn3270:tn3270 . .

USER tn3270

# ── Port the WebSocket bridge listens on (browser → bridge)
# The bridge → mainframe connections go OUT on whatever port
# each LPAR profile specifies (:23, :992, etc.) — no EXPOSE needed
# for those since they are outbound.
EXPOSE 8080

# Health-check: confirm the WS port is accepting connections
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health 2>/dev/null || \
      nc -z localhost 8080 || exit 1

ENV NODE_ENV=production \
    BRIDGE_PORT=8080 \
    LOG_LEVEL=info

CMD ["node", "server.js"]
