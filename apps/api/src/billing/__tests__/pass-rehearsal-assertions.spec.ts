import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  discountMatchesPercent,
  discountPriceIds,
  renewalIsFullPrice,
  SANDBOX_API_ORIGIN,
  withinWindow,
} from '../../../scripts/helpers/pass-rehearsal-assertions.js';

describe('Backlog Pass sandbox rehearsal checks', () => {
  it('accepts a thirty percent discount and a full-price renewal', () => {
    expect(discountMatchesPercent('5900', '1770', 30)).toBe(true);
    expect(discountMatchesPercent('5900', '0', 30)).toBe(false);
    expect(discountMatchesPercent('5900', '1771', 30)).toBe(false);
    expect(renewalIsFullPrice('5900', '0', '5900')).toBe(true);
    expect(renewalIsFullPrice('5900', '1770', '5900')).toBe(false);
    expect(renewalIsFullPrice('4130', '0', '5900')).toBe(false);
  });

  it('accepts only the two rehearsed price ids', () => {
    const prices = ['pri_annual', 'pri_pass'];
    expect(discountPriceIds(['pri_pass', 'pri_annual'], prices)).toBe(true);
    expect(discountPriceIds(['pro_plus', 'pri_annual', 'pri_pass'], prices)).toBe(true);
    expect(discountPriceIds(['pri_annual', 'pri_pass', 'pri_other'], prices)).toBe(false);
    expect(discountPriceIds(['pro_plus'], prices)).toBe(false);
  });

  it('keeps a thirty day grant inside the checkout slack', () => {
    const day = 30 * 24 * 60 * 60 * 1000;
    const expires = new Date(Date.now() + day - 60_000);
    expect(withinWindow(expires, Date.now() + day, 15 * 60 * 1000)).toBe(true);
    expect(
      withinWindow(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), Date.now() + day, 60_000),
    ).toBe(false);
  });

  it('talks only to the sandbox API', () => {
    expect(SANDBOX_API_ORIGIN).toBe('https://sandbox-api.paddle.com');
    const source = readFileSync(
      resolve(import.meta.dirname, '../../../scripts/billing-pass-sandbox-rehearsal.ts'),
      'utf8',
    );
    expect(source).not.toContain('https://api.paddle.com');
    const caller = readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../../.github/workflows/billing-checkout-revocation-rehearsal.yml',
      ),
      'utf8',
    );
    expect(caller).toContain('environment: Sandbox');
    expect(caller).toContain("github.ref == 'refs/heads/codex/ws1b-pricing-story-pass'");
    expect(caller).toContain('PADDLE_ENV: sandbox');
    expect(caller).not.toContain('PADDLE_ENV: production');
    expect(caller).toContain('scripts/billing-pass-sandbox-rehearsal.ts');
    expect(caller).toContain('Load the sandbox operator key');
    expect(caller).toContain('Name the sandbox boundary shape');
    expect(caller).toContain("github.event.inputs.rehearsal == 'pass'");
    expect(caller).toContain("github.event.inputs.rehearsal != 'pass'");
    expect(caller).not.toContain('secrets: inherit');
    expect(caller).not.toContain('workflow_call:');
    expect(caller).not.toMatch(/^ {2}pass:/m);
  });
});
