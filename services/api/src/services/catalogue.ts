/**
 * Product catalogue and pricing.
 *
 * This is the config the docgen service reads when it builds a quotation, so a
 * rate changed here changes every quotation issued afterwards — and none issued
 * before, because each generated document stores a snapshot of its own line
 * items in `Document.meta`.
 *
 * Deletion is soft by default. A hard delete is offered too, and is safe for
 * the same reason: past quotations do not resolve their prices through this
 * table at read time.
 */

import { prisma, numberToDecimal, type Prisma, type Product } from '@lead/db';
import type {
  PriceTierCreateInput,
  productCreateSchema,
  productUpdateSchema,
} from '@lead/shared';
import type { z } from 'zod';
import { ApiError } from '../lib/errors.js';

type ProductCreateInput = z.infer<typeof productCreateSchema>;
type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
type ProductWithTiers = Prisma.ProductGetPayload<{ include: { priceTiers: true } }>;

const withTiers = { include: { priceTiers: true } } as const;

export async function listProducts(options: {
  includeInactive?: boolean;
  q?: string | undefined;
}): Promise<ProductWithTiers[]> {
  const where: Prisma.ProductWhereInput = {};
  if (!options.includeInactive) where.active = true;
  if (options.q) {
    where.OR = [
      { name: { contains: options.q, mode: 'insensitive' } },
      { sku: { contains: options.q, mode: 'insensitive' } },
      { grade: { contains: options.q, mode: 'insensitive' } },
    ];
  }

  return prisma.product.findMany({
    where,
    ...withTiers,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function getProductOrThrow(id: string): Promise<ProductWithTiers> {
  const product = await prisma.product.findUnique({ where: { id }, ...withTiers });
  if (!product) throw ApiError.notFound('Product');
  return product;
}

/**
 * Reject a tier ladder whose bands overlap or leave a gap.
 *
 * An overlap makes `resolvePrice` ambiguous — two tiers would both claim a
 * quantity, and which one wins would depend on row order. A quotation quietly
 * priced from the wrong band is worse than a rejected edit.
 */
export function validateTierLadder(
  tiers: { minQty: number; maxQty?: number | null }[],
): void {
  if (tiers.length === 0) return;

  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);

  const openEnded = sorted.filter((t) => t.maxQty === null || t.maxQty === undefined);
  if (openEnded.length > 1) {
    throw ApiError.unprocessable(
      'Only one price tier may be open-ended (no maximum quantity)',
      [{ path: 'priceTiers', message: `${openEnded.length} tiers have no maximum` }],
    );
  }

  for (let i = 0; i < sorted.length; i += 1) {
    const tier = sorted[i]!;

    if (tier.maxQty != null && tier.maxQty < tier.minQty) {
      throw ApiError.unprocessable(
        `Tier starting at ${tier.minQty} ends at ${tier.maxQty}, before it begins`,
        [{ path: `priceTiers.${i}.maxQty`, message: 'Must be at least the minimum quantity' }],
      );
    }

    const next = sorted[i + 1];
    if (!next) continue;

    if (tier.maxQty == null) {
      throw ApiError.unprocessable(
        `The open-ended tier starting at ${tier.minQty} must be the highest tier`,
        [{ path: `priceTiers.${i}.maxQty`, message: 'Only the top tier may be open-ended' }],
      );
    }

    if (next.minQty <= tier.maxQty) {
      throw ApiError.unprocessable(
        `Price tiers overlap: ${tier.minQty}-${tier.maxQty} and ${next.minQty}-${next.maxQty ?? '+'}`,
        [{ path: `priceTiers.${i + 1}.minQty`, message: `Must be greater than ${tier.maxQty}` }],
      );
    }
  }
}

export async function createProduct(input: ProductCreateInput): Promise<ProductWithTiers> {
  const { priceTiers = [], ...fields } = input;
  validateTierLadder(priceTiers);

  const existing = await prisma.product.findUnique({ where: { sku: fields.sku } });
  if (existing) {
    throw ApiError.conflict(`A product with SKU "${fields.sku}" already exists`, [
      { path: 'sku', message: 'Must be unique' },
    ]);
  }

  return prisma.product.create({
    data: {
      ...fields,
      priceTiers: {
        create: priceTiers.map((tier) => ({
          minQty: tier.minQty,
          maxQty: tier.maxQty ?? null,
          pricePerUnit: numberToDecimal(tier.pricePerUnit)!,
          currency: tier.currency,
        })),
      },
    },
    ...withTiers,
  });
}

export async function updateProduct(
  id: string,
  input: ProductUpdateInput,
): Promise<ProductWithTiers> {
  await getProductOrThrow(id);
  const { priceTiers, ...fields } = input;

  if (priceTiers) {
    validateTierLadder(priceTiers);
  }

  if (fields.sku) {
    const clash = await prisma.product.findFirst({
      where: { sku: fields.sku, NOT: { id } },
    });
    if (clash) {
      throw ApiError.conflict(`A product with SKU "${fields.sku}" already exists`, [
        { path: 'sku', message: 'Must be unique' },
      ]);
    }
  }

  return prisma.$transaction(async (tx) => {
    if (priceTiers) {
      // Replace the ladder wholesale — a partial merge of overlapping bands is
      // ambiguous, and the caller sent the ladder they want.
      await tx.priceTier.deleteMany({ where: { productId: id } });
      await tx.priceTier.createMany({
        data: priceTiers.map((tier) => ({
          productId: id,
          minQty: tier.minQty,
          maxQty: tier.maxQty ?? null,
          pricePerUnit: numberToDecimal(tier.pricePerUnit)!,
          currency: tier.currency,
        })),
      });
    }

    return tx.product.update({ where: { id }, data: fields, ...withTiers });
  });
}

/**
 * Remove a catalogue listing.
 *
 * Soft by default (`active = false`): the product stops appearing on new
 * quotations but the row survives, so historical references still resolve.
 * `hard` deletes the row and cascades its price tiers.
 */
export async function deleteProduct(
  id: string,
  options: { hard?: boolean } = {},
): Promise<{ deleted: 'soft' | 'hard'; product: Product }> {
  const product = await getProductOrThrow(id);

  if (options.hard) {
    await prisma.product.delete({ where: { id } });
    return { deleted: 'hard', product };
  }

  if (!product.active) {
    // Already deactivated — report it rather than pretending something changed.
    return { deleted: 'soft', product };
  }

  const updated = await prisma.product.update({ where: { id }, data: { active: false } });
  return { deleted: 'soft', product: updated };
}

/** Bring a soft-deleted listing back. */
export async function restoreProduct(id: string): Promise<ProductWithTiers> {
  await getProductOrThrow(id);
  return prisma.product.update({ where: { id }, data: { active: true }, ...withTiers });
}

// --- price tiers -----------------------------------------------------------

export async function addPriceTier(
  productId: string,
  input: PriceTierCreateInput,
): Promise<ProductWithTiers> {
  const product = await getProductOrThrow(productId);

  validateTierLadder([
    ...product.priceTiers.map((t) => ({ minQty: t.minQty, maxQty: t.maxQty })),
    { minQty: input.minQty, maxQty: input.maxQty ?? null },
  ]);

  await prisma.priceTier.create({
    data: {
      productId,
      minQty: input.minQty,
      maxQty: input.maxQty ?? null,
      pricePerUnit: numberToDecimal(input.pricePerUnit)!,
      currency: input.currency,
    },
  });

  return getProductOrThrow(productId);
}

export async function deletePriceTier(
  productId: string,
  tierId: string,
): Promise<ProductWithTiers> {
  const product = await getProductOrThrow(productId);

  if (!product.priceTiers.some((t) => t.id === tierId)) {
    throw ApiError.notFound('Price tier');
  }

  await prisma.priceTier.delete({ where: { id: tierId } });
  return getProductOrThrow(productId);
}

/**
 * Price for a quantity, from the tier whose band contains it.
 *
 * Returns null when the quantity falls below the lowest tier — that is a real
 * answer ("below our minimum order"), not an error, and the caller decides how
 * to present it.
 */
export function resolvePrice(
  tiers: { minQty: number; maxQty: number | null; pricePerUnit: unknown }[],
  quantity: number,
): number | null {
  const match = tiers.find(
    (tier) => quantity >= tier.minQty && (tier.maxQty === null || quantity <= tier.maxQty),
  );
  if (!match) return null;
  const price = Number(String(match.pricePerUnit));
  return Number.isFinite(price) ? price : null;
}
