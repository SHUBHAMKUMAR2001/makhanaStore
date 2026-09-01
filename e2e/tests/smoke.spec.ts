/**
 * Critical-flow smoke tests, over real HTTP.
 *
 * Deliberately thin: this is not a second copy of the unit suite. It checks
 * that the flows the business depends on work end to end through the actual
 * server — the parts that only break once routes, hooks, cookies and
 * serialisation are assembled together.
 */

import { test as base, expect } from '@playwright/test';
import { expect as fixtureExpect, test } from './fixtures.js';
import { leadPayload } from './helpers.js';

void fixtureExpect;

test.describe('health', () => {
  base('reports the database is reachable, without auth', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ status: 'ok', database: 'up' });
  });
});

test.describe('authentication', () => {
  // These two need a context with no session, so they use the base fixture.
  base('rejects an unauthenticated request', async ({ request }) => {
    const response = await request.get('/leads');
    expect(response.status()).toBe(401);
  });

  base('rejects wrong credentials', async ({ request }) => {
    const response = await request.post('/auth/login', {
      data: { email: 'nobody@example.com', password: 'wrong-password-entirely' },
    });
    expect(response.status()).toBe(401);
  });

  test('a signed-in session returns the current user', async ({ api }) => {
    const me = await api.get('/auth/me');
    expect(me.ok()).toBe(true);
    expect((await me.json()).user.email).toBeTruthy();
  });
});

test.describe('lead creation', () => {
  test('creates a lead and scores it server-side', async ({ api }) => {
    const response = await api.post('/leads', { data: leadPayload() });
    expect(response.status()).toBe(201);

    const lead = await response.json();
    // Dry Fruit Wholesaler -> distributor 48, tier 2 -> 18, no site 0, phone 10
    expect(lead.scoreValue).toBe(76);
    expect(lead.score).toBe('high');
    expect(lead.stage).toBe('sourced');
    expect(lead.scoreReasons.length).toBeGreaterThan(0);
  });

  test('ignores a client-supplied score', async ({ api }) => {
    const response = await api.post('/leads', {
      data: leadPayload({ category: 'Kirana Store', score: 'high', scoreValue: 999 }),
    });

    const lead = await response.json();
    expect(lead.score).toBe('low');
    expect(lead.scoreValue).not.toBe(999);
  });

  test('rejects a malformed lead at the boundary', async ({ api }) => {
    const response = await api.post('/leads', { data: leadPayload({ name: '', regionTier: 9 }) });
    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  test('refuses a duplicate business in the same city', async ({ api }) => {
    const payload = leadPayload();
    expect((await api.post('/leads', { data: payload })).status()).toBe(201);
    expect((await api.post('/leads', { data: payload })).status()).toBe(409);
  });
});

test.describe('stage transitions', () => {
  test('moves a lead and records it on the timeline', async ({ api }) => {
    const lead = await (await api.post('/leads', { data: leadPayload() })).json();

    const moved = await api.post(`/leads/${lead.id}/stage`, {
      data: { stage: 'contacted', note: 'Left a voicemail' },
    });
    expect(moved.ok()).toBe(true);
    expect((await moved.json()).stage).toBe('contacted');

    const timeline = await (await api.get(`/leads/${lead.id}/interactions`)).json();
    expect(timeline).toHaveLength(1);
    expect(timeline[0].content).toContain('sourced -> contacted');
    expect(timeline[0].content).toContain('Left a voicemail');
  });

  test('refuses to close a deal won without a value', async ({ api }) => {
    const lead = await (await api.post('/leads', { data: leadPayload() })).json();

    const response = await api.post(`/leads/${lead.id}/stage`, { data: { stage: 'closed_won' } });
    expect(response.status()).toBe(422);
    expect((await response.json()).error.details[0].path).toBe('dealValue');
  });

  test('accepts a won deal with a value and reports it as a number', async ({ api }) => {
    const lead = await (await api.post('/leads', { data: leadPayload() })).json();

    const response = await api.post(`/leads/${lead.id}/stage`, {
      data: { stage: 'closed_won', dealValue: 250000 },
    });
    expect(response.ok()).toBe(true);

    const updated = await response.json();
    expect(updated.dealValue).toBe(250000);
    // Guards the Decimal-to-JSON regression: a Decimal serialises as an object.
    expect(typeof updated.dealValue).toBe('number');
  });
});

test.describe('scoring', () => {
  test('explains a score without the client recomputing it', async ({ api }) => {
    const lead = await (await api.post('/leads', { data: leadPayload() })).json();

    const response = await api.get(`/leads/${lead.id}/score`);
    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.stored.score).toBe('high');
    expect(body.computed.value).toBe(76);
    expect(body.computed.contributions).toHaveLength(4);
    expect(body.stale).toBe(false);
  });

  test('rescores when a scored field changes', async ({ api }) => {
    const lead = await (await api.post('/leads', { data: leadPayload() })).json();

    const updated = await (
      await api.patch(`/leads/${lead.id}`, { data: { website: 'https://example.in' } })
    ).json();

    expect(updated.scoreValue).toBe(lead.scoreValue + 15);
  });

  test('does not rescore when an unscored field changes', async ({ api }) => {
    const lead = await (await api.post('/leads', { data: leadPayload() })).json();

    const updated = await (
      await api.patch(`/leads/${lead.id}`, { data: { notes: 'called them' } })
    ).json();

    expect(updated.scoreValue).toBe(lead.scoreValue);
  });
});

test.describe('dashboard', () => {
  test('returns coherent totals', async ({ api }) => {
    const stats = await (await api.get('/stats/dashboard')).json();

    expect(stats.totals.leads).toBeGreaterThanOrEqual(0);
    expect(stats.funnel).toHaveLength(8);
    // closeRate is null rather than 0 when nothing has closed — 0 would read
    // as failure rather than "no data".
    if (stats.totals.won + stats.totals.lost === 0) {
      expect(stats.totals.closeRate).toBeNull();
    }
  });
});
