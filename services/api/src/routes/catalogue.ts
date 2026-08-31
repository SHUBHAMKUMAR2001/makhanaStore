/**
 * Product catalogue management.
 *
 * These endpoints are what make the quotation catalogue editable at runtime
 * rather than only through the seed script: create a listing, adjust its price
 * ladder, retire it when you stop offering it.
 */

import type { FastifyInstance } from 'fastify';
import {
  businessProfileUpdateSchema,
  idParamSchema,
  priceTierCreateSchema,
  priceTierReplaceSchema,
  productCreateSchema,
  productDeleteQuerySchema,
  productListQuerySchema,
  productUpdateSchema,
} from '@lead/shared';
import { prisma } from '@lead/db';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { parseBody, parseParams, parseQuery } from '../lib/validate.js';
import { serializeBusinessProfile, serializeProduct } from '../lib/serialize.js';
import { requireAuth } from '../plugins/auth.js';
import {
  addPriceTier,
  createProduct,
  deletePriceTier,
  deleteProduct,
  getProductOrThrow,
  listProducts,
  restoreProduct,
  updateProduct,
} from '../services/catalogue.js';

const tierParamsSchema = z.object({ id: z.string().cuid(), tierId: z.string().cuid() });

export function registerCatalogueRoutes(app: FastifyInstance): void {
  app.addHook('onRequest', requireAuth);

  // --- products ------------------------------------------------------------
  app.get('/catalogue/products', async (request) => {
    const query = parseQuery(productListQuerySchema, request.query);
    const products = await listProducts({ includeInactive: query.includeInactive, q: query.q });
    return products.map(serializeProduct);
  });

  app.get('/catalogue/products/:id', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    return serializeProduct(await getProductOrThrow(id));
  });

  app.post('/catalogue/products', async (request, reply) => {
    const input = parseBody(productCreateSchema, request.body);
    const product = await createProduct(input);
    return reply.status(201).send(serializeProduct(product));
  });

  app.patch('/catalogue/products/:id', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(productUpdateSchema, request.body);
    return serializeProduct(await updateProduct(id, input));
  });

  /**
   * Delete a listing. Soft by default; `?hard=true` removes the row.
   *
   * The response says which happened rather than returning a bare 204, so the
   * UI can tell the operator "deactivated" versus "permanently deleted" — those
   * are different enough that a silent success is unhelpful.
   */
  app.delete('/catalogue/products/:id', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    const { hard } = parseQuery(productDeleteQuerySchema, request.query);

    const { deleted, product } = await deleteProduct(id, { hard });

    return {
      deleted,
      id: product.id,
      sku: product.sku,
      message:
        deleted === 'hard'
          ? `"${product.name}" was permanently deleted along with its price tiers.`
          : `"${product.name}" was deactivated. It will not appear on new quotations; restore it any time.`,
    };
  });

  app.post('/catalogue/products/:id/restore', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    return serializeProduct(await restoreProduct(id));
  });

  // --- price tiers ---------------------------------------------------------
  app.post('/catalogue/products/:id/tiers', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(priceTierCreateSchema, request.body);
    const product = await addPriceTier(id, input);
    return reply.status(201).send(serializeProduct(product));
  });

  /** Replace the whole ladder — simpler and less ambiguous than patching bands. */
  app.put('/catalogue/products/:id/tiers', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    const { tiers } = parseBody(priceTierReplaceSchema, request.body);
    return serializeProduct(await updateProduct(id, { priceTiers: tiers }));
  });

  app.delete('/catalogue/products/:id/tiers/:tierId', async (request) => {
    const { id, tierId } = parseParams(tierParamsSchema, request.params);
    return serializeProduct(await deletePriceTier(id, tierId));
  });

  // --- business profile ----------------------------------------------------
  app.get('/config/business', async () => {
    const profile = await prisma.businessProfile.findUnique({ where: { id: 'default' } });
    if (!profile) {
      throw ApiError.notFound(
        'Business profile (run `pnpm db:seed` to create it)',
      );
    }
    return serializeBusinessProfile(profile);
  });

  app.patch('/config/business', async (request) => {
    const input = parseBody(businessProfileUpdateSchema, request.body);
    const existing = await prisma.businessProfile.findUnique({ where: { id: 'default' } });
    if (!existing) {
      throw ApiError.notFound('Business profile (run `pnpm db:seed` to create it)');
    }

    const profile = await prisma.businessProfile.update({
      where: { id: 'default' },
      data: input,
    });
    return serializeBusinessProfile(profile);
  });
}
