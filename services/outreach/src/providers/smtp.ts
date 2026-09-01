/**
 * SMTP provider (nodemailer).
 *
 * Works with Gmail via an app password, or any transactional SMTP host.
 *
 * A caution about Gmail: the daily cap is around 500 messages, and cold B2B
 * outreach from a personal Gmail risks the account itself. It is fine for
 * testing the flow; use a real sending domain for actual campaigns.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config.js';
import type { OutreachMessage, OutreachProvider, OutreachRecipient, SendResult } from './types.js';
import { OutreachError } from './types.js';

export class SmtpProvider implements OutreachProvider {
  readonly name = 'smtp';
  readonly channel = 'email' as const;

  private transporter: Transporter | null = null;

  get unavailableReason(): string | undefined {
    if (!env.SMTP_HOST) return 'SMTP_HOST is not set';
    if (!env.OUTREACH_FROM_EMAIL) return 'OUTREACH_FROM_EMAIL is not set';
    return undefined;
  }

  isConfigured(): boolean {
    return this.unavailableReason === undefined;
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        ...(env.SMTP_USER
          ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
          : {}),
      });
    }
    return this.transporter;
  }

  async send(recipient: OutreachRecipient, message: OutreachMessage): Promise<SendResult> {
    if (!recipient.email) {
      return { status: 'skipped', detail: 'This lead has no email address on record' };
    }

    try {
      const info = await this.getTransporter().sendMail({
        from: env.OUTREACH_FROM_NAME
          ? `"${env.OUTREACH_FROM_NAME}" <${env.OUTREACH_FROM_EMAIL}>`
          : env.OUTREACH_FROM_EMAIL,
        to: recipient.email,
        subject: message.subject ?? '(no subject)',
        text: message.body,
        ...(env.OUTREACH_REPLY_TO ? { replyTo: env.OUTREACH_REPLY_TO } : {}),
      });

      // A message can be accepted for some recipients and rejected for others.
      if (info.rejected?.length > 0) {
        return {
          status: 'failed',
          detail: `The SMTP server rejected ${info.rejected.join(', ')}`,
        };
      }

      return {
        status: 'sent',
        externalId: info.messageId,
        detail: `Sent via SMTP to ${recipient.email}`,
      };
    } catch (cause) {
      throw new OutreachError(
        `SMTP send failed: ${cause instanceof Error ? cause.message : 'unknown error'}`,
        true,
      );
    }
  }
}
