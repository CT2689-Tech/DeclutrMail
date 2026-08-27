/**
 * Guards `content-registry.ts` against the failure it exists to prevent:
 * a new content module that no truth-gate scans.
 *
 * The registry is only load-bearing if forgetting it FAILS. Without this
 * test, an unregistered module is silently invisible to `screener-truth`,
 * `engagement-truth` and `tier-truth` — which is the exact blind-guard
 * shape the registry was written to kill.
 *
 * Note the first assertion. This scanner reads from disk, so its own
 * blind case is an empty file list: a glob that matches nothing would
 * make every later assertion vacuously true and report a clean pass
 * having checked no modules at all. The floor is asserted FIRST and
 * deliberately, before anything is compared.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MARKETING_CONTENT_CORPUS, MARKETING_CONTENT_MODULE_IDS } from './content-registry';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Content modules on disk, by convention: `learn/*-content.ts` plus the
 * comparison dataset. Excludes tests, types, and render files.
 */
function contentModulesOnDisk(): string[] {
  const learn = readdirSync(join(HERE, 'learn'))
    .filter((file) => file.endsWith('-content.ts'))
    .map((file) => `learn/${file.replace(/\.ts$/, '')}`);
  const comparison = readdirSync(join(HERE, 'comparison'))
    .filter((file) => file === 'comparison-data.ts')
    .map((file) => `comparison/${file.replace(/\.ts$/, '')}`);
  return [...learn, ...comparison].sort();
}

describe('marketing content registry', () => {
  it('discovers content modules on disk at all', () => {
    // Blind case. If the glob stops matching — a rename, a moved
    // directory — every assertion below passes while checking nothing.
    // Fail loudly here instead.
    const found = contentModulesOnDisk();
    expect(found.length, 'no content modules found on disk — the scanner is blind').toBeGreaterThan(
      3,
    );
  });

  it('registers every content module that ships', () => {
    const onDisk = contentModulesOnDisk();
    const registered: readonly string[] = [...MARKETING_CONTENT_MODULE_IDS].sort();

    const unregistered = onDisk.filter((id) => !registered.includes(id));
    expect(
      unregistered,
      `these content modules ship but no truth-gate scans them — add them to content-registry.ts: ${unregistered.join(', ')}`,
    ).toEqual([]);
  });

  it('registers nothing that does not exist', () => {
    const onDisk = contentModulesOnDisk();
    const stale = [...MARKETING_CONTENT_MODULE_IDS].filter((id) => !onDisk.includes(id));
    expect(stale, `registry references modules that no longer exist: ${stale.join(', ')}`).toEqual(
      [],
    );
  });

  it('exposes a non-empty corpus for the truth-gates to scan', () => {
    expect(MARKETING_CONTENT_CORPUS.length).toBe(MARKETING_CONTENT_MODULE_IDS.length);
    for (const collection of MARKETING_CONTENT_CORPUS) {
      expect(collection).toBeTruthy();
    }
  });
});
