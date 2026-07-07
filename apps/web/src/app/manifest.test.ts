/**
 * manifest.webmanifest tests (D132 SEO batch — favicon completeness).
 *
 * The manifest declares icon URLs as strings; nothing at build time
 * proves the files exist. These tests pin each declared icon to a real
 * file on disk, and lock the full favicon set (SVG + ICO fallback +
 * apple-touch PNG) shipped next to this route.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import manifest from './manifest';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(appDir, '../../public');

describe('manifest.webmanifest — D132', () => {
  it('declares 192 + 512 icons plus a maskable variant', () => {
    const icons = manifest().icons ?? [];
    expect(icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('every declared icon resolves to a real file under public/', () => {
    for (const icon of manifest().icons ?? []) {
      expect(existsSync(path.join(publicDir, icon.src)), `missing ${icon.src}`).toBe(true);
    }
  });

  it('the static favicon set is complete next to the app root', () => {
    for (const file of ['icon.svg', 'apple-icon.png', 'favicon.ico']) {
      expect(existsSync(path.join(appDir, file)), `missing app/${file}`).toBe(true);
    }
  });
});
