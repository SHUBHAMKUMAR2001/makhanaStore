FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY services/api/package.json services/api/
RUN pnpm install --frozen-lockfile=false \
      --filter @lead/shared --filter @lead/db --filter @lead/api

FROM deps AS builder
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY services/api services/api
# @lead/db's build runs `prisma generate` first, which the API types against.
RUN pnpm --filter @lead/shared build \
 && pnpm --filter @lead/db build \
 && pnpm --filter @lead/api build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app /app

# The `migrate` service reuses this image and runs `prisma migrate deploy`,
# which needs the Prisma CLI and the schema — both are present because the
# whole workspace is copied above.

# Shares the storage volume with docgen so the API can stream documents back.
# -m gives the user a home directory. Without one, the `migrate` service — which
# reuses this image to run `prisma migrate deploy` — cannot write Prisma's
# engine cache and fails with a permission error rather than a clear message.
RUN groupadd -r api && useradd -r -m -g api api \
    && mkdir -p /data/storage && chown -R api:api /data/storage /app
ENV HOME=/home/api
USER api

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "services/api/dist/server.js"]
