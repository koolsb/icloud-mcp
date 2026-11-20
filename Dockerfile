# Container image for running icloud-mcp behind an authenticating
# MCP gateway (Streamable HTTP, bearer token, hard read-only by default).
FROM node:22-alpine

RUN addgroup -S mcp && adduser -S mcp -G mcp

WORKDIR /app

# Production dependencies only; no install scripts.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY index.js ./
COPY lib/ ./lib/

USER mcp

# Safe defaults for container use. Credentials (IMAP_USER, IMAP_PASSWORD,
# ICLOUD_MCP_BEARER_TOKEN) come from the runtime environment / secrets.
ENV NODE_ENV=production \
    ICLOUD_MCP_READ_ONLY=1 \
    ICLOUD_MCP_SEND_MODE=off \
    ICLOUD_MCP_HTTP_HOST=0.0.0.0 \
    ICLOUD_MCP_HTTP_PORT=3000 \
    ICLOUD_MCP_DATA_DIR=/data \
    HOME=/data

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "index.js", "--http"]
