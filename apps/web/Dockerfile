# Build the SPA, then serve the static output from nginx.
# Multi-stage so the runtime image carries no node_modules or toolchain.
FROM node:22-slim AS builder
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile=false --filter @lead/shared --filter @lead/web

COPY packages/shared packages/shared
COPY apps/web apps/web

RUN pnpm --filter @lead/shared build

# The API origin is baked in at build time, not read at runtime — Vite inlines
# import.meta.env during the build.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @lead/web build

FROM nginx:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
