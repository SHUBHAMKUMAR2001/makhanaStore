/**
 * Score and stage badges.
 *
 * Colour carries meaning here rather than decoration: the score band uses the
 * moss/ochre/neutral progression, and stages darken as a lead moves down the
 * funnel, so a glance at the table shows where the pipeline is dense.
 */

import {
  LEAD_SCORE_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_STAGE_LABELS,
  type LeadScore,
  type LeadSource,
  type LeadStage,
} from '@lead/shared';

const SCORE_STYLES: Record<LeadScore, string> = {
  high: 'border-moss-400 bg-moss-100 text-moss-800',
  medium: 'border-ochre-300 bg-ochre-100 text-ochre-700',
  low: 'border-parchment-300 bg-parchment-200 text-ink-faint',
};

export function ScoreBadge({
  score,
  value,
}: {
  score: LeadScore;
  value?: number;
}): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium ${SCORE_STYLES[score]}`}
      title={value === undefined ? undefined : `Score ${value}/100`}
    >
      {LEAD_SCORE_LABELS[score]}
      {value !== undefined && <span className="tabular text-[10px] opacity-70">{value}</span>}
    </span>
  );
}

const STAGE_STYLES: Record<LeadStage, string> = {
  sourced: 'border-parchment-300 bg-parchment-100 text-ink-faint',
  contacted: 'border-moss-200 bg-moss-100 text-moss-700',
  replied: 'border-moss-300 bg-moss-100 text-moss-800',
  sample_sent: 'border-moss-300 bg-moss-200 text-moss-800',
  quoted: 'border-moss-400 bg-moss-200 text-moss-900',
  negotiating: 'border-ochre-300 bg-ochre-100 text-ochre-700',
  closed_won: 'border-moss-600 bg-moss-600 text-parchment-50',
  closed_lost: 'border-rust-300 bg-rust-100 text-rust-700',
};

export function StageBadge({ stage }: { stage: LeadStage }): React.ReactElement {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-xs font-medium ${STAGE_STYLES[stage]}`}
    >
      {LEAD_STAGE_LABELS[stage]}
    </span>
  );
}

export function SourceTag({ source }: { source: LeadSource }): React.ReactElement {
  return (
    <span className="whitespace-nowrap text-xs text-ink-faint">{LEAD_SOURCE_LABELS[source]}</span>
  );
}

export function TierTag({ tier }: { tier: number }): React.ReactElement {
  return (
    <span className="tabular text-xs text-ink-faint" title={`Region tier ${tier}`}>
      T{tier}
    </span>
  );
}
