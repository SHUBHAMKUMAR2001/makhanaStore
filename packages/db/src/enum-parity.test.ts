/**
 * Guards the one duplication this codebase deliberately accepts.
 *
 * `packages/shared/src/enums.ts` restates the Prisma enums as plain tuples so
 * the browser bundle does not have to import a database client. That is a copy,
 * and copies drift — typically when someone adds a lead source to the schema,
 * runs a migration, and the frontend filter silently never offers it.
 *
 * This test parses the schema file itself (not the generated client, which can
 * be stale) and asserts both sides agree, member for member and in order.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_CHANNELS,
  DELIVERY_STATUSES,
  DOCUMENT_TYPES,
  INTERACTION_DIRECTIONS,
  INTERACTION_TYPES,
  LEAD_SCORES,
  LEAD_SOURCES,
  LEAD_STAGES,
  SCRAPER_RUN_STATUSES,
  USER_ROLES,
} from '@lead/shared';

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'schema.prisma');
const schema = readFileSync(schemaPath, 'utf8');

/** Pull the members of `enum <name> { ... }` out of the schema source. */
function schemaEnum(name: string): string[] {
  const match = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`, 'm').exec(schema);
  if (!match?.[1]) {
    throw new Error(`enum ${name} not found in schema.prisma`);
  }
  return match[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('///'));
}

const cases: [string, readonly string[]][] = [
  ['LeadSource', LEAD_SOURCES],
  ['LeadScore', LEAD_SCORES],
  ['LeadStage', LEAD_STAGES],
  ['InteractionType', INTERACTION_TYPES],
  ['InteractionDirection', INTERACTION_DIRECTIONS],
  ['DeliveryStatus', DELIVERY_STATUSES],
  ['CampaignChannel', CAMPAIGN_CHANNELS],
  ['ScraperRunStatus', SCRAPER_RUN_STATUSES],
  ['UserRole', USER_ROLES],
  ['DocumentType', DOCUMENT_TYPES],
];

describe('shared enums match the Prisma schema', () => {
  it.each(cases)('%s', (name, sharedValues) => {
    expect(schemaEnum(name)).toEqual([...sharedValues]);
  });
});
