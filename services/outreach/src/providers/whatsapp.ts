/**
 * WhatsApp — NOT IMPLEMENTED, and deliberately so.
 *
 * This is a stub that refuses clearly rather than a fake that appears to work.
 * Sending WhatsApp business messages in India is not a matter of plugging in an
 * API key; it requires all of the following before a single message can go out:
 *
 *  1. A Meta Business account that has passed **business verification** —
 *     Meta reviews company registration documents, and it takes days to weeks.
 *  2. A **WhatsApp Business Platform** (Cloud API) app, with a phone number
 *     registered to it that is not already in use by the WhatsApp consumer or
 *     Business app.
 *  3. **Message templates approved by Meta** for anything sent outside a
 *     24-hour customer-initiated window. Cold B2B outreach is entirely outside
 *     that window, so every first-touch message needs a pre-approved template —
 *     you cannot send free-form text to a lead who has not messaged you first.
 *  4. Per-conversation billing. India has its own rate card, and marketing
 *     templates cost more than utility ones.
 *
 * Points 3 and 4 are the ones that matter for this use case: the natural
 * assumption is "we can WhatsApp our scraped leads", and you cannot. Cold
 * outreach to a number that never contacted you is both technically blocked
 * and against WhatsApp's Business Messaging Policy.
 *
 * TODO: implement once business verification is approved and at least one
 * utility template is live. The shape below is what the implementation needs
 * to fill in — the interface will not have to change.
 */

import { logger } from '../logger.js';
import type { OutreachMessage, OutreachProvider, OutreachRecipient, SendResult } from './types.js';

export class WhatsAppProvider implements OutreachProvider {
  readonly name = 'whatsapp';
  readonly channel = 'whatsapp' as const;

  readonly unavailableReason =
    'WhatsApp sending is not implemented. It requires Meta business verification, a ' +
    'WhatsApp Business Platform app, and message templates approved by Meta — cold ' +
    'outreach to a lead who has not messaged you first cannot be sent as free-form ' +
    'text. See services/outreach/README.md.';

  isConfigured(): boolean {
    return false;
  }

  async send(recipient: OutreachRecipient, _message: OutreachMessage): Promise<SendResult> {
    logger.warn(
      { lead: recipient.name },
      'WhatsApp send attempted, but the provider is a stub — nothing was sent',
    );

    return {
      status: 'skipped',
      detail: this.unavailableReason,
    };
  }
}
