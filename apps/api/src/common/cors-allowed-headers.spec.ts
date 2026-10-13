import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHECKOUT_GEO_HEADER } from '@declutrmail/shared/billing/checkout-geo-header';

import { CORS_ALLOWED_HEADERS } from './cors-allowed-headers.js';

describe('CORS_ALLOWED_HEADERS', () => {
  it('allows the India checkout geo token (#1020 / DECLUTRMAIL-WEB-2V)', () => {
    expect(CORS_ALLOWED_HEADERS).toContain(CHECKOUT_GEO_HEADER);
  });

  it('keeps the request headers that already preflighted before #1020', () => {
    expect(CORS_ALLOWED_HEADERS).toEqual(
      expect.arrayContaining([
        'Content-Type',
        'X-CSRF-Token',
        'X-Active-Mailbox-Id',
        'Idempotency-Key',
      ]),
    );
  });

  it('is the list enableCors actually uses', () => {
    const main = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');
    expect(main).toMatch(/allowedHeaders:\s*\[\s*\.\.\.CORS_ALLOWED_HEADERS\s*\]/);
  });
});
