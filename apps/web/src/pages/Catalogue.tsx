/**
 * Product catalogue.
 *
 * This is the pricing that quotations are generated from. Editing a rate here
 * changes every quotation issued afterwards — and none issued before, because
 * each generated document snapshots its own line items.
 */

import { useState, type FormEvent } from 'react';
import type { ProductDto } from '@lead/shared';
import {
  useBusinessProfile,
  useCreateProduct,
  useDeleteProduct,
  useProducts,
  useRestoreProduct,
} from '../hooks/queries';
import { EmptyState, ErrorNote, Modal, PageHeader, Spinner } from '../components/ui';
import { formatMoney } from '../lib/format';
import { Field } from '../components/NewLeadModal';

export function CataloguePage(): React.ReactElement {
  const [includeInactive, setIncludeInactive] = useState(false);
  const products = useProducts(includeInactive);
  const business = useBusinessProfile();
  const [showNew, setShowNew] = useState(false);
  const [deleting, setDeleting] = useState<ProductDto | null>(null);
  const restore = useRestoreProduct();

  return (
    <div>
      <PageHeader
        title="Catalogue"
        subtitle="Products and price ladders used by every generated quotation"
        actions={
          <>
            <label className="flex items-center gap-1.5 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              Show retired
            </label>
            <button type="button" className="btn-primary" onClick={() => setShowNew(true)}>
              Add product
            </button>
          </>
        }
      />

      {business.data && (
        <div className="card mb-4 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="font-serif text-base text-moss-900">{business.data.brandName}</span>
            <span className="text-ink-faint">
              FSSAI <span className="tabular">{business.data.fssaiNumber}</span>
            </span>
            {business.data.gstin && (
              <span className="text-ink-faint">
                GSTIN <span className="tabular">{business.data.gstin}</span>
              </span>
            )}
            <span className="text-ink-faint">
              Quotes valid {business.data.quotationValidityDays} days
            </span>
          </div>
        </div>
      )}

      {products.isLoading && <Spinner label="Loading catalogue" />}
      {products.isError && <ErrorNote error={products.error} />}

      {products.data && products.data.length === 0 && (
        <EmptyState
          title="No products in the catalogue"
          hint="Add your makhana grades and their quantity-banded rates. Quotations are priced from these."
          action={
            <button type="button" className="btn-primary mt-2" onClick={() => setShowNew(true)}>
              Add the first product
            </button>
          }
        />
      )}

      <div className="space-y-3">
        {products.data?.map((product) => (
          <article
            key={product.id}
            className={`card px-4 py-3 ${product.active ? '' : 'opacity-60'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="font-serif text-base text-moss-900">{product.name}</h2>
                  <span className="tabular rounded-sm bg-parchment-200 px-1.5 py-0.5 text-xs text-ink-faint">
                    {product.sku}
                  </span>
                  {product.grade && <span className="text-xs text-ink-faint">{product.grade}</span>}
                  {!product.active && (
                    <span className="rounded-sm bg-rust-100 px-1.5 py-0.5 text-xs text-rust-700">
                      Retired
                    </span>
                  )}
                </div>
                {product.description && (
                  <p className="mt-1 max-w-2xl text-sm text-ink-soft">{product.description}</p>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                {product.active ? (
                  <button type="button" className="btn-danger" onClick={() => setDeleting(product)}>
                    Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => restore.mutate(product.id)}
                    disabled={restore.isPending}
                  >
                    Restore
                  </button>
                )}
              </div>
            </div>

            {product.priceTiers.length > 0 ? (
              <table className="mt-3 w-full max-w-md text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-ink-faint">
                    <th className="py-1 text-left font-medium">Quantity</th>
                    <th className="py-1 text-right font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {product.priceTiers.map((tier) => (
                    <tr key={tier.id} className="ledger-row">
                      <td className="tabular py-1">
                        {tier.minQty}
                        {tier.maxQty === null ? '+' : `–${tier.maxQty}`} {product.unit}
                      </td>
                      <td className="tabular py-1 text-right">
                        {formatMoney(tier.pricePerUnit)} / {product.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-xs text-ochre-700">
                No price tiers — quotations cannot be generated for this product until one is added.
              </p>
            )}
          </article>
        ))}
      </div>

      {showNew && <NewProductModal onClose={() => setShowNew(false)} />}
      {deleting && <DeleteProductModal product={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function NewProductModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const create = useCreateProduct();
  const [form, setForm] = useState({
    sku: '',
    name: '',
    grade: '',
    description: '',
    hsnCode: '',
    unit: 'kg',
  });
  const [tiers, setTiers] = useState([{ minQty: '', maxQty: '', pricePerUnit: '' }]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    create.mutate(
      {
        sku: form.sku,
        name: form.name,
        grade: form.grade || null,
        description: form.description || null,
        hsnCode: form.hsnCode || null,
        unit: form.unit,
        priceTiers: tiers
          .filter((t) => t.minQty !== '' && t.pricePerUnit !== '')
          .map((t) => ({
            minQty: Number(t.minQty),
            // Blank max means "and above" — the open-ended top tier.
            maxQty: t.maxQty === '' ? null : Number(t.maxQty),
            pricePerUnit: Number(t.pricePerUnit),
          })),
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="Add a product" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU" hint="Unique code, e.g. MK-6SUT" required>
            <input
              className="field font-mono"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              required
              autoFocus
            />
          </Field>
          <Field label="Unit">
            <input
              className="field"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Name" required>
          <input
            className="field"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Grade" hint="e.g. 6 Sut">
            <input
              className="field"
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value })}
            />
          </Field>
          <Field label="HSN code">
            <input
              className="field tabular"
              value={form.hsnCode}
              onChange={(e) => setForm({ ...form, hsnCode: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Description">
          <textarea
            className="field"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>

        <div>
          <p className="label">Price ladder</p>
          <p className="mb-1.5 text-xs text-ink-faint">
            Bands must not overlap. Leave the last band&apos;s maximum blank for &ldquo;and
            above&rdquo;.
          </p>
          <div className="space-y-1.5">
            {tiers.map((tier, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  className="field tabular"
                  placeholder="From"
                  value={tier.minQty}
                  onChange={(e) => {
                    const next = [...tiers];
                    next[i] = { ...tier, minQty: e.target.value };
                    setTiers(next);
                  }}
                />
                <input
                  type="number"
                  min="0"
                  className="field tabular"
                  placeholder="To (blank = ∞)"
                  value={tier.maxQty}
                  onChange={(e) => {
                    const next = [...tiers];
                    next[i] = { ...tier, maxQty: e.target.value };
                    setTiers(next);
                  }}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="field tabular"
                  placeholder="₹ / unit"
                  value={tier.pricePerUnit}
                  onChange={(e) => {
                    const next = [...tiers];
                    next[i] = { ...tier, pricePerUnit: e.target.value };
                    setTiers(next);
                  }}
                />
                <button
                  type="button"
                  className="shrink-0 px-1 text-lg text-ink-faint hover:text-rust-500"
                  onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                  aria-label="Remove tier"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary mt-2"
            onClick={() => setTiers([...tiers, { minQty: '', maxQty: '', pricePerUnit: '' }])}
          >
            Add a band
          </button>
        </div>

        {create.isError && <ErrorNote error={create.error} />}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Add product'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Two kinds of delete, stated plainly. Retiring is reversible and is what you
 * almost always want; permanent deletion is offered because a mistyped SKU
 * should not linger forever.
 */
function DeleteProductModal({
  product,
  onClose,
}: {
  product: ProductDto;
  onClose: () => void;
}): React.ReactElement {
  const remove = useDeleteProduct();

  return (
    <Modal title={`Remove ${product.name}?`} onClose={onClose}>
      {remove.isError && <ErrorNote error={remove.error} />}

      <div className="space-y-3">
        <div className="rounded-sm border border-parchment-300 px-3 py-2">
          <p className="text-sm font-medium">Retire it</p>
          <p className="mt-1 text-xs text-ink-soft">
            Stops appearing on new quotations. The row survives, so past quotations still resolve
            the SKU, and you can restore it at any time.
          </p>
          <button
            type="button"
            className="btn-secondary mt-2"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: product.id, hard: false }, { onSuccess: onClose })}
          >
            Retire
          </button>
        </div>

        <div className="rounded-sm border border-rust-300 px-3 py-2">
          <p className="text-sm font-medium text-rust-700">Delete permanently</p>
          <p className="mt-1 text-xs text-ink-soft">
            Removes the row and its {product.priceTiers.length} price band
            {product.priceTiers.length === 1 ? '' : 's'}. Safe for existing documents — each one
            stores its own copy of what was quoted — but it cannot be undone.
          </p>
          <button
            type="button"
            className="btn-danger mt-2"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: product.id, hard: true }, { onSuccess: onClose })}
          >
            Delete permanently
          </button>
        </div>

        <div className="flex justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
