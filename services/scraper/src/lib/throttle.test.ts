/**
 * Throttle tests.
 *
 * The pacing rules are what let this scraper work with no proxies and no paid
 * API, so they are worth testing precisely: the cap must be a hard stop, and
 * the batch pause must actually happen at the batch boundary.
 */

import { describe, expect, it, vi } from 'vitest';
import { RequestBudgetExhausted, Throttle } from './throttle.js';

/** Records every wait instead of performing it, so tests run instantly. */
function recorder() {
  const waits: number[] = [];
  return {
    waits,
    wait: async (ms: number): Promise<void> => {
      waits.push(ms);
    },
  };
}

const options = {
  minDelayMs: 3500,
  maxDelayMs: 9000,
  batchSize: 40,
  batchPauseMs: 90_000,
  maxRequests: 300,
};

describe('request budget', () => {
  it('permits exactly maxRequests requests', async () => {
    const { wait } = recorder();
    const throttle = new Throttle({ ...options, maxRequests: 5 }, wait, () => 0.5);

    for (let i = 0; i < 5; i += 1) await throttle.beforeRequest();

    expect(throttle.requestsMade).toBe(5);
    expect(throttle.exhausted).toBe(true);
    expect(throttle.remaining).toBe(0);
  });

  it('throws rather than silently allowing the cap to be exceeded', async () => {
    const { wait } = recorder();
    const throttle = new Throttle({ ...options, maxRequests: 2 }, wait, () => 0.5);

    await throttle.beforeRequest();
    await throttle.beforeRequest();

    await expect(throttle.beforeRequest()).rejects.toThrow(RequestBudgetExhausted);
    // The rejected request must not be counted.
    expect(throttle.requestsMade).toBe(2);
  });

  it('reports remaining budget as it is consumed', async () => {
    const { wait } = recorder();
    const throttle = new Throttle({ ...options, maxRequests: 3 }, wait, () => 0.5);

    expect(throttle.remaining).toBe(3);
    await throttle.beforeRequest();
    expect(throttle.remaining).toBe(2);
  });
});

describe('delays', () => {
  it('does not delay before the very first request', async () => {
    const rec = recorder();
    const throttle = new Throttle(options, rec.wait, () => 0.5);

    await throttle.beforeRequest();
    expect(rec.waits).toEqual([]);
  });

  it('delays between subsequent requests', async () => {
    const rec = recorder();
    const throttle = new Throttle(options, rec.wait, () => 0.5);

    await throttle.beforeRequest();
    await throttle.beforeRequest();
    await throttle.beforeRequest();

    expect(rec.waits).toHaveLength(2);
  });

  it('keeps every delay inside the configured window', async () => {
    const rec = recorder();
    const throttle = new Throttle(options, rec.wait, Math.random);

    for (let i = 0; i < 30; i += 1) await throttle.beforeRequest();

    for (const wait of rec.waits) {
      // Batch pauses are longer by design; ignore those here.
      if (wait === options.batchPauseMs) continue;
      expect(wait).toBeGreaterThanOrEqual(options.minDelayMs);
      expect(wait).toBeLessThanOrEqual(options.maxDelayMs);
    }
  });

  it('maps the random extremes to the window bounds', () => {
    const { wait } = recorder();
    expect(new Throttle(options, wait, () => 0).nextDelay()).toBe(options.minDelayMs);
    expect(new Throttle(options, wait, () => 1).nextDelay()).toBe(options.maxDelayMs);
  });

  it('varies delays rather than using a fixed interval', async () => {
    const rec = recorder();
    const throttle = new Throttle(options, rec.wait, Math.random);

    for (let i = 0; i < 20; i += 1) await throttle.beforeRequest();

    // A constant delay is exactly the fingerprint randomisation exists to avoid.
    expect(new Set(rec.waits).size).toBeGreaterThan(1);
  });
});

describe('batch pauses', () => {
  it('pauses after every batchSize requests', async () => {
    const rec = recorder();
    const throttle = new Throttle(
      { ...options, batchSize: 5, maxRequests: 100 },
      rec.wait,
      () => 0.5,
    );

    for (let i = 0; i < 16; i += 1) await throttle.beforeRequest();

    const pauses = rec.waits.filter((w) => w === options.batchPauseMs);
    // Requests 6 and 11 and 16 follow a completed batch of 5.
    expect(pauses).toHaveLength(3);
  });

  it('resets the batch counter after pausing', async () => {
    const rec = recorder();
    const throttle = new Throttle(
      { ...options, batchSize: 3, maxRequests: 100 },
      rec.wait,
      () => 0.5,
    );

    for (let i = 0; i < 9; i += 1) await throttle.beforeRequest();

    // Without a reset the pause would fire on every request after the third.
    expect(rec.waits.filter((w) => w === options.batchPauseMs)).toHaveLength(2);
  });

  it('never pauses when the run is shorter than one batch', async () => {
    const rec = recorder();
    const throttle = new Throttle({ ...options, batchSize: 40 }, rec.wait, () => 0.5);

    for (let i = 0; i < 10; i += 1) await throttle.beforeRequest();

    expect(rec.waits).not.toContain(options.batchPauseMs);
  });
});

describe('defaults are polite', () => {
  it('would take a meaningful amount of time to make 300 requests', () => {
    // A sanity check on the shipped defaults: if someone tunes these down to
    // "fast", this test is the thing that objects.
    const meanDelay = (options.minDelayMs + options.maxDelayMs) / 2;
    const batches = Math.floor(options.maxRequests / options.batchSize);
    const totalMs = options.maxRequests * meanDelay + batches * options.batchPauseMs;

    // At least twenty minutes for a full run.
    expect(totalMs).toBeGreaterThan(20 * 60 * 1000);
  });
});
