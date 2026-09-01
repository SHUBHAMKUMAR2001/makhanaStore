/** Unique per run, so repeated runs do not collide on the name+city dedupe key. */
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function leadPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `E2E Traders ${uniqueSuffix()}`,
    category: 'Dry Fruit Wholesaler',
    city: 'Patna',
    regionTier: 2,
    phone: '+919876543210',
    source: 'manual',
    ...overrides,
  };
}
