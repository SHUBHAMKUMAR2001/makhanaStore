import { useState } from 'react';
import { LEAD_SOURCES, LEAD_SOURCE_LABELS } from '@lead/shared';
import { useImportCsv } from '../hooks/queries';
import { ErrorNote, Modal } from './ui';

/**
 * CSV import.
 *
 * Runs a dry run first by default. The API validates every row and reports
 * failures with line numbers, so the operator sees exactly what would happen
 * before anything is written.
 */
export function ImportCsvModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const importCsv = useImportCsv();
  const [csv, setCsv] = useState('');
  const [defaultSource, setDefaultSource] = useState('manual');
  const [filename, setFilename] = useState<string | null>(null);

  const result = importCsv.data;
  const wasDryRun = result?.dryRun ?? false;

  async function pickFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setFilename(file.name);
    setCsv(await file.text());
    importCsv.reset();
  }

  return (
    <Modal title="Import leads from CSV" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="rounded-sm border border-parchment-300 bg-parchment-100 px-3 py-2 text-xs text-ink-soft">
          <p className="font-medium">Expected columns</p>
          <p className="mt-1 font-mono">name, category, city, regionTier, phone, email, website, source, notes</p>
          <p className="mt-1">
            Common spreadsheet headings are recognised too — &ldquo;Business Name&rdquo;,
            &ldquo;Mobile&rdquo;, &ldquo;Location&rdquo;, &ldquo;Tier&rdquo;, &ldquo;Remarks&rdquo;.
            Only <span className="font-mono">name</span>, <span className="font-mono">category</span>{' '}
            and <span className="font-mono">city</span> are required.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="csv-file">
              CSV file
            </label>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              className="text-sm"
              onChange={(e) => void pickFile(e.target.files?.[0])}
            />
          </div>
          <div>
            <label className="label" htmlFor="csv-source">
              Source for rows without one
            </label>
            <select
              id="csv-source"
              className="field w-auto"
              value={defaultSource}
              onChange={(e) => setDefaultSource(e.target.value)}
            >
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <textarea
          className="field font-mono text-xs"
          rows={6}
          placeholder="…or paste CSV here"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setFilename(null);
            importCsv.reset();
          }}
        />
        {filename && <p className="text-xs text-ink-faint">Loaded {filename}</p>}

        {importCsv.isError && <ErrorNote error={importCsv.error} />}

        {result && (
          <div
            className={`rounded-sm border px-3 py-2 text-sm ${
              wasDryRun
                ? 'border-ochre-300 bg-ochre-100 text-ochre-700'
                : 'border-moss-300 bg-moss-100 text-moss-800'
            }`}
          >
            <p className="font-medium">
              {wasDryRun ? 'Dry run — nothing was written' : 'Import complete'}
            </p>
            <p className="tabular mt-1 text-xs">
              {result.totalRows} rows · {result.created} {wasDryRun ? 'would be created' : 'created'}
              {result.updated > 0 && ` · ${result.updated} updated`}
              {result.duplicates > 0 && ` · ${result.duplicates} duplicates skipped`}
              {result.failed > 0 && ` · ${result.failed} failed`}
            </p>

            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    <span className="font-mono">{e.row > 0 ? `line ${e.row}` : ''}</span>{' '}
                    {e.field && <span className="font-mono">[{e.field}]</span>} {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {result && !wasDryRun ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!csv.trim() || importCsv.isPending}
            onClick={() => importCsv.mutate({ csv, dryRun: true, defaultSource })}
          >
            Dry run
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!csv.trim() || importCsv.isPending}
            onClick={() => importCsv.mutate({ csv, dryRun: false, defaultSource })}
          >
            {importCsv.isPending ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
