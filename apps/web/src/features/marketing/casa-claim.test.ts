/**
 * The CASA verification claim has ONE source and no hand-written twin.
 *
 * Google's OAuth verification recertifies annually, so the date is a
 * claim that goes stale on a known schedule. It was previously written
 * out on four separate surfaces — `/privacy`, `/security`, Settings →
 * Privacy & Data, and (as of the trust-strip change) the landing page —
 * which meant the next recertification would update only the ones
 * somebody remembered. This is the repo's signature defect class (a
 * surface asserting something it does not know) pointed at the
 * product's only third-party credential.
 *
 * These tests read the SOURCE FILES rather than rendering, because what
 * must not come back is a literal in the source, not a string on a
 * screen. A render test would pass just as happily against a
 * hand-written date that happens to match today.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CASA_VERIFICATION_APPROVED_MONTH,
  CASA_VERIFICATION_APPROVED_ON,
} from '@declutrmail/shared';

/** Every source file that renders the verification claim. */
const CLAIM_SITES = [
  'src/app/(marketing)/security/page.tsx',
  'src/app/(marketing)/privacy/page.tsx',
  'src/features/settings/privacy-data/privacy-data-screen.tsx',
  'src/features/marketing/landing/hero.tsx',
] as const;

const read = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), 'utf8');

describe('CASA verification claim', () => {
  it.each(CLAIM_SITES)('%s carries no hand-written date literal', (site) => {
    const source = read(site);
    expect(source).not.toContain(CASA_VERIFICATION_APPROVED_ON);
    // The month-only form is the narrow-surface variant and is equally
    // a claim, so it may not be inlined either.
    expect(source).not.toContain(`in ${CASA_VERIFICATION_APPROVED_MONTH}`);
    expect(source).not.toContain(`, ${CASA_VERIFICATION_APPROVED_MONTH} (`);
  });

  it.each(CLAIM_SITES)('%s imports the claim from shared copy', (site) => {
    expect(read(site)).toMatch(/CASA_VERIFICATION_APPROVED_(ON|MONTH)/);
  });

  it('never upgrades "approved" to a certification on a claim site', () => {
    // Google approved a verification for one restricted scope. It did
    // not certify or audit the product, and no surface may say it did.
    for (const site of CLAIM_SITES) {
      const source = read(site);
      for (const overstatement of ['CASA certified', 'CASA-certified', 'CASA audited']) {
        expect(source, `${site} must not claim "${overstatement}"`).not.toContain(overstatement);
      }
    }
  });

  it('is a positive control — the constants are the real published values', () => {
    // If these ever drift, every assertion above silently starts
    // checking for the wrong string.
    expect(CASA_VERIFICATION_APPROVED_ON).toBe('21 April 2026');
    expect(CASA_VERIFICATION_APPROVED_MONTH).toBe('April 2026');
    expect(CASA_VERIFICATION_APPROVED_ON).toContain(CASA_VERIFICATION_APPROVED_MONTH);
  });
});
