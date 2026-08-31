import type { FastifyInstance } from 'fastify';
import {
  csvImportOptionsSchema,
  idParamSchema,
  interactionCreateSchema,
  leadCreateSchema,
  leadListQuerySchema,
  leadUpdateSchema,
  stageTransitionSchema,
  type LeadDetailDto,
  type Paginated,
  type LeadDto,
} from '@lead/shared';
import { prisma } from '@lead/db';
import { ApiError } from '../lib/errors.js';
import { parseBody, parseParams, parseQuery } from '../lib/validate.js';
import { serializeDocument, serializeInteraction, serializeLead } from '../lib/serialize.js';
import { actorUserId, requireAuth } from '../plugins/auth.js';
import {
  createLead,
  deleteLead,
  getLeadOrThrow,
  listLeads,
  transitionStage,
  updateLead,
} from '../services/leads.js';
import { importLeadsFromCsv } from '../services/csv-import.js';
import { scoreLead } from '../scoring/index.js';

export function registerLeadRoutes(app: FastifyInstance): void {
  app.addHook('onRequest', requireAuth);

  // --- list ----------------------------------------------------------------
  app.get('/leads', async (request): Promise<Paginated<LeadDto>> => {
    const query = parseQuery(leadListQuerySchema, request.query);
    const { items, total } = await listLeads(query);

    return {
      items: items.map(serializeLead),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  });

  // --- create --------------------------------------------------------------
  app.post('/leads', async (request, reply) => {
    const input = parseBody(leadCreateSchema, request.body);
    const lead = await createLead(input);
    return reply.status(201).send(serializeLead(lead));
  });

  // --- detail --------------------------------------------------------------
  app.get('/leads/:id', async (request): Promise<LeadDetailDto> => {
    const { id } = parseParams(idParamSchema, request.params);

    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        interactions: { include: { user: true }, orderBy: { createdAt: 'desc' } },
        documents: { orderBy: { createdAt: 'desc' } },
        campaign: true,
      },
    });

    if (!lead) throw ApiError.notFound('Lead');

    return {
      ...serializeLead(lead),
      interactions: lead.interactions.map(serializeInteraction),
      documents: lead.documents.map(serializeDocument),
      campaign: lead.campaign
        ? { id: lead.campaign.id, name: lead.campaign.name, channel: lead.campaign.channel }
        : null,
    };
  });

  // --- update --------------------------------------------------------------
  app.patch('/leads/:id', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(leadUpdateSchema, request.body);
    return serializeLead(await updateLead(id, input));
  });

  app.delete('/leads/:id', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    await deleteLead(id);
    return reply.status(204).send();
  });

  // --- stage transition ----------------------------------------------------
  app.post('/leads/:id/stage', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(stageTransitionSchema, request.body);
    return serializeLead(await transitionStage(id, input, actorUserId(request)));
  });

  // --- score explanation ---------------------------------------------------
  /**
   * Why a lead scored what it did. Exists so the UI can show the breakdown
   * without reimplementing any part of the calculation client-side.
   */
  app.get('/leads/:id/score', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    const lead = await getLeadOrThrow(id);
    const result = scoreLead(lead);

    return {
      stored: { score: lead.score, scoreValue: lead.scoreValue, reasons: lead.scoreReasons },
      computed: result,
      /** True when the rules have changed since this lead was last scored. */
      stale: result.band !== lead.score || result.value !== lead.scoreValue,
    };
  });

  // --- interactions --------------------------------------------------------
  app.get('/leads/:id/interactions', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    await getLeadOrThrow(id);

    const interactions = await prisma.interaction.findMany({
      where: { leadId: id },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });

    return interactions.map(serializeInteraction);
  });

  app.post('/leads/:id/interactions', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(interactionCreateSchema, request.body);
    await getLeadOrThrow(id);

    const interaction = await prisma.interaction.create({
      data: {
        leadId: id,
        type: input.type,
        content: input.content,
        direction: input.direction,
        subject: input.subject ?? null,
        userId: actorUserId(request),
      },
      include: { user: true },
    });

    return reply.status(201).send(serializeInteraction(interaction));
  });

  // --- bulk CSV import -----------------------------------------------------
  /**
   * Accepts either a multipart file upload or a raw `text/csv` body, because
   * the first is what the browser sends and the second is what `curl
   * --data-binary` sends.
   */
  app.post('/leads/import', async (request) => {
    const options = parseQuery(csvImportOptionsSchema, request.query);
    let csv: string;

    if (request.isMultipart()) {
      const file = await request.file();
      if (!file) throw ApiError.badRequest('No file was uploaded');
      csv = (await file.toBuffer()).toString('utf8');
    } else if (typeof request.body === 'string') {
      csv = request.body;
    } else {
      throw ApiError.badRequest(
        'Send the CSV as a multipart file upload or with Content-Type: text/csv',
      );
    }

    if (csv.trim().length === 0) {
      throw ApiError.badRequest('The uploaded file is empty');
    }

    return importLeadsFromCsv(csv, options);
  });
}
