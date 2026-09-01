# Debian rather than alpine: Chromium needs the glibc shared libraries below,
# and an alpine build would need a separately installed chromium and a
# different launch path.
FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
      libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
      libxext6 libxfixes3 libxkbcommon0 libxrandr2 wget \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY services/scraper/package.json services/scraper/
# Let puppeteer download the Chromium build it was tested against.
RUN pnpm install --frozen-lockfile=false --filter @lead/shared --filter @lead/scraper

FROM deps AS builder
COPY packages/shared packages/shared
COPY services/scraper services/scraper
RUN pnpm --filter @lead/shared build && pnpm --filter @lead/scraper build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app /app

# Chromium must not run as root.
RUN groupadd -r scraper && useradd -r -g scraper -G audio,video scraper \
    && mkdir -p /home/scraper/Downloads && chown -R scraper:scraper /home/scraper /app
USER scraper

CMD ["node", "services/scraper/dist/worker.js"]
