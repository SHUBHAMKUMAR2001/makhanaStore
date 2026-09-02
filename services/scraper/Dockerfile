# Debian rather than alpine: Chromium needs the glibc shared libraries below,
# and an alpine build would need a separately installed chromium and a
# different launch path.
FROM node:22-slim AS base
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Puppeteer downloads Chromium into $HOME/.cache/puppeteer by default, which in
# the builder stage is /root/.cache — outside /app, and therefore not carried
# over by `COPY --from=builder /app /app`. The image then builds cleanly and
# fails at the first scrape with "Could not find Chrome".
#
# Pointing the cache inside /app means the browser is copied with everything
# else, and the same variable tells the runtime where to look.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

RUN corepack enable

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates openssl fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
      libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
      libxext6 libxfixes3 libxkbcommon0 libxrandr2 wget \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY services/scraper/package.json services/scraper/
# Downloads the Chromium build puppeteer was tested against, into
# PUPPETEER_CACHE_DIR above.
RUN pnpm install --frozen-lockfile=false --filter @lead/shared --filter @lead/scraper \
 && test -d "$PUPPETEER_CACHE_DIR" \
    || (echo "Chromium was not downloaded to $PUPPETEER_CACHE_DIR" >&2 && exit 1)

FROM deps AS builder
COPY packages/shared packages/shared
COPY services/scraper services/scraper
RUN pnpm --filter @lead/shared build && pnpm --filter @lead/scraper build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app /app

# Fail the build rather than the first scrape if the browser is missing.
RUN test -d /app/.cache/puppeteer \
 && echo "Chromium present: $(find /app/.cache/puppeteer -name 'chrome' -type f | head -1)" \
 || (echo "Chromium missing from the runtime image" >&2 && exit 1)

# Chromium must not run as root.
RUN groupadd -r scraper && useradd -r -m -g scraper -G audio,video scraper \
    && mkdir -p /home/scraper/Downloads && chown -R scraper:scraper /home/scraper /app
ENV HOME=/home/scraper
USER scraper

CMD ["node", "services/scraper/dist/worker.js"]
