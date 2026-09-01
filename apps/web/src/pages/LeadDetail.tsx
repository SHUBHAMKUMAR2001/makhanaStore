/**
 * Lead detail: the working view for one prospect.
 *
 * Three things sit side by side because they are used together — where the
 * lead is in the funnel, why it scored what it did, and what has been said
 * to them so far.
 */

import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  INTERACTION_TYPES,
  INTERACTION_TYPE_LABELS,
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  REGION_TIER_LABELS,
  type LeadStage,
} from '@lead/shared';
import {
  useAddInteraction,
  useDeleteLead,
  useLead,
  useLeadScore,
  useTransitionStage,
  useUpdateLead,
} from '../hooks/queries';
import { ScoreBadge, SourceTag, StageBadge } from '../components/badges';
import { ErrorNote, Modal, PageHeader, Spinner } from '../components/ui';
import { formatDateTime, formatMoney, formatPhone, formatRelative } from '../lib/format';

export function LeadDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const lead = useLead(id);
  const score = useLeadScore(id);
  const transition = useTransitionStage(id ?? '');
  const addInteraction = useAddInteraction(id ?? '');
  const update = useUpdateLead(id ?? '');
  const remove = useDeleteLead();

  const [note, setNote] = useState('');
  const [noteType, setNoteType] = useState<string>('note');
  const [wonModal, setWonModal] = useState(false);
  const [dealValue, setDealValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (lead.isLoading) return <Spinner label="Loading lead" />;
  if (lead.isError) return <ErrorNote error={lead.error} />;
  if (!lead.data) return <ErrorNote error={new Error('Lead not found')} />;

  const l = lead.data;

  function changeStage(stage: LeadStage): void {
    // A won deal needs a value; the API enforces it, so ask rather than let
    // the request fail.
    if (stage === 'closed_won' && !l.dealValue) {
      setWonModal(true);
      return;
    }
    transition.mutate({ stage });
  }

  function submitNote(event: FormEvent): void {
    event.preventDefault();
    if (!note.trim()) return;
    addInteraction.mutate(
      { type: noteType, content: note.trim(), direction: noteType === 'note' ? 'internal' : 'outbound' },
      { onSuccess: () => setNote('') },
    );
  }

  return (
    <div>
      <PageHeader
        title={l.name}
        subtitle={`${l.category} · ${l.city}`}
        actions={
          <>
            <Link to="/leads" className="btn-secondary">
              Back to leads
            </Link>
            <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* --- left column: facts and score --- */}
        <div className="space-y-4">
          <section className="card px-4 py-3">
            <h2 className="mb-2 font-serif text-base text-moss-900">Details</h2>
            <dl className="space-y-1.5 text-sm">
              <Row label="Stage">
                <StageBadge stage={l.stage} />
              </Row>
              <Row label="Score">
                <ScoreBadge score={l.score} value={l.scoreValue} />
              </Row>
              <Row label="Source">
                <SourceTag source={l.source} />
              </Row>
              <Row label="Region">{REGION_TIER_LABELS[l.regionTier as 1 | 2 | 3] ?? `Tier ${l.regionTier}`}</Row>
              <Row label="Phone">
                {l.phone ? (
                  <a href={`tel:${l.phone}`} className="tabular text-moss-700 hover:underline">
                    {formatPhone(l.phone)}
                  </a>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Email">
                {l.email ? (
                  <a href={`mailto:${l.email}`} className="text-moss-700 hover:underline">
                    {l.email}
                  </a>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Website">
                {l.website ? (
                  <a href={l.website} target="_blank" rel="noreferrer noopener" className="text-moss-700 hover:underline">
                    {l.website.replace(/^https?:\/\//, '')}
                  </a>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Deal value">
                <span className="tabular">{formatMoney(l.dealValue)}</span>
              </Row>
              <Row label="Added">{formatDateTime(l.createdAt)}</Row>
            </dl>

            {l.notes && (
              <div className="mt-3 border-t border-parchment-200 pt-2">
                <p className="label">Notes</p>
                <p className="whitespace-pre-wrap text-sm text-ink-soft">{l.notes}</p>
              </div>
            )}
          </section>

          {/* --- score breakdown --- */}
          <section className="card px-4 py-3">
            <h2 className="mb-2 font-serif text-base text-moss-900">Why this score</h2>
            {score.data ? (
              <>
                <ul className="space-y-1 text-sm">
                  {score.data.computed.contributions.map((c) => (
                    <li key={c.signal} className="flex items-baseline justify-between gap-2">
                      <span className="text-ink-soft">{c.reason.replace(/\s*\(\+\d+\)$/, '')}</span>
                      <span className="tabular shrink-0 text-xs text-ink-faint">
                        {c.points}/{c.max}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-baseline justify-between border-t border-parchment-200 pt-2">
                  <span className="text-sm font-medium">Total</span>
                  <span className="tabular text-sm">{score.data.computed.value}/100</span>
                </div>
                {score.data.stale && (
                  <p className="mt-2 rounded-sm bg-ochre-100 px-2 py-1 text-xs text-ochre-700">
                    The stored score predates the current rules. Run{' '}
                    <span className="font-mono">pnpm --filter @lead/api rescore</span>.
                  </p>
                )}
              </>
            ) : (
              <Spinner label="Scoring" />
            )}
          </section>

          {l.documents.length > 0 && (
            <section className="card px-4 py-3">
              <h2 className="mb-2 font-serif text-base text-moss-900">Documents</h2>
              <ul className="space-y-1 text-sm">
                {l.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-2">
                    <a
                      href={`/api${doc.downloadUrl}`}
                      className="truncate text-moss-700 hover:underline"
                      download
                    >
                      {doc.filename}
                    </a>
                    <span className="shrink-0 text-xs text-ink-faint">
                      {formatRelative(doc.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* --- middle: stage changer --- */}
        <section className="card px-4 py-3">
          <h2 className="mb-2 font-serif text-base text-moss-900">Move through the funnel</h2>
          <p className="mb-3 text-xs text-ink-faint">
            Every move is recorded on the timeline. Going backwards is allowed — correcting a
            mis-click should not require a database edit.
          </p>
          <div className="space-y-1">
            {LEAD_STAGES.map((stage) => {
              const current = stage === l.stage;
              return (
                <button
                  key={stage}
                  type="button"
                  disabled={current || transition.isPending}
                  onClick={() => changeStage(stage)}
                  className={`flex w-full items-center justify-between rounded-sm border px-3 py-1.5 text-sm transition-colors ${
                    current
                      ? 'cursor-default border-moss-600 bg-moss-600 text-parchment-50'
                      : 'border-parchment-300 bg-parchment-50 text-ink-soft hover:border-moss-400 hover:bg-moss-100'
                  }`}
                >
                  {LEAD_STAGE_LABELS[stage]}
                  {current && <span className="text-xs">current</span>}
                </button>
              );
            })}
          </div>
          {transition.isError && (
            <div className="mt-2">
              <ErrorNote error={transition.error} />
            </div>
          )}

          <div className="mt-4 border-t border-parchment-200 pt-3">
            <label className="label" htmlFor="deal-value">
              Deal value
            </label>
            <div className="flex gap-2">
              <input
                id="deal-value"
                type="number"
                min="0"
                className="field tabular"
                defaultValue={l.dealValue ?? ''}
                onBlur={(e) => {
                  const value = e.target.value === '' ? null : Number(e.target.value);
                  if (value !== l.dealValue) update.mutate({ dealValue: value });
                }}
              />
            </div>
            <p className="mt-1 text-xs text-ink-faint">Saved when you click away.</p>
          </div>
        </section>

        {/* --- right: timeline --- */}
        <section className="card flex flex-col px-4 py-3 lg:col-span-1">
          <h2 className="mb-2 font-serif text-base text-moss-900">Timeline</h2>

          <form onSubmit={submitNote} className="mb-3 space-y-2">
            <div className="flex gap-2">
              <select
                className="field w-auto"
                value={noteType}
                onChange={(e) => setNoteType(e.target.value)}
                aria-label="Interaction type"
              >
                {INTERACTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {INTERACTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-primary" disabled={!note.trim() || addInteraction.isPending}>
                Log
              </button>
            </div>
            <textarea
              className="field"
              rows={2}
              placeholder="What happened?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </form>

          {l.interactions.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-faint">Nothing logged yet.</p>
          ) : (
            <ol className="max-h-[32rem] space-y-2.5 overflow-y-auto">
              {l.interactions.map((item) => (
                <li key={item.id} className="border-l-2 border-moss-200 pl-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wider text-moss-700">
                      {INTERACTION_TYPE_LABELS[item.type]}
                      {item.direction === 'inbound' && ' ← in'}
                      {item.direction === 'outbound' && ' → out'}
                    </span>
                    <span
                      className="shrink-0 text-xs text-ink-faint"
                      title={formatDateTime(item.createdAt)}
                    >
                      {formatRelative(item.createdAt)}
                    </span>
                  </div>
                  {item.subject && <p className="text-sm font-medium">{item.subject}</p>}
                  <p className="whitespace-pre-wrap text-sm text-ink-soft">{item.content}</p>
                  {item.userName && <p className="text-xs text-ink-faint">— {item.userName}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {wonModal && (
        <Modal title="Mark this deal won" onClose={() => setWonModal(false)}>
          <p className="mb-3 text-sm text-ink-soft">
            A won deal needs a value — revenue and close-rate reporting depend on it.
          </p>
          <label className="label" htmlFor="won-value">
            Deal value (₹)
          </label>
          <input
            id="won-value"
            type="number"
            min="1"
            className="field tabular"
            value={dealValue}
            onChange={(e) => setDealValue(e.target.value)}
            autoFocus
          />
          {transition.isError && (
            <div className="mt-2">
              <ErrorNote error={transition.error} />
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setWonModal(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!dealValue || Number(dealValue) <= 0}
              onClick={() =>
                transition.mutate(
                  { stage: 'closed_won', dealValue: Number(dealValue) },
                  { onSuccess: () => setWonModal(false) },
                )
              }
            >
              Mark won
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Delete this lead?" onClose={() => setConfirmDelete(false)}>
          <p className="text-sm text-ink-soft">
            <strong>{l.name}</strong> and its {l.interactions.length} timeline{' '}
            {l.interactions.length === 1 ? 'entry' : 'entries'} will be permanently removed. This
            cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => remove.mutate(l.id, { onSuccess: () => navigate('/leads') })}
            >
              Delete permanently
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
