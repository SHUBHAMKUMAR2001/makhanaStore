/**
 * CSV bulk import.
 *
 * The design rule from the brief: a malformed row must never silently corrupt
 * the leads table. So every row is parsed through `csvLeadRowSchema`, and a row
 * that fails is reported back with its line number and skipped — the import
 * continues rather than aborting, because one bad row in a 400-row export
 * should not cost you the other 399.
 *
 * `dryRun` runs the whole validation pass and reports exactly what would
 * happen, writing nothing.
 */

import { parse } from 'csv-parse/sync';
import { buildDedupeKey, csvLeadRowSchema, type CsvImportOptions, type CsvImportResult } from '@lead/shared';
import { ApiError } from '../lib/errors.js';
import { createOrGetLead } from './leads.js';

/** Header aliases, so an export from a spreadsheet does not need hand-editing. */
const HEADER_ALIASES: Record<string, string> = {
  'business name': 'name',
  'company': 'name',
  'company name': 'name',
  'firm': 'name',
  'lead name': 'name',
  'business type': 'category',
  'type': 'category',
  'industry': 'category',
  'segment': 'category',
  'location': 'city',
  'town': 'city',
  'region tier': 'regionTier',
  'tier': 'regionTier',
  'regiontier': 'regionTier',
  'mobile': 'phone',
  'contact': 'phone',
  'contact number': 'phone',
  'phone number': 'phone',
  'email address': 'email',
  'e-mail': 'email',
  'web': 'website',
  'url': 'website',
  'site': 'website',
  'deal value': 'dealValue',
  'dealvalue': 'dealValue',
  'value': 'dealValue',
  'remarks': 'notes',
  'note': 'notes',
  'comment': 'notes',
};

function normalizeHeader(header: string): string {
  const cleaned = header.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return HEADER_ALIASES[cleaned] ?? cleaned.replace(/\s+(.)/g, (_, c: string) => c.toUpperCase());
}

/** Drop empty strings so optional fields stay absent rather than failing validation. */
function compact(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) out[key] = trimmed;
    } else if (value !== null && value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export async function importLeadsFromCsv(
  csv: string,
  options: CsvImportOptions,
): Promise<CsvImportResult> {
  let records: Record<string, string>[];

  try {
    records = parse(csv, {
      columns: (header: string[]) => header.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    }) as Record<string, string>[];
  } catch (error) {
    throw ApiError.badRequest(
      `Could not parse the CSV: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  const result: CsvImportResult = {
    dryRun: options.dryRun,
    totalRows: records.length,
    created: 0,
    updated: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
  };

  if (records.length === 0) {
    throw ApiError.badRequest('The CSV contained no data rows');
  }

  // Row 1 is the header, so the first data row is line 2 — report the line
  // number the operator will see in their spreadsheet.
  let line = 1;
  /** Catches duplicates *within the file*, which the database cannot see yet. */
  const seenInFile = new Set<string>();

  for (const record of records) {
    line += 1;
    const parsed = csvLeadRowSchema.safeParse(compact(record));

    if (!parsed.success) {
      result.failed += 1;
      for (const issue of parsed.error.issues.slice(0, 3)) {
        result.errors.push({
          row: line,
          field: issue.path.join('.') || undefined,
          message: issue.message,
        });
      }
      continue;
    }

    const row = parsed.data;

    let dedupeKey: string;
    try {
      dedupeKey = buildDedupeKey(row.name, row.city);
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        row: line,
        message: error instanceof Error ? error.message : 'Could not identify this lead',
      });
      continue;
    }

    if (seenInFile.has(dedupeKey)) {
      result.duplicates += 1;
      result.errors.push({
        row: line,
        message: `Duplicate of an earlier row in this file (${row.name}, ${row.city})`,
      });
      continue;
    }
    seenInFile.add(dedupeKey);

    if (options.dryRun) {
      result.created += 1;
      continue;
    }

    try {
      const { created, updated } = await createOrGetLead(
        {
          name: row.name,
          category: row.category,
          city: row.city,
          regionTier: row.regionTier ?? 3,
          phone: row.phone ?? null,
          email: row.email ?? null,
          website: row.website ?? null,
          source: row.source ?? options.defaultSource,
          stage: row.stage ?? 'sourced',
          dealValue: row.dealValue ?? null,
          notes: row.notes ?? null,
          campaignId: null,
          scraperRunId: null,
        },
        { updateExisting: options.updateExisting },
      );

      if (created) result.created += 1;
      else if (updated) result.updated += 1;
      else result.duplicates += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        row: line,
        message: error instanceof Error ? error.message : 'Could not save this lead',
      });
    }
  }

  // Cap the error list so a wholly malformed file returns a usable response
  // instead of a multi-megabyte one.
  if (result.errors.length > 100) {
    const hidden = result.errors.length - 100;
    result.errors = result.errors.slice(0, 100);
    result.errors.push({ row: 0, message: `... and ${hidden} more problems not listed` });
  }

  return result;
}
