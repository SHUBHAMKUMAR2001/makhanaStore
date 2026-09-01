/**
 * Quotation and outreach actions on the lead detail page.
 *
 * These are the two things you actually do with a lead once it is qualified,
 * so they sit on the detail view rather than behind a separate page.
 */

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeadDetailDto, ProductDto } from '@lead/shared';
import { api } from '../lib/api';
import { ErrorNote, Modal } from './ui';
import { Field } from './NewLeadModal';
import { formatMoney } from '../lib/format';
import { useProducts } from '../hooks/queries';

interface LineItem {
  productId: string;
  quantity: string;
}

/** Show the rate a quantity will resolve to, so the operator is not guessing. */
function previewRate(product: ProductDto | undefined, quantity: number): string {
  if (!product || !Number.isFinite(quantity) || quantity <= 0) return '—';
  const tier = product.priceTiers.find(
    (t) => quantity >= t.minQty && (t.maxQty === null || quantity <= t.maxQty),
  );
  if (!tier) {
    const lowest = product.priceTiers[0]?.minQty;
    return lowest ? `below ${lowest} ${product.unit} minimum` : 'no price tiers';
  }
  return `${formatMoney(tier.pricePerUnit)} / ${product.unit}`;
}

export function QuotationModal({
  lead,
  onClose,
}: {
  lead: LeadDetailDto;
  onClose: () => void;
}): React.ReactElement {
  const qc = useQueryClient();
  const products = useProducts(false);
  const [items, setItems] = useState<LineItem[]>([{ productId: '', quantity: '' }]);
  const [taxPercent, setTaxPercent] = useState('5');
  const [freight, setFreight] = useState('0');
  const [notes, setNotes] = useState('');

  const generate = useMutation({
    mutationFn: (body: unknown) =>
      api.post<{ filename: string; totals: { grandTotal: number } }>('/documents/quotation', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead', lead.id] });
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    generate.mutate({
      leadId: lead.id,
      items: items
        .filter((i) => i.productId && i.quantity)
        .map((i) => ({
          productId: i.productId,
          // Blank description makes docgen use the catalogue product name.
          description: products.data?.find((p) => p.id === i.productId)?.name ?? 'Item',
          quantity: Number(i.quantity),
          unit: products.data?.find((p) => p.id === i.productId)?.unit ?? 'kg',
        })),
      taxPercent: Number(taxPercent),
      freight: Number(freight),
      ...(notes ? { notes } : {}),
    });
  }

  const ready = items.some((i) => i.productId && Number(i.quantity) > 0);

  return (
    <Modal title="Generate a quotation" onClose={onClose} wide>
      {generate.data ? (
        <div className="space-y-3">
          <div className="rounded-sm border border-moss-300 bg-moss-100 px-3 py-2 text-sm text-moss-800">
            <p className="font-medium">Quotation generated</p>
            <p className="tabular mt-1 text-xs">
              {generate.data.filename} · Grand total {formatMoney(generate.data.totals.grandTotal)}
            </p>
            <p className="mt-1 text-xs">
              It is now listed under Documents on this lead, and the timeline records that it went
              out.
            </p>
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-xs text-ink-faint">
            Rates come from the catalogue&apos;s price ladder for the quantity you enter, and are
            snapshotted into the document — editing the catalogue later will not change this
            quotation.
          </p>

          <div className="space-y-2">
            {items.map((item, i) => {
              const product = products.data?.find((p) => p.id === item.productId);
              return (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="label">Product</label>
                    <select
                      className="field"
                      value={item.productId}
                      onChange={(e) => {
                        const next = [...items];
                        next[i] = { ...item, productId: e.target.value };
                        setItems(next);
                      }}
                    >
                      <option value="">Select…</option>
                      {products.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <label className="label">Qty</label>
                    <input
                      type="number"
                      min="0"
                      className="field tabular"
                      value={item.quantity}
                      onChange={(e) => {
                        const next = [...items];
                        next[i] = { ...item, quantity: e.target.value };
                        setItems(next);
                      }}
                    />
                  </div>
                  <div className="w-36 pb-2 text-xs text-ink-faint">
                    {previewRate(product, Number(item.quantity))}
                  </div>
                  <button
                    type="button"
                    className="pb-2 text-lg text-ink-faint hover:text-rust-500"
                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                    aria-label="Remove line"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => setItems([...items, { productId: '', quantity: '' }])}
          >
            Add a line
          </button>

          <div className="grid grid-cols-2 gap-3">
            <Field label="GST %">
              <input
                type="number"
                min="0"
                max="50"
                className="field tabular"
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
              />
            </Field>
            <Field label="Freight (₹)">
              <input
                type="number"
                min="0"
                className="field tabular"
                value={freight}
                onChange={(e) => setFreight(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Notes on the quotation">
            <textarea
              className="field"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          {generate.isError && <ErrorNote error={generate.error} />}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!ready || generate.isPending}>
              {generate.isPending ? 'Generating…' : 'Generate .docx'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function OutreachModal({
  lead,
  onClose,
}: {
  lead: LeadDetailDto;
  onClose: () => void;
}): React.ReactElement {
  const qc = useQueryClient();
  const [subject, setSubject] = useState(`Makhana supply — ${lead.name}`);
  const [body, setBody] = useState('');

  const providers = useQuery({
    queryKey: ['outreach-providers'],
    queryFn: () =>
      api.get<{
        providers: { channel: string; provider: string; configured: boolean; reason?: string }[];
      }>('/outreach/providers'),
  });

  const send = useMutation({
    mutationFn: (body_: unknown) =>
      api.post<{ status: string; detail: string; provider: string }>('/outreach/send', body_),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead', lead.id] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });

  const email = providers.data?.providers.find((p) => p.channel === 'email');

  return (
    <Modal title="Send an email" onClose={onClose} wide>
      <div className="space-y-3">
        {!lead.email && (
          <div className="rounded-sm border border-ochre-300 bg-ochre-100 px-3 py-2 text-xs text-ochre-700">
            This lead has no email address on record, so the send will be recorded as skipped.
          </div>
        )}

        {email && !email.configured && (
          <div className="rounded-sm border border-ochre-300 bg-ochre-100 px-3 py-2 text-xs text-ochre-700">
            <p className="font-medium">Email is not configured — nothing will actually be sent.</p>
            <p className="mt-1">{email.reason}</p>
          </div>
        )}

        <Field label="Subject">
          <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>

        <Field label="Message">
          <textarea
            className="field"
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write the message…"
          />
        </Field>

        {send.isError && <ErrorNote error={send.error} />}

        {send.data && (
          <div
            className={`rounded-sm border px-3 py-2 text-sm ${
              send.data.status === 'sent'
                ? 'border-moss-300 bg-moss-100 text-moss-800'
                : 'border-ochre-300 bg-ochre-100 text-ochre-700'
            }`}
          >
            <p className="font-medium">
              {send.data.status === 'sent' ? 'Sent' : `Not sent (${send.data.status})`} · provider{' '}
              {send.data.provider}
            </p>
            <p className="mt-1 text-xs">{send.data.detail}</p>
            <p className="mt-1 text-xs">Recorded on the timeline either way.</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {send.data ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!body.trim() || send.isPending}
            onClick={() =>
              send.mutate({ leadId: lead.id, channel: 'email', subject, body, dryRun: true })
            }
          >
            Dry run
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!body.trim() || send.isPending}
            onClick={() =>
              send.mutate({ leadId: lead.id, channel: 'email', subject, body, dryRun: false })
            }
          >
            {send.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
