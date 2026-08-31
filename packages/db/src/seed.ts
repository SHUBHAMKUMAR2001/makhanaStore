/**
 * Idempotent seed: the admin account and the business configuration that
 * every generated quotation and deck reads from.
 *
 * Run with `pnpm db:seed`. Safe to re-run — it upserts, so re-seeding after a
 * schema change will not duplicate the product catalogue or reset a password
 * you have since changed.
 *
 * Demo *leads* are deliberately not seeded here: a lead's score must be
 * produced by the API's scoring engine, and packages/db must not depend on a
 * service. Use `pnpm --filter @lead/api seed:demo` for sample leads.
 */

import { hash } from '@node-rs/argon2';
import { prisma, disconnectPrisma } from './client.js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/**
 * Placeholder business identity. Everything here is meant to be edited —
 * either in this file before the first seed, or through the API's
 * `/config/business` endpoint afterwards.
 */
const BUSINESS = {
  legalName: 'Your Legal Entity Name Pvt Ltd',
  brandName: 'Your Makhana Brand',
  fssaiNumber: '00000000000000',
  gstin: null as string | null,
  addressLine1: 'Address line 1',
  addressLine2: null as string | null,
  city: 'Darbhanga',
  state: 'Bihar',
  pincode: '846004',
  country: 'India',
  phone: '+910000000000',
  email: 'sales@example.com',
  website: null as string | null,
  bankName: null as string | null,
  accountName: null as string | null,
  accountNumber: null as string | null,
  ifsc: null as string | null,
  quotationValidityDays: 15,
  quotationTerms: [
    'Prices are ex-works and exclusive of freight unless stated otherwise.',
    'GST as applicable will be charged over and above the quoted rate.',
    'Payment terms: 50% advance against order, balance before dispatch.',
    'Dispatch within 7-10 working days of confirmed order and advance receipt.',
    'Moisture content maintained below 8%; packed in food-grade laminated pouches.',
    'Private-label orders require artwork approval before production begins.',
    'Rates are subject to revision after the validity period stated above.',
  ],
};

/**
 * Makhana is graded by "sut" — the popped diameter. Larger sut = larger,
 * whiter, more uniform pop = higher price. These are the standard wholesale
 * grades; edit the prices to your actual rates before quoting anyone.
 */
const PRODUCTS = [
  {
    sku: 'MK-6SUT',
    name: 'Makhana — 6 Sut (Premium Handpicked)',
    grade: '6 Sut',
    description:
      'Largest grade. Uniform white pop, minimal black spotting. Suited to gifting packs and premium retail.',
    hsnCode: '20081920',
    sortOrder: 10,
    tiers: [
      { minQty: 25, maxQty: 99, pricePerUnit: 720 },
      { minQty: 100, maxQty: 499, pricePerUnit: 680 },
      { minQty: 500, maxQty: null, pricePerUnit: 645 },
    ],
  },
  {
    sku: 'MK-5SUT',
    name: 'Makhana — 5 Sut (Standard Grade)',
    grade: '5 Sut',
    description:
      'The wholesale workhorse grade. Good size consistency at a materially lower rate than 6 sut.',
    hsnCode: '20081920',
    sortOrder: 20,
    tiers: [
      { minQty: 25, maxQty: 99, pricePerUnit: 620 },
      { minQty: 100, maxQty: 499, pricePerUnit: 585 },
      { minQty: 500, maxQty: null, pricePerUnit: 550 },
    ],
  },
  {
    sku: 'MK-4SUT',
    name: 'Makhana — 4 Sut (Economy Grade)',
    grade: '4 Sut',
    description:
      'Smaller pop with more variation. Cost-effective for flavoured snack processing and bulk catering.',
    hsnCode: '20081920',
    sortOrder: 30,
    tiers: [
      { minQty: 50, maxQty: 199, pricePerUnit: 500 },
      { minQty: 200, maxQty: null, pricePerUnit: 470 },
    ],
  },
  {
    sku: 'MK-ROAST-PLAIN',
    name: 'Roasted Makhana — Lightly Salted',
    grade: '5 Sut base',
    description: 'Roasted in-house, lightly salted. Ready-to-eat, packed in nitrogen-flushed pouches.',
    hsnCode: '20081920',
    sortOrder: 40,
    tiers: [
      { minQty: 10, maxQty: 49, pricePerUnit: 890 },
      { minQty: 50, maxQty: null, pricePerUnit: 840 },
    ],
  },
  {
    sku: 'MK-WL-PACK',
    name: 'White-Label Packing Service',
    grade: null,
    description:
      'Your brand, our production. Covers roasting, flavouring, pouch filling and labelling. Priced per kg over the base grade rate. MOQ 200 kg per SKU.',
    hsnCode: '998819',
    sortOrder: 50,
    tiers: [
      { minQty: 200, maxQty: 999, pricePerUnit: 95 },
      { minQty: 1000, maxQty: null, pricePerUnit: 75 },
    ],
  },
];

async function seedAdmin(): Promise<void> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn(
      '[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin user.\n' +
        '       Set both in .env and re-run `pnpm db:seed` to create your login.',
    );
    return;
  }

  if (ADMIN_PASSWORD.length < 12) {
    throw new Error('[seed] ADMIN_PASSWORD must be at least 12 characters.');
  }
  if (ADMIN_PASSWORD === 'change-me-before-seeding') {
    throw new Error(
      '[seed] ADMIN_PASSWORD is still the .env.example placeholder. Set a real password.',
    );
  }

  const email = ADMIN_EMAIL.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    // Never silently reset a password the operator has since changed.
    console.log(`[seed] admin user ${email} already exists — leaving password untouched`);
    return;
  }

  await prisma.user.create({
    data: { email, passwordHash: await hash(ADMIN_PASSWORD), role: 'admin' },
  });
  console.log(`[seed] created admin user ${email}`);
}

async function seedBusinessProfile(): Promise<void> {
  const { quotationTerms, ...rest } = BUSINESS;
  await prisma.businessProfile.upsert({
    where: { id: 'default' },
    // Only fill in on first run. Re-seeding must not clobber details the
    // operator has edited through the API.
    update: {},
    create: { id: 'default', ...rest, quotationTerms },
  });
  console.log('[seed] business profile ready');
}

async function seedCatalogue(): Promise<void> {
  for (const { tiers, ...product } of PRODUCTS) {
    const row = await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: product,
    });

    for (const tier of tiers) {
      await prisma.priceTier.upsert({
        where: { productId_minQty: { productId: row.id, minQty: tier.minQty } },
        update: {},
        create: { productId: row.id, ...tier },
      });
    }
  }
  console.log(`[seed] catalogue ready (${PRODUCTS.length} products)`);
}

async function main(): Promise<void> {
  await seedAdmin();
  await seedBusinessProfile();
  await seedCatalogue();
  console.log('[seed] done');
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void disconnectPrisma());
