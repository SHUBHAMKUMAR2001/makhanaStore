/**
 * Provider selection.
 *
 * The only place a provider name is mapped to an implementation. Adding
 * SendGrid means one more case here and one more file — nothing else in the
 * service changes.
 */

import type { OutreachChannel } from '@lead/shared';
import { env } from '../config.js';
import { LogProvider } from './log.js';
import { ResendProvider } from './resend.js';
import { SmtpProvider } from './smtp.js';
import { WhatsAppProvider } from './whatsapp.js';
import type { OutreachProvider } from './types.js';

export * from './types.js';

function buildEmailProvider(): OutreachProvider {
  switch (env.OUTREACH_PROVIDER) {
    case 'resend':
      return new ResendProvider();
    case 'smtp':
      return new SmtpProvider();
    case 'log':
    default:
      return new LogProvider('email');
  }
}

const providers: Record<OutreachChannel, OutreachProvider> = {
  email: buildEmailProvider(),
  whatsapp: new WhatsAppProvider(),
};

export function getProvider(channel: OutreachChannel): OutreachProvider {
  return providers[channel];
}

/** Configuration status for every channel, surfaced at /providers. */
export function describeProviders(): {
  channel: OutreachChannel;
  provider: string;
  configured: boolean;
  reason?: string;
}[] {
  return (Object.keys(providers) as OutreachChannel[]).map((channel) => {
    const provider = providers[channel];
    const configured = provider.isConfigured();
    return {
      channel,
      provider: provider.name,
      configured,
      ...(configured ? {} : { reason: provider.unavailableReason ?? 'Not configured' }),
    };
  });
}
