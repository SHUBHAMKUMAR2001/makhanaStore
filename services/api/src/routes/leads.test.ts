/**
 * Lead API integration tests.
 *
 * The behaviours worth protecting here are the ones a future change could break
 * without any test noticing: scores being server-authoritative, de-duplication,
 * and validation actually rejecting bad input rather than coercing it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@lead/db';
import {
  closeTestContext,
  createTestContext,
  leadPayload,
  resetDatabase,
  type TestContext,
} from '../test/helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  await resetDatabase();
  ctx = await createTestContext();
});

afterAll(async () => {
  await closeTestContext(ctx);
});

beforeEach(async () => {
  await prisma.interaction.deleteMany();
  await prisma.lead.deleteMany();
});

function post(url: string, payload: unknown) {
  return ctx.app.inject({ method: 'POST', url, payload, headers: { cookie: ctx.auth } });
}
function get(url: string) {
  return ctx.app.inject({ method: 'GET', url, headers: { cookie: ctx.auth } });
}
function patch(url: string, payload: unknown) {
  return ctx.app.inject({ method: 'PATCH', url, payload, headers: { cookie: ctx.auth } });
}

describe('authentication', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/leads' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('rejects a forged session cookie', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/leads',
      headers: { cookie: 'lead_session=not-a-real-signed-cookie' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts the internal service token', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/leads',
      headers: { 'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a wrong internal token', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/leads',
      headers: { 'x-internal-token': 'x'.repeat(64) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('leaves /health open so container healthchecks work', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'up' });
  });
});

describe('POST /leads', () => {
  it('creates a lead and computes its score server-side', async () => {
    const res = await post('/leads', leadPayload());
    expect(res.statusCode).toBe(201);

    const lead = res.json();
    // Dry Fruit Wholesaler -> distributor (48) + tier 2 (18) + no site (0) + phone (10)
    expect(lead.scoreValue).toBe(76);
    expect(lead.score).toBe('high');
    expect(lead.scoreReasons.length).toBeGreaterThan(0);
    expect(lead.stage).toBe('sourced');
  });

  it('IGNORES a client-supplied score rather than trusting it', async () => {
    const res = await post(
      '/leads',
      leadPayload({ score: 'low', scoreValue: 1, scoreReasons: ['hacked'] }),
    );
    expect(res.statusCode).toBe(201);

    const lead = res.json();
    expect(lead.score).toBe('high');
    expect(lead.scoreValue).toBe(76);
    expect(lead.scoreReasons).not.toContain('hacked');
  });

  it('rejects a lead with no name', async () => {
    const res = await post('/leads', leadPayload({ name: '' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.some((d: { path: string }) => d.path === 'name')).toBe(true);
  });

  it('rejects an invalid source', async () => {
    const res = await post('/leads', leadPayload({ source: 'linkedin' }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects a region tier outside 1..3', async () => {
    expect((await post('/leads', leadPayload({ regionTier: 4 }))).statusCode).toBe(400);
    expect((await post('/leads', leadPayload({ regionTier: 0 }))).statusCode).toBe(400);
  });

  it('rejects a negative deal value', async () => {
    const res = await post('/leads', leadPayload({ dealValue: -5 }));
    expect(res.statusCode).toBe(400);
  });

  it('normalises a bare hostname into an absolute URL', async () => {
    const res = await post('/leads', leadPayload({ website: 'sharmadryfruits.in' }));
    expect(res.json().website).toBe('https://sharmadryfruits.in');
  });

  it('strips formatting from a phone number', async () => {
    const res = await post('/leads', leadPayload({ phone: '+91 98765-43210' }));
    expect(res.json().phone).toBe('+919876543210');
  });

  it('rejects a phone number that is obviously too short', async () => {
    expect((await post('/leads', leadPayload({ phone: '123' }))).statusCode).toBe(400);
  });

  it('refuses a duplicate name+city with a 409', async () => {
    expect((await post('/leads', leadPayload())).statusCode).toBe(201);

    const dup = await post('/leads', leadPayload());
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.message).toMatch(/already exists/i);
  });

  it('treats legal-suffix variants of the same business as duplicates', async () => {
    await post('/leads', leadPayload({ name: 'Sharma Dry Fruits' }));

    const dup = await post('/leads', leadPayload({ name: 'M/s Sharma Dry Fruits Pvt. Ltd.' }));
    expect(dup.statusCode).toBe(409);
  });

  it('allows the same business name in a different city', async () => {
    await post('/leads', leadPayload({ city: 'Patna' }));
    const other = await post('/leads', leadPayload({ city: 'Delhi' }));
    expect(other.statusCode).toBe(201);
  });
});

describe('PATCH /leads/:id', () => {
  it('rescores when a scored field changes', async () => {
    const created = (await post('/leads', leadPayload())).json();
    expect(created.scoreValue).toBe(76);

    const updated = (await patch(`/leads/${created.id}`, { website: 'https://x.in' })).json();
    expect(updated.scoreValue).toBe(76 + 15);
    expect(updated.score).toBe('high');
  });

  it('does NOT rescore when an unscored field changes', async () => {
    const created = (await post('/leads', leadPayload())).json();
    const updated = (await patch(`/leads/${created.id}`, { notes: 'called them' })).json();

    expect(updated.scoreValue).toBe(created.scoreValue);
    expect(updated.scoreReasons).toEqual(created.scoreReasons);
  });

  it('moves the dedupe key when a lead is renamed', async () => {
    const a = (await post('/leads', leadPayload({ name: 'Alpha Traders' }))).json();
    await post('/leads', leadPayload({ name: 'Beta Traders' }));

    // Renaming Alpha to Beta must collide with the existing Beta.
    const res = await patch(`/leads/${a.id}`, { name: 'Beta Traders' });
    expect(res.statusCode).toBe(409);
  });

  it('404s for an unknown lead', async () => {
    const res = await patch('/leads/clwxyz000000000000000000', { notes: 'x' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /leads/:id/stage', () => {
  it('moves a lead and logs the transition on the timeline', async () => {
    const lead = (await post('/leads', leadPayload())).json();

    const res = await post(`/leads/${lead.id}/stage`, {
      stage: 'contacted',
      note: 'Left voicemail',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe('contacted');

    const timeline = (await get(`/leads/${lead.id}/interactions`)).json();
    expect(timeline).toHaveLength(1);
    expect(timeline[0].content).toContain('sourced -> contacted');
    expect(timeline[0].content).toContain('Left voicemail');
  });

  it('refuses to mark a deal won without a value', async () => {
    const lead = (await post('/leads', leadPayload())).json();

    const res = await post(`/leads/${lead.id}/stage`, { stage: 'closed_won' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details[0].path).toBe('dealValue');
  });

  it('accepts a won deal when a value is supplied', async () => {
    const lead = (await post('/leads', leadPayload())).json();

    const res = await post(`/leads/${lead.id}/stage`, { stage: 'closed_won', dealValue: 125000 });
    expect(res.statusCode).toBe(200);
    expect(res.json().dealValue).toBe(125000);
    expect(typeof res.json().dealValue).toBe('number');
  });

  it('allows moving backwards, because real sales work does', async () => {
    const lead = (await post('/leads', leadPayload())).json();
    await post(`/leads/${lead.id}/stage`, { stage: 'quoted' });

    const back = await post(`/leads/${lead.id}/stage`, { stage: 'contacted' });
    expect(back.statusCode).toBe(200);
    expect(back.json().stage).toBe('contacted');
  });

  it('rejects an unknown stage', async () => {
    const lead = (await post('/leads', leadPayload())).json();
    expect((await post(`/leads/${lead.id}/stage`, { stage: 'invoiced' })).statusCode).toBe(400);
  });
});

describe('GET /leads', () => {
  beforeEach(async () => {
    await post(
      '/leads',
      leadPayload({ name: 'Alpha Wholesale', city: 'Delhi', regionTier: 1, source: 'indiamart' }),
    );
    await post(
      '/leads',
      leadPayload({
        name: 'Beta Kirana',
        city: 'Patna',
        regionTier: 3,
        category: 'Kirana Store',
        source: 'justdial',
        phone: null,
      }),
    );
    await post(
      '/leads',
      leadPayload({
        name: 'Gamma Gifting',
        city: 'Mumbai',
        regionTier: 1,
        category: 'Corporate Gifting',
        source: 'indiamart',
      }),
    );
  });

  it('paginates', async () => {
    const res = await get('/leads?pageSize=2&page=1');
    const body = res.json();
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.totalPages).toBe(2);
  });

  it('filters by source', async () => {
    const body = (await get('/leads?source=indiamart')).json();
    expect(body.total).toBe(2);
  });

  it('filters by multiple stages at once', async () => {
    const body = (await get('/leads?stage=sourced&stage=quoted')).json();
    expect(body.total).toBe(3);
  });

  it('filters by score band', async () => {
    const body = (await get('/leads?score=low')).json();
    expect(body.items.every((l: { score: string }) => l.score === 'low')).toBe(true);
  });

  it('searches across name, city and category', async () => {
    expect((await get('/leads?q=kirana')).json().total).toBe(1);
    expect((await get('/leads?q=mumbai')).json().total).toBe(1);
  });

  it('sorts by score ascending using the numeric value, not enum order', async () => {
    const body = (await get('/leads?sortBy=score&sortDir=asc')).json();
    const values = body.items.map((l: { scoreValue: number }) => l.scoreValue);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('rejects an unknown sort field instead of ignoring it', async () => {
    expect((await get('/leads?sortBy=passwordHash')).statusCode).toBe(400);
  });

  it('caps pageSize so a client cannot request the whole table', async () => {
    expect((await get('/leads?pageSize=100000')).statusCode).toBe(400);
  });
});

describe('GET /leads/:id/score', () => {
  it('explains the score without the client recomputing anything', async () => {
    const lead = (await post('/leads', leadPayload())).json();
    const body = (await get(`/leads/${lead.id}/score`)).json();

    expect(body.stored.score).toBe('high');
    expect(body.computed.value).toBe(76);
    expect(body.stale).toBe(false);
    expect(body.computed.contributions).toHaveLength(4);
  });

  it('flags a lead whose stored score no longer matches the rules', async () => {
    const lead = (await post('/leads', leadPayload())).json();
    await prisma.lead.update({ where: { id: lead.id }, data: { score: 'low', scoreValue: 3 } });

    const body = (await get(`/leads/${lead.id}/score`)).json();
    expect(body.stale).toBe(true);
  });
});

describe('DELETE /leads/:id', () => {
  it('deletes the lead and cascades its interactions', async () => {
    const lead = (await post('/leads', leadPayload())).json();
    await post(`/leads/${lead.id}/interactions`, { type: 'call', content: 'spoke' });

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/leads/${lead.id}`,
      headers: { cookie: ctx.auth },
    });
    expect(res.statusCode).toBe(204);

    expect(await prisma.interaction.count({ where: { leadId: lead.id } })).toBe(0);
  });
});
