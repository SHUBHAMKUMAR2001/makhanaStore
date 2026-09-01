/**
 * Assembling the data a quotation is built from.
 *
 * Prices are resolved from the catalogue's tier ladder at generation time and
 * then **snapshotted** into the document's meta. That is what lets the
 * catalogue be edited freely: changing a rate changes future quotations and
 * leaves issued ones exactly as they were sent.
 */

import { decimalToNumber, prisma } from '@lead/db';
import type { QuotationRequest } from '@lead/shared';
import type { LineItemInput } from './money.js';

export class QuotationDataError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'QuotationDataError';
  }
}

/** Price for a quantity, from the tier whose band contains it. */
export function resolveTierPrice(
  tiers: { minQty: number; maxQty: number | null; pricePerUnit: unknown }[],
  quantity: number,
): number | null {
  const match = tiers.find(
    (t) => quantity >= t.minQty && (t.maxQty === null || quantity <= t.maxQty),
  );
  if (!match) return null;
  return decimalToNumber(match.pricePerUnit as never);
}

export interface QuotationContext {
  lead: { id: string; name: string; city: string; phone: string | null; email: string | null };
  business: NonNullable<Awaited<ReturnType<typeof prisma.businessProfile.findUnique>>>;
  items: LineItemInput[];
  taxPercent: number;
  freight: number;
  notes: string | undefined;
  validityDays: number;
  quotationNumber: string;
  issuedAt: Date;
}

/**
 * A short, human-quotable reference. Not a database sequence: a gap-free
 * sequence would need locking, and nothing here depends on the numbers being
 * contiguous — only on being unambiguous when a customer reads one over the
 * phone.
 */
export function buildQuotationNumber(date: Date, seed: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const suffix = seed
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-5)
    .toUpperCase()
    .padStart(5, '0');
  return `Q/${y}${m}/${suffix}`;
}

export async function buildQuotationContext(request: QuotationRequest): Promise<QuotationContext> {
  const [lead, business] = await Promise.all([
    prisma.lead.findUnique({ where: { id: request.leadId } }),
    prisma.businessProfile.findUnique({ where: { id: 'default' } }),
  ]);

  if (!lead) throw new QuotationDataError('Lead not found', 'leadId');
  if (!business) {
    throw new QuotationDataError(
      'No business profile configured. Run `pnpm db:seed`, then set your details ' +
        'under Catalogue in the CRM — a quotation cannot be issued without them.',
    );
  }

  const items: LineItemInput[] = [];

  for (const [index, item] of request.items.entries()) {
    let pricePerUnit = item.pricePerUnit;
    let description = item.description;
    let unit = item.unit;
    let hsnCode = item.hsnCode;

    if (item.productId) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
        include: { priceTiers: true },
      });

      if (!product) {
        throw new QuotationDataError(
          `Product ${item.productId} not found`,
          `items.${index}.productId`,
        );
      }

      description = item.description || product.name;
      unit = item.unit || product.unit;
      hsnCode = item.hsnCode ?? product.hsnCode ?? undefined;

      // An explicit price on the request wins — that is how a negotiated rate
      // gets quoted without editing the catalogue.
      if (pricePerUnit === undefined) {
        const resolved = resolveTierPrice(product.priceTiers, item.quantity);
        if (resolved === null) {
          const lowest = Math.min(...product.priceTiers.map((t) => t.minQty));
          throw new QuotationDataError(
            product.priceTiers.length === 0
              ? `"${product.name}" has no price tiers configured, so it cannot be quoted.`
              : `${item.quantity} ${unit} of "${product.name}" is below the minimum order of ` +
                  `${lowest} ${unit}. Add a lower tier or quote a price explicitly.`,
            `items.${index}.quantity`,
          );
        }
        pricePerUnit = resolved;
      }
    }

    if (pricePerUnit === undefined) {
      throw new QuotationDataError(
        `Line ${index + 1} ("${description}") needs either a productId to price from ` +
          'the catalogue, or an explicit pricePerUnit.',
        `items.${index}.pricePerUnit`,
      );
    }

    items.push({ description, quantity: item.quantity, unit, pricePerUnit, hsnCode });
  }

  const issuedAt = new Date();

  return {
    lead: { id: lead.id, name: lead.name, city: lead.city, phone: lead.phone, email: lead.email },
    business,
    items,
    taxPercent: request.taxPercent,
    freight: request.freight,
    notes: request.notes,
    validityDays: request.validityDays ?? business.quotationValidityDays,
    quotationNumber: buildQuotationNumber(issuedAt, lead.id),
    issuedAt,
  };
}
