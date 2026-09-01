/**
 * Storage path handling.
 *
 * `storagePath` comes out of a database row, so treating it as trusted would
 * turn one bad row into an arbitrary-file read. These tests pin the refusal.
 */

import { describe, expect, it } from 'vitest';
import { buildStoragePath, resolveStoragePath, slugify } from './storage.js';

describe('slugify', () => {
  it('makes a filename-safe fragment', () => {
    expect(slugify('Sharma Dry Fruits & Co.')).toBe('sharma-dry-fruits-co');
  });

  it('strips path separators so a name cannot introduce a directory', () => {
    expect(slugify('../../etc/passwd')).not.toContain('/');
    expect(slugify('a/b\\c')).toBe('a-b-c');
  });

  it('falls back rather than returning an empty name', () => {
    expect(slugify('///')).toBe('document');
    expect(slugify('')).toBe('document');
  });

  it('truncates a very long name', () => {
    expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe('resolveStoragePath', () => {
  it('resolves a normal relative path', () => {
    expect(resolveStoragePath('quotation/2026/09/a.docx')).toContain('quotation/2026/09/a.docx');
  });

  it.each([
    '../../../etc/passwd',
    'quotation/../../../etc/shadow',
    '../outside.docx',
  ])('refuses the traversal %s', (path) => {
    expect(() => resolveStoragePath(path)).toThrow(/escapes the storage directory/);
  });

  it('allows a path that merely contains dots inside a filename', () => {
    expect(() => resolveStoragePath('quotation/2026/09/q..2.docx')).not.toThrow();
  });
});

describe('buildStoragePath', () => {
  it('partitions by type, year and month', () => {
    const { relativePath } = buildStoragePath('quotation', 'Sharma Traders', 'docx');
    const year = String(new Date().getFullYear());
    expect(relativePath).toMatch(new RegExp(`^quotation/${year}/\\d{2}/`));
    expect(relativePath.endsWith('.docx')).toBe(true);
  });

  it('produces a unique name for repeated calls, so same-day quotations cannot collide', () => {
    const a = buildStoragePath('quotation', 'Sharma Traders', 'docx');
    const b = buildStoragePath('quotation', 'Sharma Traders', 'docx');
    expect(a.filename).not.toBe(b.filename);
  });

  it('never escapes the storage root even for a hostile label', () => {
    const { relativePath } = buildStoragePath('quotation', '../../etc/passwd', 'docx');
    expect(() => resolveStoragePath(relativePath)).not.toThrow();
  });
});
