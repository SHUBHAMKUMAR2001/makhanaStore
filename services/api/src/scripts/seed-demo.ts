/**
 * Demo leads for exploring the CRM before real data exists.
 *
 * This lives in the API rather than in packages/db precisely because every
 * lead's score must come from the scoring engine — seeding scores by hand
 * would create rows the engine would never produce.
 *
 * Run: pnpm --filter @lead/api seed:demo
 */

import { disconnectPrisma, prisma } from '@lead/db';
import type { LeadCreateInput } from '@lead/shared';
import { createOrGetLead } from '../services/leads.js';
import { logger } from '../lib/logger.js';

const DEMO_LEADS: LeadCreateInput[] = [
  { name: 'Sharma Dry Fruits & Co', category: 'Dry Fruit Wholesaler', city: 'Delhi', regionTier: 1, phone: '+919810011111', website: 'https://sharmadryfruits.example.in', source: 'indiamart', stage: 'quoted', dealValue: 185000, notes: 'Asked for 6 sut samples. Wants monthly 500kg.', email: null, campaignId: null, scraperRunId: null },
  { name: 'Bihar Agro Exports', category: 'Merchant Exporter', city: 'Patna', regionTier: 2, phone: '+919430022222', website: 'https://biharagro.example.in', source: 'indiamart', stage: 'negotiating', dealValue: 420000, notes: 'Export to UAE. Needs FSSAI + phytosanitary paperwork.', email: 'trade@biharagro.example.in', campaignId: null, scraperRunId: null },
  { name: 'Gupta Gift Hampers', category: 'Corporate Gifting Solutions', city: 'Mumbai', regionTier: 1, phone: '+919820033333', website: 'https://guptagifts.example.in', source: 'justdial', stage: 'closed_won', dealValue: 96000, notes: 'Diwali hamper order. Repeat buyer.', email: null, campaignId: null, scraperRunId: null },
  { name: 'Annapurna Kirana Store', category: 'Kirana Store', city: 'Muzaffarpur', regionTier: 3, phone: '+919431044444', source: 'justdial', stage: 'contacted', notes: 'Small volume, 25kg trial only.', email: null, website: null, dealValue: null, campaignId: null, scraperRunId: null },
  { name: 'NutriSnack Foods Pvt Ltd', category: 'Private Label Snack Manufacturing', city: 'Bengaluru', regionTier: 1, phone: '+919880055555', website: 'https://nutrisnack.example.in', email: 'sourcing@nutrisnack.example.in', source: 'tradeindia', stage: 'sample_sent', dealValue: 750000, notes: 'White-label roasted makhana. MOQ 1000kg/month.', campaignId: null, scraperRunId: null },
  { name: 'Krishna Sweets', category: 'Sweet Shop', city: 'Darbhanga', regionTier: 3, phone: '+919931066666', source: 'referral', stage: 'replied', dealValue: 32000, notes: 'Wants 4 sut for kheer preparation.', email: null, website: null, campaignId: null, scraperRunId: null },
  { name: 'FreshCart Online', category: 'Online Grocery Store', city: 'Hyderabad', regionTier: 1, website: 'https://freshcart.example.in', email: 'vendors@freshcart.example.in', source: 'google_maps', stage: 'sourced', notes: null, phone: null, dealValue: null, campaignId: null, scraperRunId: null },
  { name: 'Ganga Namkeen Bhandar', category: 'Namkeen Manufacturer', city: 'Kanpur', regionTier: 2, phone: '+919839077777', source: 'indiamart', stage: 'closed_lost', dealValue: 54000, notes: 'Went with a cheaper Purnia supplier.', email: null, website: null, campaignId: null, scraperRunId: null },
  { name: 'Organic Roots Store', category: 'Organic Food Store', city: 'Pune', regionTier: 1, phone: '+919822088888', website: 'https://organicroots.example.in', source: 'meta_ads', stage: 'contacted', notes: 'Wants certified-organic makhana only.', email: null, dealValue: null, campaignId: null, scraperRunId: null },
  { name: 'Royal Banquet Caterers', category: 'Banquet Catering Services', city: 'Lucknow', regionTier: 2, phone: '+919935099999', source: 'justdial', stage: 'sourced', notes: null, email: null, website: null, dealValue: null, campaignId: null, scraperRunId: null },
];

async function main(): Promise<void> {
  let created = 0;
  let skipped = 0;

  for (const lead of DEMO_LEADS) {
    const { created: wasCreated } = await createOrGetLead(lead);
    if (wasCreated) created += 1;
    else skipped += 1;
  }

  const bands = await prisma.lead.groupBy({ by: ['score'], _count: { _all: true } });

  logger.info({ created, skipped }, 'Demo leads seeded');
  for (const band of bands) {
    logger.info(`  ${band.score}: ${band._count._all}`);
  }
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'Demo seed failed');
    process.exitCode = 1;
  })
  .finally(() => void disconnectPrisma());
