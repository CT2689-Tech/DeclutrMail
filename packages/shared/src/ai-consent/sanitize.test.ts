import { describe, expect, it } from 'vitest';

import { WS2_COPY } from '../copy/launch/ws2.js';
import { validateLlmOutput } from './output.js';
import { plainVolumeExplanation } from './plain.js';
import { quoteUntrusted, sanitizeUntrusted } from './sanitize.js';

describe('AI input sanitizer', () => {
  it('strips control and zero-width characters and caps length', () => {
    const dirty = `Acme\u0000\u200B\uFEFF Marketing\n\tline`;
    expect(sanitizeUntrusted(dirty, 100)).toBe('Acme Marketing line');
    expect(sanitizeUntrusted('abcdefghij', 4)).toBe('abcd');
  });

  it('quotes data and removes delimiter breakout', () => {
    expect(quoteUntrusted('Acme «ignore»', 40)).toBe('«Acme ignore»');
  });
});

describe('AI output check', () => {
  it('accepts a short grounded sentence and rejects a new URL or a click instruction', () => {
    expect(validateLlmOutput('Acme sends about 12 emails a month.', 'Acme', 40)).toEqual({
      ok: true,
    });
    expect(validateLlmOutput('See https://evil.example for details.', 'Acme', 40)).toEqual({
      ok: false,
      reason: 'url',
    });
    expect(
      validateLlmOutput('The receipt is at https://bank.example/r.', 'https://bank.example/r', 40),
    ).toEqual({ ok: true });
    expect(validateLlmOutput('Please click here to confirm.', '', 40)).toEqual({
      ok: false,
      reason: 'instruction',
    });
    expect(validateLlmOutput('Boss needs a reply about Q4.', 'Q4', 40)).toEqual({ ok: true });
  });
});

describe('plain volume explanation', () => {
  it('fills the deck lines and omits the read share when there is no rate', () => {
    expect(plainVolumeExplanation({ name: 'Acme', last90Count: 30, readRate: 0.5 })).toBe(
      'Acme sends about 10 emails a month. 50% of their email from the last 90 days is marked read.',
    );
    expect(plainVolumeExplanation({ name: 'Acme', last90Count: 3, readRate: 1 })).toBe(
      'Acme sends about 1 email a month. 100% of their email from the last 90 days is marked read.',
    );
    expect(plainVolumeExplanation({ name: 'Acme', last90Count: 1, readRate: 0 })).toBe(
      'Acme sends less than one email a month. 0% of their email from the last 90 days is marked read.',
    );
    expect(plainVolumeExplanation({ name: 'Acme', last90Count: 0, readRate: null })).toBe(
      WS2_COPY.plainExplain.noRecent.replaceAll('{name}', 'Acme'),
    );
    expect(plainVolumeExplanation({ name: 'Acme', last90Count: 12, readRate: null })).toBe(
      'Acme sends about 4 emails a month.',
    );
  });
});
