/**
 * Catalogue API integration tests.
 *
 * The catalogue is what quotations are priced from, so the rules that matter
 * are the ones preventing an ambiguous price: overlapping tiers, more than one
 * open-ended tier, and gaps between bands.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@lead/db';
import { resolvePrice } from '../services/catalogue.js';
import {
  closeTestContext,
  createTestContext,
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
  await prisma.priceTier.deleteMany();
  await prisma.product.deleteMany();
});

const headers = () => ({ cookie: ctx.auth });

function post(url: string, payload: unknown) {
  return ctx.app.inject({ method: 'POST', url, payload, headers: headers() });
}
function get(url: string) {
  return ctx.app.inject({ method: 'GET', url, headers: headers() });
}
function del(url: string) {
  return ctx.app.inject({ method: 'DELETE', url, headers: headers() });
}
function patch(url: string, payload: unknown) {
  return ctx.app.inject({ method: 'PATCH', url, payload, headers: headers() });
}

const product = (overrides: Record<string, unknown> = {}) => ({
  sku: 'MK-TEST',
  name: 'Makhana — Test Grade',
  grade: '5 Sut',
  unit: 'kg',
  priceTiers: [
    { minQty: 25, maxQty: 99, pricePerUnit: 620 },
    { minQty: 100, maxQty: 499, pricePerUnit: 585 },
    { minQty: 500, maxQty: null, pricePerUnit: 550 },
  ],
  ...overrides,
});

describe('POST /catalogue/products', () => {
  it('creates a listing with its price ladder', async () => {
    const res = await post('/catalogue/products', product());
    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body.sku).toBe('MK-TEST');
    expect(body.active).toBe(true);
    expect(body.priceTiers).toHaveLength(3);
    // Tiers come back sorted by minQty regardless of insert order.
    expect(body.priceTiers.map((t: { minQty: number }) => t.minQty)).toEqual([25, 100, 500]);
    expect(typeof body.priceTiers[0].pricePerUnit).toBe('number');
  });

  it('creates a listing with no tiers at all', async () => {
    const res = await post('/catalogue/products', product({ priceTiers: undefined }));
    expect(res.statusCode).toBe(201);
    expect(res.json().priceTiers).toEqual([]);
  });

  it('rejects a duplicate SKU', async () => {
    await post('/catalogue/products', product());
    const dup = await post('/catalogue/products', product({ name: 'Something else' }));

    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.details[0].path).toBe('sku');
  });

  it('rejects overlapping price tiers', async () => {
    const res = await post(
      '/catalogue/products',
      product({
        priceTiers: [
          { minQty: 25, maxQty: 150, pricePerUnit: 620 },
          { minQty: 100, maxQty: 499, pricePerUnit: 585 },
        ],
      }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/overlap/i);
  });

  it('rejects more than one open-ended tier', async () => {
    const res = await post(
      '/catalogue/products',
      product({
        priceTiers: [
          { minQty: 25, maxQty: null, pricePerUnit: 620 },
          { minQty: 500, maxQty: null, pricePerUnit: 550 },
        ],
      }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/open-ended/i);
  });

  it('rejects a tier that ends before it begins', async () => {
    const res = await post(
      '/catalogue/products',
      product({ priceTiers: [{ minQty: 500, maxQty: 100, pricePerUnit: 620 }] }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects a negative price', async () => {
    const res = await post(
      '/catalogue/products',
      product({ priceTiers: [{ minQty: 25, maxQty: 99, pricePerUnit: -10 }] }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing SKU', async () => {
    const res = await post('/catalogue/products', product({ sku: '' }));
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /catalogue/products/:id', () => {
  it('soft-deletes by default, keeping the row', async () => {
    const created = (await post('/catalogue/products', product())).json();

    const res = await del(`/catalogue/products/${created.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe('soft');
    expect(res.json().message).toMatch(/deactivated/i);

    // Row survives, but is hidden from the default listing.
    expect(await prisma.product.count({ where: { id: created.id } })).toBe(1);
    expect((await get('/catalogue/products')).json()).toHaveLength(0);
    expect((await get('/catalogue/products?includeInactive=true')).json()).toHaveLength(1);
  });

  it('restores a soft-deleted listing', async () => {
    const created = (await post('/catalogue/products', product())).json();
    await del(`/catalogue/products/${created.id}`);

    const restored = await post(`/catalogue/products/${created.id}/restore`, {});
    expect(restored.statusCode).toBe(200);
    expect(restored.json().active).toBe(true);
    expect((await get('/catalogue/products')).json()).toHaveLength(1);
  });

  it('hard-deletes the row and cascades its price tiers', async () => {
    const created = (await post('/catalogue/products', product())).json();

    const res = await del(`/catalogue/products/${created.id}?hard=true`);
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe('hard');
    expect(res.json().message).toMatch(/permanently/i);

    expect(await prisma.product.count({ where: { id: created.id } })).toBe(0);
    expect(await prisma.priceTier.count({ where: { productId: created.id } })).toBe(0);
  });

  it('404s for an unknown product', async () => {
    expect((await del('/catalogue/products/clwxyz000000000000000000')).statusCode).toBe(404);
  });

  it('is idempotent when soft-deleting twice', async () => {
    const created = (await post('/catalogue/products', product())).json();
    await del(`/catalogue/products/${created.id}`);

    const again = await del(`/catalogue/products/${created.id}`);
    expect(again.statusCode).toBe(200);
    expect(again.json().deleted).toBe('soft');
  });
});

describe('price tiers', () => {
  it('adds a tier to an existing product', async () => {
    const created = (await post(
      '/catalogue/products',
      product({ priceTiers: [{ minQty: 25, maxQty: 99, pricePerUnit: 620 }] }),
    )).json();

    const res = await post(`/catalogue/products/${created.id}/tiers`, {
      minQty: 100,
      maxQty: 499,
      pricePerUnit: 585,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().priceTiers).toHaveLength(2);
  });

  it('refuses a tier that would overlap an existing one', async () => {
    const created = (await post('/catalogue/products', product())).json();

    const res = await post(`/catalogue/products/${created.id}/tiers`, {
      minQty: 50,
      maxQty: 200,
      pricePerUnit: 600,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/overlap/i);
  });

  it('deletes a single tier', async () => {
    const created = (await post('/catalogue/products', product())).json();
    const tierId = created.priceTiers[0].id;

    const res = await del(`/catalogue/products/${created.id}/tiers/${tierId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().priceTiers).toHaveLength(2);
  });

  it('404s deleting a tier that belongs to another product', async () => {
    const a = (await post('/catalogue/products', product())).json();
    const b = (await post('/catalogue/products', product({ sku: 'MK-OTHER' }))).json();

    const res = await del(`/catalogue/products/${a.id}/tiers/${b.priceTiers[0].id}`);
    expect(res.statusCode).toBe(404);
  });

  it('replaces the whole ladder', async () => {
    const created = (await post('/catalogue/products', product())).json();

    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/catalogue/products/${created.id}/tiers`,
      headers: headers(),
      payload: { tiers: [{ minQty: 10, maxQty: null, pricePerUnit: 999 }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().priceTiers).toHaveLength(1);
    expect(res.json().priceTiers[0].pricePerUnit).toBe(999);
  });
});

describe('PATCH /catalogue/products/:id', () => {
  it('updates a price without touching the rest of the listing', async () => {
    const created = (await post('/catalogue/products', product())).json();

    const res = await patch(`/catalogue/products/${created.id}`, { name: 'Renamed Grade' });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Renamed Grade');
    expect(res.json().priceTiers).toHaveLength(3);
  });

  it('rejects renaming to a SKU another product already uses', async () => {
    await post('/catalogue/products', product({ sku: 'MK-A' }));
    const b = (await post('/catalogue/products', product({ sku: 'MK-B' }))).json();

    expect((await patch(`/catalogue/products/${b.id}`, { sku: 'MK-A' })).statusCode).toBe(409);
  });

  it('allows a product to keep its own SKU on update', async () => {
    const a = (await post('/catalogue/products', product({ sku: 'MK-A' }))).json();
    expect((await patch(`/catalogue/products/${a.id}`, { sku: 'MK-A' })).statusCode).toBe(200);
  });
});

describe('resolvePrice', () => {
  const tiers = [
    { minQty: 25, maxQty: 99, pricePerUnit: 620 },
    { minQty: 100, maxQty: 499, pricePerUnit: 585 },
    { minQty: 500, maxQty: null, pricePerUnit: 550 },
  ];

  it.each([
    [25, 620],
    [99, 620],
    [100, 585],
    [499, 585],
    [500, 550],
    [10_000, 550],
  ])('quantity %i resolves to %i', (qty, expected) => {
    expect(resolvePrice(tiers, qty)).toBe(expected);
  });

  it('returns null below the lowest tier rather than guessing', () => {
    expect(resolvePrice(tiers, 5)).toBeNull();
  });

  it('returns null when there are no tiers at all', () => {
    expect(resolvePrice([], 100)).toBeNull();
  });
});
