/**
 * The outreach provider interface.
 *
 * The point of this file: **no provider name appears anywhere in business
 * logic.** Swapping Resend for SendGrid, or adding WhatsApp once Meta approves
 * a sender, is a new file in this directory and one line in the factory — not
 * a change to how leads or interactions work.
 */

import type { OutreachChannel } from '@lead/shared';

/** The subset of a lead a provider needs. Nothing more is passed in. */
export interface OutreachRecipient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface OutreachMessage {
  subject?: string | undefined;
  body: string;
}

export interface SendResult {
  status: 'sent' | 'skipped' | 'failed';
  /** Provider-side id, stored on the Interaction for reply/bounce correlation. */
  externalId?: string | undefined;
  /** Human-readable outcome, recorded on the timeline. */
  detail: string;
}

export class OutreachError extends Error {
  constructor(
    message: string,
    /** True when retrying could plausibly succeed (network, provider 5xx). */
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'OutreachError';
  }
}

/**
 * A channel implementation.
 *
 * `send` must not throw for an ordinary rejection — a missing email address or
 * a bounced send is a `SendResult`, because the caller records it on the
 * timeline either way. Throw only for genuine faults.
 */
export interface OutreachProvider {
  /** Stable identifier, recorded in logs and on the interaction. */
  readonly name: string;
  readonly channel: OutreachChannel;
  /** False when configuration is incomplete; the reason goes in `unavailableReason`. */
  isConfigured(): boolean;
  readonly unavailableReason?: string;
  send(recipient: OutreachRecipient, message: OutreachMessage): Promise<SendResult>;
}
