/**
 * Generated-file storage.
 *
 * Files live on disk under STORAGE_DIR; the Document row stores a path
 * *relative* to it, so the volume can move without rewriting rows.
 */

import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { env } from '../config.js';

/** Safe filename fragment — no separators, no traversal, no shell surprises. */
export function slugify(value: string, maxLength = 60): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .toLowerCase();
  return slug || 'document';
}

/**
 * Resolve a relative storage path to an absolute one, refusing anything that
 * escapes STORAGE_DIR. The path can originate from a database row, so treating
 * it as trusted would turn a bad row into an arbitrary-file read.
 */
export function resolveStoragePath(relativePath: string): string {
  const root = resolve(env.STORAGE_DIR);
  const target = resolve(root, normalize(relativePath));

  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Refusing to access "${relativePath}" — it escapes the storage directory`);
  }
  return target;
}

export async function saveDocument(relativePath: string, contents: Buffer): Promise<number> {
  const absolute = resolveStoragePath(relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, contents);
  return contents.byteLength;
}

export async function readDocument(relativePath: string): Promise<Buffer> {
  return readFile(resolveStoragePath(relativePath));
}

export async function documentExists(relativePath: string): Promise<boolean> {
  try {
    await stat(resolveStoragePath(relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the relative path for a new document.
 *
 * Partitioned by year and month so a directory listing stays usable after a
 * few thousand quotations, and suffixed with a short random token so two
 * quotations for the same lead on the same day cannot collide.
 */
export function buildStoragePath(
  type: 'quotation' | 'presentation',
  label: string,
  extension: string,
): { relativePath: string; filename: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const token = Math.random().toString(36).slice(2, 8);

  const filename = `${slugify(label)}-${year}${month}${day}-${token}.${extension}`;
  return { relativePath: join(type, String(year), month, filename), filename };
}
