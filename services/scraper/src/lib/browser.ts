/**
 * Browser lifecycle.
 *
 * puppeteer-extra with the stealth plugin, because the directories being read
 * fingerprint headless Chrome. Stealth is not evasion of a block — it stops
 * the browser announcing itself as automated to sites that would otherwise
 * serve a degraded page.
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';
import { env, USER_AGENT } from '../config.js';
import { logger } from './logger.js';

let pluginRegistered = false;

function registerPlugins(): void {
  if (pluginRegistered) return;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- puppeteer-extra
  // and the stealth plugin ship independently-versioned type declarations that
  // do not structurally match; the runtime contract is stable.
  puppeteerExtra.use(StealthPlugin() as Parameters<typeof puppeteerExtra.use>[0]);
  pluginRegistered = true;
}

export async function launchBrowser(): Promise<Browser> {
  registerPlugins();

  return puppeteerExtra.launch({
    headless: env.SCRAPER_HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Chromium's default 64MB of shared memory is not enough for
      // content-heavy directory pages inside a container.
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1440,900',
      // Indian locale, to match the IP the scraper must be running from.
      '--lang=en-IN',
    ],
  }) as unknown as Promise<Browser>;
}

export async function newPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();

  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1440, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-IN,en;q=0.9' });
  page.setDefaultNavigationTimeout(env.SCRAPER_NAV_TIMEOUT_MS);

  /**
   * Block images, fonts, media and analytics.
   *
   * Politeness as much as speed: not downloading a megabyte of product
   * photography per listing page is a real reduction in load on the site, and
   * it makes each request finish inside the timeout on a small VM.
   */
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const type = request.resourceType();
    if (type === 'image' || type === 'media' || type === 'font' || type === 'stylesheet') {
      void request.abort();
      return;
    }
    const url = request.url();
    if (/googletagmanager|google-analytics|doubleclick|facebook\.net|hotjar|clarity\.ms/.test(url)) {
      void request.abort();
      return;
    }
    void request.continue();
  });

  page.on('pageerror', (error) => {
    logger.debug({ err: error.message }, 'Page script error (usually harmless)');
  });

  return page;
}

export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch (error) {
    logger.warn({ err: error }, 'Browser did not close cleanly');
  }
}
