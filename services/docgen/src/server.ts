/**
 * Document generation service.
 *
 * Two endpoints, both of which write a `Document` row linked to the lead so a
 * prospect's document history shows up in their detail view rather than being
 * a file someone has to remember they made.
 */

import Fastify, { type FastifyBaseLogger } from 'fastify';
import { pino } from 'pino';
import { z } from 'zod';
import { assertDatabaseReachable, disconnectPrisma, prisma, type Prisma } from '@lead/db';
import { presentationRequestSchema, quotationRequestSchema } from '@lead/shared';
import { env } from './config.js';
import { buildQuotationContext, QuotationDataError } from './lib/quotation-data.js';
import { generateQuotationDocx } from './generators/quotation.js';
import { generatePresentationPptx } from './generators/presentation.js';
import { buildStoragePath, readDocument, saveDocument } from './lib/storage.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  ...(env.NODE_ENV === 'production'
    ? {}
    : {
        transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } },
      }),
});

export async function buildDocgenApp() {
  const app = Fastify({ loggerInstance: logger as FastifyBaseLogger, bodyLimit: 2 * 1024 * 1024 });

  /**
   * This service is not exposed to browsers — the API proxies to it. Every
   * route therefore requires the internal token.
   */
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    if (request.headers['x-internal-token'] !== env.INTERNAL_API_TOKEN) {
      await reply
        .status(401)
        .send({ error: { code: 'unauthorized', message: 'Internal token required' } });
    }
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof QuotationDataError) {
      void reply.status(422).send({
        error: {
          code: 'unprocessable',
          message: error.message,
          ...(error.field ? { details: [{ path: error.field, message: error.message }] } : {}),
        },
      });
      return;
    }
    if (error instanceof z.ZodError) {
      void reply.status(400).send({
        error: {
          code: 'bad_request',
          message: 'Validation failed',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }
    request.log.error({ err: error }, 'Document generation failed');
    const status = (error as { statusCode?: number }).statusCode;
    const message = error instanceof Error ? error.message : 'Something went wrong';
    void reply.status(status && status < 500 ? status : 500).send({
      error: { code: 'internal_error', message },
    });
  });

  app.get('/health', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      return reply.status(503).send({ status: 'degraded', database: 'down' });
    }
  });

  // --- quotation -----------------------------------------------------------
  app.post('/documents/quotation', async (request, reply) => {
    const input = quotationRequestSchema.parse(request.body);
    const ctx = await buildQuotationContext(input);
    const { buffer, totals } = await generateQuotationDocx(ctx);

    const { relativePath, filename } = buildStoragePath(
      'quotation',
      `${ctx.quotationNumber}-${ctx.lead.name}`,
      'docx',
    );
    const sizeBytes = await saveDocument(relativePath, buffer);

    const document = await prisma.document.create({
      data: {
        type: 'quotation',
        leadId: ctx.lead.id,
        filename,
        storagePath: relativePath,
        mimeType: DOCX_MIME,
        sizeBytes,
        // The snapshot is what makes the catalogue safely editable: this
        // quotation can be reproduced exactly even after prices change or the
        // product is deleted.
        meta: {
          quotationNumber: ctx.quotationNumber,
          issuedAt: ctx.issuedAt.toISOString(),
          validityDays: ctx.validityDays,
          items: totals.items,
          subtotal: totals.subtotal,
          taxPercent: totals.taxPercent,
          taxAmount: totals.taxAmount,
          freight: totals.freight,
          grandTotal: totals.grandTotal,
          businessSnapshot: {
            legalName: ctx.business.legalName,
            brandName: ctx.business.brandName,
            fssaiNumber: ctx.business.fssaiNumber,
            gstin: ctx.business.gstin,
          },
          // Cast at the boundary: Prisma's Json input type does not accept a
          // typed array, though the value is plain JSON-safe data.
        } as unknown as Prisma.InputJsonValue,
      },
    });

    // Record it on the lead's timeline — a quotation going out is an
    // interaction, and the funnel should reflect that it happened.
    await prisma.interaction.create({
      data: {
        leadId: ctx.lead.id,
        type: 'note',
        direction: 'internal',
        content:
          `Quotation ${ctx.quotationNumber} generated — ` +
          `${totals.items.length} line item(s), grand total Rs. ${totals.grandTotal.toFixed(2)}.`,
      },
    });

    request.log.info(
      { documentId: document.id, leadId: ctx.lead.id, grandTotal: totals.grandTotal },
      'Quotation generated',
    );

    return reply.status(201).send({
      id: document.id,
      filename,
      mimeType: DOCX_MIME,
      sizeBytes,
      quotationNumber: ctx.quotationNumber,
      totals,
      downloadUrl: `/documents/${document.id}/download`,
    });
  });

  // --- presentation --------------------------------------------------------
  app.post('/documents/presentation', async (request, reply) => {
    const input = presentationRequestSchema.parse(request.body);

    const [business, products, lead] = await Promise.all([
      prisma.businessProfile.findUnique({ where: { id: 'default' } }),
      prisma.product.findMany({
        where: { active: true },
        include: { priceTiers: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      input.leadId ? prisma.lead.findUnique({ where: { id: input.leadId } }) : null,
    ]);

    if (!business) {
      throw new QuotationDataError(
        'No business profile configured. Run `pnpm db:seed`, then set your details under ' +
          'Catalogue in the CRM.',
      );
    }
    if (input.leadId && !lead) {
      throw new QuotationDataError('Lead not found', 'leadId');
    }

    const { buffer, slideCount } = await generatePresentationPptx({
      business,
      products,
      leadName: lead?.name,
      title: input.title,
      includePricing: input.includePricing,
    });

    const { relativePath, filename } = buildStoragePath(
      'presentation',
      lead ? `${business.brandName}-for-${lead.name}` : `${business.brandName}-capability-deck`,
      'pptx',
    );
    const sizeBytes = await saveDocument(relativePath, buffer);

    const document = await prisma.document.create({
      data: {
        type: 'presentation',
        leadId: lead?.id ?? null,
        filename,
        storagePath: relativePath,
        mimeType: PPTX_MIME,
        sizeBytes,
        meta: {
          slideCount,
          includePricing: input.includePricing,
          productCount: products.length,
          generatedAt: new Date().toISOString(),
        },
      },
    });

    request.log.info({ documentId: document.id, slideCount }, 'Presentation generated');

    return reply.status(201).send({
      id: document.id,
      filename,
      mimeType: PPTX_MIME,
      sizeBytes,
      slideCount,
      downloadUrl: `/documents/${document.id}/download`,
    });
  });

  // --- download ------------------------------------------------------------
  app.get('/documents/:id/download', async (request, reply) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) {
      return reply
        .status(404)
        .send({ error: { code: 'not_found', message: 'Document not found' } });
    }

    try {
      const buffer = await readDocument(document.storagePath);
      return reply
        .header('Content-Type', document.mimeType)
        .header('Content-Disposition', `attachment; filename="${document.filename}"`)
        .header('Content-Length', String(buffer.byteLength))
        .send(buffer);
    } catch (error) {
      request.log.error({ err: error, documentId: id }, 'Stored document could not be read');
      return reply.status(410).send({
        error: {
          code: 'gone',
          message:
            'The generated file is no longer on disk. Regenerate it — the record still holds ' +
            'everything needed to reproduce it.',
        },
      });
    }
  });

  return app;
}

async function main(): Promise<void> {
  await assertDatabaseReachable();
  const app = await buildDocgenApp();
  await app.listen({ port: env.DOCGEN_PORT, host: env.DOCGEN_HOST });
  logger.info({ port: env.DOCGEN_PORT, storage: env.STORAGE_DIR }, 'Docgen listening');

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    void app
      .close()
      .then(disconnectPrisma)
      .then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only start a server when run directly — the test suite imports buildDocgenApp.
if (process.env['DOCGEN_NO_LISTEN'] !== 'true') {
  main().catch((error: unknown) => {
    logger.fatal({ err: error }, 'Docgen failed to start');
    process.exit(1);
  });
}
