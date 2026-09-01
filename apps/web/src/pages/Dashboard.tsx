/**
 * Dashboard.
 *
 * Every number here comes from `/stats/dashboard` — the frontend does no
 * aggregation of its own, so what you see always matches what the database
 * says.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FUNNEL_ORDER,
  LEAD_SOURCE_LABELS,
  LEAD_STAGE_LABELS,
  SCRAPER_RUN_STATUS_LABELS,
  type LeadStage,
} from '@lead/shared';
import { useDashboard } from '../hooks/queries';
import { ErrorNote, PageHeader, Spinner, StatTile } from '../components/ui';
import { formatDate, formatMoney, formatMoneyCompact, formatPercent } from '../lib/format';

export function DashboardPage(): React.ReactElement {
  const [days, setDays] = useState(30);
  const stats = useDashboard(days);

  if (stats.isLoading) return <Spinner label="Building dashboard" />;
  if (stats.isError) return <ErrorNote error={stats.error} />;
  if (!stats.data) return <></>;

  const { totals, funnel, bySource, byScore, byRegionTier, leadsOverTime, recentRuns } = stats.data;
  const funnelMax = Math.max(...funnel.map((f) => f.count), 1);
  const peakDay = Math.max(...leadsOverTime.map((d) => d.count), 1);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Pipeline health across every source"
        actions={
          <select
            className="field w-auto"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Time window"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Total leads"
          value={String(totals.leads)}
          sub={`${totals.openLeads} still open`}
        />
        <StatTile
          label="Pipeline"
          value={formatMoneyCompact(totals.pipelineValue)}
          sub="Value in open stages"
        />
        <StatTile
          label="Revenue"
          value={formatMoneyCompact(totals.revenue)}
          sub={`${totals.won} deals won`}
          tone="good"
        />
        <StatTile
          label="Close rate"
          value={formatPercent(totals.closeRate)}
          sub={
            totals.closeRate === null
              ? 'Nothing closed yet'
              : `${totals.won} won / ${totals.lost} lost`
          }
        />
        <StatTile
          label="Avg deal"
          value={formatMoneyCompact(totals.averageDealValue)}
          sub="Across won deals"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --- funnel --- */}
        <section className="card px-4 py-3">
          <h2 className="mb-3 font-serif text-base text-moss-900">Funnel</h2>
          <ul className="space-y-1.5">
            {FUNNEL_ORDER.map((stage) => {
              const row = funnel.find((f) => f.stage === stage);
              const count = row?.count ?? 0;
              return (
                <li key={stage} className="flex items-center gap-2 text-sm">
                  <Link
                    to={`/leads?stage=${stage}`}
                    className="w-28 shrink-0 truncate text-ink-soft hover:text-moss-700 hover:underline"
                  >
                    {LEAD_STAGE_LABELS[stage]}
                  </Link>
                  <div className="h-4 flex-1 overflow-hidden rounded-sm bg-parchment-200">
                    <div
                      className="h-full bg-moss-500"
                      style={{ width: `${Math.round((count / funnelMax) * 100)}%` }}
                    />
                  </div>
                  <span className="tabular w-8 shrink-0 text-right text-xs">{count}</span>
                  <span className="tabular w-16 shrink-0 text-right text-xs text-ink-faint">
                    {row?.value ? formatMoneyCompact(row.value) : ''}
                  </span>
                </li>
              );
            })}
            <li className="flex items-center gap-2 border-t border-parchment-200 pt-1.5 text-sm">
              <Link
                to="/leads?stage=closed_lost"
                className="w-28 shrink-0 text-rust-500 hover:underline"
              >
                {LEAD_STAGE_LABELS['closed_lost' as LeadStage]}
              </Link>
              <div className="h-4 flex-1 overflow-hidden rounded-sm bg-parchment-200">
                <div
                  className="h-full bg-rust-300"
                  style={{
                    width: `${Math.round(((funnel.find((f) => f.stage === 'closed_lost')?.count ?? 0) / funnelMax) * 100)}%`,
                  }}
                />
              </div>
              <span className="tabular w-8 shrink-0 text-right text-xs">
                {funnel.find((f) => f.stage === 'closed_lost')?.count ?? 0}
              </span>
              <span className="w-16 shrink-0" />
            </li>
          </ul>
        </section>

        {/* --- leads over time --- */}
        <section className="card px-4 py-3">
          <h2 className="mb-3 font-serif text-base text-moss-900">Leads added</h2>
          <div className="flex h-32 items-end gap-px">
            {leadsOverTime.map((d) => (
              <div
                key={d.date}
                className="flex-1 bg-moss-400 hover:bg-moss-600"
                style={{ height: `${Math.max((d.count / peakDay) * 100, d.count > 0 ? 6 : 1)}%` }}
                title={`${formatDate(d.date)}: ${d.count} lead${d.count === 1 ? '' : 's'}`}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-ink-faint">
            <span>{formatDate(leadsOverTime[0]?.date)}</span>
            <span>{formatDate(leadsOverTime[leadsOverTime.length - 1]?.date)}</span>
          </div>
        </section>

        {/* --- source performance --- */}
        <section className="card overflow-hidden lg:col-span-2">
          <h2 className="border-b border-parchment-200 px-4 py-2.5 font-serif text-base text-moss-900">
            Source performance
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-parchment-200/60 text-xs uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="px-4 py-2 text-left">Source</th>
                  <th className="px-4 py-2 text-right">Leads</th>
                  <th className="px-4 py-2 text-right">Contacted</th>
                  <th className="px-4 py-2 text-right">Replied</th>
                  <th className="px-4 py-2 text-right">Won</th>
                  <th className="px-4 py-2 text-right">Close rate</th>
                  <th className="px-4 py-2 text-right">Pipeline</th>
                  <th className="px-4 py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {bySource.map((row) => (
                  <tr key={row.source} className="ledger-row hover:bg-moss-100/40">
                    <td className="px-4 py-1.5">
                      <Link
                        to={`/leads?source=${row.source}`}
                        className="text-moss-700 hover:underline"
                      >
                        {LEAD_SOURCE_LABELS[row.source]}
                      </Link>
                    </td>
                    <td className="tabular px-4 py-1.5 text-right">{row.leads}</td>
                    <td className="tabular px-4 py-1.5 text-right text-ink-faint">
                      {row.contacted}
                    </td>
                    <td className="tabular px-4 py-1.5 text-right text-ink-faint">{row.replied}</td>
                    <td className="tabular px-4 py-1.5 text-right">{row.won}</td>
                    <td className="tabular px-4 py-1.5 text-right">
                      {formatPercent(row.closeRate)}
                    </td>
                    <td className="tabular px-4 py-1.5 text-right">
                      {formatMoney(row.pipelineValue)}
                    </td>
                    <td className="tabular px-4 py-1.5 text-right text-moss-700">
                      {formatMoney(row.revenue)}
                    </td>
                  </tr>
                ))}
                {bySource.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-ink-faint">
                      No leads yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* --- score bands --- */}
        <section className="card px-4 py-3">
          <h2 className="mb-3 font-serif text-base text-moss-900">Score bands</h2>
          <p className="mb-2 text-xs text-ink-faint">
            Whether the scoring engine is picking the right leads: high-band leads should convert
            more often than low-band ones.
          </p>
          <ul className="space-y-1.5 text-sm">
            {byScore.map((band) => (
              <li key={band.score} className="flex items-center justify-between gap-2">
                <Link
                  to={`/leads?score=${band.score}`}
                  className="capitalize text-moss-700 hover:underline"
                >
                  {band.score}
                </Link>
                <span className="tabular text-xs text-ink-faint">
                  {band.count} lead{band.count === 1 ? '' : 's'} · {band.won} won
                </span>
              </li>
            ))}
          </ul>

          <h3 className="mb-1.5 mt-4 text-xs uppercase tracking-wider text-ink-faint">
            Region tiers
          </h3>
          <ul className="space-y-1 text-sm">
            {byRegionTier.map((tier) => (
              <li key={tier.regionTier} className="flex items-center justify-between">
                <Link
                  to={`/leads?regionTier=${tier.regionTier}`}
                  className="text-moss-700 hover:underline"
                >
                  Tier {tier.regionTier}
                </Link>
                <span className="tabular text-xs text-ink-faint">
                  {tier.count} · {tier.won} won
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* --- recent scraper runs --- */}
        <section className="card px-4 py-3">
          <h2 className="mb-3 font-serif text-base text-moss-900">Recent scrape runs</h2>
          {recentRuns.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-faint">
              No scrapes yet.{' '}
              <Link to="/campaigns" className="text-moss-700 hover:underline">
                Start one
              </Link>
              .
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {recentRuns.map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {run.category} · {run.city}
                  </span>
                  <span className="tabular shrink-0 text-xs text-ink-faint">
                    {run.leadsCreated} new · {SCRAPER_RUN_STATUS_LABELS[run.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
