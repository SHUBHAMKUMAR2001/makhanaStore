/**
 * Sending, and the interaction record that goes with it.
 *
 * The brief's requirement — "log every send as an Interaction automatically" —
 * is enforced here rather than left to callers: the interaction is written for
 * every outcome, including skips and failures. A send that failed is exactly
 * the thing you want on the timeline when you look at the lead a week later
 * and wonder why they never replied.
 */

import { prisma } from '@lead/db';
import type { DeliveryStatus, OutreachChannel } from '@lead/shared';
import { getProvider, type SendResult } from './providers/index.js';
import { logger } from './logger.js';

export class LeadNotFoundError extends Error {
  constructor(leadId: string) {
    super(`Lead ${leadId} not found`);
    this.name = 'LeadNotFoundError';
  }
}

const STATUS_MAP: Record<SendResult['status'], DeliveryStatus> = {
  sent: 'sent',
  skipped: 'na',
  failed: 'failed',
};

export interface SendRequest {
  leadId: string;
  channel: OutreachChannel;
  subject?: string | undefined;
  body: string;
  dryRun: boolean;
}

export interface SendOutcome {
  interactionId: string;
  status: SendResult['status'];
  provider: string;
  detail: string;
  externalId: string | null;
}

export async function sendOutreach(request: SendRequest): Promise<SendOutcome> {
  const lead = await prisma.lead.findUnique({ where: { id: request.leadId } });
  if (!lead) throw new LeadNotFoundError(request.leadId);

  const provider = getProvider(request.channel);

  let result: SendResult;

  if (request.dryRun) {
    result = {
      status: 'skipped',
      detail: `Dry run — nothing was sent (provider would have been "${provider.name}")`,
    };
  } else if (!provider.isConfigured()) {
    // Refuse clearly rather than attempting a send that cannot work.
    result = {
      status: 'skipped',
      detail: provider.unavailableReason ?? `The ${provider.name} provider is not configured`,
    };
  } else {
    result = await provider.send(
      { id: lead.id, name: lead.name, email: lead.email, phone: lead.phone },
      { subject: request.subject, body: request.body },
    );
  }

  // Written for every outcome — sent, skipped or failed.
  const interaction = await prisma.interaction.create({
    data: {
      leadId: lead.id,
      type: request.channel === 'whatsapp' ? 'whatsapp' : 'email',
      direction: 'outbound',
      status: STATUS_MAP[result.status],
      subject: request.subject ?? null,
      content:
        result.status === 'sent'
          ? request.body
          : `${request.body}\n\n[not delivered: ${result.detail}]`,
      externalId: result.externalId ?? null,
    },
  });

  /**
   * Advance a still-untouched lead to `contacted`. Only from `sourced`, and
   * only on a real send — moving a lead forward because a dry run happened, or
   * because an un-configured provider declined, would corrupt the funnel.
   */
  if (result.status === 'sent' && lead.stage === 'sourced') {
    await prisma.lead.update({ where: { id: lead.id }, data: { stage: 'contacted' } });
    await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: 'note',
        direction: 'internal',
        content: 'Stage changed: sourced -> contacted (first outreach sent)',
      },
    });
  }

  logger.info(
    { leadId: lead.id, channel: request.channel, provider: provider.name, status: result.status },
    'Outreach recorded',
  );

  return {
    interactionId: interaction.id,
    status: result.status,
    provider: provider.name,
    detail: result.detail,
    externalId: result.externalId ?? null,
  };
}

/**
 * Record an inbound reply against a lead.
 *
 * Reply tracking is inbound-only and manual for now: automatic threading needs
 * a provider webhook, which needs a public HTTPS endpoint this deployment does
 * not have. Recording a reply still moves the funnel, which is the part that
 * matters day to day.
 */
export async function recordReply(
  leadId: string,
  content: string,
  channel: OutreachChannel,
): Promise<{ interactionId: string; stageChanged: boolean }> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new LeadNotFoundError(leadId);

  const interaction = await prisma.interaction.create({
    data: {
      leadId,
      type: channel === 'whatsapp' ? 'whatsapp' : 'email',
      direction: 'inbound',
      status: 'na',
      content,
    },
  });

  // A reply from someone we had only sourced or contacted is real progress.
  const shouldAdvance = lead.stage === 'sourced' || lead.stage === 'contacted';
  if (shouldAdvance) {
    await prisma.lead.update({ where: { id: leadId }, data: { stage: 'replied' } });
    await prisma.interaction.create({
      data: {
        leadId,
        type: 'note',
        direction: 'internal',
        content: `Stage changed: ${lead.stage} -> replied (reply received)`,
      },
    });
  }

  return { interactionId: interaction.id, stageChanged: shouldAdvance };
}
