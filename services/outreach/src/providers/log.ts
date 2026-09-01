/**
 * The no-op provider — the default.
 *
 * Sends nothing, records everything. This exists so the whole outreach flow
 * (compose, send, timeline entry, delivery status) is testable end to end
 * before a sending domain is verified, and so a misconfigured production
 * deployment writes a log line instead of quietly failing.
 */

import type { OutreachChannel } from '@lead/shared';
import { logger } from '../logger.js';
import type { OutreachMessage, OutreachProvider, OutreachRecipient, SendResult } from './types.js';

export class LogProvider implements OutreachProvider {
  readonly name = 'log';

  constructor(readonly channel: OutreachChannel = 'email') {}

  isConfigured(): boolean {
    return true;
  }

  async send(recipient: OutreachRecipient, message: OutreachMessage): Promise<SendResult> {
    logger.info(
      {
        to: recipient.email ?? recipient.phone,
        lead: recipient.name,
        subject: message.subject,
        bodyPreview: message.body.slice(0, 200),
      },
      'OUTREACH (log provider — nothing was actually sent)',
    );

    return {
      status: 'skipped',
      detail:
        'Recorded only — OUTREACH_PROVIDER is "log", so no message left the system. ' +
        'Set OUTREACH_PROVIDER=resend or smtp to send for real.',
    };
  }
}
