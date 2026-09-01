# `@lead/outreach` — email and WhatsApp

Sends outreach behind a provider interface and records every send as an
`Interaction` on the lead's timeline.

```bash
pnpm --filter @lead/outreach dev    # http://localhost:4200
pnpm --filter @lead/outreach test
```

Not exposed to browsers — the API proxies to it, and every route requires
`x-internal-token`.

## The provider interface

No provider name appears anywhere in business logic. `send.ts` talks to
`OutreachProvider`; `providers/index.ts` is the only file that maps a
configuration value to an implementation. Adding SendGrid is one new file and
one `case` — nothing about leads or interactions changes.

```ts
interface OutreachProvider {
  readonly name: string;
  readonly channel: OutreachChannel;
  isConfigured(): boolean;
  readonly unavailableReason?: string;
  send(recipient, message): Promise<SendResult>;
}
```

`send` does **not** throw for an ordinary rejection. A lead with no email
address, or an unconfigured provider, returns a `SendResult` with
`status: 'skipped'` — because the caller records it on the timeline either way.
Throwing is reserved for genuine faults like an unreachable provider.

## Providers

| `OUTREACH_PROVIDER` | Channel | Notes |
| --- | --- | --- |
| `log` *(default)* | email | Records the message, sends nothing |
| `resend` | email | Needs `RESEND_API_KEY` and a verified domain |
| `smtp` | email | Needs `SMTP_HOST`; works with Gmail app passwords |
| — | whatsapp | **Not implemented.** See below. |

### Why `log` is the default

The whole flow — compose, send, timeline entry, delivery status, funnel move —
works before a sending domain is verified. A misconfigured production
deployment writes a log line and a visible "not delivered" note on the timeline
rather than silently failing. It reports `skipped`, never `sent`, so it can
never be mistaken for real delivery.

### Setting up Resend

1. Create an account at <https://resend.com> and add your sending domain.
2. Add the DNS records it shows you — SPF, DKIM, and ideally DMARC. **Cold B2B
   outreach from an unverified domain lands in spam**, so do not skip this.
3. Create an API key → `RESEND_API_KEY`.
4. Set `OUTREACH_FROM_EMAIL` to an address on that verified domain, and
   `OUTREACH_FROM_NAME` to your brand.
5. Set `OUTREACH_PROVIDER=resend`.

Free tier: 3,000 emails/month, 100/day.

### Setting up SMTP (including Gmail)

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and
`OUTREACH_PROVIDER=smtp`. For Gmail, generate an **app password** (not your
account password) with 2FA enabled.

A caution: Gmail caps around 500 messages a day, and cold B2B outreach from a
personal Gmail risks the account itself. Fine for testing the flow; use a real
sending domain for campaigns.

## WhatsApp is a stub, deliberately

`providers/whatsapp.ts` refuses clearly rather than faking a send. This is not
an oversight and it is not one API key away. Sending WhatsApp business messages
in India requires:

1. A Meta Business account that has passed **business verification** — Meta
   reviews company registration documents; days to weeks.
2. A **WhatsApp Business Platform** (Cloud API) app with a registered phone
   number not already in use by the consumer or Business app.
3. **Message templates approved by Meta** for anything outside a 24-hour
   customer-initiated window.
4. Per-conversation billing on India's rate card.

Point 3 is the one that matters here. The natural assumption is "we can WhatsApp
our scraped leads" — and you cannot. A lead who has never messaged you is
outside the 24-hour window, so free-form text cannot be sent at all, and cold
outreach to such a number is against WhatsApp's Business Messaging Policy
regardless.

The stub returns `skipped` with that explanation, so the attempt is recorded on
the timeline instead of vanishing. When verification comes through, implement
`send()` — the interface will not need to change.

## Every send is logged automatically

`sendOutreach` writes an `Interaction` for **every** outcome — sent, skipped, or
failed. A send that failed is exactly what you want on the timeline when you
look at a lead a week later and wonder why they never replied. Undelivered
messages carry a `[not delivered: …]` suffix and a `failed`/`na` delivery
status.

## Funnel effects

- A **real send** (`status: 'sent'`) moves a lead from `sourced` to `contacted`.
  A dry run or a skipped send does **not** — moving a lead forward because an
  unconfigured provider declined would corrupt the funnel.
- A **recorded reply** moves `sourced` or `contacted` to `replied`.

Both write their own timeline note explaining the move.

## Reply tracking

Inbound replies are recorded through `POST /outreach/reply`. This is manual for
now: automatic threading needs a provider webhook, which needs a public HTTPS
endpoint that a firewalled single-VM deployment does not have. `Interaction`
already stores `externalId`, so wiring a webhook later is additive.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/providers` | Which channels can send, and why not if they cannot |
| POST | `/outreach/send` | `leadId`, `channel`, `subject`, `body`, `dryRun` |
| POST | `/outreach/reply` | Record an inbound reply |
| GET | `/health` | Unauthenticated |

The service logs each channel's readiness at boot — a channel that cannot send
warns loudly, because that is the failure you otherwise discover a week later
when nobody has replied.
