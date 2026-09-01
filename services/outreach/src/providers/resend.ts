/**
 * Resend email provider.
 *
 * Setup:
 *  1. Create an account at https://resend.com and add your sending domain.
 *  2. Add the DNS records Resend shows you (SPF, DKIM, and ideally DMARC).
 *     Cold B2B outreach from an unverified domain lands in spam.
 *  3. Create an API key and set RESEND_API_KEY.
 *  4. Set OUTREACH_FROM_EMAIL to an address on that verified domain.
 *
 * Free tier is 3,000 emails/month, 100/day.
 */

import { Resend } from 'resend';
import { env } from '../config.js';
import type { OutreachMessage, OutreachProvider, OutreachRecipient, SendResult } from './types.js';
import { OutreachError } from './types.js';

export class ResendProvider implements OutreachProvider {
  readonly name = 'resend';
  readonly channel = 'email' as const;

  private client: Resend | null = null;

  get unavailableReason(): string | undefined {
    if (!env.RESEND_API_KEY) return 'RESEND_API_KEY is not set';
    if (!env.OUTREACH_FROM_EMAIL) return 'OUTREACH_FROM_EMAIL is not set';
    return undefined;
  }

  isConfigured(): boolean {
    return this.unavailableReason === undefined;
  }

  private getClient(): Resend {
    if (!this.client) this.client = new Resend(env.RESEND_API_KEY);
    return this.client;
  }

  async send(recipient: OutreachRecipient, message: OutreachMessage): Promise<SendResult> {
    if (!recipient.email) {
      // Not an error: plenty of scraped leads have no email. Report it so it
      // lands on the timeline rather than throwing.
      return { status: 'skipped', detail: 'This lead has no email address on record' };
    }

    const from = env.OUTREACH_FROM_NAME
      ? `${env.OUTREACH_FROM_NAME} <${env.OUTREACH_FROM_EMAIL}>`
      : env.OUTREACH_FROM_EMAIL;

    try {
      const { data, error } = await this.getClient().emails.send({
        from,
        to: [recipient.email],
        subject: message.subject ?? '(no subject)',
        text: message.body,
        ...(env.OUTREACH_REPLY_TO ? { replyTo: env.OUTREACH_REPLY_TO } : {}),
      });

      if (error) {
        // Resend returns errors in the body rather than throwing.
        return {
          status: 'failed',
          detail: `Resend rejected the message: ${error.message}`,
        };
      }

      return {
        status: 'sent',
        externalId: data?.id,
        detail: `Sent via Resend to ${recipient.email}`,
      };
    } catch (cause) {
      throw new OutreachError(
        `Could not reach Resend: ${cause instanceof Error ? cause.message : 'unknown error'}`,
        true,
      );
    }
  }
}
