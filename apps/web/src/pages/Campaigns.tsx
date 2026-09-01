/**
 * Campaigns and scrape-run history.
 *
 * The run table is the audit trail: a run that found nothing still appears
 * here with its status and error, which is the only way to tell a genuinely
 * empty search from a scraper that was geo-blocked.
 */

import { useState, type FormEvent } from 'react';
import {
  CAMPAIGN_CHANNEL_LABELS,
  LEAD_SOURCE_LABELS,
  SCRAPABLE_SOURCES,
  SCRAPER_RUN_STATUS_LABELS,
  type ScraperRunStatus,
} from '@lead/shared';
import { useCampaigns, useScraperRuns, useStartScrape } from '../hooks/queries';
import { ErrorNote, Modal, PageHeader, Spinner } from '../components/ui';
import { formatDateTime, formatMoney, formatPercent, formatRelative } from '../lib/format';
import { Field } from '../components/NewLeadModal';

const STATUS_STYLES: Record<ScraperRunStatus, string> = {
  queued: 'bg-parchment-200 text-ink-faint',
  running: 'bg-ochre-100 text-ochre-700',
  completed: 'bg-moss-100 text-moss-800',
  capped: 'bg-ochre-100 text-ochre-700',
  failed: 'bg-rust-100 text-rust-700',
  geo_blocked: 'bg-rust-100 text-rust-700',
  cancelled: 'bg-parchment-200 text-ink-faint',
};

export function CampaignsPage(): React.ReactElement {
  const campaigns = useCampaigns();
  const runs = useScraperRuns({ pageSize: 25 });
  const [showScrape, setShowScrape] = useState(false);

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle="Scrape runs and paid campaign performance"
        actions={
          <button type="button" className="btn-primary" onClick={() => setShowScrape(true)}>
            Run a scrape
          </button>
        }
      />

      <section className="card mb-4 overflow-hidden">
        <h2 className="border-b border-parchment-200 px-4 py-2.5 font-serif text-base text-moss-900">
          Scrape runs
        </h2>

        {runs.isLoading && <Spinner label="Loading runs" />}
        {runs.isError && (
          <div className="p-4">
            <ErrorNote error={runs.error} />
          </div>
        )}

        {runs.data && runs.data.items.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-ink-faint">
            No scrape runs yet. Every run is recorded here — including failures — so a scrape that
            silently finds nothing still leaves a trail.
          </p>
        )}

        {runs.data && runs.data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-parchment-200/60 text-xs uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="px-4 py-2 text-left">Source</th>
                  <th className="px-4 py-2 text-left">Search</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Found</th>
                  <th className="px-4 py-2 text-right">New</th>
                  <th className="px-4 py-2 text-right">Dupes</th>
                  <th className="px-4 py-2 text-right">Requests</th>
                  <th className="px-4 py-2 text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.items.map((run) => (
                  <tr key={run.id} className="ledger-row hover:bg-moss-100/40">
                    <td className="px-4 py-1.5">{LEAD_SOURCE_LABELS[run.source]}</td>
                    <td className="px-4 py-1.5">
                      <span className="text-ink-soft">{run.category}</span>
                      <span className="text-ink-faint"> · {run.city}</span>
                    </td>
                    <td className="px-4 py-1.5">
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-xs ${STATUS_STYLES[run.status]}`}
                      >
                        {SCRAPER_RUN_STATUS_LABELS[run.status]}
                      </span>
                      {run.error && (
                        <p
                          className="mt-0.5 max-w-xs truncate text-xs text-rust-500"
                          title={run.error}
                        >
                          {run.error}
                        </p>
                      )}
                    </td>
                    <td className="tabular px-4 py-1.5 text-right">{run.leadsFound}</td>
                    <td className="tabular px-4 py-1.5 text-right text-moss-700">
                      {run.leadsCreated}
                    </td>
                    <td className="tabular px-4 py-1.5 text-right text-ink-faint">
                      {run.leadsDuplicate}
                    </td>
                    <td className="tabular px-4 py-1.5 text-right text-ink-faint">
                      {run.requestsMade}
                    </td>
                    <td
                      className="px-4 py-1.5 text-right text-xs text-ink-faint"
                      title={formatDateTime(run.requestedAt)}
                    >
                      {formatRelative(run.requestedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-parchment-200 px-4 py-2.5 font-serif text-base text-moss-900">
          Campaigns
        </h2>

        {campaigns.data && campaigns.data.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-ink-faint">
            No campaigns yet. Create one to group leads from a Meta Ads push or a scrape batch and
            track its return.
          </p>
        )}

        {campaigns.data && campaigns.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-parchment-200/60 text-xs uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="px-4 py-2 text-left">Campaign</th>
                  <th className="px-4 py-2 text-left">Channel</th>
                  <th className="px-4 py-2 text-right">Leads</th>
                  <th className="px-4 py-2 text-right">Won</th>
                  <th className="px-4 py-2 text-right">Spend</th>
                  <th className="px-4 py-2 text-right">Revenue</th>
                  <th className="px-4 py-2 text-right">Return</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.data.map((c) => (
                  <tr key={c.id} className="ledger-row hover:bg-moss-100/40">
                    <td className="px-4 py-1.5">{c.name}</td>
                    <td className="px-4 py-1.5 text-ink-faint">
                      {CAMPAIGN_CHANNEL_LABELS[c.channel]}
                    </td>
                    <td className="tabular px-4 py-1.5 text-right">{c.leadCount}</td>
                    <td className="tabular px-4 py-1.5 text-right">{c.wonCount}</td>
                    <td className="tabular px-4 py-1.5 text-right">{formatMoney(c.spend)}</td>
                    <td className="tabular px-4 py-1.5 text-right text-moss-700">
                      {formatMoney(c.revenue)}
                    </td>
                    <td className="tabular px-4 py-1.5 text-right">
                      {c.spend && c.spend > 0 ? formatPercent(c.revenue / c.spend) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showScrape && <StartScrapeModal onClose={() => setShowScrape(false)} />}
    </div>
  );
}

function StartScrapeModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const start = useStartScrape();
  const [form, setForm] = useState({
    source: 'indiamart',
    category: 'Makhana',
    city: 'Delhi',
    regionTier: '1',
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    start.mutate(
      {
        source: form.source,
        category: form.category,
        city: form.city,
        regionTier: Number(form.regionTier),
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="Run a scrape" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="rounded-sm border border-ochre-300 bg-ochre-100 px-3 py-2 text-xs text-ochre-700">
          <p className="font-medium">This only works from an Indian IP address.</p>
          <p className="mt-1">
            IndiaMART redirects non-Indian traffic to a host that returns 403. If the worker is
            running outside India the run will be marked <strong>Geo-blocked</strong> rather than
            quietly returning zero results.
          </p>
        </div>

        <Field label="Source">
          <select
            className="field"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
          >
            {SCRAPABLE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Search term"
          hint="What you would type into the site's own search box"
          required
        >
          <input
            className="field"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="City" required>
            <input
              className="field"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              required
            />
          </Field>
          <Field label="Region tier" hint="Applied to every lead found">
            <select
              className="field"
              value={form.regionTier}
              onChange={(e) => setForm({ ...form, regionTier: e.target.value })}
            >
              <option value="1">Tier 1 — Metro</option>
              <option value="2">Tier 2 — Large city</option>
              <option value="3">Tier 3 — Smaller city</option>
            </select>
          </Field>
        </div>

        {start.isError && <ErrorNote error={start.error} />}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={start.isPending}>
            {start.isPending ? 'Queueing…' : 'Queue scrape'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
