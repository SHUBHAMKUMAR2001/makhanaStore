/**
 * Request pacing and the hard request cap.
 *
 * This is the whole reason the scraper can work without proxies: it behaves
 * like a slow human rather than a crawler. The budget is also the safety net
 * that stops a parser bug from walking a site forever.
 */

import { setTimeout as sleep } from 'node:timers/promises';

export interface ThrottleOptions {
  minDelayMs: number;
  maxDelayMs: number;
  batchSize: number;
  batchPauseMs: number;
  maxRequests: number;
}

export class RequestBudgetExhausted extends Error {
  constructor(readonly limit: number) {
    super(`Reached the configured cap of ${limit} requests for this run`);
    this.name = 'RequestBudgetExhausted';
  }
}

export class Throttle {
  private used = 0;
  private sinceBatchPause = 0;

  constructor(
    private readonly options: ThrottleOptions,
    /** Injectable for tests — the real one is `setTimeout` from timers/promises. */
    private readonly wait: (ms: number) => Promise<void> = (ms) => sleep(ms),
    private readonly random: () => number = Math.random,
  ) {}

  get requestsMade(): number {
    return this.used;
  }

  get remaining(): number {
    return Math.max(0, this.options.maxRequests - this.used);
  }

  get exhausted(): boolean {
    return this.used >= this.options.maxRequests;
  }

  /** A uniformly random delay in the configured window. */
  nextDelay(): number {
    const { minDelayMs, maxDelayMs } = this.options;
    return Math.round(minDelayMs + this.random() * (maxDelayMs - minDelayMs));
  }

  /**
   * Call immediately before every network request.
   *
   * Throws `RequestBudgetExhausted` rather than returning false, so a caller
   * cannot accidentally ignore the cap by not checking a return value.
   */
  async beforeRequest(): Promise<void> {
    if (this.exhausted) {
      throw new RequestBudgetExhausted(this.options.maxRequests);
    }

    // No delay before the very first request — the pause belongs *between*
    // requests, and an upfront wait just makes every run slower for nothing.
    if (this.used > 0) {
      if (this.sinceBatchPause >= this.options.batchSize) {
        await this.wait(this.options.batchPauseMs);
        this.sinceBatchPause = 0;
      } else {
        await this.wait(this.nextDelay());
      }
    }

    this.used += 1;
    this.sinceBatchPause += 1;
  }
}
