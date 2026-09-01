/** Small shared pieces: loading, error, empty states, and the page shell. */

import type { ReactNode } from 'react';
import { ApiClientError } from '../lib/api';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}): React.ReactElement {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-parchment-300 pb-3">
      <div>
        <h1 className="font-serif text-2xl text-moss-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-faint">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-ink-faint">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-moss-300 border-t-moss-700" />
      {label}…
    </div>
  );
}

/**
 * Error display. Surfaces field-level detail from the API rather than a bare
 * "something went wrong" — the backend already said what was wrong.
 */
export function ErrorNote({ error }: { error: unknown }): React.ReactElement {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof ApiClientError ? error.details : [];

  return (
    <div className="rounded-sm border border-rust-300 bg-rust-100 px-3 py-2 text-sm text-rust-700">
      <p className="font-medium">{message}</p>
      {details.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-xs">
          {details.map((d, i) => (
            <li key={`${d.path}-${i}`}>
              {d.path ? <span className="font-mono">{d.path}</span> : null} {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}): React.ReactElement {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-serif text-lg text-moss-800">{title}</p>
      {hint && <p className="max-w-md text-sm text-ink-faint">{hint}</p>}
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'good' | 'warn';
}): React.ReactElement {
  const toneClass =
    tone === 'good' ? 'text-moss-700' : tone === 'warn' ? 'text-rust-500' : 'text-ink';

  return (
    <div className="card px-4 py-3">
      <p className="text-xs uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`tabular mt-1 text-2xl ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-faint">{sub}</p>}
    </div>
  );
}

/** Simple modal. No dependency — this app needs one dialog pattern, not a library. */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-16"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} shadow-raised`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-parchment-200 px-4 py-2.5">
          <h2 className="font-serif text-lg text-moss-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm px-2 text-xl leading-none text-ink-faint hover:bg-parchment-200"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
