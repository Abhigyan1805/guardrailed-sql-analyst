# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# Bake the deterministic demo dataset (seed=42) into an embedded PGlite dir,
# so the container is self-contained and needs no managed database.
RUN PGDATA_DIR=/seed-pgdata npm run db:seed

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    PGDATA_DIR=/data/pgdata
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
# uid 1000 (the built-in node user) is what Hugging Face Spaces runs containers as.
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/db ./db
COPY --from=build --chown=node:node /app/docs/openapi.yaml ./docs/openapi.yaml
COPY --from=build --chown=node:node /app/node_modules/@electric-sql/pglite ./node_modules/@electric-sql/pglite
COPY --from=build --chown=node:node /seed-pgdata /data/pgdata
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
