FROM node:22-slim AS base
WORKDIR /app

# Corepack otherwise prompts "Do you want to continue? [Y/n]" on first use,
# which stalls any non-interactive build or `docker compose run`.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Prisma needs OpenSSL to pick its query engine. Without it it warns that it
# "failed to detect the libssl/openssl version" and falls back to openssl-1.1.x,
# which is not what this image ships.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY services/docgen/package.json services/docgen/
RUN pnpm install --frozen-lockfile=false \
      --filter @lead/shared --filter @lead/db --filter @lead/docgen

FROM deps AS builder
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY services/docgen services/docgen
RUN pnpm --filter @lead/shared build \
 && pnpm --filter @lead/db build \
 && pnpm --filter @lead/docgen build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app /app

# The storage volume is mounted here; the service must be able to write to it.
RUN groupadd -r docgen && useradd -r -m -g docgen docgen \
    && mkdir -p /data/storage && chown -R docgen:docgen /data/storage /app
ENV HOME=/home/docgen
USER docgen

EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.DOCGEN_PORT||4100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "services/docgen/dist/server.js"]
