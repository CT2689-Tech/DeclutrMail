import { describe, expect, it } from 'vitest';

import { clampLimit, decodeCursor, encodeCursor, ok, paginated, withMeta } from './paginate.js';
import type { DecodedCursor } from './envelope.js';

/**
 * D202 envelope helpers — unit tests (D201/D202).
 *
 * The envelope is the wire shape every controller returns; if these
 * helpers misbehave, every endpoint's contract drifts at once. The
 * tests lock:
 *
 *   - `ok()` and `withMeta()` produce the shapes their types claim
 *     (TS would catch most of this, but a sanity assertion costs
 *     nothing and guards against future careless edits).
 *   - `paginated()` derives `hasMore` from `nextCursor`'s nullability,
 *     so the FE only ever needs to read one of the two fields.
 *   - `encodeCursor` ↔ `decodeCursor` round-trip cleanly.
 *   - `decodeCursor` returns `null` for every flavor of bad input —
 *     malformed base64, valid base64 of non-JSON, valid JSON of the
 *     wrong shape — so controllers can rely on the contract "null
 *     means 400, not 500".
 *   - `clampLimit` honors its bounds for the common inputs the
 *     senders/messages controllers will throw at it.
 */

describe('ok()', () => {
  it('wraps the payload in `{ data }` with no meta', () => {
    expect(ok({ id: 'sndr_1' })).toEqual({ data: { id: 'sndr_1' } });
  });
});

describe('withMeta()', () => {
  it('wraps with both data and meta', () => {
    const env = withMeta({ id: 'sndr_1' }, { computedAt: '2026-05-23T00:00:00Z' });
    expect(env).toEqual({
      data: { id: 'sndr_1' },
      meta: { computedAt: '2026-05-23T00:00:00Z' },
    });
  });
});

describe('paginated()', () => {
  it('sets hasMore=true when nextCursor is provided', () => {
    const env = paginated({ items: [1, 2, 3], limit: 3, nextCursor: 'abc' });
    expect(env.meta.pagination).toEqual({ nextCursor: 'abc', hasMore: true, limit: 3 });
    expect(env.data).toEqual([1, 2, 3]);
  });

  it('sets hasMore=false when nextCursor is null (last page)', () => {
    const env = paginated({ items: [1, 2], limit: 5, nextCursor: null });
    expect(env.meta.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 5 });
  });

  it('echoes the server-honored limit (not the client request)', () => {
    // Controllers clamp the request limit and pass the clamped value
    // here; the FE reads `meta.pagination.limit` to know the actual
    // page size.
    const env = paginated({ items: [], limit: 100, nextCursor: null });
    expect(env.meta.pagination.limit).toBe(100);
  });
});

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a typical sort-by-date cursor', () => {
    const original: DecodedCursor = { key: '2026-05-23T00:00:00.000Z', id: 'msg_uuid_42' };
    const encoded = encodeCursor(original);
    expect(typeof encoded).toBe('string');
    // base64url alphabet only: A–Z a–z 0–9 -_ (no `+` `/` `=`).
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(original);
  });

  it.each([
    ['empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['random garbage', '!!!not-base64!!!'],
    ['base64 of non-JSON', Buffer.from('hello world').toString('base64url')],
    ['JSON of wrong shape', Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url')],
    [
      'JSON with non-string key',
      Buffer.from(JSON.stringify({ key: 42, id: 'x' })).toString('base64url'),
    ],
  ])('returns null for %s', (_label, input) => {
    expect(decodeCursor(input as string | null | undefined)).toBeNull();
  });
});

describe('clampLimit()', () => {
  const bounds = { def: 25, min: 1, max: 100 };

  it('returns the default for missing input', () => {
    expect(clampLimit(undefined, bounds)).toBe(25);
    expect(clampLimit(null, bounds)).toBe(25);
    expect(clampLimit('', bounds)).toBe(25);
  });

  it('returns the default for non-numeric input', () => {
    expect(clampLimit('abc', bounds)).toBe(25);
    expect(clampLimit('NaN', bounds)).toBe(25);
  });

  it('clamps to the max ceiling', () => {
    expect(clampLimit('500', bounds)).toBe(100);
  });

  it('clamps to the min floor', () => {
    expect(clampLimit('0', bounds)).toBe(1);
    expect(clampLimit('-5', bounds)).toBe(1);
  });

  it('passes through values inside the range', () => {
    expect(clampLimit('50', bounds)).toBe(50);
  });
});
