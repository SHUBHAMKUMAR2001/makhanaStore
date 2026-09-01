/**
 * The leads table.
 *
 * Filters live in the URL query string rather than component state, so a
 * filtered view is a shareable link and the browser back button works.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import {
  LEAD_SCORES,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  leadSortFields,
  type LeadDto,
  type LeadScore,
  type LeadSource,
  type LeadStage,
} from '@lead/shared';
import { useLeads } from '../hooks/queries';
import { ScoreBadge, SourceTag, StageBadge, TierTag } from '../components/badges';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { displayHost, formatDate, formatMoney, formatPhone } from '../lib/format';
import { NewLeadModal } from '../components/NewLeadModal';
import { ImportCsvModal } from '../components/ImportCsvModal';

const SORTABLE = [
  { id: 'name', label: 'Business' },
  { id: 'city', label: 'City' },
  { id: 'score', label: 'Score' },
  { id: 'stage', label: 'Stage' },
  { id: 'dealValue', label: 'Value' },
  { id: 'createdAt', label: 'Added' },
] as const;

export function LeadsPage(): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);

  /**
   * Query params are user-editable text, so narrow them against the known
   * values rather than trusting them. A hand-edited `?sortBy=passwordHash`
   * falls back to the default instead of being forwarded to the API.
   */
  const only = <T extends string>(values: string[], allowed: readonly T[]): T[] =>
    values.filter((v): v is T => (allowed as readonly string[]).includes(v));

  const rawSortBy = params.get('sortBy');
  const query = {
    q: params.get('q') ?? undefined,
    stage: only<LeadStage>(params.getAll('stage'), LEAD_STAGES),
    source: only<LeadSource>(params.getAll('source'), LEAD_SOURCES),
    score: only<LeadScore>(params.getAll('score'), LEAD_SCORES),
    regionTier: params
      .getAll('regionTier')
      .map(Number)
      .filter((n) => n >= 1 && n <= 3),
    sortBy: (leadSortFields as readonly string[]).includes(rawSortBy ?? '')
      ? (rawSortBy as (typeof leadSortFields)[number])
      : ('createdAt' as const),
    sortDir: (params.get('sortDir') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc',
    page: Math.max(1, Number(params.get('page') ?? 1) || 1),
    pageSize: 50,
  };

  const leads = useLeads(query);

  function setParam(key: string, value: string | null): void {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    // Any filter change invalidates the current page number.
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  /** Toggle one value of a repeatable filter (stage, source, score). */
  function toggleParam(key: string, value: string): void {
    const next = new URLSearchParams(params);
    const current = next.getAll(key);
    next.delete(key);
    for (const v of current.includes(value)
      ? current.filter((c) => c !== value)
      : [...current, value]) {
      next.append(key, v);
    }
    next.delete('page');
    setParams(next);
  }

  function toggleSort(id: string): void {
    const next = new URLSearchParams(params);
    if (query.sortBy === id) {
      next.set('sortDir', query.sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      next.set('sortBy', id);
      next.set('sortDir', id === 'name' || id === 'city' ? 'asc' : 'desc');
    }
    next.delete('page');
    setParams(next);
  }

  const columns = useMemo<ColumnDef<LeadDto>[]>(
    () => [
      {
        id: 'name',
        header: 'Business',
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`/leads/${row.original.id}`}
              className="block truncate font-medium text-moss-800 hover:text-moss-600 hover:underline"
            >
              {row.original.name}
            </Link>
            <p className="truncate text-xs text-ink-faint">{row.original.category}</p>
          </div>
        ),
      },
      {
        id: 'city',
        header: 'City',
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{row.original.city}</span>
            <TierTag tier={row.original.regionTier} />
          </div>
        ),
      },
      {
        id: 'contact',
        header: 'Contact',
        cell: ({ row }) => (
          <div className="text-xs">
            <p className="tabular text-ink-soft">{formatPhone(row.original.phone)}</p>
            {row.original.website && (
              <a
                href={row.original.website}
                target="_blank"
                rel="noreferrer noopener"
                className="text-moss-600 hover:underline"
              >
                {displayHost(row.original.website)}
              </a>
            )}
          </div>
        ),
      },
      {
        id: 'score',
        header: 'Score',
        cell: ({ row }) => (
          <ScoreBadge score={row.original.score} value={row.original.scoreValue} />
        ),
      },
      {
        id: 'stage',
        header: 'Stage',
        cell: ({ row }) => <StageBadge stage={row.original.stage} />,
      },
      {
        id: 'source',
        header: 'Source',
        cell: ({ row }) => <SourceTag source={row.original.source} />,
      },
      {
        id: 'dealValue',
        header: 'Value',
        cell: ({ row }) => (
          <span className="tabular text-sm">{formatMoney(row.original.dealValue)}</span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Added',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-ink-faint">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: leads.data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const activeFilters =
    query.stage.length + query.source.length + query.score.length + query.regionTier.length;

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle={
          leads.data
            ? `${leads.data.total} lead${leads.data.total === 1 ? '' : 's'}${activeFilters ? ' matching filters' : ''}`
            : undefined
        }
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => setShowImport(true)}>
              Import CSV
            </button>
            <button type="button" className="btn-primary" onClick={() => setShowNew(true)}>
              Add lead
            </button>
          </>
        }
      />

      {/* --- filters --- */}
      <div className="card mb-4 space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            className="field max-w-xs"
            placeholder="Search name, city, category, phone…"
            defaultValue={query.q ?? ''}
            onChange={(e) => setParam('q', e.target.value || null)}
          />
          <select
            className="field w-auto"
            value={`${query.sortBy}:${query.sortDir}`}
            onChange={(e) => {
              const [by, dir] = e.target.value.split(':');
              const next = new URLSearchParams(params);
              next.set('sortBy', by!);
              next.set('sortDir', dir!);
              next.delete('page');
              setParams(next);
            }}
          >
            {SORTABLE.map((s) => (
              <optgroup key={s.id} label={s.label}>
                <option value={`${s.id}:desc`}>{s.label} ↓</option>
                <option value={`${s.id}:asc`}>{s.label} ↑</option>
              </optgroup>
            ))}
          </select>
          {activeFilters > 0 && (
            <button
              type="button"
              className="text-xs text-rust-500 hover:underline"
              onClick={() =>
                setParams(query.q ? new URLSearchParams({ q: query.q }) : new URLSearchParams())
              }
            >
              Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}
            </button>
          )}
        </div>

        <FilterRow
          label="Score"
          options={LEAD_SCORES.map((s) => ({ value: s, label: s }))}
          selected={query.score}
          onToggle={(v) => toggleParam('score', v)}
        />
        <FilterRow
          label="Stage"
          options={LEAD_STAGES.map((s) => ({ value: s, label: LEAD_STAGE_LABELS[s] }))}
          selected={query.stage}
          onToggle={(v) => toggleParam('stage', v)}
        />
        <FilterRow
          label="Source"
          options={LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABELS[s] }))}
          selected={query.source}
          onToggle={(v) => toggleParam('source', v)}
        />
        <FilterRow
          label="Region"
          options={[
            { value: '1', label: 'Tier 1' },
            { value: '2', label: 'Tier 2' },
            { value: '3', label: 'Tier 3' },
          ]}
          selected={query.regionTier.map(String)}
          onToggle={(v) => toggleParam('regionTier', v)}
        />
      </div>

      {/* --- table --- */}
      {leads.isError && <ErrorNote error={leads.error} />}
      {leads.isLoading && <Spinner label="Loading leads" />}

      {leads.data && leads.data.items.length === 0 && (
        <EmptyState
          title="No leads match"
          hint={
            activeFilters || query.q
              ? 'Try clearing a filter or broadening the search.'
              : 'Add one by hand, import a CSV, or run a scrape from the Campaigns page.'
          }
        />
      )}

      {leads.data && leads.data.items.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead className="border-b border-parchment-300 bg-parchment-200/60">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((header) => {
                      const sortable = SORTABLE.some((s) => s.id === header.column.id);
                      const active = query.sortBy === header.column.id;
                      return (
                        <th
                          key={header.id}
                          className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-ink-faint"
                        >
                          {sortable ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(header.column.id)}
                              className={`hover:text-moss-700 ${active ? 'text-moss-800' : ''}`}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {active && (query.sortDir === 'asc' ? ' ↑' : ' ↓')}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="ledger-row hover:bg-moss-100/40">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {leads.data.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-parchment-300 px-3 py-2 text-sm">
              <span className="text-ink-faint">
                Page {leads.data.page} of {leads.data.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={leads.data.page <= 1}
                  onClick={() => setParam('page', String(leads.data!.page - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={leads.data.page >= leads.data.totalPages}
                  onClick={() => setParam('page', String(leads.data!.page + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showNew && <NewLeadModal onClose={() => setShowNew(false)} />}
      {showImport && <ImportCsvModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

function FilterRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-14 shrink-0 text-xs uppercase tracking-wider text-ink-faint">{label}</span>
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(option.value)}
            className={`rounded-sm border px-2 py-0.5 text-xs transition-colors ${
              active
                ? 'border-moss-600 bg-moss-600 text-parchment-50'
                : 'border-parchment-300 bg-parchment-50 text-ink-soft hover:border-moss-300'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
