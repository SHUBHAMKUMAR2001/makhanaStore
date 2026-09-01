/**
 * Provider contract tests.
 *
 * The value of the interface is that business logic never names a provider, so
 * what is worth testing is that every implementation honours the same contract
 * — particularly that an ordinary rejection is a SendResult, not a throw.
 */

import { describe, expect, it } from 'vitest';
import { LogProvider } from './log.js';
import { ResendProvider } from './resend.js';
import { SmtpProvider } from './smtp.js';
import { WhatsAppProvider } from './whatsapp.js';
import type { OutreachProvider } from './types.js';

const recipient = {
  id: 'clx1',
  name: 'Sharma Dry Fruits',
  email: 'buyer@example.in',
  phone: '+919876543210',
};
const message = { subject: 'Makhana rates', body: 'Sending our current rate card.' };

const all: OutreachProvider[] = [
  new LogProvider(),
  new ResendProvider(),
  new SmtpProvider(),
  new WhatsAppProvider(),
];

describe('every provider honours the interface', () => {
  it.each(all.map((p) => [p.name, p] as const))(
    '%s declares a name and channel',
    (_n, provider) => {
      expect(provider.name).toBeTruthy();
      expect(['email', 'whatsapp']).toContain(provider.channel);
    },
  );

  it.each(all.map((p) => [p.name, p] as const))(
    '%s explains itself when unconfigured',
    (_n, provider) => {
      // An unconfigured provider must say why, or the operator is left guessing
      // at boot time why nothing sends.
      if (!provider.isConfigured()) {
        expect(provider.unavailableReason).toBeTruthy();
      }
    },
  );
});

describe('LogProvider', () => {
  it('is always configured, so the flow works before a domain is verified', () => {
    expect(new LogProvider().isConfigured()).toBe(true);
  });

  it('reports "skipped", never "sent" — it must not look like a real delivery', async () => {
    const result = await new LogProvider().send(recipient, message);
    expect(result.status).toBe('skipped');
    expect(result.detail).toMatch(/no message left the system/i);
  });
});

describe('WhatsAppProvider', () => {
  it('is never configured — it is a stub, not an implementation', () => {
    expect(new WhatsAppProvider().isConfigured()).toBe(false);
  });

  it('explains the Meta approval requirement rather than failing cryptically', () => {
    const reason = new WhatsAppProvider().unavailableReason;
    expect(reason).toMatch(/business verification/i);
    expect(reason).toMatch(/template/i);
  });

  it('skips rather than pretending to send', async () => {
    const result = await new WhatsAppProvider().send(recipient, message);
    expect(result.status).toBe('skipped');
    expect(result.externalId).toBeUndefined();
  });
});

describe('email providers without configuration', () => {
  it('Resend reports the missing key by name', () => {
    // The test env has no RESEND_API_KEY.
    const provider = new ResendProvider();
    expect(provider.isConfigured()).toBe(false);
    expect(provider.unavailableReason).toMatch(/RESEND_API_KEY|OUTREACH_FROM_EMAIL/);
  });

  it('SMTP reports the missing host by name', () => {
    const provider = new SmtpProvider();
    expect(provider.isConfigured()).toBe(false);
    expect(provider.unavailableReason).toMatch(/SMTP_HOST|OUTREACH_FROM_EMAIL/);
  });
});

describe('a lead with no email', () => {
  it.each([
    ['resend', new ResendProvider()],
    ['smtp', new SmtpProvider()],
  ])('%s skips rather than throwing', async (_name, provider) => {
    const result = await provider.send({ ...recipient, email: null }, message);
    expect(result.status).toBe('skipped');
    expect(result.detail).toMatch(/no email/i);
  });
});
