FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY services/outreach/package.json services/outreach/
RUN pnpm install --frozen-lockfile=false \
      --filter @lead/shared --filter @lead/db --filter @lead/outreach

FROM deps AS builder
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY services/outreach services/outreach
RUN pnpm --filter @lead/shared build \
 && pnpm --filter @lead/db build \
 && pnpm --filter @lead/outreach build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app /app

RUN groupadd -r outreach && useradd -r -m -g outreach outreach && chown -R outreach:outreach /app
ENV HOME=/home/outreach
USER outreach

EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.OUTREACH_PORT||4200)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "services/outreach/dist/server.js"]
