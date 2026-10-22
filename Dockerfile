FROM node:22.23.4-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM node:22.23.4-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/browsers PUPPETEER_SKIP_DOWNLOAD=true \
    SPARROW_DB_PATH=/data/results.db
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npx playwright install --with-deps chromium
COPY src/ ./src/
COPY server.js ./
COPY scripts/container-entrypoint.sh /usr/local/bin/sparrow
COPY --from=frontend /build/dist ./frontend/dist
RUN mkdir -p /data && chown node:node /data && chmod +x /usr/local/bin/sparrow
USER node
EXPOSE 3001
CMD ["sparrow"]
