import { useState, type FormEvent } from 'react';
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, REGION_TIER_LABELS } from '@lead/shared';
import { useCreateLead } from '../hooks/queries';
import { ErrorNote, Modal } from './ui';
import { ApiClientError } from '../lib/api';

/**
 * Note what this form does NOT have: a score field. The score is computed by
 * the API from category, region tier and contact details — showing a control
 * for it would imply an authority the frontend does not have.
 */
export function NewLeadModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const create = useCreateLead();
  const [form, setForm] = useState({
    name: '',
    category: '',
    city: '',
    regionTier: '3',
    phone: '',
    email: '',
    website: '',
    source: 'manual',
    notes: '',
  });

  const set = (key: string, value: string): void => setForm((f) => ({ ...f, [key]: value }));
  const fieldError = (path: string): string | undefined =>
    create.error instanceof ApiClientError ? create.error.fieldError(path) : undefined;

  function submit(event: FormEvent): void {
    event.preventDefault();
    create.mutate(
      {
        name: form.name,
        category: form.category,
        city: form.city,
        regionTier: Number(form.regionTier),
        // Send null rather than '' so the API's optional-field handling applies.
        phone: form.phone || null,
        email: form.email || null,
        website: form.website || null,
        source: form.source,
        notes: form.notes || null,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="Add a lead" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Business name" error={fieldError('name')} required>
          <input className="field" value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
        </Field>

        <Field
          label="Category"
          error={fieldError('category')}
          hint="Free text — the scoring engine keyword-matches it (e.g. 'Dry Fruit Wholesaler')"
          required
        >
          <input className="field" value={form.category} onChange={(e) => set('category', e.target.value)} required />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="City" error={fieldError('city')} required>
            <input className="field" value={form.city} onChange={(e) => set('city', e.target.value)} required />
          </Field>
          <Field label="Region tier">
            <select className="field" value={form.regionTier} onChange={(e) => set('regionTier', e.target.value)}>
              {([1, 2, 3] as const).map((t) => (
                <option key={t} value={t}>
                  {REGION_TIER_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone" error={fieldError('phone')}>
            <input className="field" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Email" error={fieldError('email')}>
            <input className="field" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
        </div>

        <Field label="Website" error={fieldError('website')} hint="A bare domain is fine — it gets normalised">
          <input className="field" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="acmefoods.in" />
        </Field>

        <Field label="Source">
          <select className="field" value={form.source} onChange={(e) => set('source', e.target.value)}>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Notes">
          <textarea className="field" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        {create.isError && <ErrorNote error={create.error} />}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Add lead'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <label className="label">
        {label}
        {required && <span className="text-rust-500"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
      {error && <p className="mt-0.5 text-xs text-rust-500">{error}</p>}
    </div>
  );
}
